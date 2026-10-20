'use strict';
// Translate interface chrome only. Project content, agent replies, code and logs retain their original language.
(() => {
  const dictionary = {
    '私下聊，不打扰群里': 'Direct messages, separate from the group', '在这里给成员派活，它们会协作处理': 'Assign work to your AI team here', '● 已检测': '● Detected', '○ 未找到 CLI': '○ CLI not found', '● 在线': '● Online', '○ 离线': '○ Offline',
    '停止这个频道里正在做和排队的事？': 'Stop running and queued tasks in this channel?', '退出工作台并停止正在执行的任务？': 'Quit the workbench and stop running tasks?', '工作台已退出。下次双击启动入口即可继续。': 'Workbench stopped. Use the launcher to start it again.',
    '停止执行': 'Stop task', '验收完成': 'Accept delivery', '废弃任务': 'Archive task', '恢复任务': 'Restore task', ' · 来自': ' · from', ' · 接续交接': ' · handoff', ' · 自动接力': ' · workflow', ' · 双发': ' · both', '项任务': 'tasks',
    '同席': 'Tongxi', '同席 · 本地 AI 协作工作台': 'Tongxi · Local AI Workbench',
    '本地运行 · AI 自动接力': 'Local · Automatic AI handoffs', '本地运行 · 自动接力': 'Local · Automatic handoffs',
    '你的项目': 'Your projects', '让 AI 帮我接入': 'Connect with AI help', '⚙ CLI 设置': '⚙ CLI settings', '退出工作台': 'Quit workbench',
    '共享上下文，自动接力': 'Shared context, automatic handoffs', '一个工作台，协作不限两位。': 'One workbench. Your AI team.',
    '添加本机 Git 仓库，开始协作。': 'Add a local Git repository to collaborate.', '添加本机 Git 仓库，开始手动分工。': 'Add a local Git repository to get started.',
    '💬 聊天': '💬 Chat', '▦ 任务看板': '▦ Task board', '＋ 分配任务': '＋ Assign task', '聊天': 'Chat',
    '@大家': '@all', '不 @ 就由刚才回话的那位接着做': 'Without a mention, the last responder continues',
    '只读，不改代码': 'Review only', '发送': 'Send', '群成员': 'Members', '群公告': 'Shared instructions', '编辑': 'Edit',
    '外部 AI': 'External AI', '复制接入提示词': 'Copy connection prompt',
    '发给任何能运行命令的 AI（另一个 Claude Code、Cursor、Gemini CLI 等），它就能在这个群里派活、看回复。': 'Give this prompt to an AI with local terminal access to join as a member, claim tasks and report results.',
    '▤ 共享需求与接口': '▤ Shared requirements & interfaces', '给出目标，双方接力做到完成': 'Set the goal. Let your AI team continue.',
    '统一需求和接口，AI 可以直接互派任务。后台自动接收、排队和执行，直到整组完成。': 'Share requirements and interfaces. AI members hand off tasks while the server queues and tracks the work.',
    '添加本机项目': 'Add local project', '当前任务': 'Active tasks', '完成任务': 'Completed tasks', '搜索任务': 'Search tasks', '搜索任务名称…': 'Search task titles…',
    '消息动态': 'Updates', '点击展开最近消息': 'Expand recent updates', '最新消息': 'Latest updates', '全部标为已读': 'Mark all read', '协作动态': 'Activity', '本机保存': 'Stored locally',
    '项目名称': 'Project name', '例如：my-app': 'For example: my-app', 'Git 仓库绝对路径': 'Absolute Git repository path', '起始分支 / 提交': 'Base branch / commit', '留空使用当前分支': 'Blank uses the current branch',
    '开始任务时创建独立分支和工作目录；现有未提交修改不会复制过去。': 'Tasks create a separate branch and worktree. Existing uncommitted changes are not copied.',
    '取消': 'Cancel', '添加项目': 'Add project', '分配任务': 'Assign task', '交接给另一方': 'Hand off task', '任务名称': 'Task title', '例如：实现地图 UI': 'For example: implement map UI',
    '交给谁': 'Assignee', '两个都发（各自独立分支）': 'Codex + Claude (separate worktrees)', '任务类型': 'Task mode', '实现与修改': 'Implement / edit', '只读审查': 'Review',
    '修改范围': 'Scope', '例如：只修改 world/game/': 'For example: only world/game/', '留空使用项目起始分支': 'Blank uses the project base branch', '具体要求与验收': 'Requirements & acceptance criteria',
    '把完成的标准写清楚，双方都能看到。': 'Describe completion criteria for the team.', '等待哪些任务完成': 'Dependencies',
    'AI 自动接力，连续执行到整组完成': 'Continue automatic handoffs until the workflow finishes', '保存后立即执行': 'Start after saving', '整组最多任务数': 'Maximum tasks per workflow', '保存分工': 'Save assignment',
    '每个 AI 在自己的分支（ai/codex/…、ai/claude/…）和独立工作目录里执行，不会同时改同一目录。': 'Each parallel task uses a separate branch and worktree. Sequential handoffs share one worktree.',
    '共享需求与接口': 'Shared requirements & interfaces', '双方每次执行都会收到同一版说明。更新对下一次执行生效，不打断正在运行的任务。': 'Each run receives the same revision. Updates apply to the next run.',
    '共享需求': 'Shared requirements', '目标、共同规则、需要遵守的约束……': 'Goals, shared rules and constraints…', '接口约定': 'Interface contracts', '接口名称、字段、返回示例、负责人、当前状态……': 'Interfaces, fields, examples, owners and status…', '保存新版本': 'Save revision',
    '本机 CLI 设置': 'Local CLI settings', '使用各 CLI 已有的登录。这里不收集 API 密钥。未安装 Claude Code CLI 时，若启动工作台前设置了环境变量 ANTHROPIC_API_KEY，Claude 通道会改用 Anthropic API。': 'Uses each CLI’s existing login. API keys are not collected here. If Claude Code is unavailable, the Claude channel can use ANTHROPIC_API_KEY set before startup.',
    'Codex 可执行文件': 'Codex executable', 'Claude 可执行文件': 'Claude executable', '留空自动查找': 'Blank: detect automatically', '例如：C:\\Users\\你\\.local\\bin\\claude.exe': 'For example: C:\\Users\\you\\.local\\bin\\claude.exe',
    'Godot 可执行文件（可选）': 'Godot executable (optional)', '留空则查找 WORKBENCH_GODOT 或 PATH': 'Blank: use WORKBENCH_GODOT or PATH',
    '自动验收：任务交付后由 Codex 自动复核，通过才归档，不用逐个点“验收完成”': 'Automatic acceptance: Codex reviews deliveries before archiving them', '保存并检测': 'Save & detect', '本次任务完整输入': 'Full task input',
    '自动选择': 'Automatic', '所有成员': 'All members', '接收成员': 'Recipient', '待开始': 'Not started', '自动排队': 'Queued', '准备目录': 'Preparing worktree', '执行中': 'Running', '停止中': 'Stopping', '已停止': 'Stopped',
    '待你验收': 'Awaiting acceptance', '已完成': 'Completed', '执行失败': 'Failed', '需要处理': 'Needs attention', '上次执行中断': 'Interrupted', '已被后续交付替代': 'Superseded',
    '自动验收受阻': 'Acceptance blocked', '自动验收中 / 查看进度': 'Acceptance in progress', '等待自动验收': 'Awaiting automatic acceptance', '已废弃': 'Archived', 'AI 已完成': 'Completed by AI',
    '后台自动接力中': 'Workflow running', '已暂停接力': 'Workflow paused', '需要处理后继续': 'Workflow needs attention', '整组已停止': 'Workflow stopped', '整组任务全部完成': 'Workflow completed',
    '已完成 / 已停止': 'Completed / stopped', '已废弃 / 已停止': 'Archived / stopped', '待开始 / 需处理': 'Not started / needs attention', '正在执行': 'Running', '自动验收与成果': 'Acceptance & deliverables', '待验收': 'Awaiting acceptance', '暂无任务': 'No tasks',
    '暂停接力': 'Pause workflow', '继续接力': 'Resume workflow', '停止整组': 'Stop workflow', '未连接': 'Disconnected', '离线 · 等待领取任务': 'Offline · waiting for claim', '空闲': 'Idle',
    '正在输入…': 'Working…', '群里还没人说话': 'Start a group conversation', '直接说要做什么。默认谁空闲谁接；写': 'Describe the task, or mention', '指定人。需要复核或修复时它们会在群里互相 @，你不用转达。': 'to choose a member. Members can hand off reviews and fixes.',
    '或': 'or', '群主': 'Owner', '我': 'Me', '群': 'Group', '停止': 'Stop', '重试': 'Retry', '展开': 'Expand', '展开全文': 'Read more', '改动': 'Changes', '详情': 'Details', '只读': 'Review',
    '（无文字回复）': '(No text reply)', '（已由后面的消息接手）': '(Handled by a later message)', '看过程': 'Show progress', '收起过程': 'Hide progress', '排队中': 'Queued',
    '还没有群公告。写下目标、规则和接口约定，各位成员每次都会看到。': 'Add goals, rules and interfaces. Every member receives them.',
    '发到群里… Enter 发送，Shift+Enter 换行': 'Message the group… Enter to send, Shift+Enter for a new line',
    '交付成果': 'Deliverables', '等待交付说明': 'Awaiting delivery notes', '↗ 外部成果链接': '↗ External deliverable', '此任务暂无可预览文件，展开详情查看交付说明。': 'No preview files. Open details for delivery notes.',
    '分配第一项任务后，双方的进度会出现在这里。': 'Assign a task to see progress here.', '尚未添加项目': 'No projects yet', '暂无改动': 'No changes', '尚未开始执行。': 'Not started yet.',
    '重新执行': 'Run again', '开始执行': 'Start', '查看完整输入': 'View full input', '查看改动': 'View changes', '关闭': 'Close', '任务要求': 'Requirements', '交付结果': 'Result', '前置任务': 'Dependencies', '实时执行记录': 'Live log',
    '已复制接入提示词，粘贴给其他 AI 即可': 'Connection prompt copied. Paste it into your AI.', '尚未连接到本地服务': 'Not connected to the local service',
    '自动接力时，双方可以直接派发后续任务并回传修复，直到整组完成。需要权限或认证时会明确暂停。': 'Members can hand off tasks and fixes. Permission or authentication issues are reported explicitly.',
    '接收方沿用交接目录，保留未提交代码；当前任务结束后自动开始，不会同时改同一目录。': 'The recipient reuses the worktree after the current task ends, preserving uncommitted changes.',
    '停止这个频道里正在做和排队的事': 'Stop running and queued tasks in this channel',
    '还没有消息。分配任务后，AI 之间的派发、执行和完成都会出现在这里。': 'No updates yet. Task assignments and results will appear here.',
    '打开这项任务': 'Open task', '实现任务': 'Implementation', '↗ 查看详情': '↗ Details', '任务看板': 'Task board',
  };
  let lang;
  try { lang = new URLSearchParams(location.search).get('lang') || localStorage.getItem('language') || (navigator.language.startsWith('zh') ? 'zh' : 'en'); } catch { lang = 'zh'; }
  if (!['zh','en'].includes(lang)) lang = 'zh';
  const textState = new WeakMap(), attrState = new WeakMap();
  const protectedContent = '.project-item,.msg-text,.bubble,.delivery-summary,.detail h2,.detail-text,.result,.terminal,pre,code,.activity-row span,.latest-row > span:not(.who),.task-card h3,.task-card p,.tag.ok,.member b:not([data-ui]),.msg-name,.agent-row b,.avatar,.provider,.channel[data-channel^="ext-"] .ch-name,[data-user-content]';
  function translate(text) {
    const trimmed = text.trim();
    if (Object.hasOwn(dictionary, trimmed)) return text.replace(trimmed, dictionary[trimmed]);
    const patterns = [
      [/^ · (\d+) 执行中 · (\d+) 等待自动接收 · (\d+) 已完成$/, (_,r,q,d) => ` · ${r} running · ${q} queued · ${d} completed`],
      [/^(.+) · (\d+)\/(\d+) 完成 · 上限 (\d+)$/, (_,s,a,b,c) => `${dictionary[s] || s} · ${a}/${b} complete · limit ${c}`],
      [/^(待开始|自动排队|准备目录|执行中|停止中|已停止|待你验收|已完成|执行失败|需要处理|上次执行中断) · (只读审查|实现与修改)$/, (_,s,m) => `${dictionary[s]} · ${dictionary[m]}`],
      [/^(.+) 群$/, (_, n) => `${n} group`],
      [/^和 (.+) 私聊$/, (_, n) => `Chat with ${n}`], [/^(.+) 群（(\d+)）$/, (_, n,c) => `${n} group (${c})`],
      [/^你、(.+) · 同一个代码目录$/, (_, n) => `You, ${n} · shared worktree`], [/^私信 (.+)… Enter 发送$/, (_, n) => `Message ${n}… Enter to send`],
      [/^私聊 (.+)$/, (_, n) => `Message ${n}`], [/^在忙：(.+)$/, (_, n) => `Busy: ${n}`], [/^排队：(.+)$/, (_, n) => `Queued: ${n}`],
      [/^(\d+) 条新消息$/, (_, n) => `${n} new updates`], [/^第 (\d+) 次$/, (_, n) => `Run ${n}`],
    ];
    for (const [pattern, replacement] of patterns) if (pattern.test(trimmed)) return text.replace(trimmed, trimmed.replace(pattern, replacement));
    return text;
  }
  function apply() {
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
    const select = document.querySelector('#language'); if (select) select.value = lang;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode, parent = node.parentElement;
      if (!parent || parent.closest('script,style,textarea,input')) continue;
      const protectedRoot = parent.closest(protectedContent);
      if (protectedRoot && !(protectedRoot.classList.contains('bubble') && parent.closest('button'))) continue;
      const saved = textState.get(node);
      const source = saved && node.nodeValue === saved.output ? saved.source : node.nodeValue;
      const output = lang === 'en' ? translate(source) : source;
      textState.set(node, { source, output }); if (node.nodeValue !== output) node.nodeValue = output;
    }
    for (const el of document.querySelectorAll('[placeholder],[title],[aria-label]')) {
      if (el.closest(protectedContent)) continue;
      const saved = attrState.get(el) || {};
      for (const key of ['placeholder','title','aria-label']) {
        if (!el.hasAttribute(key)) continue;
        const value = el.getAttribute(key), prev = saved[key], source = prev && value === prev.output ? prev.source : value;
        const output = lang === 'en' ? translate(source) : source; saved[key] = { source, output }; if (value !== output) el.setAttribute(key, output);
      }
      attrState.set(el, saved);
    }
    if (lang === 'en') document.title = document.title.replace('同席 · 本地 AI 协作工作台', 'Tongxi · Local AI Workbench');
    else document.title = document.title.replace('Tongxi · Local AI Workbench', '同席 · 本地 AI 协作工作台');
  }
  window.i18n = { get lang() { return lang; }, apply, t: text => lang === 'en' ? translate(text) : text };
  document.querySelector('#language').addEventListener('change', e => { lang = e.target.value; try { localStorage.setItem('language',lang); } catch {} apply(); });
  let pending = false;
  new MutationObserver(() => { if (!pending) { pending = true; queueMicrotask(() => { pending = false; apply(); }); } }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder','title','aria-label'] });
  apply();
})();
