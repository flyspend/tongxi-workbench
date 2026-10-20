# 复制给 AI：帮我安装、启动并接入同席

中文 | [English](AI-START-HERE.en.md)

把下面代码块里的整段话发给一个能操作本机文件和终端的 AI，例如 Codex、Claude Code 或 Cursor。纯聊天 AI 如果没有这些工具，只能提供指导。已有程序时，附上程序文件夹路径；要协作的项目路径也可以一起告诉它。

```text
请帮我在这台电脑上安装或找到「同席 tongxi-workbench」，启动并尝试接入。我不熟悉命令，请尽量替我完成可操作的步骤。

1. 先查看我提供的同席目录及 README.md；没提供位置时，先检查当前工作目录，找不到再问我程序在哪里。尚未下载时，从 https://github.com/flyspend/tongxi-workbench 获取代码。仓库目前可能是私有的：没有权限就告诉我需要登录或由作者提供访问权限，不要寻找来路不明的下载。
2. 检查 Node.js >= 22 和 Git。Windows 上 run.cmd 可以使用本机 Codex 附带的 Node/Git，不需要 npm install。依赖缺失时说明缺少什么，按本机授权规则协助安装官方版本。
3. 先检查工作台是否已运行。Windows 可运行 launch.ps1 或“启动本地协作台.bat”启动；其他系统使用 node server.cjs。后台进程应隐藏窗口，已有运行中的工作不要停止。仅在本机回环地址运行，不开放外网。
4. 使用本机 Node 执行 bridge.cjs projects 和 bridge.cjs status，确认连接；桥接脚本会自行读取凭证，不要打印或上传 .local 里的内容。失败时根据实际错误检查进程和连接文件；不要通过关闭鉴权或提升代理权限来解决。
5. 询问我要协作的本机 Git 项目路径（如果我已经给出就直接用）。运行 node bridge.cjs add-project --path "项目绝对路径"；已添加的项目直接复用。如果不是 Git 仓库或尚无提交，解释原因，先问我要怎么处理，不要擅自初始化或提交。
6. 检查本机 Codex CLI / Claude Code 是否可用，在工作台“CLI 设置”查看检测情况。它们使用各自官方登录或用户自己的 API Key。登录、验证码和密钥由我在本机完成，不要索取聊天中的密码或密钥，不要读取或复制 CLI 的登录凭证。只安装了一种 CLI 也可以先接入，并说明另一通道尚不可用。
7. 运行 node bridge.cjs prompt，阅读它返回的实际本机路径和项目说明。运行 node bridge.cjs join --project 项目ID --name 你的AI名称，以独立成员加入；保存返回的 memberId。已有成员身份就复用原 ID，成员名同一项目不能重复。Windows PowerShell 执行带引号的可执行路径时使用 & 调用。连接成功后简短告诉我：工作台是否运行、已接入哪个项目、哪些 AI 通道可用、还缺什么。不要自动派发任务、修改项目或消耗模型额度；等我说具体要做什么。
8. 运行 node bridge.cjs claim --member 成员ID --wait 30 接收派给你的任务。job:null 表示暂无任务，告诉我已接入并等我派活；只有我要求持续接收时才继续轮询。外部会话结束后，工作台不能代它继续运行。
9. 有任务时遵守返回的 prompt、mode，只在指定 workspace 内工作。至少每 10 分钟、长工具调用前后运行 node bridge.cjs heartbeat --member 成员ID --task 任务ID --message 当前进度。租约 30 分钟未续期会失效；stopRequested:true 时先停工，再 report --status stopped。
10. 将结果写入 UTF-8 文件，运行 node bridge.cjs report --member 成员ID --task 任务ID --result-file 报告绝对路径 --status complete --validation 实际检查及结果。未完成就用 blocked / failed 并写明原因。未实际验证的步骤必须说明。交接、离开与失联恢复见 EXTERNAL-AI.md。
11. 如需把工作交给别人，可用 bridge.cjs say --project 项目ID --to 目标成员ID --message 任务 --wait 600；领取的任务内要交接同一目录时，使用结果文件中的 workbench handoff 块。返回 done:false 时用 read 继续看，避免重复派活。
```

程序已运行时，也可以直接点击页面上的 **“让 AI 帮我接入”** 或群成员面板中的 **“复制接入提示词”**，复制带本机路径的提示词。剪贴板不可用时会显示文本，手动复制即可。

主界面右上角可直接选择中文或 English，也可用 `/?lang=en` 打开英文界面。复制的接入提示词跟随界面语言；`prompt --lang en` / `setup-prompt --lang en` 可直接获取英文。

未启动服务时，`node bridge.cjs setup-prompt` 也能输出本页，不需要登录或读取工作台凭证。

MIT 适用于本项目代码；模型服务的账号、费用、额度和服务条款由各使用者自行承担。AI 能否自动操作，取决于它所在工具的能力和你授予的权限。
