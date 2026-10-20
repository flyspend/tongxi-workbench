'use strict';
// Agent-to-agent delivery without shell interpolation, cloud proxy or an embedded master token.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function argumentsFor(argv) {
  const [action, ...rest] = argv, options = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!/^--[a-z-]+$/.test(rest[i]) || rest[i + 1] === undefined) throw new Error('参数格式：--名称 值');
    options[rest[i].slice(2)] = rest[i + 1];
  }
  return { action, options };
}
function message(action, o) {
  const prompt = o['prompt-file'] ? fs.readFileSync(o['prompt-file'], 'utf8') : o.prompt;
  if (['send', 'handoff'].includes(action)) return { action, provider: o.to, title: o.title, prompt, mode: o.mode || 'edit', strategy: o.strategy || 'handoff' };
  if (action === 'complete') return { action, summary: o.summary, validation: o.validation ? [o.validation] : [], remaining: [] };
  if (action === 'block') return { action, reason: o.reason };
  if (action === 'progress') return { action, message: o.message };
  throw new Error('支持 send / handoff / complete / block / progress；工作台外还可用 projects / status / say / read / prompt');
}
// 给外部 AI 的接入说明：路径和项目都已填好，整段复制给任何能运行命令的 AI 即可
function connectPrompt(projects) {
  const run = `${process.platform === 'win32' ? '& ' : ''}"${process.execPath}" "${path.join(__dirname, 'bridge.cjs')}"`;
  return [
    '你可以通过本机的「同席」工作台把工作交给 Codex 和 Claude，它们在群里自己分工、互相复核，你只需要发消息和看回复。',
    '',
    `先尝试只读连接：${run} projects，然后运行 ${run} status。成功后告诉用户已接入，等待具体任务，不要自动发送测试任务。`,
    `若服务未启动，先阅读 ${path.join(__dirname, 'AI-START-HERE.md')}，协助启动本机工作台后重试。`,
    `用户已指定的 Git 项目可用 ${run} add-project --path "仓库绝对路径" 添加；不要自行选项目或替用户初始化、提交仓库。`,
    '',
    `可用项目：${projects.map(p => `${p.name}（${p.id}）`).join('、') || '尚未添加，请先在工作台页面添加本机 Git 仓库'}`,
    '',
    '常用命令（在终端运行，输出都是 JSON）：',
    `- 发到群里并等回复（最多等 10 分钟）：${run} say --project 项目名 --message "要做的事" --wait 600`,
    `- 指定某一位：在消息里写 @Codex / @Claude / @大家，或加 --to codex|claude|both`,
    `- 私信某一位：加 --channel codex 或 --channel claude`,
    `- 只读（不改代码）：加 --readonly 1`,
    `- 查看最近消息：${run} read --project 项目名 [--after 上次的时间] [--wait 秒数]`,
    `- 长消息：先写进文件，再用 --message-file 文件路径`,
    '',
    '规则：',
    '- 一次说清楚目标和验收标准；工作台不会自动推送、合并或部署，CLI 命令权限仍以本机设置为准。',
    '- say 返回 done:false 表示还在处理，用 read --wait 继续等，不要重复发送同一条消息。',
    '- 回复里 kind=handoff 是 AI 之间的交接，kind=reply 是某位 AI 的回复；status 为 blocked/failed 时把原因告诉用户或回一句怎么处理。',
    '- 工作台只接受本机请求，凭证由桥接脚本自动读取，不要打印或外传 .local 目录里的任何文件。',
    '- 登录由用户在官方 CLI 中完成；API Key 由用户在本机配置，不要让用户把密钥、密码或验证码粘贴到聊天里。',
  ].join('\n');
}
async function main(argv = process.argv.slice(2)) {
  const { action, options: o } = argumentsFor(argv);
  if (action === 'setup-prompt' && !process.env.WORKBENCH_AGENT_MAILBOX) return fs.readFileSync(path.join(__dirname, 'AI-START-HERE.md'), 'utf8');
  const mailbox = process.env.WORKBENCH_AGENT_MAILBOX;
  if (mailbox) {
    if (o.project || o.workflow) throw new Error('代理只能给当前任务组派发后续任务');
    const id = crypto.randomUUID();
    const request = { ...message(action, o), taskId: process.env.WORKBENCH_AGENT_TASK, run: Number(process.env.WORKBENCH_AGENT_RUN), nonce: process.env.WORKBENCH_AGENT_NONCE };
    const encoded = JSON.stringify(request);
    if (Buffer.byteLength(encoded) > 65536) throw new Error('消息不能超过 64KB');
    const outbox = path.join(mailbox, 'outbox');
    const temp = path.join(outbox, id + '.tmp');
    fs.writeFileSync(temp, encoded, { flag: 'wx', mode: 0o600 }); fs.renameSync(temp, path.join(outbox, id + '.json'));
    // Wait only for server acceptance, never for the receiving AI to finish (that would deadlock a handoff).
    const receipt = path.join(mailbox, 'receipts', id + '.json'), end = Date.now() + 15000;
    while (!fs.existsSync(receipt) && Date.now() < end) await new Promise(r => setTimeout(r, 50));
    if (!fs.existsSync(receipt)) throw new Error('消息已保存但尚未收到回执，请勿反复投递；结束本轮时服务器仍会读取');
    const result = JSON.parse(fs.readFileSync(receipt, 'utf8'));
    if (!result.ok) throw new Error(result.error);
    return result;
  }
  const file = process.env.WORKBENCH_CONNECTION_FILE || path.join(__dirname, '.local', 'connection.json');
  if (!fs.existsSync(file)) throw new Error('工作台尚未启动或未找到连接记录。请先启动工作台；首次接入可运行 node bridge.cjs setup-prompt 获取引导。');
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535 || !/^[0-9a-f]{64}$/.test(c.token)) throw new Error('本机连接记录无效');
  const api = async (route, data) => {
    const r = await fetch('http://127.0.0.1:' + c.port + '/api/' + route, { method: data ? 'POST' : 'GET', signal: AbortSignal.timeout(15000), headers: { Authorization: 'Bearer ' + c.token, ...(data ? { 'Content-Type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
    const value = await r.json(); if (!r.ok) throw new Error(value.error); return value;
  };
  const state = () => api('state');
  if (action === 'add-project') {
    if (!o.path) throw new Error('请用 --path 指定用户选择的 Git 仓库绝对路径');
    if (!path.isAbsolute(o.path)) throw new Error('--path 必须是绝对路径');
    const existing = (await state()).projects.find(p => p.path === fs.realpathSync(o.path));
    const p = existing || await api('projects', { path: o.path, ...(o.name ? { name: o.name } : {}), ...(o['base-ref'] ? { baseRef: o['base-ref'] } : {}) });
    return { id: p.id, name: p.name, baseRef: p.baseRef, existing: !!existing };
  }
  // 项目可以写 ID 或名称；只有一个项目时可以省略
  const projectOf = async () => {
    const list = (await state()).projects;
    if (!o.project) { if (list.length === 1) return list[0]; throw new Error('请用 --project 指定项目（ID 或名称）：' + list.map(p => p.name).join('、')); }
    const p = list.find(x => x.id === o.project) || list.filter(x => x.name === o.project).at(0);
    if (!p) throw new Error('找不到项目：' + o.project); return p;
  };
  const readMessages = (p, after) => api(`chat/messages?projectId=${encodeURIComponent(p.id)}&channel=${encodeURIComponent(o.channel || 'group')}&limit=${encodeURIComponent(o.limit || 30)}${after ? '&after=' + encodeURIComponent(after) : ''}`);
  // 等到频道里没人在忙、且出现了新回复（或超时），返回这期间的消息
  const waitReplies = async (p, after, seconds) => {
    const end = Date.now() + seconds * 1000; let last;
    do {
      last = await readMessages(p, after);
      if (!last.busy.length && last.messages.some(m => m.kind === 'reply')) return { ...last, done: true };
      await new Promise(r => setTimeout(r, 3000));
    } while (Date.now() < end);
    return { ...last, done: false, note: '等待超时：AI 仍在处理，稍后用 read 继续查看' };
  };
  if (action === 'projects') { const s = await state(); return s.projects.map(p => ({ id: p.id, name: p.name, baseRef: p.baseRef })); }
  if (action === 'say') {
    const p = await projectOf(), text = o['message-file'] ? fs.readFileSync(o['message-file'], 'utf8') : o.message;
    const sent = await api('chat', { projectId: p.id, channel: o.channel || 'group', message: text, mode: o.readonly === '1' ? 'review' : 'edit', ...(o.to ? { to: o.to } : {}) });
    const since = new Date(new Date(sent.tasks[0].createdAt).getTime() - 1).toISOString();
    return o.wait ? waitReplies(p, since, Number(o.wait)) : { ok: true, project: p.name, channel: o.channel || 'group', queued: sent.tasks.map(t => ({ to: t.provider, status: t.status })), since };
  }
  if (action === 'read') { const p = await projectOf(); return o.wait ? waitReplies(p, o.after, Number(o.wait)) : readMessages(p, o.after); }
  if (action === 'prompt') return connectPrompt((await state()).projects);
  if (action === 'status') { const s = await api('state'); return { workflows: s.workflows.filter(f => !o.workflow || f.id === o.workflow), tasks: s.tasks.filter(t => (!o.workflow || t.workflowId === o.workflow) && (!o.project || t.projectId === o.project)).map(t => ({ id: t.id, title: t.title, provider: t.provider, status: t.status, error: t.error, workflowId: t.workflowId })) }; }
  if (!['send', 'handoff'].includes(action)) throw new Error('complete / block / progress 只能由正在执行的任务发送');
  return api('tasks', { ...message(action, o), projectId: o.project, workflowId: o.workflow, autoContinue: true, autoStart: true });
}
if (require.main === module) main().then(value => console.log(typeof value === 'string' ? value : JSON.stringify(value))).catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { main, argumentsFor, connectPrompt };
