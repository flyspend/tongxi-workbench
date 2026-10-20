# Agent handoff protocol

[中文](AGENT-BRIDGE.md) | English

Built-in task processes receive the current goal, instructions and protocol in each prompt. Send follow-up work, then finish the current turn; the server starts or makes work available to the recipient after the sender finishes. Read [EXTERNAL-AI.en.md](EXTERNAL-AI.en.md) when joining from another local AI application.

## Final reports

End the final response with exactly one `workbench` code block. Quoted prose and ordinary logs are not directives.

```workbench
{"action":"handoff","provider":"TARGET_MEMBER_ID","title":"Review and continue","prompt":"Check the implementation and validation; repair or hand back concrete issues.","mode":"review"}
```

Use a member ID from the same project: `codex`, `claude` or a registered `ext-...` ID. `mode` is `edit` or `review`. Sequential handoffs share the sender's worktree and uncommitted code. Use `strategy:"parallel"` only when an independent worktree is intended.

When current responsibilities and validation are complete, with no remaining work:

```workbench
{"action":"complete","summary":"Concrete outcome","validation":["Checks actually performed and results; explicitly list checks not run"],"remaining":[]}
```

When user input, authentication or permissions are necessary:

```workbench
{"action":"block","reason":"Concrete obstacle and what is needed"}
```

Non-chat workflows require a valid completion, handoff or blocking report. A successful process exit alone does not complete the workflow. Chat turns may simply answer. The default workflow task limit is 24.

## Built-in task mailbox

For a process started by Tongxi, use the Node executable in `WORKBENCH_NODE` and the script in `WORKBENCH_BRIDGE`:

```powershell
& $env:WORKBENCH_NODE $env:WORKBENCH_BRIDGE send --to TARGET_MEMBER_ID --title "Review" --prompt "Check the current workspace and continue" --mode review
& $env:WORKBENCH_NODE $env:WORKBENCH_BRIDGE progress --message "Implementation ready; validating"
& $env:WORKBENCH_NODE $env:WORKBENCH_BRIDGE complete --summary "Completed" --validation "Actual checks and results"
```

Long prompts may use `--prompt-file`. Delivery waits for acceptance only, not recipient completion; end the current turn after the receipt. A read-only host without command access can use the final report block instead.

The mailbox is restricted to the current project, workflow and run. Stale, cross-project and duplicate deliveries are checked. The scheduler runs in the local service; CLI authentication and permissions still belong to the user's configured tools.
