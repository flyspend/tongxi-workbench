'use strict';
// Test-only fixture. Never used by the production server or CLI settings.
const fs = require('node:fs');
let prompt = '';
process.stdin.setEncoding('utf8').on('data', s => prompt += s).on('end', async () => {
  if (await require('./relay-scenario.cjs')({ prompt, provider: process.env.WORKBENCH_AGENT_PROVIDER || 'codex', emit: o => console.log(JSON.stringify(o)), finalPath: process.argv[2] })) return;
  if (prompt.includes('SLOW_FIXTURE')) { console.log(JSON.stringify({ type: 'turn.started' })); setInterval(() => {}, 1000); return; }
  if (prompt.includes('FAIL_FIXTURE')) { console.log(JSON.stringify({ type: 'turn.failed', error: { message: 'fixture failed' } })); return; }
  if (prompt.includes('DENIED_FIXTURE')) { console.log(JSON.stringify({ type: 'result', result: 'needs permission', permission_denials: [{ tool_name: 'Bash' }] })); return; }
  if (prompt.includes('RECONNECT_FIXTURE')) console.log(JSON.stringify({ type: 'error', message: 'Reconnecting... waiting for network (Connection failed: error sending request)' }));
  fs.writeFileSync('generated.txt', '本地测试产物');
  const result = '完成测试任务。实际验证：fixture。输入包含共享版本：' + prompt.includes('共享说明版本：1');
  console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: result } }));
  fs.writeFileSync(process.argv[2], result);
});
