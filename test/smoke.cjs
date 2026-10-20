'use strict';
// End-to-end smoke test: starts the real server process, drives the HTTP API, and runs a fake AI
// child process through the real Codex and Claude adapters: send task → receive output → finish.
// Also checks stop, per-AI branches/worktrees, and that state survives a restart.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { git } = require('../core.cjs');
const ROOT = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(what, fn, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('超时等待：' + what); await sleep(100); }
}
function startServer(data) {
  fs.rmSync(path.join(data, 'connection.json'), { force: true });
  const env = { ...process.env, WORKBENCH_DATA: data, WORKBENCH_PORT: '0', WORKBENCH_FAKE_AGENT: path.join(__dirname, 'fake-agent.cjs') };
  delete env.ANTHROPIC_API_KEY;
  const child = spawn(process.execPath, [path.join(ROOT, 'server.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = ''; child.stdout.on('data', d => output += d); child.stderr.on('data', d => output += d);
  child.exited = new Promise(r => child.once('exit', r));
  return until('服务启动', async () => {
    if (child.exitCode !== null) throw new Error('服务启动失败：' + output);
    try { return { child, ...JSON.parse(fs.readFileSync(path.join(data, 'connection.json'), 'utf8')) }; } catch { return null; }
  });
}
function client(port, token) {
  return async (route, method = 'GET', body, auth = true) => {
    const res = await fetch(`http://127.0.0.1:${port}${route}`, { method, headers: { ...(auth ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const type = res.headers.get('content-type') || '';
    return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() };
  };
}
const step = msg => console.log('  ✓ ' + msg);
async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-smoke-'));
  const repo = path.join(root, 'repo'), data = path.join(root, 'data');
  const bridge = async (...args) => {
    const env = { ...process.env, WORKBENCH_CONNECTION_FILE: path.join(data, 'connection.json') };
    delete env.WORKBENCH_AGENT_MAILBOX;
    const { stdout } = await require('node:util').promisify(require('node:child_process').execFile)(process.execPath, [path.join(ROOT, 'bridge.cjs'), ...args], { env, windowsHide: true });
    return stdout;
  };
  assert.match(await bridge('setup-prompt'), /帮我安装、启动并接入同席/);
  await assert.rejects(bridge('projects'), /工作台尚未启动/);
  fs.mkdirSync(repo);
  await git(repo, ['init']); await git(repo, ['config', 'user.name', 'Smoke']); await git(repo, ['config', 'user.email', 'smoke@localhost']);
  fs.writeFileSync(path.join(repo, 'README.md'), '# smoke\n'); await git(repo, ['add', '.']); await git(repo, ['-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture']);
  let server;
  try {
    server = await startServer(data);
    let api = client(server.port, server.token);
    step('服务已启动，端口 ' + server.port);
    assert.equal((await api('/api/health', 'GET', null, false)).status, 200);
    assert.match((await api('/', 'GET', null, false)).body, /同席/);
    assert.equal((await api('/api/state', 'GET', null, false)).status, 401);
    assert.equal((await api('/api/state')).status, 200);
    assert.equal((await api('/api/tasks/nope')).status, 404);
    step('health / 页面 / 鉴权 / 404 正常');
    const emptyPrompt = (await api('/api/connect-prompt')).body.prompt;
    assert.match(emptyPrompt, /add-project/);
    assert.ok(!emptyPrompt.includes(server.token));
    const project = JSON.parse(await bridge('add-project', '--path', repo, '--name', '冒烟项目'));
    assert.ok(project.id, JSON.stringify(project));
    assert.equal(JSON.parse(await bridge('add-project', '--path', repo)).id, project.id);
    await assert.rejects(bridge('add-project', '--path', '.'), /绝对路径/);
    assert.equal(JSON.parse(await bridge('projects')).length, 1);
    assert.equal(JSON.parse(await bridge('status')).tasks.length, 0, '连接和添加项目不得派发任务');
    assert.match(await bridge('prompt'), /先尝试只读连接/);
    const bad = await api('/api/projects', 'POST', { path: path.join(root, 'missing') });
    assert.equal(bad.status, 400); assert.match(bad.body.error, /不存在/);
    step('添加项目；错误路径返回可读错误');

    // Send one task to both AIs and start immediately.
    const created = await api('/api/tasks', 'POST', { projectId: project.id, title: 'Smoke both', prompt: '写入 shared.txt', provider: 'both', autoStart: true });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const [a, b] = created.body.tasks; assert.deepEqual([a.provider, b.provider].sort(), ['claude', 'codex']);
    step('发任务（两个都发）→ 2 个任务已启动');
    const done = {};
    for (const t of [a, b]) {
      done[t.provider] = await until(t.provider + ' 完成', async () => { const x = (await api('/api/tasks/' + t.id)).body; return ['review', 'failed', 'blocked'].includes(x.status) && x; });
      assert.equal(done[t.provider].status, 'review', done[t.provider].error);
      const logs = (await api(`/api/tasks/${t.id}/logs`)).body;
      assert.ok(logs.some(r => r.text.includes(`FAKE_${t.provider.toUpperCase()}_DONE`)), '日志中应有代理输出');
      assert.match(done[t.provider].result, new RegExp(`FAKE_${t.provider.toUpperCase()}_DONE`));
    }
    step('收到输出 → 结束（codex: ' + done.codex.status + '，claude: ' + done.claude.status + '）');
    assert.match(done.codex.branch, /^ai\/codex\//); assert.match(done.claude.branch, /^ai\/claude\//);
    assert.notEqual(done.codex.workspace, done.claude.workspace);
    assert.equal(fs.readFileSync(path.join(done.codex.workspace, 'shared.txt'), 'utf8'), 'written by codex\n');
    assert.equal(fs.readFileSync(path.join(done.claude.workspace, 'shared.txt'), 'utf8'), 'written by claude\n');
    assert.equal(fs.existsSync(path.join(repo, 'shared.txt')), false);
    const branches = await git(repo, ['branch', '--list', 'ai/*']);
    assert.match(branches, /ai\/codex\//); assert.match(branches, /ai\/claude\//);
    step('各自独立分支与目录：' + done.codex.branch + ' / ' + done.claude.branch + '；同名文件互不覆盖，主仓库未改动');
    const diff = (await api(`/api/tasks/${a.id}/diff`)).body; assert.match(diff.status, /shared\.txt/);
    step('查看改动接口正常');

    // Stop a long-running task.
    const slow = (await api('/api/tasks', 'POST', { projectId: project.id, title: 'Slow', prompt: 'SLOW_FIXTURE', provider: 'claude', autoStart: true })).body.tasks[0];
    await until('慢任务运行', async () => (await api('/api/tasks/' + slow.id)).body.status === 'running');
    const stopped = await api(`/api/tasks/${slow.id}/stop`, 'POST'); assert.equal(stopped.status, 200);
    const s = await until('慢任务停止', async () => { const x = (await api('/api/tasks/' + slow.id)).body; return x.status === 'stopped' && x; });
    assert.equal(s.error, '已手动停止');
    step('停止正在运行的任务 → stopped');
    assert.equal((await api(`/api/tasks/${done.codex.id}/approve`, 'POST')).body.status, 'done');
    assert.equal((await api(`/api/tasks/${done.codex.id}/start`, 'POST')).status, 400);
    step('验收；已验收任务不能重复启动（返回 400 和错误信息）');

    // Restart: tasks, outputs and logs survive, and the same token still works.
    await api('/api/shutdown', 'POST'); await server.child.exited;
    assert.equal(fs.existsSync(path.join(data, 'server.lock')), false, '退出后应删除锁文件');
    const oldToken = server.token;
    server = await startServer(data); api = client(server.port, server.token);
    assert.equal(server.token, oldToken, '重启后凭证应保持不变');
    const state = (await api('/api/state')).body;
    assert.equal(state.tasks.length, 3);
    assert.equal(state.tasks.find(t => t.id === done.codex.id).status, 'done');
    assert.match(state.tasks.find(t => t.id === done.claude.id).result, /FAKE_CLAUDE_DONE/);
    assert.ok((await api(`/api/tasks/${done.claude.id}/logs`)).body.length > 0);
    step('重启后任务、输出、状态、日志都还在，凭证不变');
    // An AI outside the child process can dispatch directly through the bridge.
    // Leave the browser closed: only the server owns the relay scheduler.
    const sent = await new Promise((resolve, reject) => {
      const bridge = spawn(process.execPath, [path.join(ROOT, 'bridge.cjs'), 'send', '--project', project.id, '--to', 'codex', '--title', 'relay-stage-1', '--prompt', '四步接力完成后结束整组'], { env: { ...process.env, WORKBENCH_CONNECTION_FILE: path.join(data, 'connection.json') }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let output = '', error = ''; bridge.stdout.on('data', d => output += d); bridge.stderr.on('data', d => error += d);
      bridge.on('error', reject); bridge.on('close', code => code === 0 ? resolve(JSON.parse(output)) : reject(new Error(error)));
    });
    assert.ok(sent.tasks[0].workflowId);
    const flowId = sent.tasks[0].workflowId;
    const final = await until('无浏览器自动四步接力', async () => {
      const s = (await api('/api/state')).body, f = s.workflows.find(x => x.id === flowId);
      if (f.status === 'blocked') throw new Error(f.reason);
      return f.status === 'completed' && s;
    });
    const chain = final.tasks.filter(t => t.workflowId === flowId).reverse();
    assert.deepEqual(chain.map(t => t.provider), ['codex', 'claude', 'codex', 'claude']);
    assert.ok(chain.every(t => t.status === 'done' && t.completionKind === 'agent'));
    assert.equal(new Set(chain.map(t => t.workspace)).size, 1);
    assert.equal(fs.readFileSync(path.join(chain[0].workspace, 'relay-code.txt'), 'utf8'), 'codex-v2');
    step('外部 AI 直接发送 → Codex/Claude 四步互派 → 自动整组完成；全程没有浏览器或人工开始/验收');
    await api('/api/shutdown', 'POST'); await server.child.exited; server = null;
    console.log('SMOKE PASS');
  } finally {
    if (server && server.child.exitCode === null) { server.child.kill(); await server.child.exited; }
    for (let i = 0; i < 5; i++) { try { fs.rmSync(root, { recursive: true, force: true }); break; } catch { await sleep(300); } }
  }
}
main().catch(e => { console.error('SMOKE FAIL:', e); process.exitCode = 1; });
