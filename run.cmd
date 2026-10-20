@echo off
rem Usage: run.cmd [start|test|smoke] [server args such as --port 18800 --open]
rem Uses node from PATH, or the Node bundled with Codex when node is not installed.
setlocal
cd /d "%~dp0"
set "NODE=node"
where node >nul 2>nul || set "NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
set "CMD=%~1"
if "%CMD%"=="" set "CMD=start"
shift
if /i "%CMD%"=="start" goto start
if /i "%CMD%"=="test" goto test
if /i "%CMD%"=="smoke" goto smoke
echo Unknown command: %CMD%  (use start, test or smoke)
exit /b 1
:start
"%NODE%" server.cjs %1 %2 %3 %4 %5
exit /b %errorlevel%
:test
"%NODE%" --test test\workbench.test.cjs test\relay.test.cjs test\auto-review.test.cjs test\external-members.test.cjs
exit /b %errorlevel%
:smoke
"%NODE%" test\smoke.cjs
exit /b %errorlevel%
