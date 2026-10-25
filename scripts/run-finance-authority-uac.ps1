# Elevation wrapper: publish only sanitized status, never credentials.
$ErrorActionPreference='Stop'
$installer=Join-Path $PSScriptRoot 'install-finance-reservation-authority.ps1'
$report=Join-Path $env:LOCALAPPDATA 'DevFactory\FinanceReservation\authority-cutover-result.txt'
try{
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  $isAdmin=[Security.Principal.WindowsPrincipal]::new($identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if(-not $isAdmin){
    Write-Output 'ADMINISTRATOR_UAC_REQUIRED: relance de PowerShell en administrateur.'
    $child=Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"')) -Verb RunAs -Wait -PassThru
    Write-Output ('FINANCE_AUTHORITY_INSTALL_EXIT='+$child.ExitCode)
    exit $child.ExitCode
  }
  $output=@(& $installer -ResumePartial 2>&1 | ForEach-Object { $_.ToString() })
  [IO.File]::WriteAllText($report,($output -join [Environment]::NewLine),[Text.UTF8Encoding]::new($false))
  $output | ForEach-Object { Write-Output $_ }
}catch{
  $message='FINANCE_AUTHORITY_FAILED: '+$_.Exception.Message
  try{[IO.File]::WriteAllText($report,$message,[Text.UTF8Encoding]::new($false))}catch{}
  Write-Output $message
  exit 1
}
