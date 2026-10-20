'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Workbench, git, command } = require('../core.cjs');
const { createServer } = require('../server.cjs');
async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-test-'));
  const repo = path.join(root, 'repo'); fs.mkdirSync(repo);
  await git(repo, ['init']); await git(repo, ['config', 'user.name', 'Workbench Test']); await git(repo, ['config', 'user.email', 'test@localhost']);
  fs.writeFileSync(path.join(repo, 'README.md'), '# test'); await git(repo, ['add', '.']); await git(repo, ['-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture']);
  const providers = { codex: { executable: process.execPath }, claude: { executable: process.execPath } };
  const data = path.join(root, 'data');
  const options = { providers, command: (_t, _e, out) => ({ executable: process.execPath, args: [path.join(__dirname, 'fake-cli.cjs'), out] }) };
  const wb = new Workbench(data, options);
  t.after(async () => { await wb.close(); });
  const project = await wb.addProject({ path: repo, name: '测试项目' });
  return { wb, project, root, repo, data, options };
}
const task = (wb, project, input = {}) => wb.createTask({ projectId: project.id, title: '实现任务', prompt: '正常实现', provider: 'codex', ...input });
async function finish(wb, id) {
  const end = Date.now() + 15000;
  while (['starting', 'running', 'stopping'].includes(wb.task(id).status) && Date.now() < end) await new Promise(r => setTimeout(r, 25));
  assert.ok(!wb.running.has(id), 'fixture process should finish');
  return wb.task(id);
}
test('shared context revision prevents stale overwrite; frozen run input contains requirements', async t => {
  const { wb, project } = await setup(t);
  wb.updateContext(project.id, { revision: 0, context: '共同需求', contracts: 'GET /mapdata' });
  assert.throws(() => wb.updateContext(project.id, { revision: 0, context: 'old', contracts: '' }), /其他窗口/);
  const x = task(wb, project); const input = wb.promptFor(x);
  assert.match(input, /共同需求/); assert.match(input, /GET \/mapdata/);
  await wb.start(x.id); await finish(wb, x.id);
  assert.equal(x.status, 'review'); assert.match(x.result, /true/); assert.equal(x.contextRevision, 1);
  assert.notEqual(x.workspace, project.path); assert.equal(fs.existsSync(path.join(project.path, 'generated.txt')), false);
});
test('handoff preserves uncommitted code, is manual, and locks the shared workspace', async t => {
  const { wb, project } = await setup(t); const first = task(wb, project);
  await wb.start(first.id); await finish(wb, first.id);
  const next = wb.handoff(first.id, { provider: 'claude', prompt: 'SLOW_FIXTURE', mode: 'review' });
  assert.equal(next.status, 'todo'); assert.equal(next.workspace, first.workspace);
  assert.equal(fs.readFileSync(path.join(next.workspace, 'generated.txt'), 'utf8'), '本地测试产物');
  assert.match(wb.promptFor(next), /完成测试任务/);
  await wb.start(next.id);
  await assert.rejects(wb.start(first.id), /另一任务/);
  await wb.stop(next.id); await finish(wb, next.id); assert.equal(next.status, 'stopped');
});
test('dependencies require human acceptance, not just successful CLI exit', async t => {
  const { wb, project } = await setup(t); const a = task(wb, project), b = task(wb, project, { dependencies: [a.id] });
  await assert.rejects(wb.start(b.id), /前置/); await wb.start(a.id); await finish(wb, a.id);
  await assert.rejects(wb.start(b.id), /前置/); wb.approve(a.id); await wb.start(b.id); await finish(wb, b.id); assert.equal(b.status, 'review');
});
test('protocol error despite exit zero is failed; permission denial is blocked', async t => {
  const { wb, project } = await setup(t);
  const a = task(wb, project, { prompt: 'FAIL_FIXTURE' }), b = task(wb, project, { provider: 'claude', prompt: 'DENIED_FIXTURE' });
  await wb.start(a.id); await finish(wb, a.id); assert.equal(a.status, 'failed'); assert.match(a.error, /fixture failed/);
  await wb.start(b.id); await finish(wb, b.id); assert.equal(b.status, 'blocked'); assert.throws(() => wb.approve(b.id), /待验收/);
});
test('a transient Codex "Reconnecting..." error does not fail a run that completes', async t => {
  const { wb, project } = await setup(t); const x = task(wb, project, { prompt: 'RECONNECT_FIXTURE' });
  await wb.start(x.id); await finish(wb, x.id);
  assert.equal(x.status, 'review', x.error); assert.equal(x.error, '');
});
test('restart marks unfinished runs interrupted and retains task output', async t => {
  const { wb, project, data, options } = await setup(t); const x = task(wb, project);
  x.status = 'running'; x.result = '保留结果'; wb.save();
  const reopened = new Workbench(data, options); assert.equal(reopened.task(x.id).status, 'interrupted'); assert.equal(reopened.task(x.id).result, '保留结果');
});
test('shutdown during worktree preparation cancels before spawning a CLI', async t => {
  const { wb, project } = await setup(t); const x = task(wb, project);
  const starting = wb.start(x.id); await wb.close(); await starting;
  assert.equal(x.status, 'stopped'); assert.equal(wb.running.size, 0);
  await assert.rejects(wb.start(x.id), /退出/);
});
test('auth, exact origin/host, static traversal and request size are enforced', async t => {
  const { wb } = await setup(t); const { server, token } = createServer(wb);
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => { server.closeAllConnections(); server.close(); });
  const url = 'http://127.0.0.1:' + server.address().port;
  assert.equal((await fetch(url + '/api/state')).status, 401);
  const headers = { Authorization: 'Bearer ' + token };
  assert.equal((await fetch(url + '/api/state', { headers })).status, 200);
  assert.equal((await fetch(url + '/api/state', { headers: { ...headers, Origin: 'http://localhost:4000' } })).status, 403);
  const wrongHost = await new Promise((resolve, reject) => { require('node:http').get(url + '/api/state', { headers: { ...headers, Host: 'evil.example' } }, r => { r.resume(); resolve(r.statusCode); }).on('error', reject); });
  assert.equal(wrongHost, 403);
  assert.equal((await fetch(url + '/state.json', { headers })).status, 404);
  assert.equal((await fetch(url + '/api/tasks', { method: 'POST', headers, body: 'x'.repeat(310000) })).status, 413);
  assert.equal((await fetch(url + '/api/tasks', { method: 'POST', headers, body: '{bad json' })).status, 400);
  assert.equal((await fetch(url.replace('127.0.0.1', 'localhost') + '/api/health')).status, 200);
  const html = await fetch(url); assert.match(html.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.ok(!(await html.text()).includes(token));
});
test('real adapter argv never bypasses sandbox or uses a shell, prompt travels via stdin', () => {
  for (const provider of ['codex', 'claude']) {
    const cmd = command(provider, 'C:/repo with spaces', 'edit', 'C:/out.txt', { executable: 'agent.exe', prefix: [] });
    assert.ok(!cmd.args.some(a => /dangerously|bypassPermissions/.test(a))); assert.ok(!cmd.args.includes('用户提示词'));
  }
  assert.ok(command('codex', 'repo', 'review', 'out', { prefix: [] }).args.includes('read-only'));
  const claude = command('claude', 'repo', 'edit', 'out', { prefix: [] }).args;
  assert.ok(claude.includes('-p') && claude.includes('stream-json'));
});
test('both providers get separate ai/<provider>/ branches and worktrees; corrupt state is backed up', async t => {
  const { wb, project, data, options } = await setup(t);
  const [a, b] = wb.createTasks({ projectId: project.id, title: 'Same file', prompt: '正常实现', provider: 'both' });
  await Promise.all([wb.start(a.id), wb.start(b.id)]); await finish(wb, a.id); await finish(wb, b.id);
  assert.match(a.branch, /^ai\/codex\/same-file-/); assert.match(b.branch, /^ai\/claude\/same-file-/);
  assert.notEqual(a.workspace, b.workspace);
  fs.writeFileSync(path.join(data, 'state.json'), '{broken');
  const reopened = new Workbench(data, options); assert.equal(reopened.state.tasks.length, 0);
  assert.ok(fs.readdirSync(data).some(f => f.startsWith('state.corrupt-')));
});
test('a task can start from its own branch instead of the project base; bad refs fail clearly', async t => {
  const { wb, project, repo } = await setup(t);
  await git(repo, ['switch', '-q', '-c', 'merge-candidate']); fs.writeFileSync(path.join(repo, 'merged.txt'), 'm');
  await git(repo, ['add', '.']); await git(repo, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'candidate']); await git(repo, ['switch', '-q', '-']);
  const x = task(wb, project, { baseRef: 'merge-candidate' });
  assert.match(wb.promptFor(x), /基线：merge-candidate/);
  await wb.start(x.id); await finish(wb, x.id);
  assert.ok(fs.existsSync(path.join(x.workspace, 'merged.txt')));
  const bad = task(wb, project, { baseRef: 'no-such-branch' });
  await assert.rejects(wb.start(bad.id), /起始分支\/提交不存在/);
});
test('Anthropic API fallback agent: key from env only, tool loop edits the worktree, stream-json output', async t => {
  const { spawn } = require('node:child_process');
  const http = require('node:http');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-api-'));
  const seen = [];
  const api = http.createServer(async (req, res) => {
    let s = ''; for await (const c of req) s += c; const b = JSON.parse(s); seen.push({ key: req.headers['x-api-key'], body: b });
    const reply = seen.length === 1
      ? { stop_reason: 'tool_use', content: [{ type: 'text', text: '写文件' }, { type: 'tool_use', id: 't1', name: 'write_file', input: { path: 'out/api.txt', content: 'hi' } }, { type: 'tool_use', id: 't2', name: 'read_file', input: { path: '../escape.txt' } }] }
      : { stop_reason: 'end_turn', content: [{ type: 'text', text: 'API_DONE' }] };
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(reply));
  });
  await new Promise(r => api.listen(0, '127.0.0.1', r)); t.after(() => api.close());
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'agents', 'claude-api.cjs'), '--mode', 'edit'], { cwd: work, env: { ...process.env, ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + api.address().port } });
  let out = ''; child.stdout.on('data', d => out += d); child.stdin.end('do it');
  const code = await new Promise(r => child.on('close', r));
  assert.equal(code, 0);
  assert.equal(fs.readFileSync(path.join(work, 'out', 'api.txt'), 'utf8'), 'hi');
  assert.equal(seen[0].key, 'test-key'); assert.equal(seen[0].body.model, 'claude-opus-5-5');
  const toolResults = seen[1].body.messages.at(-1).content;
  assert.equal(toolResults.find(r => r.tool_use_id === 't2').is_error, true, 'path escape must be refused');
  assert.ok(!out.includes('test-key'), 'key must never be printed');
  const last = JSON.parse(out.trim().split('\n').at(-1)); assert.deepEqual([last.type, last.result], ['result', 'API_DONE']);
});
