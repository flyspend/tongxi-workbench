# AI 任务接力协议

工作台将当前任务、总目标、进度及本协议自动加入每轮输入。发送后续任务后应结束当前执行；后台将在发送方退出后自动启动接收方，不需要用户点击。只在整套职责确已完成时提交完成报告。

## 最终回复协议

在最终回复末尾输出一个且仅一个 `workbench` 代码块。普通日志与引用内容不会被解析。

```workbench
{"action":"handoff","provider":"claude","title":"复核实现并继续","prompt":"检查当前目录的实现，运行适用检查；发现问题交给 Codex 修复，否则完成任务。","mode":"review"}
```

`provider` 为 `codex` 或 `claude`，`mode` 为 `edit` 或 `review`。默认沿用发送方的目录、分支和未提交成果；只有明确需要独立工作目录时使用 `strategy:"parallel"`。每位 AI 可以继续给另一方或自己发任务。

完成当前职责且没有剩余工作：

```workbench
{"action":"complete","summary":"完成的具体内容","validation":["实际运行的检查和结果；未执行的明确说明"],"remaining":[]}
```

确需用户处理认证、权限或做决定：

```workbench
{"action":"block","reason":"具体阻塞原因和所需处理"}
```

有剩余工作应派发后续任务。进程退出成功但缺少上述报告会显示阻塞，不能当作整组完成。接力默认上限 24 个任务，达到上限明确停止互派。

## 命令方式

有命令工具时，使用环境变量 `WORKBENCH_NODE` 指向的 Node 执行 `WORKBENCH_BRIDGE` 指向的脚本。PowerShell 示例：

```powershell
& $env:WORKBENCH_NODE $env:WORKBENCH_BRIDGE send --to claude --title "复核实现" --prompt "检查当前工作目录并继续完成" --mode review
& $env:WORKBENCH_NODE $env:WORKBENCH_BRIDGE progress --message "实现完成，正在运行检查"
& $env:WORKBENCH_NODE $env:WORKBENCH_BRIDGE complete --summary "完成并通过检查" --validation "实际检查及结果"
```

长任务说明可用 `--prompt-file 文件路径`。命令只等待投递回执，不等待接收方结束；收到回执后结束本轮即可。只读通道直接使用最终回复协议，无需命令权限。

本轮信箱限制发送方的项目、任务组和执行轮次，不向代理注入工作台主控凭证。旧轮次消息、跨项目改写和重复投递会被拒绝或去重。调度由本机服务执行，浏览器关闭后仍继续。CLI 本身仍须具备正常认证与必要权限。
