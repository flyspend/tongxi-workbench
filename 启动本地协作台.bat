@echo off
setlocal
cd /d "%~dp0"
rem Execution policy applies only to this trusted local launcher process.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1" %*
set "LAUNCH_EXIT=%ERRORLEVEL%"
if not "%LAUNCH_EXIT%"=="0" if not defined WORKBENCH_NO_PAUSE pause
exit /b %LAUNCH_EXIT%
