# Copy to your AI: install, start and connect to Tongxi

[中文](AI-START-HERE.md) | English

Copy the prompt below to an AI with local file and terminal tools. Include the Tongxi folder and your project folder if you know them. A chat-only assistant can explain the steps but cannot operate your computer.

```text
Help me install or locate Tongxi (tongxi-workbench), start it locally, and Connect as an independent AI member. Complete the steps you can perform and tell me exactly what still needs my input.

1. Read README.en.md in the folder I provided. Otherwise check the current folder, then ask me for the location. If not downloaded, use https://github.com/flyspend/tongxi-workbench. A private repository requires access; tell me if access is missing.
2. Check Node.js >= 22 and Git. On Windows, run.cmd can use the Node/Git bundled with Codex. No npm install is needed. Follow local permission rules when helping install official dependencies.
3. Check whether the workbench is already running. On Windows use launch.ps1 or the included launch .bat; elsewhere use node server.cjs. Hide background windows and preserve existing running work. Keep the service on loopback.
4. Run node bridge.cjs projects and node bridge.cjs status to verify access. The bridge reads local credentials internally; keep .local and CLI credential files private.
5. Use the Git project I selected. If none is specified, ask which repository to use. Run node bridge.cjs add-project --path "absolute project path". Reuse existing projects. Ask before initializing or committing a repository that lacks Git history.
6. Run node bridge.cjs prompt --lang en and follow the returned local paths. Join using node bridge.cjs join --project "project ID" --name "YourAIName". Save the returned memberId in this conversation. For an existing identity use that ID, not a duplicate registration. Member credentials stay in local files.
7. Run node bridge.cjs claim --member MEMBER_ID --wait 30. A null job means no task; tell me you are connected and wait for instructions. Claiming does not create a task or call a model. Continued polling requires an active AI session; registration does not keep a closed app running.
8. For a claimed job, work only in its supplied workspace, follow its prompt and review/edit mode, and obey repository instructions. Send heartbeat --member MEMBER_ID --task TASK_ID --message "progress" during work, at least every 10 minutes and before/after a long tool call. A lease expires after 30 minutes without a claim/heartbeat. If stopRequested:true, stop editing and report --status stopped.
9. Write the result to a local UTF-8 file. Return it with node bridge.cjs report --member MEMBER_ID --task TASK_ID --result-file "absolute report path" --status complete --validation "actual checks and results". Use blocked or failed with the concrete reason when necessary. Report only checks actually performed. Then claim again if I asked you to keep receiving work.
10. A task's workbench JSON handoff may name any registered member ID in that project. Read EXTERNAL-AI.en.md for handoffs, leaving, and interrupted-work recovery. After a lost lease, stop work and confirm the worker has stopped before using release --member MEMBER_ID --task TASK_ID --confirm-stopped 1.
11. Official CLI login and API-key configuration are completed by me locally. Do not ask for passwords, keys or verification codes in chat. Built-in Codex/Claude availability is independent of your membership: you can receive your own tasks even when neither built-in CLI is installed.

Finish connection setup with a short report: service running or not, project, your member name/ID, language, and any missing requirements. Do not invent a test task or modify my project merely to prove connectivity.
```

Use the **Language** selector on the main page or open `/?lang=en` for English. Interface language changes do not translate project names, agent replies, reports or logs. The copied connection prompt follows the selected language.

Offline: `node bridge.cjs setup-prompt --lang en`. Running: **Connect with AI help** or `node bridge.cjs prompt --lang en`.
