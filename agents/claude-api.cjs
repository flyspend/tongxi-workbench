'use strict';
// Fallback Claude agent used when the Claude Code CLI is not installed.
// Reads the task prompt from stdin, works inside the current directory (the task's git worktree)
// and prints Claude-Code-compatible stream-json lines, so the workbench treats it like the CLI.
// The API key is read only from the ANTHROPIC_API_KEY environment variable; it is never logged.
// Raw fetch instead of @anthropic-ai/sdk: the workbench ships with zero npm dependencies.
const fs = require('node:fs');
const path = require('node:path');
const API = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '') + '/v1/messages';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
const MAX_TURNS = Number(process.env.WORKBENCH_API_MAX_TURNS || 40);
const mode = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'edit';
const root = fs.realpathSync(process.cwd());
const emit = o => process.stdout.write(JSON.stringify(o) + '\n');
function inside(p) {
  const full = path.resolve(root, String(p || '.'));
  const check = target => { const rel = path.relative(root, target); if (rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep)[0] === '.git') throw new Error('路径超出任务工作目录：' + p); };
  check(full);
  // 符号链接/目录联接可能指向工作目录外：按真实路径再检查一次（不存在的新文件检查其最近的已存在上级目录）
  let real = full;
  while (!fs.existsSync(real) && path.dirname(real) !== real) real = path.dirname(real);
  check(path.join(fs.realpathSync(real), path.relative(real, full)));
  return full;
}
function listFiles(dir, out = [], base = root) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(full, out, base); else out.push(path.relative(base, full).split(path.sep).join('/'));
    if (out.length >= 2000) break;
  }
  return out;
}
const tools = [
  { name: 'list_files', description: 'List files (recursive, relative paths) under a directory of the task workspace.', input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Directory relative to the workspace root; default "."' } }, required: [] } },
  { name: 'read_file', description: 'Read a UTF-8 text file from the task workspace.', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  ...(mode === 'review' ? [] : [{ name: 'write_file', description: 'Create or overwrite a UTF-8 text file in the task workspace with the full new content.', input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } }]),
];
function runTool(name, input) {
  if (name === 'list_files') return listFiles(inside(input.path)).join('\n') || '(empty)';
  if (name === 'read_file') { const s = fs.readFileSync(inside(input.path), 'utf8'); return s.length > 200000 ? s.slice(0, 200000) + '\n…(truncated)' : s; }
  if (name === 'write_file' && mode !== 'review') {
    if (typeof input.content !== 'string') throw new Error('content must be a string');
    const f = inside(input.path); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, input.content); return 'wrote ' + input.path;
  }
  throw new Error('unknown tool: ' + name);
}
async function call(messages) {
  const res = await fetch(API, {
    method: 'POST',
    signal: AbortSignal.timeout(10 * 60 * 1000),
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
    body: JSON.stringify({
      // fallbacks: "default" lets the API re-run a safety-classifier refusal on a fallback model.
      model: MODEL, max_tokens: 16000, output_config: { effort: 'high' }, fallbacks: 'default',
      system: `You are a coding agent working in a git worktree at ${root}. Use the tools to inspect and ${mode === 'review' ? 'review (read-only)' : 'modify'} files. You cannot run shell commands; say what should be verified manually. Finish with a concise summary of what you did.`,
      tools, messages,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${data.error?.message || res.statusText}`);
  return data;
}
async function main(prompt) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('未设置环境变量 ANTHROPIC_API_KEY');
  emit({ type: 'system', subtype: 'init', model: MODEL, cwd: root, backend: 'anthropic-api' });
  const messages = [{ role: 'user', content: prompt }];
  let final = '';
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const msg = await call(messages);
    // Append the full content (thinking blocks included) unchanged, as the API requires.
    messages.push({ role: 'assistant', content: msg.content });
    emit({ type: 'assistant', message: { content: msg.content.filter(b => b.type === 'text' || b.type === 'tool_use').map(b => b.type === 'text' ? { type: 'text', text: b.text } : { type: 'tool_use', name: b.name, input: b.input }) } });
    const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (text) final = text;
    if (msg.stop_reason === 'refusal') { emit({ type: 'result', is_error: true, result: '模型拒绝了该请求' }); return; }
    if (msg.stop_reason !== 'tool_use') { emit({ type: 'result', is_error: false, result: final || '（模型没有返回文字结果）' }); return; }
    const results = msg.content.filter(b => b.type === 'tool_use').map(b => {
      try { return { type: 'tool_result', tool_use_id: b.id, content: runTool(b.name, b.input || {}) }; }
      catch (e) { return { type: 'tool_result', tool_use_id: b.id, content: e.message, is_error: true }; }
    });
    messages.push({ role: 'user', content: results });
  }
  emit({ type: 'result', is_error: true, result: `超过最大轮数 ${MAX_TURNS}，已停止。最后输出：${final}` });
}
let input = '';
process.stdin.setEncoding('utf8').on('data', s => input += s).on('end', () => {
  main(input).catch(e => { emit({ type: 'result', is_error: true, result: e.message }); process.exitCode = 1; });
});
