'use strict';
// Deterministic integration fixture. No AI service, API key or browser is needed.
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const sleep = ms => new Promise(r => setTimeout(r, ms));
module.exports = async function scenario({ prompt, provider, emit, finalPath }) {
  const title = /(?:当前用户任务|对你说)：\n([^\n]+)/.exec(prompt)?.[1] || '';
  if (!title.startsWith('relay-')) return false;
  const end = value => {
    const result = typeof value === 'string' ? value : '验证记录：本地 fixture。\n```workbench\n' + JSON.stringify(value) + '\n```';
    if (finalPath) fs.writeFileSync(finalPath, result);
    emit(provider === 'codex' ? { type: 'item.completed', item: { type: 'agent_message', text: result } } : { type: 'result', is_error: false, result });
  };
  const complete = () => end({ action: 'complete', summary: '本地检查完成', validation: ['fixture 实际检查通过'], remaining: [] });
  if (title === 'relay-slow') { setInterval(() => {}, 1000); return true; }
  if (title === 'relay-stage-1') {
    fs.writeFileSync('relay-code.txt', 'codex-v1');
    end({ action: 'handoff', provider: 'claude', title: 'relay-stage-2', prompt: '检查 codex-v1 并发送修复任务', mode: 'review' });
  } else if (title === 'relay-stage-2') {
    if (fs.readFileSync('relay-code.txt', 'utf8') !== 'codex-v1') throw new Error('交接丢失代码');
    end({ action: 'handoff', provider: 'codex', title: 'relay-stage-3', prompt: '修复到 codex-v2 再交给 Claude 检查', mode: 'edit' });
  } else if (title === 'relay-stage-3') {
    fs.writeFileSync('relay-code.txt', 'codex-v2');
    const { stdout } = await exec(process.execPath, [process.env.WORKBENCH_BRIDGE, 'send', '--to', 'claude', '--title', 'relay-stage-4', '--prompt', '确认 codex-v2 后完成整组', '--mode', 'review'], { windowsHide: true });
    if (!JSON.parse(stdout).ok) throw new Error('信箱接力未获回执');
    end('已通过本轮信箱给 Claude 发出检查任务，无需用户启动。');
  } else if (title === 'relay-stage-4') {
    if (fs.readFileSync('relay-code.txt', 'utf8') !== 'codex-v2') throw new Error('修复代码没有交回');
    complete();
  } else if (title === 'relay-loop') {
    end({ action: 'handoff', provider: provider === 'codex' ? 'claude' : 'codex', title: 'relay-loop', prompt: '继续回传', mode: 'review' });
  } else if (title === 'relay-failure') {
    emit({ type: 'turn.failed', error: { message: 'fixture 真实失败' } });
    end({ action: 'handoff', provider: 'claude', title: 'relay-complete', prompt: '不得启动' });
  } else if (title === 'relay-missing-report') end('CLI 正常退出，但没有完成协议');
  else if (title === 'relay-invalid-report') end({ action: 'complete', summary: '有遗漏', validation: ['未验证'], remaining: ['仍有工作'] });
  else if (title === 'relay-block') end({ action: 'block', reason: 'fixture 需要用户认证' });
  else if (title === 'relay-denied-complete' || title === 'relay-denied-silent') {
    const result = title === 'relay-denied-silent' ? '有命令被拒，没有报告' : '一条命令被拒，已说明。\n```workbench\n' + JSON.stringify({ action: 'complete', summary: '完成，缺一项实机检查', validation: ['单测通过；实机检查被拒未跑'], remaining: [] }) + '\n```';
    emit({ type: 'result', is_error: false, result, permission_denials: [{ tool_name: 'PowerShell', tool_input: { command: 'rm x' } }] });
  }
  else if (title === 'relay-pause-root') {
    await exec(process.execPath, [process.env.WORKBENCH_BRIDGE, 'send', '--to', 'claude', '--title', 'relay-complete', '--prompt', '后续完成'], { windowsHide: true });
    await sleep(1200); end('交接已发送');
  } else if (title === 'relay-duplicate') {
    const args = [process.env.WORKBENCH_BRIDGE, 'send', '--to', 'claude', '--title', 'relay-complete', '--prompt', '只创建一次'];
    await exec(process.execPath, args, { windowsHide: true }); await exec(process.execPath, args, { windowsHide: true }); end('重复请求测试完成');
  } else if (title === 'relay-complete') complete();
  else throw new Error('未知 relay fixture：' + title);
  return true;
};
