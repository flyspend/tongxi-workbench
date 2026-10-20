param([switch]$NoBrowser)
$ErrorActionPreference='Stop'
$workbenchRoot=$PSScriptRoot
$dataRoot=if($env:WORKBENCH_DATA){[IO.Path]::GetFullPath($env:WORKBENCH_DATA)}else{Join-Path $workbenchRoot '.local'}
$connectionFile=Join-Path $dataRoot 'connection.json'
function Read-ReadyConnection {
  try {
    $c=Get-Content -LiteralPath $connectionFile -Raw -ErrorAction Stop | ConvertFrom-Json
    if($c.port -lt 1 -or $c.port -gt 65535 -or $c.token -notmatch '^[0-9a-f]{64}$'){return $null}
    $base='http://127.0.0.1:'+([int]$c.port)
    $health=Invoke-RestMethod -Uri ($base+'/api/health') -TimeoutSec 2
    if(-not $health.ok){return $null}
    # Confirm this is our authenticated service, not an unrelated process on a reused port.
    $null=Invoke-RestMethod -Uri ($base+'/api/state') -Headers @{Authorization=('Bearer '+$c.token)} -TimeoutSec 2
    return [pscustomobject]@{Connection=$c;Health=$health;Url=($base+'/#'+$c.token)}
  } catch {return $null}
}
function Open-Workbench($ready) {
  if(-not $NoBrowser){Start-Process -FilePath $ready.Url -ErrorAction Stop}
  Write-Host ('工作台已就绪：http://127.0.0.1:'+ $ready.Connection.port)
}
$hash=[Security.Cryptography.SHA256]::Create()
try {$key=([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($dataRoot.ToLowerInvariant())))).Replace('-','')}finally{$hash.Dispose()}
$mutex=New-Object Threading.Mutex($false,('Local\TongxiLauncher_'+$key))
$locked=$false
try {
  try {$locked=$mutex.WaitOne(30000)}catch [Threading.AbandonedMutexException]{$locked=$true}
  if(-not $locked){throw '另一个启动入口正在处理，请稍后再试。'}
  $ready=Read-ReadyConnection
  if($ready){
    if($ready.Health.stale -and $ready.Health.active -eq 0){
      $null=Invoke-RestMethod -Method Post -Uri ('http://127.0.0.1:'+$ready.Connection.port+'/api/shutdown') -Headers @{Authorization=('Bearer '+$ready.Connection.token)} -TimeoutSec 5
      for($i=0;$i -lt 40;$i++){
        Start-Sleep -Milliseconds 250
        if(-not (Read-ReadyConnection)){break}
      }
      if(Read-ReadyConnection){throw '旧服务未能正常退出；未强制结束，请稍后重试。'}
    } else {Open-Workbench $ready; exit 0}
  }
  $nodeCommand=Get-Command node -ErrorAction SilentlyContinue
  $nodeExecutable=if($nodeCommand){$nodeCommand.Source}else{Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'}
  if(-not (Test-Path -LiteralPath $nodeExecutable)){throw '未找到 Node.js，请安装 Node.js 22 或更高版本后重试。'}
  $nodeVersion=& $nodeExecutable --version
  if($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22){throw '需要 Node.js 22 或更高版本。'}
  if(-not (Get-Command git -ErrorAction SilentlyContinue)){
    $bundledGit=Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git/cmd'
    if(Test-Path -LiteralPath (Join-Path $bundledGit 'git.exe')){$env:PATH=$bundledGit+';'+$env:PATH}else{throw '未找到 Git，请安装 Git 后重试。'}
  }
  $logRoot=if($env:WORKBENCH_DATA){$dataRoot}else{$workbenchRoot}
  $null=New-Item -ItemType Directory -Path $logRoot -Force
  $process=Start-Process -PassThru -FilePath $nodeExecutable -ArgumentList @(('"'+(Join-Path $workbenchRoot 'server.cjs')+'"')) -WorkingDirectory $workbenchRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot 'server.log') -RedirectStandardError (Join-Path $logRoot 'server-error.log')
  for($i=0;$i -lt 60;$i++){
    $ready=Read-ReadyConnection
    if($ready){Open-Workbench $ready; exit 0}
    $process.Refresh()
    if($process.HasExited){break}
    Start-Sleep -Milliseconds 250
  }
  throw ('后台服务未通过连接检查。请查看 '+(Join-Path $logRoot 'server-error.log'))
} catch {
  Write-Host ('工作台启动失败：'+$_.Exception.Message)
  exit 1
} finally {
  if($locked){$mutex.ReleaseMutex()}
  $mutex.Dispose()
}
