'use strict';
const $ = s => document.querySelector(s);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};
// The token comes from the launch URL (#token). Remember it so a plain refresh or a bookmarked URL keeps working;
// the server keeps the same token across restarts.
if (location.hash.length > 1) { store.set('token', location.hash.slice(1)); history.replaceState(null, '', location.pathname); }
const token = store.get('token') || '';
const names = { todo: '待开始', queued: '自动排队', starting: '准备目录', running: '执行中', stopping: '停止中', stopped: '已停止', review: '待你验收', done: '已完成', failed: '执行失败', blocked: '需要处理', interrupted: '上次执行中断' };
const flowNames = { running: '后台自动接力中', paused: '已暂停接力', blocked: '需要处理后继续', stopped: '整组已停止', completed: '整组任务全部完成' };
const label = p => p === 'codex' ? 'Codex' : 'Claude';
let state, selectedProject = store.get('selectedProject'), selectedTask = store.get('selectedTask'), handoffFrom, contextRevision, pollTimer, busy = false, polling = false, failures = 0;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function notify(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(notify.timer); notify.timer = setTimeout(() => $('#toast').hidden = true, 7000); }
async function api(route, method = 'GET', data, timeout = method === 'GET' ? 15000 : 180000) {
  let res;
  try {
    res = await fetch('/api/' + route, { method, signal: AbortSignal.timeout(timeout), headers: { Authorization: 'Bearer ' + token, ...(data ? { 'Content-Type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
  } catch (e) {
    throw new Error(e.name === 'TimeoutError' ? '请求超时，请检查本地服务是否卡住' : '无法连接本地服务，请确认工作台仍在运行');
  }
  const value = await res.json().catch(() => ({ error: '服务返回了无法识别的内容（HTTP ' + res.status + '）' }));
  if (!res.ok) { const err = new Error(value.error || 'HTTP ' + res.status); err.status = res.status; throw err; }
  return value;
}
function project() { return state?.projects.find(p => p.id === selectedProject); }
function tasks() { return state?.tasks.filter(t => t.projectId === selectedProject) || []; }
function openDialog(id) { $(id).showModal(); }
function selectTask(id) { selectedTask = id; store.set('selectedTask', id); }
let taskView = 'active', searchQuery = '';
function archived(t) {
  const flow = state.workflows?.find(f => f.id === t.workflowId);
  return t.archived || ['done', 'stopped'].includes(t.status) || (flow?.status === 'stopped' && !['starting','running','stopping'].includes(t.status));
}
function taskStatus(t) { if(t.supersededBy) return '已被后续交付替代'; if(t.status === 'review' && state.settings?.autoReview) { const flow=state.workflows?.find(f=>f.id===t.autoReviewWorkflowId); return flow?.status === 'blocked' ? '自动验收受阻' : t.autoReviewWorkflowId ? '自动验收中 / 查看进度' : '等待自动验收'; } return t.archived || (archived(t) && t.status !== 'done') ? '已废弃' : t.completionKind === 'agent' ? 'AI 已完成' : names[t.status] || t.status; }
const artifactBlobs = new Map();
function artifactUrl(t,a) { return 'tasks/'+t.id+'/artifact?file='+encodeURIComponent(a.file); }
function deliverables(t) {
 if (!['review','done'].includes(t.status)) return '';
 const files=t.artifacts||[], images=files.filter(a=>a.image).slice(0,3);
 const summary=String(t.result||'').split('\n').find(x=>x.trim())||'等待交付说明';
 const urls=[...String(t.result||'').matchAll(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/g)].slice(0,3);
 return '<section class="deliverables"><div class="delivery-label">交付成果</div><div class="delivery-summary">'+esc(summary)+'</div>'+(images.length?'<div class="delivery-images">'+images.map(a=>'<a href="#" data-artifact="'+esc(artifactUrl(t,a))+'" title="'+esc(a.name)+'"><img data-preview="'+esc(artifactUrl(t,a))+'" alt="'+esc(a.name)+'" loading="lazy"></a>').join('')+'</div>':'')+'<div class="delivery-links">'+files.map(a=>'<a href="#" data-artifact="'+esc(artifactUrl(t,a))+'">'+(a.image?'▧ ':'↗ ')+esc(a.name)+'</a>').join('')+urls.map(m=>'<a href="'+esc(m[1])+'" target="_blank" rel="noopener noreferrer">↗ 外部成果链接</a>').join('')+'</div>'+(!files.length&&!urls.length?'<div class="hint">此任务暂无可预览文件，展开详情查看交付说明。</div>':'')+'</section>';
}
async function artifactBlob(route) {
 if(!artifactBlobs.has(route)) artifactBlobs.set(route,fetch('/api/'+route,{headers:{Authorization:'Bearer '+token}}).then(async r=>{if(!r.ok)throw new Error('成果读取失败');return URL.createObjectURL(await r.blob());}).catch(e=>{artifactBlobs.delete(route);throw e;}));
 return artifactBlobs.get(route);
}
function loadPreviews(){ for(const img of document.querySelectorAll('[data-preview]')) {const route=img.dataset.preview;artifactBlob(route).then(url=>{if(img.isConnected)img.src=url;}).catch(()=>{img.alt='预览读取失败，点击重试';});} }
document.addEventListener('click',async e=>{const link=e.target.closest('[data-artifact]');if(!link)return;e.preventDefault();e.stopPropagation();try{const url=await artifactBlob(link.dataset.artifact);const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';a.click();}catch(err){notify(err.message);}},true);
function card(t) {
  return `<article class="task-card ${selectedTask === t.id ? 'selected' : ''}" tabindex="0" role="button" data-task="${t.id}"><div class="task-top"><span class="provider ${t.provider}">${label(t.provider)}</span><span class="status-${t.status}">${esc(taskStatus(t))}</span></div><h3>${esc(t.title)}</h3><p>${esc(t.archiveReason || t.progress || t.error || t.scope || t.prompt)}</p>${deliverables(t)}<div class="task-meta"><span>${t.mode === 'review' ? '只读审查' : '实现任务'}${t.sentBy ? ' · 来自 ' + label(t.sentBy) : t.sourceId ? ' · 接续交接' : ''}${t.workflowId ? ' · 自动接力' : t.groupId ? ' · 双发' : ''}</span><span>${t.dependencies.length ? t.dependencies.length + ' 项前置' : '↗ 查看详情'}</span></div></article>`;
}
function render() {
  if (!project() && state.projects.length) selectedProject = state.projects[0].id;
  const p = project(), list = tasks();
  const history = list.filter(archived), active = list.filter(t => !archived(t));
  $('#active-count').textContent = active.length; $('#completed-count').textContent = history.length;
  $('#view-active').setAttribute('aria-selected', taskView === 'active'); $('#view-completed').setAttribute('aria-selected', taskView === 'completed');
  const visible = (taskView === 'active' ? active : history).filter(t => t.title.toLowerCase().includes(searchQuery));
  $('#project-title').textContent = p?.name || '一个工作台，两位搭档。';
  $('#project-path').textContent = p ? p.path + '  ·  ' + p.baseRef : '添加本机 Git 仓库，开始手动分工。';
  $('#projects').innerHTML = state.projects.map(p => `<button class="project-item ${p.id === selectedProject ? 'selected' : ''}" data-project="${p.id}">▣ ${esc(p.name)}<small>${esc(p.baseRef)}</small></button>`).join('') || '<div class="hint">尚未添加项目</div>';
  $('#agents').innerHTML = ['codex', 'claude'].map(k => { const x = state.providers[k]; return `<div class="agent-row" title="${esc(x.path)}"><b>${label(k)}</b><span class="${x.available ? 'available' : ''}">${x.available ? '● ' + (x.kind === 'api' ? 'API' : '已检测') : '○ 未找到 CLI'}</span></div>`; }).join('');
  $('#intro').hidden = !!p; $('#new-task').disabled = !p; $('#shared').disabled = !p;
  document.querySelector('.local-pill').innerHTML = '<i></i> 本地运行 · 自动接力' + (state.settings?.autoReview ? ' · 自动验收' : '');
  $('#revision').textContent = p ? 'v' + p.revision : '';
  $('#counts').innerHTML = `<strong>${list.length}</strong> 项任务 <span> · ${list.filter(t => ['starting', 'running', 'stopping'].includes(t.status)).length} 执行中 · ${list.filter(t => t.status === 'queued').length} 等待自动接收 · ${list.filter(t => t.status === 'done').length} 已完成</span>`;
  $('#workflows').innerHTML = (state.workflows || []).filter(f => f.projectId === selectedProject && taskView === 'active' && !['completed', 'stopped'].includes(f.status)).map(f => {
    const members = list.filter(t => t.workflowId === f.id);
    return `<div class="workflow-row ${f.status}"><div><strong>${esc(f.title)}</strong><p>${flowNames[f.status]} · ${members.filter(t => t.status === 'done').length}/${members.length} 完成 · 上限 ${f.maxTasks}${f.reason ? '<br>' + esc(f.reason) : ''}</p></div><div class="workflow-actions">${f.status === 'running' ? `<button data-flow="${f.id}" data-control="pause">暂停接力</button>` : ['paused', 'blocked'].includes(f.status) ? `<button data-flow="${f.id}" data-control="resume">继续接力</button>` : ''}${!['completed', 'stopped'].includes(f.status) ? `<button data-flow="${f.id}" data-control="stop">停止整组</button>` : ''}</div></div>`;
  }).join('');
  const columns = taskView === 'completed' ? [['已完成', visible.filter(t => t.status === 'done' && !t.archived)], ['已废弃 / 已停止', visible.filter(t => t.status !== 'done' || t.archived)]] : [['待开始 / 需处理', visible.filter(t => !['running','starting','stopping','review'].includes(t.status))], ['正在执行', visible.filter(t => ['starting','running','stopping'].includes(t.status))], [state.settings?.autoReview ? '自动验收与成果' : '待验收', visible.filter(t => t.status === 'review')]];
  $('#board').classList.toggle('history-board', taskView === 'completed');
  $('#board').innerHTML = p ? columns.map(([title, entries]) => `<div class="column"><div class="column-head">${title}<span>${entries.length}</span></div>${entries.map(card).join('') || '<div class="empty-column">暂无任务</div>'}</div>`).join('') : '';
  renderLatest();
  const activity = state.activity.filter(e => !e.taskId || tasks().some(t => t.id === e.taskId)).slice(0, 8);
  $('#activity').innerHTML = activity.map(e => `<div class="activity-row"><time>${new Date(e.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time><span>${esc(e.message)}</span></div>`).join('') || '<div class="hint">分配第一项任务后，双方的进度会出现在这里。</div>';
  renderChat(); renderDetail(); loadPreviews();
}
// ---- 聊天：每个项目一个群（你 + Codex + Claude）和两个私信。AI 之间在群里直接对话、接力，你只看结果 ----
let view = store.get('view') || 'chat', selectedChannel = store.get('selectedChannel') || 'group', threadQuery = '';
let channelSeen = {}; try { channelSeen = JSON.parse(store.get('channelSeen') || '{}'); } catch { /* reset */ }
const liveText = new Map(), expanded = new Set();
let showProcess = false;
const running = t => ['starting', 'running', 'stopping'].includes(t.status);
const touched = t => [t.finishedAt, t.startedAt, t.createdAt].filter(Boolean).sort().pop() || '';
const CHANNELS = ['group', 'codex', 'claude'];
const avatar = who => `<div class="avatar ${who}">${who === 'user' ? '我' : who === 'codex' ? 'Cx' : who === 'claude' ? 'Cl' : '群'}</div>`;
function stripReport(s) { return String(s || '').replace(/```workbench\s*\n[\s\S]*?\n```/g, '').trim(); }
function report(s) { const m = [...String(s || '').matchAll(/```workbench\s*\n([\s\S]*?)\n```/g)]; try { return m.length === 1 ? JSON.parse(m[0][1]) : null; } catch { return null; } }
// 极简 Markdown：代码块、行内代码、粗体、链接；先转义再替换，不执行任何 HTML
function md(s) {
  return esc(s).replace(/```[\w-]*\n([\s\S]*?)```/g, (_, c) => '<pre class="code">' + c.replace(/\n$/, '') + '</pre>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    // @提及先于链接替换；链接地址里一旦含有已插入的标签就不再当作链接，避免拼出坏的 href
    .replace(/@(Codex|Claude|codex|claude|大家)/g, '<span class="at">@$1</span>')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s<>"]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}
function channelFlow(ch) { return (state.workflows || []).find(f => f.channel === selectedProject + ':' + ch); }
function channelTasks(ch) { const f = channelFlow(ch); return f ? state.tasks.filter(t => t.workflowId === f.id) : []; }
// 把任务拆成聊天事件：用户/AI 发出的消息按创建时间，AI 的回复按结束时间
function events(list) {
  const out = [];
  for (const t of list) {
    if (t.sentBy) out.push({ at: t.createdAt, from: t.sentBy, kind: 'say', t });
    else out.push({ at: t.createdAt, from: 'user', kind: 'ask', t });
    if (t.finishedAt && !running(t) && t.status !== 'queued') out.push({ at: t.finishedAt, from: t.provider, kind: 'reply', t });
  }
  out.sort((a, b) => a.at.localeCompare(b.at));
  // @大家：同一句话生成两轮任务，聊天里只显示一次
  return out.filter((e, i) => { if (e.kind !== 'ask') return true; const first = out.slice(0, i).reverse().find(x => x.kind === 'ask'); if (first && first.t.prompt === e.t.prompt && new Date(e.at) - new Date(first.at) < 5000) { first.both = true; return false; } return true; });
}
function preview(ch) {
  const ev = events(channelTasks(ch)), last = ev[ev.length - 1];
  if (!last) return { text: ch === 'group' ? '在这里给两位 AI 派活，它们会自己商量' : '私下聊，不打扰群里', at: '' };
  const who = last.from === 'user' ? '我' : label(last.from), text = last.kind === 'reply' ? stripReport(last.t.result) || last.t.error || '（无文字回复）' : last.t.prompt;
  return { text: who + '：' + text.replace(/\s+/g, ' ').slice(0, 40), at: last.at };
}
function memberState(k) {
  const x = state.providers[k];
  if (!x.available) return ['off', '未连接'];
  const busy = state.tasks.find(t => t.provider === k && running(t)), queued = state.tasks.find(t => t.provider === k && t.status === 'queued');
  if (busy) return ['busy', '在忙：' + busy.title];
  if (queued) return ['busy', '排队：' + queued.title];
  return ['ok', '空闲'];
}
function bubble(e, prev) {
  const t = e.t, mine = e.from === 'user', grouped = prev && prev.from === e.from && new Date(e.at) - new Date(prev.at) < 5 * 60000;
  const when = new Date(e.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  let body, cls = '', tools = '';
  if (e.kind === 'ask') {
    body = (selectedChannel === 'group' ? `<span class="at">@${e.both ? '大家' : label(t.provider)}</span> ` : '') + md(t.prompt) + (t.mode === 'review' ? ' <span class="tag">只读</span>' : '');
  } else if (e.kind === 'say') {
    body = `<span class="at">@${label(t.provider)}</span> <b>${esc(t.title)}</b>`;
    const long = t.prompt.length > 160;
    body += long && !expanded.has('s' + t.id) ? `<div class="msg-text clamp">${md(t.prompt.slice(0, 160))}…</div><button class="link" data-expand="s${t.id}">展开</button>` : `<div class="msg-text">${md(t.prompt)}</div>`;
  } else {
    const r = report(t.result), text = stripReport(t.result);
    if (['failed', 'blocked', 'interrupted', 'stopped'].includes(t.status)) {
      cls = t.supersededBy ? 'muted' : 'warn';
      body = (text ? md(text.slice(0, 600)) + '<br>' : '') + `<span class="err">${t.supersededBy ? '（已由后面的消息接手）' : '⚠ ' + esc(t.error || names[t.status])}</span>`;
      if (!t.supersededBy && !archived(t)) tools += `<button class="link" data-retry="${t.id}">重试</button>`;
    } else {
      const long = text.length > 700 || text.split('\n').length > 14;
      body = !text ? '<span class="hint">（无文字回复）</span>' : long && !expanded.has('r' + t.id) ? `<div class="msg-text clamp">${md(text)}</div><button class="link" data-expand="r${t.id}">展开全文</button>` : `<div class="msg-text">${md(text)}</div>`;
      if (r?.action === 'complete' || t.completionSummary) body += `<div class="tag ok">✓ ${esc(t.completionSummary || r.summary)}</div>`;
      if (t.artifacts?.length) body += deliverables(t);
    }
    if (t.workspace) tools += `<button class="link" data-diff="${t.id}">改动</button>`;
    tools += `<button class="link" data-detail="${t.id}">详情</button>`;
  }
  const name = mine ? '' : `<div class="msg-name">${label(e.from)}${e.kind === 'say' ? ' → ' + label(t.provider) : ''}</div>`;
  return `<div class="msg ${mine ? 'me' : 'them'} ${grouped ? 'grouped' : ''}">${mine ? '' : grouped ? '<div class="avatar-gap"></div>' : avatar(e.from)}<div class="msg-col">${grouped ? '' : name}<div class="bubble ${cls}">${body}</div><div class="msg-foot"><time>${when}</time>${tools}</div>${e.kind === 'reply' ? `<div class="diff-slot" data-diff-slot="${t.id}"></div>` : ''}</div></div>`;
}
function messagesHtml(list) {
  const ev = events(list); let prev = null, html = '';
  for (const e of ev) {
    if (!prev || new Date(e.at) - new Date(prev.at) > 15 * 60000) html += `<div class="sep">${new Date(e.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>`;
    html += bubble(e, prev); prev = e;
  }
  return html;
}
function renderChat() {
  const p = project(), chat = view === 'chat' && !!p;
  document.body.classList.toggle('chat-mode', chat);
  $('#chat-view').hidden = !chat; $('#board-view').hidden = chat;
  $('#new-task').hidden = chat;
  $('#view-chat').setAttribute('aria-selected', view === 'chat'); $('#view-board').setAttribute('aria-selected', view === 'board');
  if (!chat) return;
  if (!CHANNELS.includes(selectedChannel)) selectedChannel = 'group';
  const seenKey = ch => selectedProject + ':' + ch;
  const list = channelTasks(selectedChannel), ev = events(list), latest = ev.length ? ev[ev.length - 1].at : '';
  if (latest) { channelSeen[seenKey(selectedChannel)] = latest; store.set('channelSeen', JSON.stringify(channelSeen)); }
  // 频道列表
  const chHtml = CHANNELS.map(ch => {
    const pv = preview(ch), unread = pv.at && pv.at > (channelSeen[seenKey(ch)] || ''), st = ch === 'group' ? null : memberState(ch);
    const busy = channelTasks(ch).some(t => running(t) || t.status === 'queued');
    return `<button class="channel ${ch === selectedChannel ? 'selected' : ''}" data-channel="${ch}">${avatar(ch === 'group' ? 'group' : ch)}<span class="ch-main"><span class="ch-name">${ch === 'group' ? esc(p.name) + ' 群' : label(ch)}${st ? `<i class="st ${st[0]}"></i>` : ''}</span><span class="ch-last">${busy ? '<em>正在输入…</em>' : esc(pv.text)}</span></span><span class="ch-side">${pv.at ? new Date(pv.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''}${unread ? '<b class="badge">●</b>' : ''}</span></button>`;
  }).join('');
  if ($('#channel-list').dataset.html !== chHtml) { $('#channel-list').innerHTML = chHtml; $('#channel-list').dataset.html = chHtml; }
  // 标题
  $('#room-title').textContent = selectedChannel === 'group' ? p.name + ' 群（3）' : '和 ' + label(selectedChannel) + ' 私聊';
  $('#room-sub').textContent = selectedChannel === 'group' ? '你、Codex、Claude · 同一个代码目录' : memberState(selectedChannel)[1];
  const f = channelFlow(selectedChannel), live = list.filter(t => running(t) || t.status === 'queued');
  $('#room-actions').innerHTML = live.length && f ? `<button data-flow-ctl="stop" title="停止这个频道里正在做和排队的事">停止</button>` : '';
  // 消息
  const box = $('#messages');
  const html = ev.length ? messagesHtml(list) : `<div class="empty-chat">${selectedChannel === 'group' ? '<h2>群里还没人说话</h2><p>直接说要做什么。默认谁空闲谁接；写 <span class="at">@Codex</span>、<span class="at">@Claude</span> 或 <span class="at">@大家</span> 指定人。需要复核或修复时它们会在群里互相 @，你不用转达。</p>' : `<h2>和 ${label(selectedChannel)} 私聊</h2><p>只发给 ${label(selectedChannel)}，群里看不到。适合问问题、单独布置小事。</p>`}</div>`;
  if (box.dataset.html !== html) {
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80, switched = box.dataset.channel !== selectedProject + selectedChannel;
    box.innerHTML = html; box.dataset.html = html; box.dataset.channel = selectedProject + selectedChannel;
    if (atBottom || switched) box.scrollTop = box.scrollHeight;
  }
  // 正在输入
  const typing = live.map(t => running(t) ? `<div class="typing-row"><span class="dots"><i></i><i></i><i></i></span> <b>${label(t.provider)}</b> 正在${t.status === 'starting' ? '准备' : '处理'}：${esc(t.progress || t.title)} <button class="link" data-halt="${t.id}">停止</button></div>` : `<div class="typing-row hint">${label(t.provider)} 排队中${state.tasks.some(x => running(x) && x.provider === t.provider) ? '（手上还有别的事）' : state.tasks.some(x => running(x) && x.workspace && x.workspace === t.workspace) ? '（等另一位用完代码目录）' : ''}：${esc(t.title)}</div>`).join('');
  const liveTask = live.find(running);
  $('#typing').hidden = !live.length;
  const typingHtml = typing + (liveTask ? `<button class="link" data-process>${showProcess ? '收起过程' : '看过程'}</button>${showProcess ? `<pre class="live" data-live="${liveTask.id}">${esc(liveText.get(liveTask.id) || '')}</pre>` : ''}` : '');
  if ($('#typing').dataset.html !== typingHtml) { $('#typing').innerHTML = typingHtml; $('#typing').dataset.html = typingHtml; }
  // 输入框
  $('#mention-bar').hidden = selectedChannel !== 'group';
  $('#composer').elements.message.placeholder = selectedChannel === 'group' ? '发到群里… Enter 发送，Shift+Enter 换行' : '私信 ' + label(selectedChannel) + '… Enter 发送';
  // 成员与群公告
  const members = `<div class="member">${avatar('user')}<span><b>我</b><small>群主</small></span></div>` + ['codex', 'claude'].map(k => { const [s, text] = memberState(k); return `<button class="member" data-channel="${k}" title="私聊 ${label(k)}">${avatar(k)}<span><b>${label(k)}<i class="st ${s}"></i></b><small>${esc(text)}</small></span></button>`; }).join('');
  if ($('#member-list').dataset.html !== members) { $('#member-list').innerHTML = members; $('#member-list').dataset.html = members; }
  const notice = [p.context, p.contracts].filter(Boolean).join('\n\n');
  $('#notice').textContent = notice ? (notice.length > 220 ? notice.slice(0, 220) + '…' : notice) : '还没有群公告。写下目标、规则和接口约定，两位 AI 每次都会看到。';
}
async function refreshLive() {
  if (view !== 'chat' || !showProcess || !state) return;
  const t = channelTasks(selectedChannel).find(running); if (!t) return;
  const rows = await api(`tasks/${t.id}/logs?limit=60`);
  const text = rows.map(humanLog).filter(Boolean).join('\n').split('\n').filter(x => x.trim()).slice(-8).map(x => x.length > 240 ? x.slice(0, 240) + '…' : x).join('\n');
  liveText.set(t.id, text);
  const el = document.querySelector(`[data-live="${t.id}"]`); if (el && el.textContent !== text) el.textContent = text;
}
function setView(v) { view = v; store.set('view', v); render(); }
function openChannel(ch) { selectedChannel = ch; store.set('selectedChannel', ch); render(); $('#composer').elements.message.focus(); }
$('#view-chat').onclick = () => setView('chat');
$('#view-board').onclick = () => setView('board');
$('#channel-list').addEventListener('click', e => { const el = e.target.closest('[data-channel]'); if (el) openChannel(el.dataset.channel); });
$('#member-list').addEventListener('click', e => { const el = e.target.closest('[data-channel]'); if (el) openChannel(el.dataset.channel); });
$('#edit-notice').onclick = () => $('#shared').click();
$('#connect-ai').onclick = $('#setup-ai').onclick = async () => {
  try {
    const { prompt } = await api('connect-prompt');
    try { await navigator.clipboard.writeText(prompt); notify('已复制接入提示词，粘贴给其他 AI 即可'); }
    catch { $('#prompt-content').textContent = prompt; openDialog('#prompt-dialog'); } // 剪贴板不可用时直接展示，手动复制
  } catch (err) { notify(err.message); }
};
$('#mention-bar').addEventListener('click', e => {
  const b = e.target.closest('[data-mention]'); if (!b) return;
  const box = $('#composer').elements.message, tag = '@' + b.dataset.mention + ' ';
  if (!box.value.includes(tag.trim())) box.value = tag + box.value.replace(/^@\S+\s*/, '');
  box.focus();
});
$('#composer').elements.message.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); $('#composer').requestSubmit(); } });
$('#composer').addEventListener('submit', async e => {
  e.preventDefault(); const form = e.target, message = form.elements.message.value.trim();
  if (!message || busy || !project()) return; busy = true; $('#send').disabled = true;
  try {
    const res = await api('chat', 'POST', { projectId: selectedProject, channel: selectedChannel, message, mode: form.elements.review.checked ? 'review' : 'edit' });
    form.elements.message.value = '';
    const failed = res.tasks.filter(t => t.status === 'failed'); if (failed.length) notify(failed.map(t => label(t.provider) + '：' + t.error).join('；'));
    await refresh(); $('#messages').scrollTop = $('#messages').scrollHeight;
  } catch (err) { notify(err.message); }
  finally { busy = false; $('#send').disabled = false; form.elements.message.focus(); }
});
document.querySelector('#chat-view').addEventListener('click', async e => {
  const x = e.target.closest('[data-expand]'); if (x) { expanded.add(x.dataset.expand); render(); return; }
  if (e.target.closest('[data-process]')) { showProcess = !showProcess; render(); refreshLive().catch(() => {}); return; }
  const d = e.target.closest('[data-detail]'); if (d) { selectTask(d.dataset.detail); render(); refreshLogs().catch(err => notify(err.message)); return; }
  const b = e.target.closest('[data-diff],[data-retry],[data-halt],[data-flow-ctl]'); if (!b) return;
  if (b.dataset.flowCtl && !confirm('停止这个频道里正在做和排队的事？')) return;
  b.disabled = true;
  try {
    if (b.dataset.diff) { const slot = document.querySelector(`[data-diff-slot="${b.dataset.diff}"]`); if (slot.innerHTML) { slot.innerHTML = ''; return; } const data = await api(`tasks/${b.dataset.diff}/diff`); slot.innerHTML = '<pre class="terminal">' + esc((data.status + '\n\n' + data.diff).trim() || '暂无改动') + '</pre>'; }
    else if (b.dataset.retry) { const t = state.tasks.find(t => t.id === b.dataset.retry), f = state.workflows.find(f => f.id === t.workflowId); if (f && f.status !== 'running') await api(`workflows/${f.id}/resume`, 'POST').catch(() => {}); await api(`tasks/${t.id}/start`, 'POST'); await refresh(); }
    else if (b.dataset.halt) { await api(`tasks/${b.dataset.halt}/stop`, 'POST'); await refresh(); }
    else if (b.dataset.flowCtl) { await api(`workflows/${channelFlow(selectedChannel).id}/stop`, 'POST'); await refresh(); }
  } catch (err) { notify(err.message); } finally { b.disabled = false; }
});
// 最新消息：所有项目最近的动态，打开页面就在最上面。比上次查看新的条目加粗，并在标签页标题上显示数量
let lastSeen = store.get('lastSeen') || '', seenThisPoll = null;
function renderLatest() {
  const byTask = new Map(state.tasks.map(t => [t.id, t])), byProject = new Map(state.projects.map(p => [p.id, p]));
  const rows = state.activity.slice(0, 15);
  const fresh = state.activity.filter(e => e.at > lastSeen);
  $('#latest-count').textContent = fresh.length ? fresh.length + ' 条新消息' : '';
  $('#latest-read').hidden = !fresh.length;
  document.title = (fresh.length ? `(${fresh.length}) ` : '') + '同席 · 本地双 AI 工作台';
  $('#latest').innerHTML = rows.map(e => {
    const t = e.taskId && byTask.get(e.taskId), p = t && byProject.get(t.projectId);
    const when = new Date(e.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `<div class="latest-row ${e.at > lastSeen ? 'new' : ''}" ${t ? `data-open="${t.id}" title="打开这项任务"` : ''}><time>${when}</time>${t ? `<span class="who">${label(t.provider)} · ${names[t.status] || esc(t.status)}</span>` : ''}<span>${esc(e.message)}</span>${p && state.projects.length > 1 ? `<span class="proj">${esc(p.name)}</span>` : ''}</div>`;
  }).join('') || '<div class="hint">还没有消息。分配任务后，AI 之间的派发、执行和完成都会出现在这里。</div>';
  // 新到的 AI 派发 / 完成 / 需要处理，弹一条提示（第一次加载不弹）
  const newest = state.activity[0]?.at || '';
  if (seenThisPoll !== null && view !== 'chat') { // 聊天里有未读红点和“正在输入”，不再弹提示
    const arrived = state.activity.filter(e => e.at > seenThisPoll && /派发|完成|需要处理|失败|blocked|failed|done/.test(e.message));
    if (arrived.length) notify(arrived.length === 1 ? arrived[0].message : `${arrived.length} 条新消息：${arrived[0].message}`);
  }
  seenThisPoll = newest;
}
$('#latest').addEventListener('click', e => {
  const el = e.target.closest('[data-open]'); if (!el) return;
  const t = state.tasks.find(t => t.id === el.dataset.open); if (!t) return;
  selectedProject = t.projectId; store.set('selectedProject', selectedProject); selectTask(t.id); render(); refreshLogs().catch(err => notify(err.message));
});
$('#latest-read').onclick = () => { lastSeen = state.activity[0]?.at || new Date().toISOString(); store.set('lastSeen', lastSeen); render(); };
function actionButton(action, text, cls = '') { return `<button data-action="${action}" class="${cls}">${text}</button>`; }
function renderDetail() {
  const t = state.tasks.find(t => t.id === selectedTask);
  $('#detail').hidden = !t; if (!t) { $('#detail').dataset.signature = ''; return; }
  const running = ['starting', 'running', 'stopping'].includes(t.status);
  const controls = [];
  if (!running && !archived(t) && t.status !== 'done') controls.push(actionButton('start', t.runs ? '重新执行' : '开始执行', 'primary'));
  if (running) controls.push(actionButton('stop', '停止执行'));
  if (t.status === 'review' && !state.settings?.autoReview) controls.push(actionButton('approve', '验收完成', 'primary'));
  if (['review', 'done'].includes(t.status)) controls.push(actionButton('handoff', '交接给另一方'));
  if (!running && !['queued','done'].includes(t.status) && !archived(t)) controls.push(actionButton('archive', '废弃任务'));
  if (t.archived) controls.push(actionButton('restore', '恢复任务'));
  controls.push(actionButton('prompt', '查看完整输入'), actionButton('diff', '查看改动'));
  // Detail DOM is stable while logs refresh, so the operator can read/select output.
  const signature = JSON.stringify([t.id, t.status, t.result, t.error, t.runs, t.branch, t.backend, t.progress, t.archived]);
  if ($('#detail').dataset.signature === signature) return;
  const oldLog = $('#task-log')?.textContent;
  $('#detail').dataset.signature = signature;
  $('#detail').innerHTML = `<div class="dialog-head"><span class="provider ${t.provider}">${label(t.provider)}</span>${t.backend ? `<span class="backend">${t.backend === 'api' ? 'Anthropic API' : 'CLI'}</span>` : ''}<button data-action="close">×</button></div><h2>${esc(t.title)}</h2><div class="detail-info">${names[t.status] || esc(t.status)} · ${t.mode === 'review' ? '只读审查' : '实现与修改'}<br>${esc(t.branch || '执行时创建独立分支 ai/' + t.provider + '/…')}<br>${esc(t.workspace || '')}</div><div class="detail-actions">${controls.join('')}</div>${t.error ? `<p class="error">${esc(t.error)}</p>` : ''}${deliverables(t)}<div class="detail-section">任务要求</div><div class="detail-text">${esc(t.prompt)}</div>${t.dependencies.length ? `<div class="detail-section">前置任务</div><div class="detail-text">${t.dependencies.map(id => { const d = state.tasks.find(t => t.id === id); return esc(d?.title) + ' · ' + (names[d?.status] || ''); }).join('<br>')}</div>` : ''}${t.result ? `<div class="detail-section">交付结果</div><div class="result">${esc(t.result)}</div>` : ''}<div class="detail-section">实时执行记录 <span>${t.runs ? '第 ' + t.runs + ' 次' : ''}</span></div><pre id="task-log" class="terminal">${esc(oldLog || '尚未开始执行。')}</pre><div id="diff-content"></div>`;
}
function humanLog(row) {
  if (row.stream === 'system') return '— ' + row.text;
  try {
    const e = JSON.parse(row.text), item = e.item;
    if (e.type === 'item.completed' && item?.type === 'agent_message') return item.text;
    if (item?.type === 'command_execution') return '$ ' + item.command + '\n' + (item.aggregated_output || '');
    if (e.type === 'system' && e.subtype === 'init') return '已启动 Claude 会话' + (e.model ? '（' + e.model + '）' : '');
    if (e.type === 'assistant') return e.message?.content?.map(x => x.text || (x.name ? '↳ ' + x.name + (x.input?.path || x.input?.file_path ? ' ' + (x.input.path || x.input.file_path) : x.input?.command ? ' ' + x.input.command : '') : '')).filter(Boolean).join('\n') || '';
    if (e.type === 'result') return (e.is_error ? '✗ ' : '✓ ') + (e.result || '');
    if (e.type === 'error' || e.type === 'turn.failed') return e.message || e.error?.message || '执行出错';
    if (e.type === 'thread.started') return '已创建代理会话';
    if (e.type === 'turn.started') return '代理开始处理任务…';
    if (e.type === 'turn.completed') return '代理本轮结束，后台正在处理接力与整组状态。';
    return '';
  } catch { return row.text.replace(/\x1b\[[0-9;]*m/g, ''); }
}
async function refreshLogs() {
  if (!selectedTask || !$('#task-log')) return;
  const id = selectedTask, rows = await api(`tasks/${id}/logs`);
  if (id !== selectedTask || !$('#task-log')) return;
  const log = $('#task-log'), bottom = log.scrollHeight - log.scrollTop - log.clientHeight < 45;
  const t = state.tasks.find(t => t.id === id);
  log.textContent = rows.map(humanLog).filter(Boolean).join('\n\n') || (t && ['starting', 'running'].includes(t.status) ? '等待代理输出…' : '尚无执行记录。');
  if (bottom) log.scrollTop = log.scrollHeight;
}
async function refresh() {
  if (polling) return; polling = true; // never stack requests when the server is slow
  try {
    state = await api('state'); render(); await refreshLogs(); await refreshLive();
    failures = 0; $('#offline').hidden = true;
  } catch (e) {
    failures++;
    if (e.status === 401) { stopPolling(); notify(e.message); $('#offline').textContent = '启动凭证无效：请双击“启动本地协作台”重新打开。'; $('#offline').hidden = false; }
    else if (e.status) notify(e.message);
    else $('#offline').hidden = false;
  } finally { polling = false; schedule(); }
}
function schedule() { clearTimeout(pollTimer); if (pollTimer !== null) pollTimer = setTimeout(refresh, failures ? Math.min(1500 * 2 ** failures, 15000) : 1500); }
function stopPolling() { clearTimeout(pollTimer); pollTimer = null; }
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => button.closest('dialog').close());
$('#projects').addEventListener('click', e => { const el = e.target.closest('[data-project]'); if (el) { selectedProject = el.dataset.project; selectTask(null); store.set('selectedProject', selectedProject); render(); } });
function selectCard(e) { const el = e.target.closest('[data-task]'); if (el) { selectTask(el.dataset.task); render(); refreshLogs().catch(e => notify(e.message)); } }
$('#view-active').onclick = () => { taskView = 'active'; render(); };
$('#view-completed').onclick = () => { taskView = 'completed'; render(); };
$('#task-search').oninput = e => { searchQuery = e.target.value.trim().toLowerCase(); render(); };
$('#board').addEventListener('click', selectCard); $('#board').addEventListener('keydown', e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); selectCard(e); } });
$('#add-project').onclick = $('#empty-project').onclick = () => openDialog('#project-dialog');
$('#new-task').onclick = () => taskDialog();
function taskDialog(source) {
  handoffFrom = source; const form = $('#task-form'); form.reset();
  $('#task-heading').textContent = source ? '交接给另一方' : '分配任务';
  form.elements.provider.querySelector('[value=both]').disabled = !!source;
  if (source) { form.elements.title.value = '复核 · ' + source.title; form.elements.provider.value = source.provider === 'codex' ? 'claude' : 'codex'; form.elements.mode.value = 'review'; form.elements.scope.value = source.scope; form.elements.prompt.value = '检查上一任务的实现和验证结果，指出具体问题与未完成项。'; }
  form.elements.dependencies.innerHTML = tasks().map(t => `<option value="${t.id}">${esc(t.title)} · ${names[t.status]}</option>`).join('');
  $('#dependency-label').hidden = !!source;
  form.elements.autoContinue.checked = source ? !!source.workflowId : true;
  form.elements.autoStart.checked = true;
  $('#task-hint').textContent = source ? '接收方沿用交接目录，保留未提交代码；当前任务结束后自动开始，不会同时改同一目录。' : '自动接力时，双方可以直接派发后续任务并回传修复，直到整组完成。需要权限或认证时会明确暂停。';
  openDialog('#task-dialog');
}
$('#shared').onclick = () => { const p = project(); if (!p) return; contextRevision = p.revision; $('#context-form').elements.context.value = p.context; $('#context-form').elements.contracts.value = p.contracts; openDialog('#context-dialog'); };
$('#settings').onclick = () => { if (!state) return notify('尚未连接到本地服务'); for (const k of ['codex', 'claude']) $('#settings-form').elements[k].value = state.providers[k].configured; $('#settings-form').elements.autoReview.checked = !!state.settings?.autoReview; $('#settings-form').elements.godot.value = state.settings?.godot || ''; openDialog('#settings-dialog'); };
function submit(id, handler) {
  $(id).addEventListener('submit', async e => {
    e.preventDefault(); if (busy) return; busy = true; const button = e.submitter; if (button) button.disabled = true;
    try { await handler(new FormData(e.target)); e.target.closest('dialog').close(); await refresh(); }
    catch (err) { notify(err.message); }
    finally { busy = false; if (button) button.disabled = false; }
  });
}
submit('#project-form', async fd => { const p = await api('projects', 'POST', Object.fromEntries(fd)); selectedProject = p.id; store.set('selectedProject', p.id); });
submit('#context-form', fd => api(`projects/${selectedProject}/context`, 'PUT', { ...Object.fromEntries(fd), revision: contextRevision }));
submit('#settings-form', fd => api('settings', 'POST', { codex: fd.get('codex'), claude: fd.get('claude'), godot: fd.get('godot'), autoReview: fd.get('autoReview') === '1' }));
submit('#task-form', async fd => {
  const data = { ...Object.fromEntries(fd), dependencies: fd.getAll('dependencies'), projectId: selectedProject, autoStart: fd.get('autoStart') === '1', autoContinue: fd.get('autoContinue') === '1', maxTasks: Number(fd.get('maxTasks')) };
  if (handoffFrom) {
    const t = await api(`tasks/${handoffFrom.id}/handoff`, 'POST', data); selectTask(t.id);
  } else {
    const { tasks: created } = await api('tasks', 'POST', data); selectTask(created[0].id);
    const failed = created.filter(t => t.status === 'failed');
    if (failed.length) notify(failed.map(t => label(t.provider) + ' 启动失败：' + t.error).join('；'));
  }
});
$('#workflows').addEventListener('click', async e => {
  const button = e.target.closest('[data-flow]'); if (!button) return;
  button.disabled = true;
  try { await api(`workflows/${button.dataset.flow}/${button.dataset.control}`, 'POST'); await refresh(); }
  catch (err) { notify(err.message); } finally { button.disabled = false; }
});
$('#detail').addEventListener('click', async e => {
  const button = e.target.closest('[data-action]'); if (!button) return;
  const action = button.dataset.action, t = state.tasks.find(t => t.id === selectedTask);
  if (action === 'close') { selectTask(null); render(); return; }
  if (!t) return;
  if (action === 'handoff') { taskDialog(t); return; }
  button.disabled = true;
  try {
    if (action === 'prompt') { const data = await api(`tasks/${t.id}/prompt`); $('#prompt-content').textContent = data.prompt; openDialog('#prompt-dialog'); }
    else if (action === 'diff') { const data = await api(`tasks/${t.id}/diff`); const out = (data.status + '\n\n' + data.diff).trim(); $('#diff-content').innerHTML = '<div class="detail-section">工作目录改动</div><pre class="terminal">' + esc(out || '暂无改动') + '</pre>'; }
    else { await api(`tasks/${t.id}/${action}`, 'POST'); await refresh(); }
  } catch (err) { notify(err.message); await refresh(); } finally { button.disabled = false; }
});
$('#shutdown').onclick = async () => { if (confirm('退出工作台并停止正在执行的任务？')) { try { await api('shutdown', 'POST'); stopPolling(); document.body.textContent = '工作台已退出。下次双击启动入口即可继续。'; } catch (e) { notify(e.message); } } };
if (!token) { $('#offline').textContent = '缺少本机启动凭证：请双击“启动本地协作台”或打开启动时输出的完整地址。'; $('#offline').hidden = false; }
else refresh();
