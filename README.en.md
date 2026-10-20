# Tongxi · Local AI Workbench v0.4

[中文](README.md) | English

A local, zero-dependency workbench for an AI team. Codex CLI and Claude Code have built-in process adapters. Other AI tools with local terminal access can join under their own names, claim tasks, and return results through the bridge. Windows-first; requires Node.js >= 22 and Git.

## Let your AI connect for you

Copy the prompt in [AI-START-HERE.en.md](AI-START-HERE.en.md) to your local AI. It checks dependencies, helps start Tongxi, registers your selected project, joins as a member and verifies the connection. You complete official account login or API-key configuration locally.

In the running app, click **Connect with AI help**. The prompt includes actual local executable paths. The repository remains private until its owner changes visibility; other users need repository access to download it.

## Start and choose a language

```powershell
.\run.cmd start
```

Or double-click the included launch `.bat`. Foreground alternative: `node server.cjs`. No `npm install` is required. The Windows launcher can use the Node runtime bundled with Codex; Git also has a bundled-path fallback.

Select **English** in the main page's **Language** selector, or open `/?lang=en` after signing in to the local workbench. The preference is remembered in that browser. Chinese is also available. The UI and connection prompts change language; project content, AI responses and diagnostic logs keep their original text.

The default port is 18764. Use `run.cmd start --port 18800`, `WORKBENCH_PORT`, or `PORT` to change it; `--port 0` selects a free port. The service accepts only loopback bindings. The launch URL contains a local access token stored in `.local/token`; keep it private.

## Chat and tasks

Add a local Git repository with at least one commit. Each project has a group channel and member DMs. Use the recipient selector or `@MemberName`; `@all` includes every registered project member. `--to both` targets the two built-in executors only. Without an explicit recipient, the previous responder or an available member is selected.

Parallel tasks use separate `ai/<member>/...` branches and Git worktrees. Sequential handoffs preserve the worktree and uncommitted changes. The scheduler prevents concurrent tasks in a shared worktree. Existing uncommitted changes in the original checkout are not copied. The workbench does not automatically merge, push or deploy.

Built-in executors start automatically when configured. External members actively poll for their own tasks; Tongxi does not remotely open another app or keep an ended AI session alive. Their names, availability and task results appear in the group. See [external member instructions](EXTERNAL-AI.en.md).

## Bridge commands

```powershell
node bridge.cjs setup-prompt --lang en
node bridge.cjs projects
node bridge.cjs add-project --path "C:\Projects\my-app"
node bridge.cjs prompt --lang en
node bridge.cjs members
node bridge.cjs join --project PROJECT_ID --name MyAI
node bridge.cjs claim --member MEMBER_ID --wait 30
node bridge.cjs heartbeat --member MEMBER_ID --task TASK_ID --message "Reviewing files"
node bridge.cjs report --member MEMBER_ID --task TASK_ID --result-file "C:\Reports\result.txt" --validation "Read files and ran relevant checks"
node bridge.cjs say --project PROJECT_ID --to MEMBER_ID --message "Review the login code" --wait 600
node bridge.cjs read --project PROJECT_ID --after "ISO_TIMESTAMP" --wait 120
```

The bridge returns JSON except for prompt commands. Long messages can use `--message-file`; `--channel MEMBER_ID` selects a DM. `--readonly 1` requests a review task. If `say` returns `done:false`, use `read` instead of sending the same task again. In a claimed external task, the supplied prompt and report protocol control handoffs.

## Handoffs and acceptance

The server owns scheduling; closing the browser does not stop built-in tasks. Workflows default to 24 tasks, configurable from 2 to 100. A task reports completion, a handoff or a blocking issue through the [agent protocol](AGENT-BRIDGE.en.md). A successful process exit alone is insufficient for non-chat workflow completion.

Optional automatic acceptance runs a Codex review of manual board deliveries, archiving only after a verified completion report. Chat turns and relay workflows do not use that acceptance path. Task cards can preview supported images and reports inside their worktree.

## CLI and API channels

Codex uses `exec --json --sandbox workspace-write`, or `read-only` for reviews, with the user's configured model. Claude Code uses print mode and stream JSON, with `acceptEdits` for editing and `default` for reviews. Configure executable paths in **CLI settings** when automatic detection fails.

If Claude Code is unavailable and `ANTHROPIC_API_KEY` was set before startup, the Claude channel uses `agents/claude-api.cjs`. The optional API agent has worktree file tools but cannot execute shell commands. Model and optional base URL are configurable through `ANTHROPIC_MODEL` and `ANTHROPIC_BASE_URL`. Live model availability and vendor-specific API options require verification with your own account; fake-agent tests do not establish live compatibility.

Optional Godot uses the configured path, `WORKBENCH_GODOT`, or PATH. The workbench links the executable into `.local/bin`.

## Security boundaries

- Claude is allowed to execute `node`, `git`, and `godot`, including during reviews. `git push` and `git remote` are denied as direct commands, but arbitrary Node execution can bypass command-level restrictions. Review mode and worktree paths are not an OS sandbox for Claude or external members. Use trusted projects and appropriately restricted local AI tools.
- Codex uses its own sandbox. External members use the permissions of their host application; Tongxi cannot enforce or expand those permissions.
- The service checks Bearer credentials, Host and Origin, serves a CSP and escapes displayed content. These controls protect against cross-site access, not malicious software running as your Windows user.
- Local bridge clients can read the workbench token. Member keys and task leases prevent accidental cross-member/stale reports; they are not a security boundary against another trusted local program with access to the same user files.
- Child processes inherit environment variables. Protect API keys from untrusted tasks and programs. Do not commit `.local`, `.env`, credentials, personal repositories or run logs.
- Stopping an external job requests acknowledgement; it cannot kill another app. Lost leases and restarts preserve an uncertain-workspace lock until the worker has stopped and explicitly releases it.

## Third-party services

Tongxi is independent of OpenAI and Anthropic and is not endorsed by them. Product names describe compatibility. This repository does not include or redistribute either CLI. Each user authenticates through official tools using their own account or API key and pays for their own usage.

Respect provider terms and quotas. API keys are the recommended default for substantial automation; do not share subscriptions, collect login credentials or provide a shared subscription-backed service. References: [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance), [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode).

## Local data and recovery

`.local/state.json` holds project/task state; `.local/runs/` holds prompts and logs; `.local/worktrees/` holds task checkouts; `.local/members/` holds bridge member credentials and leases. Keep uncommitted worktrees. Corrupt state is backed up; interrupted jobs require review before retry. Restart-safe queued built-in jobs resume. Single-instance locking protects the data directory.

## Validation

```powershell
.\run.cmd test
.\run.cmd smoke
```

Tests use fake AI processes and temporary repositories. The smoke test exercises real local HTTP authentication, worktrees, stop/restart and automatic handoffs. External-member tests cover identity, claims, stale reports, handoffs and cancellation. `test/ui-smoke.cjs` requires a local Playwright installation (`PLAYWRIGHT_MODULE`). These tests do not spend model credits or validate real vendor authentication.

## License and attribution

[MIT](LICENSE). Copies or substantial portions of the software must retain the copyright and permission notices. MIT does not require a homepage credit, repository link, publication of derivative source code, or the same license for every part of a larger product. Keeping the full LICENSE text with distributed copies is the practical approach. A link to [Tongxi](https://github.com/flyspend/tongxi-workbench) is appreciated, but is not an extra license condition. [MIT text at OSI](https://opensource.org/license/mit).
