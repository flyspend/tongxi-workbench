'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Workbench } = require('./core.cjs');
const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];
// 代码指纹：启动时记一次；health 时再算一次，不同说明磁盘上的代码已更新，启动入口据此重启旧服务
function codeStamp() {
  const h = crypto.createHash('sha1');
  for (const dir of [__dirname, path.join(__dirname, 'public')]) for (const f of fs.readdirSync(dir).filter(f => /\.(cjs|js|html|css)$/.test(f)).sort()) h.update(f).update(fs.readFileSync(path.join(dir, f)));
  return h.digest('hex').slice(0, 12);
}
const STARTED_STAMP = codeStamp();
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
async function body(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 300000) throw new HttpError(413, '请求内容太大'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new HttpError(400, '请求内容不是有效的 JSON'); }
}
function statusFor(err) { return err.status || (/^(任务|项目)不存在$/.test(err.message) ? 404 : 400); }
function createServer(workbench, token = crypto.randomBytes(32).toString('hex')) {
  const server = http.createServer(async (req, res) => {
    const json = (code, data) => { if (res.headersSent) return; res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    // Only loopback Host/Origin values are accepted (blocks DNS rebinding and cross-site pages).
    const port = server.address().port, hosts = LOOPBACK.map(h => h + ':' + port);
    if (!hosts.includes(req.headers.host) || req.headers.origin && !hosts.some(h => req.headers.origin === 'http://' + h)) return json(403, { error: '拒绝非本机页面请求' });
    const url = new URL(req.url, 'http://' + req.headers.host);
    try {
      if (req.method === 'GET' && url.pathname === '/api/health') { let now = STARTED_STAMP; try { now = codeStamp(); } catch { /* keep */ } return json(200, { ok: true, code: STARTED_STAMP, stale: now !== STARTED_STAMP, active: workbench.state.tasks.filter(t => ['starting', 'running', 'stopping'].includes(t.status)).length }); }
      if (url.pathname.startsWith('/api/')) {
        const auth = req.headers.authorization || '';
        const supplied = Buffer.from(auth), expected = Buffer.from('Bearer ' + token);
        if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return json(401, { error: '启动凭证无效，请用启动入口重新打开页面' });
        if (req.method === 'GET' && url.pathname === '/api/state') return json(200, workbench.snapshot());
        if (req.method === 'GET' && url.pathname === '/api/workflows') return json(200, { workflows: workbench.state.workflows });
        const workflow = url.pathname.match(/^\/api\/workflows\/([\w-]+)\/(pause|resume|stop)$/);
        if (workflow && req.method === 'POST') return json(200, await workbench.relay.control(workflow[1], workflow[2]));
        if (req.method === 'POST' && url.pathname === '/api/projects') return json(201, await workbench.addProject(await body(req)));
        if (req.method === 'GET' && url.pathname === '/api/tasks') return json(200, { tasks: workbench.state.tasks.filter(t => !url.searchParams.get('projectId') || t.projectId === url.searchParams.get('projectId')) });
        if (req.method === 'POST' && url.pathname === '/api/tasks') {
          // Unified "send task" for codex / claude / both. autoStart starts each one; a start failure is recorded on that task.
          const input = await body(req), tasks = workbench.createTasks(input);
          if (input.autoStart || input.autoContinue || workbench.state.settings.autoReview && input.mode === 'review') for (const t of tasks) workbench.relay.enqueue(t.id);
          return json(201, { tasks });
        }
        // 聊天式发送：{projectId, message, threadId?, to?: auto|codex|claude|both, mode?}；自动选人、自动排队、自动接力
        if (req.method === 'POST' && url.pathname === '/api/chat') return json(201, workbench.chat(await body(req)));
        if (req.method === 'GET' && url.pathname === '/api/connect-prompt') return json(200, { prompt: require('./bridge.cjs').connectPrompt(workbench.state.projects) });
        if (req.method === 'GET' && url.pathname === '/api/chat/messages') return json(200, workbench.chatMessages(Object.fromEntries(url.searchParams)));
        if (req.method === 'POST' && url.pathname === '/api/settings') return json(200, workbench.settings(await body(req)));
        const context = url.pathname.match(/^\/api\/projects\/([\w-]+)\/context$/);
        if (context && req.method === 'PUT') return json(200, workbench.updateContext(context[1], await body(req)));
        const artifact = url.pathname.match(/^\/api\/tasks\/([\w-]+)\/artifact$/);
        if (artifact && req.method === 'GET') {
          const item = require('./deliverables.cjs').resolve(workbench.task(artifact[1]), url.searchParams.get('file'));
          const ext = path.extname(item.path).toLowerCase();
          const mime = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.pdf':'application/pdf'}[ext] || 'text/plain; charset=utf-8';
          res.writeHead(200, {'Content-Type':mime}); return fs.createReadStream(item.path).pipe(res);
        }
        const one = url.pathname.match(/^\/api\/tasks\/([\w-]+)$/);
        if (one && req.method === 'GET') return json(200, workbench.task(one[1]));
        const task = url.pathname.match(/^\/api\/tasks\/([\w-]+)\/(start|stop|approve|archive|restore|handoff|logs|diff|prompt)$/);
        if (task) {
          const [, id, action] = task;
          if (req.method === 'GET' && action === 'logs') return json(200, workbench.logs(id, Math.min(Number(url.searchParams.get('limit')) || 250, 2000)));
          if (req.method === 'GET' && action === 'diff') return json(200, await workbench.diff(id));
          if (req.method === 'GET' && action === 'prompt') return json(200, { prompt: workbench.promptFor(workbench.task(id)) });
          if (req.method === 'POST' && action === 'handoff') {
            const input = await body(req), target = workbench.handoff(id, input);
            if (input.autoStart || target.workflowId) workbench.relay.enqueue(target.id);
            return json(201, target);
          }
          if (req.method === 'POST' && action === 'start') return json(200, await workbench.start(id));
          if (req.method === 'POST' && action === 'stop') { await workbench.stop(id); return json(200, workbench.task(id)); }
          if (req.method === 'POST' && ['archive', 'restore'].includes(action)) return json(200, workbench.archive(id, action === 'archive'));
          if (req.method === 'POST' && action === 'approve') return json(200, workbench.approve(id));
          return json(405, { error: '请求方法不正确' });
        }
        if (req.method === 'POST' && url.pathname === '/api/shutdown') { json(200, { ok: true }); server.emit('shutdown'); return; }
        return json(404, { error: '接口不存在' });
      }
      const files = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      if (req.method !== 'GET' || !files[url.pathname]) return json(404, { error: '页面不存在' });
      const [file, type] = files[url.pathname];
      res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' }); res.end(fs.readFileSync(path.join(__dirname, 'public', file)));
    } catch (err) { json(statusFor(err), { error: err.message }); }
  });
  return { server, token };
}
function option(name) {
  const i = process.argv.findIndex(a => a === '--' + name || a.startsWith('--' + name + '='));
  if (i === -1) return undefined;
  return process.argv[i].includes('=') ? process.argv[i].split('=').slice(1).join('=') : process.argv[i + 1];
}
async function alive(dir) {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(dir, 'connection.json'), 'utf8'));
    const r = await fetch(`http://127.0.0.1:${c.port}/api/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}
// The token survives restarts so an open page keeps working after the server is restarted.
function loadToken(dir) {
  const file = path.join(dir, 'token');
  try { const t = fs.readFileSync(file, 'utf8').trim(); if (/^[0-9a-f]{64}$/.test(t)) return t; } catch { /* create below */ }
  const t = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(file, t, { mode: 0o600 }); return t;
}
function testProviders() {
  // Test-only: run a fake agent script for both providers through the real adapter argv.
  const fake = process.env.WORKBENCH_FAKE_AGENT;
  if (!fake) return undefined;
  const p = { executable: process.execPath, prefix: [path.resolve(fake)], display: 'fake:' + fake, kind: 'cli' };
  return { codex: p, claude: p };
}
async function main() {
  const dir = path.resolve(process.env.WORKBENCH_DATA || path.join(__dirname, '.local'));
  const host = option('host') || process.env.WORKBENCH_HOST || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('出于安全考虑，工作台只监听本机回环地址（127.0.0.1 / ::1），拒绝：' + host);
  const rawPort = option('port') ?? process.env.WORKBENCH_PORT ?? process.env.PORT ?? '18764';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('端口无效：' + rawPort);
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, 'server.lock');
  if (fs.existsSync(lock)) {
    const old = Number(fs.readFileSync(lock, 'utf8'));
    let running = false;
    try { process.kill(old, 0); running = true; } catch (e) { running = e.code === 'EPERM'; }
    // A reused PID is not proof: only refuse when the old server actually answers.
    if (running && await alive(dir)) throw new Error('工作台已在运行（进程 ' + old + '），请使用启动入口打开已有窗口，或先退出它');
    fs.rmSync(lock, { force: true });
  }
  fs.writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
  const cleanup = () => { try { if (fs.readFileSync(lock, 'utf8') === String(process.pid)) fs.rmSync(lock); } catch { /* already gone */ } };
  process.on('exit', cleanup);
  try {
    const workbench = new Workbench(dir, { providers: testProviders() });
    const { server, token } = createServer(workbench, loadToken(dir));
    await new Promise((resolve, reject) => {
      server.once('error', e => reject(e.code === 'EADDRINUSE' ? new Error(`端口 ${port} 已被占用。换一个端口：设置环境变量 WORKBENCH_PORT 或使用 --port <端口>`) : e));
      server.listen(port, host, resolve);
    });
    workbench.relay.open();
    const shown = host === '::1' ? '[::1]' : host;
    const base = `http://${shown}:${server.address().port}`, url = `${base}/#${token}`;
    fs.writeFileSync(path.join(dir, 'connection.json'), JSON.stringify({ pid: process.pid, url, port: server.address().port, token }), { mode: 0o600 });
    console.log('本地协作台已启动：' + base);
    console.log('打开（含本机凭证）：' + url);
    if (process.argv.includes('--open')) {
      if (process.platform === 'win32') spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true, stdio: 'ignore' }).unref();
      else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' }).unref();
    }
    let stopping = false;
    const stop = async () => {
      if (stopping) return; stopping = true;
      await workbench.close();
      fs.rmSync(path.join(dir, 'connection.json'), { force: true }); cleanup();
      server.close(); server.closeAllConnections();
      setTimeout(() => process.exit(0), 200).unref();
    };
    server.on('shutdown', stop);
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } catch (e) { cleanup(); throw e; }
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { createServer };
