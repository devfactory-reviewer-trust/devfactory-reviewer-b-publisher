# One-time repair of task process ownership. Preserve DB and both DPAPI tokens.
$ErrorActionPreference='Stop'
$task='DevFactory-Finance-Ledger-Shadow'
$root=Join-Path $env:LOCALAPPDATA 'DevFactory\FinanceReservation'
$app=Join-Path $root 'app'
$node='C:\Program Files\nodejs\node.exe'
$oldService=Join-Path $app 'finance-reservation-server.mjs'
$entry=Join-Path $PSScriptRoot 'finance-reservation-windows-entrypoint.mjs'
$unseal=Join-Path $PSScriptRoot 'finance-reservation-windows-unseal.ps1'
if(-not (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue)) {throw 'SHADOW_TASK_MISSING'}
foreach($path in @($node,$oldService,$entry,$unseal,(Join-Path $root 'state\ledger.sqlite'),
  (Join-Path $root 'secrets\client.dpapi'),(Join-Path $root 'secrets\admin.dpapi'))) {
  if(-not (Test-Path -LiteralPath $path -PathType Leaf)) {throw ('SHADOW_INPUT_MISSING_'+$path)}
}
Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
$old=(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object {$_.CommandLine -like ('*'+$oldService+'*')})
if(@($old).Count -gt 1) {throw 'AMBIGUOUS_OLD_PROCESS'}
foreach($process in @($old)) {
  if($process){Stop-Process -Id $process.ProcessId -Force}
}
Copy-Item -LiteralPath $entry -Destination (Join-Path $app 'finance-reservation-windows-entrypoint.mjs')
Copy-Item -LiteralPath $unseal -Destination (Join-Path $app 'finance-reservation-windows-unseal.ps1')
$action=New-ScheduledTaskAction -Execute $node -Argument ('"'+(Join-Path $app 'finance-reservation-windows-entrypoint.mjs')+'"')
Set-ScheduledTask -TaskName $task -Action $action | Out-Null
Start-ScheduledTask -TaskName $task
Write-Output 'FINANCE_SHADOW_SINGLE_PROCESS_UPGRADE_REQUESTED'
