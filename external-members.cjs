'use strict';
const crypto = require('node:crypto');
const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const now = () => new Date().toISOString();
const active = t => ['starting', 'running', 'stopping'].includes(t.status);
class ExternalMembers {
  constructor(wb) {
    this.wb = wb; wb.state.externalMembers ||= []; this.leases = new Map(); this.claiming = new Set();
    this.timer = setInterval(() => this.expire(), 5000); this.timer.unref();
  }
  list() { return this.wb.state.externalMembers.map(({ secretHash, ...m }) => ({ ...m, online: !m.retired && Date.now() - Date.parse(m.lastSeen) < 90000 })); }
  member(id) { return this.wb.state.externalMembers.find(m => m.id === id); }
  register(input) {
    this.wb.project(input.projectId);
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!/^[\p{L}\p{N}][\p{L}\p{N}_.-]{0,39}$/u.test(name) || /^(user|group|auto|all|both|codex|claude|大家|都|两个)$/i.test(name)) throw new Error('成员名称需为 1–40 个字母、数字、点、横线或下划线，且不能与内置名称重复 / Invalid member name');
    if (this.wb.state.externalMembers.some(m => m.projectId === input.projectId && m.name.toLowerCase() === name.toLowerCase())) throw new Error('该项目已有同名成员；请使用原成员 ID / Member name already exists');
    const key = crypto.randomBytes(32).toString('hex');
    const m = { id: 'ext-' + crypto.randomUUID(), name, projectId: input.projectId, secretHash: digest(key), lastSeen: now(), createdAt: now() };
    this.wb.state.externalMembers.push(m); this.wb.event('外部成员加入 / External member joined: ' + name); this.wb.save();
    return { id: m.id, name, projectId: m.projectId, key };
  }
  auth(input) {
    const m = this.member(input.memberId);
    if (!m || typeof input.key !== 'string' || digest(input.key) !== m.secretHash) throw new Error('成员凭证无效 / Invalid member credentials');
    m.lastSeen = now(); return m;
  }
  job(t) { return { taskId: t.id, run: t.runs, projectId: t.projectId, title: t.title, mode: t.mode, workspace: t.workspace, branch: t.branch, prompt: this.wb.promptFor(t), stopRequested: !!t.cancelRequested }; }
  async claim(input) {
    const m = this.auth(input);
    if (m.retired) throw new Error('成员已离开，请先重新加入 / Rejoin before claiming');
    if (this.claiming.has(m.id)) throw new Error('该成员正在领取任务 / Claim in progress');
    this.claiming.add(m.id);
    try {
      this.expire();
      const current = this.wb.state.tasks.find(t => t.provider === m.id && active(t));
      if (current) { const l = this.leases.get(current.id); if (!l) throw new Error('领取状态未知，请先处理旧任务 / Resolve the previous task'); l.expires = Date.now() + 30 * 60000; this.wb.save(); return { job: this.job(current), lease: l.key }; }
      const t = this.wb.state.tasks.filter(t => t.provider === m.id && t.projectId === m.projectId && t.status === 'queued').sort((a,b) => a.queuedAt.localeCompare(b.queuedAt)).find(t => {
        const f = t.workflowId && this.wb.relay.flow(t.workflowId);
        if (f && f.status !== 'running' || t.dependencies.some(id => this.wb.task(id).status !== 'done')) return false;
        if (!t.workspace && t.continueFrom && this.wb.state.tasks.some(x => x.id === t.continueFrom && (active(x) || x.status === 'queued'))) return false;
        return !this.wb.state.tasks.some(x => active(x) && t.workspace && x.workspace === t.workspace);
      });
      if (!t) { this.wb.save(); return { job: null }; }
      await this.wb.start(t.id, { externalClaim: true });
      if (t.status !== 'running') return { job: null };
      const key = crypto.randomBytes(32).toString('hex'); this.leases.set(t.id, { key, run: t.runs, expires: Date.now() + 30 * 60000 });
      return { job: this.job(t), lease: key };
    } finally { this.claiming.delete(m.id); }
  }
  checked(input) {
    const m = this.auth(input), t = this.wb.task(input.taskId), l = this.leases.get(t.id);
    if (t.provider !== m.id || t.projectId !== m.projectId || !l || l.key !== input.lease || l.run !== t.runs || l.expires <= Date.now() || !active(t)) throw new Error('任务租约无效或已结束 / Invalid or expired task lease');
    return t;
  }
  heartbeat(input) {
    const t = this.checked(input); this.leases.get(t.id).expires = Date.now() + 30 * 60000;
    if (typeof input.message === 'string') t.progress = input.message.slice(0,2000);
    this.wb.save(); return { taskId: t.id, stopRequested: !!t.cancelRequested };
  }
  report(input) {
    const t = this.checked(input);
    if (!['complete','blocked','failed','stopped'].includes(input.status)) throw new Error('Invalid report status');
    if (typeof input.result !== 'string' || !input.result.trim() || input.result.length > 100000) throw new Error('报告不能为空或超过 100KB / Invalid report');
    if (input.status === 'complete' && (!Array.isArray(input.validation) || !input.validation.length || input.validation.some(v => typeof v !== 'string' || !v.trim() || v.length > 4000))) throw new Error('请说明实际验证 / Validation is required');
    const stopped = t.cancelRequested || input.status === 'stopped';
    t.result = input.result; t.finishedAt = now(); t.status = stopped ? 'stopped' : input.status === 'complete' ? 'review' : input.status;
    t.error = stopped ? '外部成员已确认停止 / External member acknowledged stop' : input.status === 'complete' ? '' : input.result.slice(0,2000);
    const channel = this.wb.relay.channels.get(t.id);
    if (!stopped && input.status === 'complete' && channel && !/```workbench\s*\n/.test(t.result)) channel.disposition = { action: 'complete', summary: input.result.slice(0,10000), validation: input.validation };
    if (!channel && t.status === 'review') { t.status = 'done'; t.validation = input.validation; t.completionKind = 'agent'; }
    this.leases.delete(t.id); this.wb.relay.finish(t, channel, stopped); this.wb.log(t,'system', 'External report: ' + t.status); this.wb.save(); this.wb.relay.wake();
    return { taskId: t.id, status: t.status };
  }
  expire() {
    let changed = false;
    for (const [id, l] of this.leases) if (l.expires <= Date.now()) {
      const t = this.wb.task(id); this.leases.delete(id);
      if (!active(t)) continue;
      t.status = 'interrupted'; t.externalUncertain = true; t.error = '外部成员失联；确认已停止后再释放目录 / External lease expired; confirm the worker stopped before releasing its workspace';
      this.wb.relay.finish(t, this.wb.relay.channels.get(id), true); changed = true;
    }
    if (changed) this.wb.save();
  }
  release(input) {
    const m = this.auth(input), t = this.wb.task(input.taskId);
    if (t.provider !== m.id || !t.externalUncertain || input.confirmStopped !== true) throw new Error('请先确认外部执行已停止 / Confirm the external worker has stopped');
    t.externalUncertain = false; this.wb.save(); return { taskId: t.id, released: true };
  }
  leave(input) {
    const m = this.auth(input);
    if (this.wb.state.tasks.some(t => t.provider === m.id && (active(t) || t.status === 'queued' || t.externalUncertain))) throw new Error('先停止并确认未完成的任务 / Resolve outstanding tasks before leaving');
    m.retired = true; this.wb.save(); return { memberId: m.id, left: true };
  }
  rejoin(input) { const m = this.auth(input); m.retired = false; this.wb.save(); return { memberId: m.id, name: m.name, projectId: m.projectId }; }
  stop(t) {
    t.cancelRequested = true; t.status = 'stopping'; t.error = '等待外部成员确认停止；工作台不能终止其他应用 / Awaiting external stop acknowledgement'; this.wb.save();
  }
}
module.exports = { ExternalMembers };
