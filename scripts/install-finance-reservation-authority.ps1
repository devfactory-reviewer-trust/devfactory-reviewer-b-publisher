# Elevated one-time cutover to an independently owned LocalService ledger.
# Does NOT grant permission to incur OpenRouter charges.
[CmdletBinding()]
param([switch]$PreflightOnly,[switch]$ResumePartial)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$oldTask='DevFactory-Finance-Ledger-Shadow'
$newTask='DevFactory-Finance-Authority'
$old=Join-Path $env:LOCALAPPDATA 'DevFactory\FinanceReservation'
$root=Join-Path $env:ProgramData 'DevFactoryFinanceAuthority'
$app=Join-Path $root 'app'
$state=Join-Path $root 'state'
$secrets=Join-Path $root 'secrets'
$repo=Split-Path -Parent $PSScriptRoot
$node='C:\Program Files\nodejs\node.exe'
if(-not (Test-Path -LiteralPath $node -PathType Leaf)){throw 'NODE_RUNTIME_MISSING'}
$prior=Get-ScheduledTask -TaskName $oldTask -ErrorAction SilentlyContinue
if(-not $prior){throw 'SHADOW_TASK_MISSING'}
if(Get-ScheduledTask -TaskName $newTask -ErrorAction SilentlyContinue){throw 'AUTHORITY_TASK_EXISTS'}
# Non-admin preflight cannot and must not introspect a service-owned ProgramData store.
if($PreflightOnly){
  Write-Output 'FINANCE_AUTHORITY_PREFLIGHT_READY_UAC'
  Write-Output 'FINANCE_AUTHORITY_SPENDING_DISABLED'
  return
}
$id=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=[Security.Principal.WindowsPrincipal]::new($id)
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ADMINISTRATOR_UAC_REQUIRED'}
$recoveryReady=$false
if(Test-Path -LiteralPath $root){
  if(-not $ResumePartial){throw 'AUTHORITY_ROOT_EXISTS'}
  $artifacts=@(
    (Join-Path $root 'state\ledger.sqlite'),
    (Join-Path $root 'secrets\client.machine'),
    (Join-Path $root 'secrets\admin.machine'),
    (Join-Path $old 'secrets\client-authority.dpapi')
  )
  $present=@($artifacts | ForEach-Object { Test-Path -LiteralPath $_ -PathType Leaf })
  $count=@($present | Where-Object {$_}).Count
  if($count -eq $artifacts.Count){$recoveryReady=$true}
  elseif($count -gt 0){throw 'PARTIAL_INSTALL_INCONSISTENT_STOP'}
}
if(-not(Test-Path -LiteralPath (Join-Path $old 'state\ledger.sqlite') -PathType Leaf)){throw 'SHADOW_LEDGER_MISSING'}
$files=@(
  (Join-Path $repo 'service\finance-reservation-ledger.mjs'),
  (Join-Path $repo 'service\finance-reservation-server.mjs'),
  (Join-Path $PSScriptRoot 'finance-reservation-windows-authority-entrypoint.mjs'),
  (Join-Path $PSScriptRoot 'finance-reservation-windows-authority-unseal.ps1')
)
foreach($file in $files){if(-not(Test-Path -LiteralPath $file -PathType Leaf)){throw ('MISSING_SOURCE '+$file)}}
$id=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=[Security.Principal.WindowsPrincipal]::new($id)
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ADMINISTRATOR_UAC_REQUIRED'}
if($id.Name -ne $prior.Principal.UserId -and $id.Name.Split('\')[-1] -ne $prior.Principal.UserId){throw 'DIFFERENT_UAC_ACCOUNT_NOT_SUPPORTED'}
function Assert-Acl([string]$path,[string[]]$aclArguments){
  $output=& icacls.exe $path @aclArguments 2>&1
  if($LASTEXITCODE -ne 0){throw ('ACL_FAILED '+$path+' '+($output -join ' '))}
}
function Secure-Dir([string]$path,[string]$rights){
  Assert-Acl $path @('/inheritance:r')
  Assert-Acl $path @('/grant:r','*S-1-5-18:(OI)(CI)F','*S-1-5-32-544:(OI)(CI)F',('*S-1-5-19:(OI)(CI)'+$rights))
}
function New-Token(){
  $bytes=New-Object byte[] 32
  $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
  try{$rng.GetBytes($bytes)}finally{$rng.Dispose()}
  try{return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')}
  finally{[Array]::Clear($bytes,0,$bytes.Length)}
}
function Protect-Machine([string]$token,[string]$path){
  $plain=[Text.Encoding]::UTF8.GetBytes($token)
  try{
    $cipher=[Security.Cryptography.ProtectedData]::Protect($plain,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
    try{[IO.File]::WriteAllText($path,[Convert]::ToBase64String($cipher),[Text.UTF8Encoding]::new($false))}
    finally{[Array]::Clear($cipher,0,$cipher.Length)}
  }finally{[Array]::Clear($plain,0,$plain.Length)}
}
[void][IO.Directory]::CreateDirectory($root)
[void][IO.Directory]::CreateDirectory($app)
[void][IO.Directory]::CreateDirectory($state)
[void][IO.Directory]::CreateDirectory($secrets)
Secure-Dir $root 'RX'
Secure-Dir $app 'RX'
Secure-Dir $state 'M'
Secure-Dir $secrets 'R'
foreach($file in $files){Copy-Item -LiteralPath $file -Destination $app}
& $node '--check' (Join-Path $app 'finance-reservation-windows-authority-entrypoint.mjs')
if($LASTEXITCODE -ne 0){throw 'AUTHORITY_ENTRYPOINT_INVALID'}
# Recover the rotated tokens only after a known failed pre-registration cutover.
if($recoveryReady){
  $secured=(Get-Content -LiteralPath (Join-Path $old 'secrets\client-authority.dpapi') -Raw).Trim() | ConvertTo-SecureString
  $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secured)
  try{$clientToken=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}
  finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
  $encrypted=[Convert]::FromBase64String((Get-Content -LiteralPath (Join-Path $secrets 'client.machine') -Raw).Trim())
  $plain=[Security.Cryptography.ProtectedData]::Unprotect($encrypted,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
  try{
    if([Text.Encoding]::UTF8.GetString($plain) -cne $clientToken){
      throw 'RECOVERED_CLIENT_TOKEN_MISMATCH'
    }
  }finally{[Array]::Clear($plain,0,$plain.Length)}
}else{
  # Both tokens are rotated: the old user-profile admin token becomes useless.
  $clientToken=New-Token
  $adminToken=New-Token
  try{
    Protect-Machine $clientToken (Join-Path $secrets 'client.machine')
    Protect-Machine $adminToken (Join-Path $secrets 'admin.machine')
    $secured=ConvertTo-SecureString -String $clientToken -AsPlainText -Force
    $cipher=ConvertFrom-SecureString -SecureString $secured
    [IO.File]::WriteAllText((Join-Path $old 'secrets\client-authority.dpapi'),$cipher,[Text.UTF8Encoding]::new($false))
  }finally{$adminToken=$null}
}
# Owner SID is Administrators, NOT MSI\ismah: only an elevated admin can
# change ACLs; the non-elevated Runner cannot reclaim write permissions.
Assert-Acl $root @('/setowner','*S-1-5-32-544','/T')
$stopped=$false
$disabled=$false
$created=$false
try{
  Stop-ScheduledTask -TaskName $oldTask
  $stopped=$true
  $free=$false
  for($i=0;$i -lt 50;$i++){
    $listeners=@(Get-NetTCPConnection -LocalPort 47881 -State Listen -ErrorAction SilentlyContinue)
    if($listeners.Count -eq 0){$free=$true;break}
    Start-Sleep -Milliseconds 200
  }
  if(-not $free){throw 'OLD_PORT_STILL_OCCUPIED'}
  Disable-ScheduledTask -TaskName $oldTask | Out-Null
  $disabled=$true
  foreach($filename in @('ledger.sqlite','ledger.sqlite-wal','ledger.sqlite-shm')){
    $source=Join-Path (Join-Path $old 'state') $filename
    if(Test-Path -LiteralPath $source -PathType Leaf){
      $destination=Join-Path $state $filename
      Copy-Item -LiteralPath $source -Destination $destination
      if((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash){throw 'LEDGER_COPY_HASH_MISMATCH'}
    }
  }
  if(-not(Test-Path -LiteralPath (Join-Path $state 'ledger.sqlite') -PathType Leaf)){throw 'MIGRATED_LEDGER_MISSING'}
  # Newly copied SQLite and WAL files must not remain owned by the Runner SID.
  Assert-Acl $root @('/setowner','*S-1-5-32-544','/T')
  # The scheduled task directly supervises Node; no orphaned wrapper.
  $action=New-ScheduledTaskAction -Execute $node -Argument ('"'+(Join-Path $app 'finance-reservation-windows-authority-entrypoint.mjs')+'"')
  $trigger=New-ScheduledTaskTrigger -AtStartup
  $serviceAccount=([Security.Principal.SecurityIdentifier]::new('S-1-5-19')).Translate([Security.Principal.NTAccount]).Value
  $servicePrincipal=New-ScheduledTaskPrincipal -UserId $serviceAccount -LogonType ServiceAccount -RunLevel Limited
  $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $newTask -Action $action -Trigger $trigger -Principal $servicePrincipal -Settings $settings -Description 'Independent financial ledger, local only, NO SPEND' | Out-Null
  $created=$true
  Start-ScheduledTask -TaskName $newTask
  $ready=$false
  for($i=0;$i -lt 50;$i++){
    try{
      $health=Invoke-RestMethod -Uri 'http://127.0.0.1:47881/health' -TimeoutSec 2
      if($health.status -eq 'ok' -and $health.maySpend -eq $false){$ready=$true;break}
    }catch{}
    Start-Sleep -Milliseconds 200
  }
  if(-not $ready){throw 'AUTHORITY_HEALTH_UNAVAILABLE'}
  $listener=Get-NetTCPConnection -LocalPort 47881 -State Listen | Where-Object {$_.LocalAddress -eq '127.0.0.1'} | Select-Object -First 1
  if(-not $listener){throw 'AUTHORITY_LISTENER_NOT_LOCAL'}
  $owner=Invoke-CimMethod -InputObject (Get-CimInstance Win32_Process -Filter ('ProcessId='+$listener.OwningProcess)) -MethodName GetOwnerSid
  if($owner.Sid -ne 'S-1-5-19'){throw 'AUTHORITY_PROCESS_NOT_LOCAL_SERVICE'}
  $status=Invoke-RestMethod -Uri 'http://127.0.0.1:47881/v1/status' -Headers @{Authorization=('Bearer '+$clientToken)} -TimeoutSec 3
  if($status.maySpend -ne $false -or $status.mayReserveForPaidRun -ne $false){throw 'FAIL_CLOSED_POLICY_BROKEN'}
  Write-Output 'FINANCE_AUTHORITY_HEALTHY'
  Write-Output 'FINANCE_AUTHORITY_LOCAL_SERVICE_CONFIRMED'
  Write-Output 'FINANCE_AUTHORITY_LEDGER_PRESERVED'
  Write-Output 'FINANCE_AUTHORITY_SPENDING_DISABLED'
}catch{
  $reason=$_.Exception.Message
  if($created){
    try{Stop-ScheduledTask -TaskName $newTask -ErrorAction SilentlyContinue}catch{}
    try{Disable-ScheduledTask -TaskName $newTask -ErrorAction SilentlyContinue | Out-Null}catch{}
  }
  if($disabled){try{Enable-ScheduledTask -TaskName $oldTask | Out-Null}catch{}}
  if($stopped){try{Start-ScheduledTask -TaskName $oldTask}catch{}}
  throw ('FINANCE_AUTHORITY_MIGRATION_FAILED_ROLLBACK_ATTEMPTED: '+$reason)
}finally{$clientToken=$null}
