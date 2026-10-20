'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Workbench, git } = require('../core.cjs');
const { reportBlock } = require('../relay.cjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { const result = fn(); if (result) return result; await sleep(25); } throw new Error('接力测试超时'); }
async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-relay-')), repo = path.join(root, 'repo'); fs.mkdirSync(repo);
  await git(repo, ['init']); await git(repo, ['config', 'user.name', 'Relay Test']); await git(repo, ['config', 'user.email', 'relay@localhost']);
  fs.writeFileSync(path.join(repo, 'README.md'), '# relay'); await git(repo, ['add', '.']); await git(repo, ['-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture']);
  const provider = { executable: process.execPath, prefix: [path.join(__dirname, 'fake-agent.cjs')], kind: 'cli' };
  const options = { providers: { codex: provider, claude: provider } };
  const wb = new Workbench(path.join(root, 'data'), options); t.after(() => wb.close());
  const project = await wb.addProject({ path: repo });
  const rootTask = (title, extra = {}) => {
    const [task] = wb.createTasks({ projectId: project.id, title, prompt: 'fixture 自动完成目标', provider: 'codex', autoContinue: true, ...extra }); wb.relay.enqueue(task.id); return task;
  };
  return { wb, project, rootTask, repo, root, options, provider };
}
test('Codex → Claude → Codex → Claude finishes automatically without a browser or start/approve clicks', async t => {
  const { wb, rootTask, repo } = await setup(t); const first = rootTask('relay-stage-1');
  const flow = wb.relay.flow(first.workflowId); await until(() => ['completed', 'blocked'].includes(flow.status));
  assert.equal(flow.status, 'completed', flow.reason);
  const tasks = wb.relay.members(flow).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  assert.deepEqual(tasks.map(t => t.provider), ['codex', 'claude', 'codex', 'claude']);
  assert.ok(tasks.every(t => t.status === 'done' && t.completionKind === 'agent'));
  assert.equal(new Set(tasks.map(t => t.workspace)).size, 1);
  assert.equal(fs.readFileSync(path.join(first.workspace, 'relay-code.txt'), 'utf8'), 'codex-v2');
  assert.equal(fs.existsSync(path.join(repo, 'relay-code.txt')), false);
  assert.equal(tasks[3].sentBy, 'codex'); assert.ok(flow.completedAt);
});
test('pause allows current turn to settle but prevents next recipient from starting until resume', async t => {
  const { wb, rootTask } = await setup(t); const first = rootTask('relay-pause-root'), flow = wb.relay.flow(first.workflowId);
  await until(() => wb.relay.members(flow).length === 2);
  await wb.relay.control(flow.id, 'pause'); await until(() => first.status === 'done');
  const next = wb.relay.members(flow).find(t => t.id !== first.id);
  assert.equal(next.status, 'queued'); assert.equal(flow.status, 'paused');
  await wb.relay.control(flow.id, 'resume'); await until(() => flow.status === 'completed');
});
test('missing recipient stays queued and continues automatically after a provider is connected', async t => {
  const { wb, rootTask, provider } = await setup(t); wb.options.providers.claude = null;
  const first = rootTask('relay-stage-1'), flow = wb.relay.flow(first.workflowId);
  await until(() => flow.status === 'blocked'); assert.equal(flow.reasonCode, 'provider');
  assert.ok(wb.relay.members(flow).some(t => t.provider === 'claude' && t.status === 'queued'));
  wb.options.providers.claude = provider; wb.relay.settingsChanged();
  await until(() => flow.status === 'completed');
});
test('failed, blocked and incomplete turns never mark the workflow complete or dispatch a failed final report', async t => {
  const { wb, rootTask } = await setup(t);
  for (const title of ['relay-failure', 'relay-missing-report', 'relay-invalid-report', 'relay-block']) {
    const first = rootTask(title), flow = wb.relay.flow(first.workflowId);
    await until(() => flow.status === 'blocked');
    assert.notEqual(first.status, 'done'); assert.equal(wb.relay.members(flow).length, 1);
  }
});
test('repeated agent deliveries are deduplicated and endless reciprocal tasks stop at the group budget', async t => {
  const { wb, rootTask } = await setup(t); const dup = rootTask('relay-duplicate'), dupFlow = wb.relay.flow(dup.workflowId);
  await until(() => dupFlow.status === 'completed'); assert.equal(wb.relay.members(dupFlow).length, 2);
  const loop = rootTask('relay-loop', { maxTasks: 3 }), flow = wb.relay.flow(loop.workflowId);
  await until(() => flow.status === 'blocked'); assert.equal(flow.reasonCode, 'limit'); assert.equal(wb.relay.members(flow).length, 3);
});
test('workflow stop cancels current processes and will not start pending recipients', async t => {
  const { wb, rootTask } = await setup(t); const first = rootTask('relay-slow'), flow = wb.relay.flow(first.workflowId);
  await until(() => first.status === 'running'); await wb.relay.control(flow.id, 'stop'); await until(() => first.status === 'stopped');
  assert.equal(flow.status, 'stopped'); assert.equal(wb.running.size, 0);
});
test('mailbox rejects wrong run credentials and project changes without creating tasks', async t => {
  const { wb, rootTask } = await setup(t); const first = rootTask('relay-slow'); await until(() => first.status === 'running');
  const channel = wb.relay.channels.get(first.id), file = path.join(channel.dir, 'outbox', 'forged.json');
  fs.writeFileSync(file, JSON.stringify({ nonce: 'wrong', taskId: first.id, run: first.runs, action: 'handoff', provider: 'claude', title: 'bad', prompt: 'bad' }));
  wb.relay.drain(first, channel); const reply = JSON.parse(fs.readFileSync(path.join(channel.dir, 'receipts', 'forged.json')));
  assert.equal(reply.ok, false); assert.equal(wb.state.tasks.length, 1);
  assert.throws(() => wb.relay.receive(first, channel, { action: 'handoff', projectId: 'other' }), /不能更换/);
});
test('restart blocks interrupted groups but resumes already queued safe work', async t => {
  const { wb, project, root, options } = await setup(t);
  const [task] = wb.createTasks({ projectId: project.id, title: 'relay-complete', prompt: '完成', provider: 'codex', autoContinue: true });
  task.status = 'queued'; task.autoStart = true; task.queuedAt = new Date().toISOString(); wb.save();
  const reopened = new Workbench(path.join(root, 'data'), options); t.after(() => reopened.close()); reopened.relay.open();
  await until(() => reopened.relay.flow(task.workflowId).status === 'completed');
  const [interrupted] = reopened.createTasks({ projectId: project.id, title: 'relay-slow', prompt: '未完成', provider: 'codex', autoContinue: true });
  interrupted.status = 'running'; reopened.save();
  const recovered = new Workbench(path.join(root, 'data'), options); t.after(() => recovered.close()); recovered.relay.open();
  assert.equal(recovered.task(interrupted.id).status, 'interrupted'); assert.equal(recovered.relay.flow(interrupted.workflowId).status, 'blocked');
});
test('chat: group channel answers, @mentions pick the AI, history is short and the workspace is shared', async t => {
  const { wb, project } = await setup(t);
  const first = wb.chat({ projectId: project.id, channel: 'group', message: '你好，先看看项目结构' });
  const flow = wb.relay.flow(first.threadId); assert.ok(flow.chat); assert.equal(flow.channel, project.id + ':group'); assert.equal(first.tasks[0].provider, 'claude');
  await until(() => ['completed', 'blocked'].includes(flow.status)); assert.equal(flow.status, 'completed', flow.reason);
  assert.equal(first.tasks[0].completionKind, 'reply');
  const next = wb.chat({ projectId: project.id, channel: 'group', message: '这次请 @codex 把 README 补全' });
  assert.equal(next.threadId, flow.id, 'same group, no new thread'); assert.equal(next.tasks[0].provider, 'codex');
  await until(() => flow.status === 'completed');
  assert.equal(next.tasks[0].workspace, first.tasks[0].workspace);
  const input = fs.readFileSync(path.join(wb.dir, 'runs', next.tasks[0].id, 'input.txt'), 'utf8');
  assert.match(input, /用户 @Claude：你好，先看看项目结构/); assert.match(input, /Claude：FAKE_CLAUDE_DONE/);
  assert.ok(input.length < 4000, 'chat prompt stays small: ' + input.length);
  // 私信：只发给对方，用同一个代码目录
  const dm = wb.chat({ projectId: project.id, channel: 'codex', message: '@claude 私下问一句' });
  assert.notEqual(dm.threadId, flow.id); assert.equal(dm.tasks[0].provider, 'codex');
  await until(() => wb.relay.flow(dm.threadId).status === 'completed');
  assert.equal(dm.tasks[0].workspace, first.tasks[0].workspace);
});
test('external agents read the same chat via chatMessages and get a filled-in connect prompt', async t => {
  const { wb, project } = await setup(t);
  const sent = wb.chat({ projectId: project.id, channel: 'group', message: '@codex 外部 AI 发来的任务' }), flow = wb.relay.flow(sent.threadId);
  await until(() => flow.status === 'completed');
  const { messages, busy } = wb.chatMessages({ projectId: project.id, channel: 'group' });
  assert.deepEqual(messages.map(m => [m.from, m.kind]), [['user', 'message'], ['codex', 'reply']]); assert.equal(busy.length, 0);
  assert.match(messages[1].text, /FAKE_CODEX_DONE/);
  assert.equal(wb.chatMessages({ projectId: project.id, after: messages[0].at }).messages.length, 1);
  assert.throws(() => wb.chatMessages({ projectId: project.id, channel: 'x' }), /频道/);
  const prompt = require('../bridge.cjs').connectPrompt(wb.state.projects);
  assert.match(prompt, new RegExp(project.id)); assert.match(prompt, /say --project/); assert.ok(!/[0-9a-f]{64}/.test(prompt), 'no token in prompt');
});
test('chat: transcript is capped no matter how long the conversation gets', async t => {
  const { wb, project } = await setup(t);
  const first = wb.chat({ projectId: project.id, channel: 'group', message: 'x'.repeat(3000) }), flow = wb.relay.flow(first.threadId);
  await until(() => flow.status === 'completed');
  for (let i = 0; i < 14; i++) { const r = wb.chat({ projectId: project.id, channel: 'group', message: '第' + i + '条 ' + 'y'.repeat(900) }); r.tasks[0].status = 'done'; r.tasks[0].result = 'z'.repeat(900); }
  const last = wb.relay.members(flow)[0], history = wb.transcript(last);
  assert.ok(history.length <= 4000, 'history ' + history.length); assert.ok(!history.includes('x'.repeat(500)));
  for (const x of wb.relay.members(flow)) if (x.status === 'queued') x.status = 'done';
});
test('chat: AI-to-AI handoffs run without the user, and a reply unblocks a blocked conversation', async t => {
  const { wb, project } = await setup(t);
  const relay = wb.chat({ projectId: project.id, message: 'relay-stage-1', to: 'codex' }), flow = wb.relay.flow(relay.threadId);
  await until(() => ['completed', 'blocked'].includes(flow.status)); assert.equal(flow.status, 'completed', flow.reason);
  assert.equal(wb.relay.members(flow).length, 4);
  const blocked = wb.chat({ projectId: project.id, channel: 'claude', message: 'relay-block' }), bflow = wb.relay.flow(blocked.threadId);
  await until(() => bflow.status === 'blocked');
  const reply = wb.chat({ projectId: project.id, channel: 'claude', message: '认证已处理，继续' });
  assert.equal(blocked.tasks[0].supersededBy, reply.tasks[0].id); assert.equal(reply.tasks[0].provider, 'claude');
  await until(() => bflow.status === 'completed'); assert.equal(reply.tasks[0].status, 'done');
});
test('chat: a follow-up sent while the first message is still queued waits and shares its workspace', async t => {
  const { wb, project } = await setup(t);
  const first = wb.chat({ projectId: project.id, message: '第一条' });
  const second = wb.chat({ projectId: project.id, message: '第二条', to: 'codex' });
  const flow = wb.relay.flow(first.threadId);
  await until(() => flow.status === 'completed');
  assert.ok(second.tasks[0].startedAt >= first.tasks[0].finishedAt);
  assert.equal(second.tasks[0].workspace, first.tasks[0].workspace);
});
test('a denied command does not block a relay turn that ends with a valid report; without a report it still blocks', async t => {
  const { wb, rootTask } = await setup(t);
  const ok = rootTask('relay-denied-complete', { provider: 'claude' }), flow = wb.relay.flow(ok.workflowId);
  await until(() => ['completed', 'blocked'].includes(flow.status)); assert.equal(flow.status, 'completed', flow.reason);
  assert.equal(ok.status, 'done'); assert.ok(ok.permissionNote);
  const bad = rootTask('relay-denied-silent', { provider: 'claude' }), badFlow = wb.relay.flow(bad.workflowId);
  await until(() => badFlow.status === 'blocked'); assert.equal(bad.status, 'blocked'); assert.match(bad.error, /权限/);
});
test('a blocked relay task can be handed to the other AI, which unblocks the group', async t => {
  const { wb, rootTask } = await setup(t);
  const stuck = rootTask('relay-block'), flow = wb.relay.flow(stuck.workflowId);
  await until(() => flow.status === 'blocked');
  await wb.relay.control(flow.id, 'pause').catch(() => {});
  const next = wb.handoff(stuck.id, { provider: 'claude', title: 'relay-complete', prompt: '提交并继续', mode: 'edit' });
  assert.equal(next.workflowId, flow.id); assert.equal(next.workspace, stuck.workspace); assert.equal(stuck.supersededBy, next.id);
  wb.relay.enqueue(next.id); await wb.relay.control(flow.id, 'resume');
  await until(() => flow.status === 'completed'); assert.equal(next.status, 'done');
});
test('Claude review runs get node/git/godot but no edit tools', () => {
  const { command } = require('../core.cjs');
  const args = command('claude', 'C:/w', 'review', 'f', { executable: 'claude.exe', kind: 'cli' }).args;
  const tools = args[args.indexOf('--tools') + 1];
  assert.equal(tools, 'Read,Glob,Grep,PowerShell,Bash'); assert.ok(args.includes('PowerShell(git:*)')); assert.ok(!/Edit|Write/.test(tools));
  assert.ok(!args.includes('bypassPermissions')); assert.equal(args[args.indexOf('--permission-mode') + 1], 'default');
});
test('only explicit fenced workbench output is interpreted as an agent instruction', () => {
  assert.equal(reportBlock('这是例子 {"action":"handoff"}'), null);
  assert.deepEqual(reportBlock('```workbench\n{"action":"block","reason":"auth"}\n```'), { action: 'block', reason: 'auth' });
  assert.throws(() => reportBlock('```workbench\nno json\n```'));
});
