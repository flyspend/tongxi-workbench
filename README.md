# 同席 · 本地双 AI 工作台 v0.4

> A local, zero-dependency web workbench where you chat with **Codex CLI** and **Claude Code** in one group: they split work, hand off and review each other in isolated Git worktrees, and other AI agents can join through a one-command bridge. Windows-first, Node.js ≥ 22, no npm install.

用户分配总任务后，Codex、Claude 可以直接给对方发任务、审查和回传修复，后台自动启动下一步，直到整组完成。双方共享需求、接口、工作目录和执行结果。桌面入口启动本机网页界面和 Node 服务；没有第三方云端调度服务或运行依赖。运行的 Codex / Claude CLI 仍使用各自已有的账号、模型服务和权限设置，它们本身可能联网。

## 启动

一条命令（前台运行，Ctrl+C 退出）：

```
run.cmd start
```

- 有 Node/npm 时等价于 `npm start`（`node server.cjs`）。`run.cmd` 会在 PATH 没有 node 时改用 Codex 自带的 Node；Git 不在 PATH 时服务自动使用 Codex 自带的 Git。
- 桌面入口：双击 **启动本地协作台.bat**（后台启动并打开浏览器；启动失败会显示原因）。
- 启动后终端会打印带凭证的完整地址。凭证保存在 `.local/token`，重启后不变，已打开的页面刷新即可继续使用。
- 端口：默认 18764，`run.cmd start --port 18800`，或环境变量 `WORKBENCH_PORT` / `PORT`；`--port 0` 自动选空闲端口。端口被占用时给出明确提示。
- 只监听本机回环地址（默认 127.0.0.1，可用 `--host ::1`）；传入其他地址会拒绝启动。

需要 Node.js ≥22、Git。应用本身无需 npm install，无第三方运行依赖。

## 测试

```
run.cmd test     # 状态机、接力、协议与权限边界测试
run.cmd smoke    # 冒烟测试：node test/smoke.cjs
```

冒烟测试会启动真实服务进程（临时数据目录、随机端口），通过 HTTP 接口：鉴权/健康检查 → 添加项目 → 同一任务“两个都发”并立即执行 → 假 AI 子进程按真实 Codex/Claude 命令行参数运行并输出 JSON 行 → 收到输出 → 结束（待验收）→ 校验 `ai/codex/…`、`ai/claude/…` 两个分支和独立目录、同名文件互不覆盖、主仓库未改动 → 停止慢任务 → 验收 → 重启服务后任务/输出/日志/凭证仍在。

接着由外部 `bridge.cjs` 直接派发，验证无浏览器、无人工开始/验收的 Codex→Claude→Codex→Claude 四步接力。测试使用假 AI；真实模型仍依赖本机已登录通道。界面测试另验证默认勾选自动接力、整组完成显示及原有手动操作。

## 聊天（默认界面）

像聊天软件一样：每个项目有一个**群**（你、Codex、Claude）和与两位 AI 的**私信**。Enter 发送。

- 群里派活：不 @ 时由刚才回话的那位接着做（第一条给空闲的 AI）；写 `@Codex`、`@Claude`、`@大家`（或点输入框上方的按钮）指定人。
- AI 之间自己聊：需要复核、修复时，它们在群里互相 @ 并接着做，你不用转达。正在做的事显示在输入框上方的“正在输入”栏，可展开看过程或停止。
- 私信只发给对方，群里看不到；群和私信共用同一个代码目录，前一轮没结束后一轮自动排队。
- AI 只是回答问题时显示为普通回复；卡住时直接回一句怎么处理，它就接着做（旧的失败项标记为已由后续消息接手），也可以点“重试”。
- 右侧是群成员（空闲/在忙，点头像开私信）和群公告（就是“共享需求与接口”）。原来的看板在右上角“任务看板”。
- 省 token：聊天里每轮只带精简规则、群公告（最多 3000 字）和最近 10 条消息（每条最多 400 字，总共最多 4000 字），一轮输入通常一千字以内；AI 被要求简短回复，长内容写进文件给路径。
- 接口：`POST /api/chat {projectId, message, channel?: "group"|"codex"|"claude", to?, mode?}`；读消息 `GET /api/chat/messages?projectId=&channel=&after=&limit=`。

## 其他 AI 一键接入

任何能在本机运行命令的 AI（另一个 Claude Code 会话、Cursor、Gemini CLI、自己写的脚本……）都可以加入群聊：派活、私信、等回复。

1. 点聊天页右侧 **“复制接入提示词”**，或运行 `node bridge.cjs prompt`。提示词里已经填好本机 Node 路径、桥接脚本路径和项目列表，不含凭证。
2. 把这段文字发给那个 AI。它之后只需要：

```powershell
node bridge.cjs say --project 项目名 --message "@Claude 检查登录流程并修好" --wait 600   # 发到群里并等回复
node bridge.cjs say --project 项目名 --channel codex --message "私信 Codex"            # 私信
node bridge.cjs read --project 项目名 --after 2026-01-01T00:00:00Z --wait 120          # 看新消息
```

- 输出都是 JSON：`messages[]`（`kind` 为 `message` / `handoff` / `reply`）、`busy[]`（谁在忙）、`done`（是否已回复完）。
- `--readonly 1` 只读，`--to codex|claude|both` 指定人，`--message-file` 发长消息。只有一个项目时可省略 `--project`。
- 桥接从 `.local/connection.json` 读取本机凭证；外部 AI 不需要也不应该看到凭证。

## 使用（看板方式）

1. 添加本机 Git 仓库和起始分支。可填写 `origin/分支名`，但需要该引用已在本机存在；工作台不自动 fetch。
2. 填写“共享需求与接口”。同时编辑时进行版本检查，避免旧窗口覆盖新约定；新版本对下一次执行生效。
3. 分配任务：交给 **Codex**、**Claude**，或 **两个都发**（生成两项任务，各自独立执行）。默认勾选“自动接力”和“保存后立即执行”，每组默认最多 24 步，可设置 2–100 步。
4. 开始执行：每项任务建立独立分支 `ai/<codex|claude>/<任务名>-<id>` 和 Git worktree（`.local/worktrees/<provider>/<id>`），代理只在该目录内工作。主仓库现有未提交更改不复制、不改写。同一目录同时只允许一个任务执行，所以两个 AI 不会互相覆盖文件。
5. AI 可直接派发后续任务，下一方自动接收、开始执行、继续回传。后台调度不依赖浏览器；关掉页面也会继续，重新打开即可看进度，无需反复刷新或点开始。
6. 顺序交接沿用原 worktree 和未提交代码，前一方退出后才启动接收方。显式并行任务使用独立目录。不会自动提交、推送、合并或部署。
7. 只有所有子任务明确报告完成、验证情况和无剩余项，任务组才显示“全部完成”。失败、认证、权限、无效报告或达到接力上限会明确阻塞；可暂停后续接力或停止整组。取消“自动接力”可保留原先逐项手动验收方式。

## 自动验收与交付成果

- “CLI 设置”里可开关**自动验收**：普通任务交付（待验收）后，后台自动建一个 Codex 验收任务，在原工作目录检查实际文件并运行适用验证；只有验收方提交带实际验证的完成报告才自动归档为已完成。验收受阻会显示在看板上，不会被当作通过。接力任务组和对话里的任务不走自动验收。
- 交付成果：任务卡片和对话里会显示工作目录中 `art-out/`、`screenshots/`、`截图/` 等目录下的图片和报告，以及结果里引用的本地文件，可直接预览（只读、限定在任务目录内）。

## AI 直接发任务

在本工作台启动的 AI 中，自动注入本轮专属的信箱与协议。AI 可运行桥接命令，也可在最终回复中给出 `workbench` JSON 块，支持只读审查和 API 通道。具体格式见 [AGENT-BRIDGE.md](AGENT-BRIDGE.md)。接收回执只代表投递成功，发送方应结束本轮，让后台启动对方。

当前桌面中的 AI 或其他本地工具也可直接调用：

```powershell
node bridge.cjs projects
node bridge.cjs send --project 项目ID --to claude --title "检查地图接口" --prompt "检查实现并修复问题，完成后报告实际验证" --mode edit
node bridge.cjs status
```

新发送默认创建自动接力任务组；`--workflow 任务组ID` 可追加到同一组。桥接自动读取本机连接记录，不需要复制或打印凭证。它只向本机工作台投递，不控制其他桌面聊天窗口。

## 统一接口（Codex / Claude 相同）

所有 `/api/*`（除 health）需要 `Authorization: Bearer <token>`。

| 操作 | 接口 |
|---|---|
| 健康检查 | `GET /api/health` |
| 全部状态 | `GET /api/state` |
| 发任务 | `POST /api/tasks` `{projectId,title,prompt,provider:"codex"\|"claude"\|"both",mode?,scope?,autoStart?,autoContinue?,maxTasks?,workflowId?}` → `{tasks:[…]}` |
| 任务组 | `GET /api/workflows` · `POST /api/workflows/:id/pause`、`/resume`、`/stop` |
| 看进度 | `GET /api/tasks/:id`、`GET /api/tasks?projectId=` |
| 看输出 | `GET /api/tasks/:id/logs?limit=250` |
| 开始 / 停止 / 验收 | `POST /api/tasks/:id/start` · `/stop` · `/approve` |
| 改动 / 输入 | `GET /api/tasks/:id/diff` · `/prompt` |
| 交接 | `POST /api/tasks/:id/handoff` |

## Claude 通道

- 首选 Claude Code CLI：`claude -p --verbose --output-format stream-json --permission-mode acceptEdits`（只读审查：`default` 模式，文件只能 Read/Glob/Grep），工作目录为任务的 worktree，提示经 stdin 传入（避免命令行长度和引号问题），输出逐行实时写入日志。自动查找 PATH、`~/.local/bin`、npm 全局目录，以及 Claude 桌面版自带的 `%APPDATA%\Claude\claude-code\<版本>\…\claude.exe`；也可在“CLI 设置”指定。
- 备选 Anthropic API：找不到 CLI 且**启动工作台前**设置了环境变量 `ANTHROPIC_API_KEY` 时，改用 `agents/claude-api.cjs` 子进程（同样的开始/停止/日志流程）。密钥只从环境变量读取，不写入文件、不打印。模型默认 `claude-opus-5-5`（可用 `ANTHROPIC_MODEL` 覆盖），启用了服务端拒答回退（`fallbacks: "default"`）。API 通道只有 list/read/write 文件工具，限定在 worktree 内，**不能运行命令**；实现与验证能力弱于 CLI。
- Codex：`exec --json --sandbox workspace-write`，只读审查使用 `read-only`。不指定模型，沿用本机配置。
- 不使用 bypassPermissions。Claude 额外工具权限被拒绝时，任务显示“需要处理权限”；接力任务若已给出有效的完成/交接报告，则按报告继续并记录说明。

## 安全与权限（开源使用前请读）

- **Claude 可运行的命令**：实现和只读审查都放行以 `node`、`git`、`godot` 开头的单条命令（`--allowedTools PowerShell/Bash(node|git|godot:*)`），并禁止 `git push`、`git remote`。注意：放行 `node` 实际上等于允许运行任意代码（`node -e …`），它以你的 Windows 账户身份运行，不在沙箱里。只在可信仓库上使用。
- **Codex** 使用其自带沙箱（`workspace-write` / `read-only`），因此写不了 worktree 的 `.git`；需要提交时交给 Claude。
- **Godot（可选）**：在“CLI 设置”填写路径，或设置环境变量 `WORKBENCH_GODOT`，或放进 PATH。工作台会把它硬链接为 `.local/bin/godot.exe` 供代理调用。
- **服务只监听本机**，校验 Bearer 凭证、Host、Origin；凭证保存在 `.local/`（已被 `.gitignore` 排除）。本机上任何能读取你用户目录的程序都能读到凭证——它防御网页跨站，不防御本机恶意软件。
- 工作台不自动提交到主分支、不推送、不合并、不部署；AI 的改动都在 `ai/<provider>/…` 分支的独立 worktree 里，由你决定是否合并。
- 运行的 Codex / Claude CLI 使用你自己的账号与额度，遵守各自的服务条款。

## 合规与第三方服务

- 本项目不是 Anthropic 或 OpenAI 的官方产品，与它们没有隶属、合作或背书关系；文中的 “Claude Code”“Codex” 仅用于说明兼容哪些工具。
- 本项目不包含、不修改、不分发 Claude Code 或 Codex CLI，只调用你本机已安装的官方 CLI。每位使用者用自己的账号或 API Key 登录，费用和额度归其本人；工作台不收集、不保存、不转发任何 Claude.ai / ChatGPT 登录凭证。
- 订阅（Claude Pro/Max、ChatGPT Plus/Pro 等）的额度按普通个人使用设计，长时间自动接力会很快用完。重度或无人值守的自动化，请改用各自的 API Key（Claude：`ANTHROPIC_API_KEY`；Codex：`CODEX_API_KEY`），并遵守 [Anthropic 条款](https://code.claude.com/docs/en/legal-and-compliance)和 OpenAI 条款。
- 不要把工作台部署成多人共享服务、替别人跑他们的请求，或把你的订阅/凭证提供给他人使用。

## 本地存储与边界

- `.local/state.json`：项目、任务、状态、结果（原子写入；文件损坏时自动备份为 `state.corrupt-*.json` 并以空状态启动）。
- `.local/runs/<任务>/`：输入快照、`events.jsonl` 实时输出日志。
- `.local/worktrees/`：代码目录，有未提交成果时不要删除。
- `.local/token`、`connection.json`：本机凭证。`.local/` 和 `*.log` 已被 `.gitignore` 排除，不要提交。

HTTP API 校验 Bearer 凭证、Host 和 Origin（仅接受 127.0.0.1 / localhost / [::1] 加本端口），页面使用 CSP 并转义用户文本；查看 diff 禁止外部 diff/textconv 程序。它防御跨站访问，不防御已经控制当前用户账户的恶意软件。

单实例锁防止两个服务同时改同一份数据（旧锁对应的服务不再响应时自动清除）。重启后安全排队的任务自动继续；执行中被中断的任务明确阻塞，需检查后重试，避免重复执行。正常退出会停止 Windows CLI 进程树。

## 文件

- `core.cjs`：项目、共享说明、任务状态机、CLI/API 子进程、Git worktree。
- `server.cjs`：只监听本机的鉴权 HTTP API、静态页面、单实例与退出。
- `relay.cjs`：后台任务队列、自动互派、整组状态、本轮信箱和接力限额。
- `bridge.cjs`：AI 直接派发、进度与完成报告入口；外部 AI 的 `say` / `read` / `prompt`。
- `agents/claude-api.cjs`：Anthropic API 备选通道。
- `public/`：看板、任务详情、实时日志。
- `test/workbench.test.cjs`、`test/smoke.cjs`、`test/fake-agent.cjs`：测试；`test/ui-smoke.cjs` 需本机 Playwright（`PLAYWRIGHT_MODULE`）。
- `run.cmd`、`launch.ps1`、`启动本地协作台.bat`：启动入口。

## 最新消息与启动入口

- 页面最上方“最新消息”列出所有项目最近 15 条动态（AI 派发、开始、完成、需要处理）。比上次查看新的条目加粗，数量显示在标签页标题上；点一条直接打开对应任务。AI 派发或完成任务时右下角会弹提示。页面每 1.5 秒自动更新，不用手动刷新。
- 桌面快捷方式“打开同席工作台”启动 `启动本地协作台.bat` → `launch.ps1`：服务在跑就直接打开页面；如果磁盘上的代码比正在运行的服务新、且没有任务在执行，会先关掉旧服务再用新代码启动（依据 `/api/health` 的 `stale` 字段）。

## 许可

MIT，见 [LICENSE](LICENSE)。本项目只调用你本机已安装的 Codex CLI / Claude Code，不包含、不分发它们。
