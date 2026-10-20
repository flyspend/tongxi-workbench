'use strict';
// Autonomous task routing belongs to the server, never to a browser timer.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const active = t => ['starting', 'running', 'stopping'].includes(t.status);
const validText = (v, max = 60000) => { if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error('接力文本为空或过长'); return v.trim(); };
const reportBlock = result => {
  const blocks = [...String(result).matchAll(/```workbench\s*\n([\s\S]*?)\n```/g)];
  if (blocks.length > 1) throw new Error('结束报告只能包含一个 workbench 块');
  return blocks.length ? JSON.parse(blocks[0][1]) : null;
};
class Relay {
  constructor(wb) { this.wb = wb; wb.state.workflows ||= []; this.channels = new Map(); this.scheduled = false; this.pumping = false; }
  flow(id) { const f = this.wb.state.workflows.find(f => f.id === id); if (!f) throw new Error('任务组不存在'); return f; }
  members(f) { return this.wb.state.tasks.filter(t => t.workflowId === f.id); }
  create(input) {
    this.wb.project(input.projectId);
    const maxTasks = input.maxTasks === undefined ? 24 : Number(input.maxTasks);
    if (!Number.isInteger(maxTasks) || maxTasks < 2 || maxTasks > 100) throw new Error('接力任务上限必须在 2 到 100 之间');
    const f = { id: crypto.randomUUID(), projectId: input.projectId, title: validText(input.title, 200), goal: validText(input.prompt), status: 'running', maxTasks, createdAt: new Date().toISOString(), reason: '' };
    this.wb.state.workflows.unshift(f); return f;
  }
  open() {
    for (const f of this.wb.state.workflows) if (f.status === 'running' && this.members(f).some(t => t.status === 'interrupted')) {
      f.status = 'blocked'; f.reason = '工作台重启时有执行未完成，请检查中断任务后重试';
    }
    this.wb.save(); this.wake();
  }
  enqueue(id) {
    const t = this.wb.task(id);
    if (active(t) || t.status === 'done') throw new Error('该任务不能加入执行队列');
    t.autoStart = true; t.status = 'queued'; t.error = ''; t.queuedAt = new Date().toISOString();
    this.wb.event('已接收，自动排队：' + t.title, t.id); this.wb.save(); this.wake(); return t;
  }
  wake() {
    if (this.pumping) { this.again = true; return; }
    if (this.scheduled || this.wb.closing) return;
    this.scheduled = true;
    setImmediate(() => { this.scheduled = false; this.pump().catch(err => { this.wb.event('接力调度异常：' + err.message); this.wb.save(); }); });
  }
  async pump() {
    if (this.pumping || this.wb.closing) return;
    this.pumping = true;
    try {
      this.wb.autoReview?.sweep();
      const queued = this.wb.state.tasks.filter(t => t.status === 'queued' && t.autoStart).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
      for (const t of queued) {
        if (this.wb.closing) break;
        const f = t.workflowId ? this.flow(t.workflowId) : null;
        if (f && f.status !== 'running') continue;
        if (t.dependencies.some(id => this.wb.task(id).status !== 'done')) continue;
        if (this.wb.state.tasks.some(x => active(x) && (x.provider === t.provider || t.workspace && t.workspace === x.workspace))) continue;
        if (!t.workspace && t.continueFrom && this.wb.state.tasks.some(x => x.id === t.continueFrom && (active(x) || x.status === 'queued'))) continue;
        if (!this.wb.executable(t.provider)) {
          t.error = t.provider + ' 尚未连接；配置通道后会继续执行';
          if (f) { f.status = 'blocked'; f.reasonCode = 'provider'; f.reason = t.error; }
          this.wb.save(); continue;
        }
        if (this.wb.external.member(t.provider)) continue; // External clients claim queued tasks themselves.
        try { await this.wb.start(t.id); }
        catch (err) {
          t.status = 'blocked'; t.error = err.message;
          if (f) { f.status = 'blocked'; f.reasonCode = 'task'; f.reason = t.error; }
          this.wb.save();
        }
      }
      for (const f of this.wb.state.workflows) this.summarize(f);
      this.wb.autoReview?.sweep();
      this.wb.save();
    } finally { this.pumping = false; if (this.again) { this.again = false; this.wake(); } }
  }
  summarize(f) {
    if (f.status !== 'running') return;
    const tasks = this.members(f);
    const problem = tasks.find(t => !t.supersededBy && ['failed', 'blocked', 'interrupted', 'stopped'].includes(t.status));
    if (problem) { f.status = 'blocked'; f.reasonCode = 'task'; f.reason = problem.title + '：' + (problem.error || problem.status); return; }
    if (tasks.length && tasks.every(t => t.status === 'done' || t.supersededBy)) {
      f.status = 'completed'; f.completedAt = new Date().toISOString(); f.reason = '';
      this.wb.event((f.chat ? '对话已回复，等你下一条消息：' : '整组任务已由 AI 完成：') + f.title);
    }
  }
  async control(id, action) {
    const f = this.flow(id);
    if (action === 'pause') { if (f.status === 'completed') throw new Error('任务组已经完成'); f.status = 'paused'; f.reason = '已暂停接收后续任务，当前执行会保留'; }
    else if (action === 'stop') {
      f.status = 'stopped'; f.reason = '已手动停止整组任务';
      for (const t of this.members(f)) {
        if (t.status === 'queued') { t.status = 'stopped'; t.autoStart = false; }
        if (active(t)) await this.wb.stop(t.id);
      }
    } else if (action === 'resume') {
      if (f.status === 'completed') throw new Error('任务组已经完成');
      if (this.members(f).some(t => !t.supersededBy && ['failed', 'interrupted', 'stopped', 'blocked'].includes(t.status))) throw new Error('请先重试或处理失败/停止的任务；不能跳过它们宣告完成');
      if (f.reasonCode === 'limit') throw new Error('已达到本组接力上限，请查看结果后新建任务组');
      f.status = 'running'; f.reason = ''; f.reasonCode = '';
    } else throw new Error('未知任务组操作');
    this.wb.save(); this.wake(); return f;
  }
  settingsChanged() {
    for (const f of this.wb.state.workflows) if (f.status === 'blocked' && f.reasonCode === 'provider' && this.members(f).filter(t => t.status === 'queued').every(t => this.wb.executable(t.provider))) { f.status = 'running'; f.reason = ''; f.reasonCode = ''; }
    this.wake();
  }
  prepare(t) {
    if (!t.workflowId) return null;
    const f = this.flow(t.workflowId);
    if (['paused', 'stopped', 'completed'].includes(f.status)) throw new Error('请先继续任务组再执行');
    f.status = 'running'; f.reason = ''; f.reasonCode = '';
    const nonce = crypto.randomBytes(24).toString('hex');
    const dir = path.join(this.wb.runDir(t), 'mailboxes', t.runs + '-' + nonce);
    for (const sub of ['outbox', 'receipts']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
    const channel = { dir, nonce, seen: new Map(), sent: [], disposition: null, protocolError: '', run: t.runs };
    this.channels.set(t.id, channel); return channel;
  }
  environment(t, channel) {
    return channel ? { WORKBENCH_AGENT_MAILBOX: channel.dir, WORKBENCH_AGENT_NONCE: channel.nonce, WORKBENCH_AGENT_TASK: t.id, WORKBENCH_AGENT_RUN: String(t.runs), WORKBENCH_AGENT_PROVIDER: t.provider, WORKBENCH_BRIDGE: path.join(__dirname, 'bridge.cjs'), WORKBENCH_NODE: process.execPath } : {};
  }
  instructions(t) {
    if (!t.workflowId) return '';
    const f = this.flow(t.workflowId);
    const progress = this.members(f).slice(0, 30).map(x => `${x.provider}: ${x.title} [${x.status}]`).join('\n');
    return `自动接力任务组（无需用户逐步确认）：${f.title}\n总目标：${f.goal}\n整组进度：\n${progress}\n
可用成员 ID：${this.wb.providerIds(t.projectId).map(id => id + "=" + this.wb.providerName(id)).join(", ")}。你可以给这些成员发后续任务。需要对方检查/修复/补全时，结束回复的末尾必须给一个 workbench 代码块，例如：
\`\`\`workbench
{"action":"handoff","provider":"${t.provider === 'codex' ? 'claude' : 'codex'}","title":"复核并继续","prompt":"具体检查、验收和需要修复的内容","mode":"review"}
\`\`\`
服务器会自动投递、等你退出后启动对方，沿用你的工作目录和未提交代码。接收方还可交回任务，不要要求用户再点开始，不要在本次进程中等待接收方完成。
有命令工具时也可运行环境变量 WORKBENCH_NODE 指向的 Node，以 WORKBENCH_BRIDGE 为脚本：send --to 同一项目成员ID --title 标题 --prompt 具体任务 --mode edit|review。桥接使用本轮专属文件信箱，不需要网络或主控凭证。send 默认顺序交接；显式 --strategy parallel 才创建独立目录并行，不能用来接续未提交代码。先发送，再结束当前执行。
只读审查/没有命令工具时只需输出上述 workbench 块，同样自动投递。
当前职责和验证确已完成时，末尾输出：
\`\`\`workbench
{"action":"complete","summary":"完成了什么","validation":["实际运行的检查及结果；未执行的明确说明"],"remaining":[]}
\`\`\`
有实质未完成工作就发送后续任务；只在确需用户权限、认证或决定时输出 {"action":"block","reason":"具体原因"}。不要把正常 CLI 退出当作整套完成。子任务全完成后工作台才结束整组。不要自动合并、推送或部署。每组最多 ${f.maxTasks} 项任务以阻止无限互派。`;
  }
  attach(t, channel) {
    if (!channel) return;
    channel.timer = setInterval(() => { try { this.drain(t, channel); } catch (e) { channel.protocolError = e.message; } }, 150);
    channel.timer.unref();
  }
  drain(t, channel) {
    const out = path.join(channel.dir, 'outbox');
    for (const name of fs.readdirSync(out).filter(n => /^[a-zA-Z0-9-]{1,100}\.json$/.test(n)).slice(0, 128)) {
      if (channel.seen.has(name)) continue;
      const file = path.join(out, name); let response;
      try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw new Error('信箱消息不是合法文件或超过 64KB');
        const request = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (request.nonce !== channel.nonce || request.taskId !== t.id || request.run !== channel.run) throw new Error('不是本轮任务的信箱凭证');
        response = { ok: true, ...this.receive(t, channel, request) };
      } catch (e) { response = { ok: false, error: e.message }; }
      channel.seen.set(name, response);
      fs.writeFileSync(path.join(channel.dir, 'receipts', name), JSON.stringify(response), { mode: 0o600 });
    }
  }
  receive(t, channel, request) {
    if (this.channels.get(t.id) !== channel || channel.run !== t.runs || !active(t) && !channel.finishing) throw new Error('该执行轮次已结束');
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('接力消息格式不正确');
    const f = this.flow(t.workflowId);
    if (['stopped', 'completed'].includes(f.status) || this.wb.closing) throw new Error('该任务组已停止接收');
    if (request.projectId || request.workflowId || request.workspace || request.sourceId) throw new Error('代理不能更换所属项目、任务组或工作目录');
    if (request.action === 'progress') {
      t.progress = validText(request.message, 2000); this.wb.log(t, 'system', t.progress); this.wb.save(); return { status: 'recorded' };
    }
    if (['send', 'handoff'].includes(request.action)) {
      if (!this.wb.providerIds(t.projectId).includes(request.provider)) throw new Error('请选择同一项目的成员 ID / Select a member of the same project');
      const title = validText(request.title, 200), prompt = validText(request.prompt);
      const strategy = request.strategy || 'handoff';
      if (!['handoff', 'parallel'].includes(strategy)) throw new Error('无效的接力方式');
      const fingerprint = crypto.createHash('sha256').update(JSON.stringify([request.provider, title, prompt, strategy, request.mode])).digest('hex');
      const existing = channel.sent.find(s => s.fingerprint === fingerprint);
      if (existing) return { taskId: existing.id, status: 'queued', duplicate: true };
      if (this.members(f).length >= f.maxTasks) { f.status = 'blocked'; f.reasonCode = 'limit'; f.reason = '达到接力上限 ' + f.maxTasks + '，已停止继续互派'; this.wb.save(); throw new Error(f.reason); }
      const target = this.wb.createTask({ projectId: t.projectId, workflowId: f.id, provider: request.provider, title, prompt, language: t.language, mode: request.mode, scope: t.scope, dependencies: strategy === 'handoff' ? [t.id] : [] });
      target.sourceId = t.id; target.deliveryStrategy = strategy;
      if (strategy === 'handoff') { target.workspace = t.workspace; target.branch = t.branch; }
      target.sentBy = t.provider; target.senderTaskId = t.id;
      channel.sent.push({ id: target.id, fingerprint }); t.sentTaskIds ||= []; t.sentTaskIds.push(target.id);
      this.wb.event(t.provider + ' → ' + target.provider + '：AI 直接派发 ' + target.title, target.id);
      this.enqueue(target.id); return { taskId: target.id, status: 'queued', startsAfterSender: strategy === 'handoff' };
    }
    if (request.action === 'complete') {
      const summary = validText(request.summary, 10000);
      if (!Array.isArray(request.validation) || !request.validation.length || request.validation.some(x => typeof x !== 'string' || x.length > 4000)) throw new Error('结束报告必须说明实际验证；未运行的明确说明');
      if (!Array.isArray(request.remaining) || request.remaining.length) throw new Error('仍有未完成项，请交接或明确阻塞原因');
      channel.disposition = { action: 'complete', summary, validation: request.validation }; return { status: 'pending-exit' };
    }
    if (request.action === 'block') { channel.disposition = { action: 'block', reason: validText(request.reason, 4000) }; return { status: 'pending-exit' }; }
    throw new Error('不支持的 AI 消息操作');
  }
  finish(t, channel, cancelled) {
    if (!channel) return;
    channel.finishing = true;
    clearInterval(channel.timer);
    try {
      this.drain(t, channel);
      // Failed/cancelled turns cannot schedule a directive hidden in an unsuccessful final result.
      if (!cancelled && t.status === 'review') {
        const directive = reportBlock(t.result);
        if (directive) this.receive(t, channel, directive);
        if (channel.protocolError) throw new Error(channel.protocolError);
        if (channel.disposition?.action === 'block') { t.status = 'blocked'; t.error = channel.disposition.reason; }
        else if (channel.disposition?.action === 'complete' || channel.sent.length) {
          t.status = 'done'; t.completionKind = 'agent';
          if (channel.disposition?.action === 'complete') { t.validation = channel.disposition.validation; t.completionSummary = channel.disposition.summary; }
        } else if (this.flow(t.workflowId).chat) {
          // 聊天里直接回答问题是正常结束：显示为“已回复”，等用户下一条消息，不当作阻塞
          t.status = 'done'; t.completionKind = 'reply';
        } else { t.status = 'blocked'; t.error = 'AI 未提交完成/交接报告；请重试并要求明确剩余工作，未将本组误判为完成'; }
      }
    } catch (e) { if (!cancelled && t.status === 'review') { t.status = 'blocked'; t.error = '接力报告无效：' + e.message; } }
    finally { this.channels.delete(t.id); }
    const f = this.flow(t.workflowId); this.summarize(f); this.wake();
  }
}
module.exports = { Relay, reportBlock };
