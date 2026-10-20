'use strict';
// Test-only fake AI. Invoked with the *real* adapter argv (codex: `exec --json ... -o <file> -`,
// claude: `-p --verbose --output-format stream-json ...`) and emits that CLI's JSON-lines protocol.
// Selected only by the WORKBENCH_FAKE_AGENT env var in the smoke test.
const fs = require('node:fs');
const args = process.argv.slice(2);
const provider = args[0] === 'exec' ? 'codex' : 'claude';
const emit = o => process.stdout.write(JSON.stringify(o) + '\n');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let prompt = '';
process.stdin.setEncoding('utf8').on('data', s => prompt += s).on('end', async () => {
  if (await require('./relay-scenario.cjs')({ prompt, provider, emit, finalPath: provider === 'codex' ? args[args.indexOf('-o') + 1] : null })) return;
  if (provider === 'claude' && !(args.includes('-p') && args.includes('stream-json'))) { console.error('bad claude argv: ' + args.join(' ')); process.exit(2); }
  if (provider === 'codex') emit({ type: 'thread.started' }); else emit({ type: 'system', subtype: 'init', model: 'fake' });
  emit(provider === 'codex' ? { type: 'turn.started' } : { type: 'assistant', message: { content: [{ type: 'text', text: 'fake claude 开始处理' }] } });
  if (prompt.includes('SLOW_FIXTURE')) { setInterval(() => {}, 1000); return; }
  await sleep(300); // lets the smoke test observe the running state and partial output
  // Same file name in both worktrees: proves the two AIs never overwrite each other.
  fs.writeFileSync('shared.txt', 'written by ' + provider + '\n');
  const result = `FAKE_${provider.toUpperCase()}_DONE：已写入 shared.txt`;
  if (provider === 'codex') {
    emit({ type: 'item.completed', item: { type: 'agent_message', text: result } });
    fs.writeFileSync(args[args.indexOf('-o') + 1], result);
    emit({ type: 'turn.completed' });
  } else {
    emit({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'shared.txt' } }] } });
    emit({ type: 'result', is_error: false, result });
  }
});
