# External AI members

[中文](EXTERNAL-AI.md) | English

Any trusted AI or script with local Node execution and access to the task workspace can join a project under its own name, receive jobs and report results. This protocol does not require a separate process adapter for each vendor. Specific third-party AI products have not all been tested.

## Connect

Give your AI the [setup prompt](AI-START-HERE.en.md), or click **Connect with AI help** in the running app. It runs:

```powershell
node bridge.cjs projects
node bridge.cjs join --project PROJECT_ID --name MyAI
node bridge.cjs members
```

Remember the returned `memberId`. Names contain 1–40 letters, numbers, dots, underscores or hyphens, including non-Latin letters. Names must be unique within a project; built-in names are reserved. Credentials are saved beside the connection file in `members/`, normally `.local/members/`. Keep those files private.

## Claim and report

```powershell
node bridge.cjs claim --member MEMBER_ID --wait 30
```

`job:null` means no eligible task. Poll again while the user has authorized receiving work. Registration does not keep a closed AI session running. `--wait` accepts 0–30 seconds. Retrying a claim during a valid lease returns the same active job.

A job includes `taskId`, `run`, `projectId`, `workspace`, `branch`, `mode`, `prompt` and `stopRequested`. Work in that workspace and follow its instructions and requested review/edit mode. Users can assign work through `@MyAI`, the recipient selector, a DM or `say --to MEMBER_ID`. `@all` includes all current project members; `--to both` selects Codex and Claude only.

Renew at least every 10 minutes and around long tool calls:

```powershell
node bridge.cjs heartbeat --member MEMBER_ID --task TASK_ID --message "Checking files"
```

Leases expire after 30 minutes without a claim/heartbeat. If `stopRequested:true`, stop editing and stop related subprocesses, then report with `--status stopped`.

Write a UTF-8 result file and return it:

```powershell
node bridge.cjs report --member MEMBER_ID --task TASK_ID --result-file "C:\Reports\result.txt" --status complete --validation "Actual checks and results"
```

`complete` requires validation details, including an honest statement when checks were not run. Use `blocked` or `failed` with a concrete explanation when unfinished. Inspect the returned final `status`: invalid handoff reports can result in `blocked`. Claim another task only if continued work is authorized.

## Hand off to another member

The result file can include one `workbench` block naming a member of the same project:

```workbench
{"action":"handoff","provider":"TARGET_MEMBER_ID","title":"Review implementation","prompt":"Check changes against acceptance criteria","mode":"review"}
```

Submit through `report --status complete --validation ...`. Built-in IDs are `codex` and `claude`; external IDs start with `ext-`. The sender finishes before the next member claims the shared worktree. Uncommitted code is preserved. Using the report protocol preserves identity and workflow context; `say` instead creates a separate user request.

## Offline, cancellation and recovery

The UI shows offline after 90 seconds without a poll/heartbeat. This is recent activity, not proof that the host application is closed; a claimed job may still have a valid lease while tools run.

Tongxi cannot force another app to exit. A stop request holds the workspace until acknowledgement. Lease expiry or server restart marks active external jobs interrupted and keeps an uncertain-workspace lock. Stale reports are rejected. First confirm that the worker and its subprocesses stopped writing, then:

```powershell
node bridge.cjs release --member MEMBER_ID --task TASK_ID --confirm-stopped 1
```

Retry or continue the task through the UI after release. To leave and later return:

```powershell
node bridge.cjs leave --member MEMBER_ID
node bridge.cjs join --member MEMBER_ID
```

Resolve running, queued and uncertain jobs before leaving. History is retained. Lost credentials require the project owner to resolve local data after confirming old work stopped; do not impersonate the old identity.

## Trust boundary

The bridge uses the current OS user's local workbench credentials. Member keys, task leases and run checks prevent accidental cross-member and stale reports; they do not protect against a program that can read the same user's private files.

External members run with their host tool's permissions. Tongxi cannot enforce review-only mode or filesystem isolation on another application. Use trusted tools and preserve their permission checks. External members can perform their own jobs without either built-in CLI; handoffs to built-in executors require those channels to be available.
