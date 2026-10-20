# 外部 AI 独立成员接入

中文 | [English](EXTERNAL-AI.en.md)

任何能在本机执行 Node 命令、读写任务目录的 AI 或脚本，都可以加入指定项目，使用自己的名字收任务、回传结果。无需为每种厂商编写 CLI 适配器。这里只规定本地协议；未逐一验证 Cursor、Gemini 等产品的实际操作能力。

## 最简单的入口

用户把 [首次接入提示词](AI-START-HERE.md) 发给 AI；程序已经启动时，点击“让 AI 帮我接入”。提示词指导 AI 完成下面步骤。注册和查看状态不调用模型、不创建任务。

```powershell
node bridge.cjs projects
node bridge.cjs join --project 项目ID --name Gemini
node bridge.cjs members
```

保存返回的 `memberId`。显示名称限 1–40 个字母、数字、点、横线或下划线（支持中文）；同一项目不可重名。`codex`、`claude` 等内置名称保留。身份凭证自动写入连接文件所在目录下的 `members/`，通常是 `.local/members/`，不要复制到聊天、仓库或其他电脑。

## 收任务、执行、回传

```powershell
node bridge.cjs claim --member 成员ID --wait 30
```

`job:null` 表示当前没有可执行任务。用户要求持续接收时继续领取；AI 会话已经结束时，工作台无法代它启动应用。`--wait` 为 0–30 秒。已领任务在有效租约内重复领取会返回同一任务，不会重复创建。

有任务时返回 `taskId`、`run`、`projectId`、`workspace`、`branch`、`mode`、`prompt`、`stopRequested`。只在这个工作目录执行，遵守项目说明和任务模式。群里可通过名字 `@Gemini`、接收成员下拉框、私信或 `say --to 成员ID` 指定它；`@all` / `@大家` 包括该项目所有已加入成员，`--to both` 仅指 Codex 和 Claude。

至少每 10 分钟、长工具调用前后汇报一次：

```powershell
node bridge.cjs heartbeat --member 成员ID --task 任务ID --message "正在检查文件"
```

租约 30 分钟未领取/续期会失效。收到 `stopRequested:true`，先停止写文件和相关子进程，再用 `--status stopped` 回传。完成后把说明写入 UTF-8 文件：

```powershell
node bridge.cjs report --member 成员ID --task 任务ID --result-file "C:\Reports\result.txt" --status complete --validation "实际运行的检查及结果"
```

`complete` 必须说明实际验证；没有运行检查就如实说明。未完成时用 `--status blocked` 或 `--status failed` 并在报告里解释原因。回执中的 `status` 才是最终处理状态；无效的接力报告可能变成 `blocked`。回传成功后，用户要求继续接收时再领下一项任务。

## 给其他成员交接

报告文件可包含一个 `workbench` 块，`provider` 填该项目成员 ID（内置为 `codex` / `claude`，外部为 `ext-...`）：

```workbench
{"action":"handoff","provider":"目标成员ID","title":"复核实现","prompt":"检查改动与验收标准","mode":"review"}
```

依旧使用 `report --status complete --validation ...` 提交。工作台结束本轮后才允许接收方使用相同目录，保留未提交代码。调用 `say` 是另发用户任务；执行已领取的任务时，使用报告里的交接块可以保留发送者身份、任务组与目录。

## 离线、停止、重启

- 最近 90 秒没有领取/心跳时，界面显示离线；这表示最近未轮询，并不证明 AI 应用已关闭。已领取任务的租约仍可有效，期间成员可能在执行工具。
- 工作台不能强制关闭别的 AI 应用。点击停止后等待外部成员确认，期间目录仍被占用。
- 租约过期或工作台重启后，执行中的任务标为中断并保留目录锁。旧结果不能再提交。先停止该 AI 的实际工作，确认没有子进程继续写目录，然后：

```powershell
node bridge.cjs release --member 成员ID --task 任务ID --confirm-stopped 1
```

释放后再通过页面重试/续接任务。没有确认停工时保持锁定。

```powershell
node bridge.cjs leave --member 成员ID
node bridge.cjs join --member 成员ID
```

离开前需处理运行、排队和未知执行状态的任务。历史结果保留；用原 ID 可重新加入。凭证丢失时不要冒充原身份；在确认旧工作已停后由项目所有者处理本机数据。

自动分配会跳过离线外部成员，包括刚刚回复后已离线的成员；手动指定、私信和明确交接仍可排队等待它回来。全部成员不可用时会提示先连接 AI，不会自动挑选离线成员。

## 权限边界

桥接使用当前 Windows 用户可访问的本机凭证。成员密钥、任务租约和轮次检查防止误报、串任务和过期回传；同一用户下能读取这些文件的恶意程序仍可冒用身份，这不是多租户安全隔离。

外部成员使用自己所在应用的权限，工作台不能强制它遵守只读模式或目录范围。把任务交给可信 AI，保留其宿主工具的权限审查。无需内置 Codex/Claude 即可执行外部成员自己的任务；交接给它们则需要相应通道可用。
