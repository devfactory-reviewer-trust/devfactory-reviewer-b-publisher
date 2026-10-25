# Runs only as NT AUTHORITY\LOCAL SERVICE inside the protected authority task.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$secrets=Join-Path (Split-Path -Parent $PSScriptRoot) 'secrets'
function Unseal([string]$name){
  $path=Join-Path $secrets ($name+'.machine')
  $cipher=[Convert]::FromBase64String((Get-Content -LiteralPath $path -Raw).Trim())
  $plain=[Security.Cryptography.ProtectedData]::Unprotect(
    $cipher,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
  try { return [Text.Encoding]::UTF8.GetString($plain) }
  finally { [Array]::Clear($plain,0,$plain.Length) }
}
@{client=(Unseal 'client');admin=(Unseal 'admin')} | ConvertTo-Json -Compress
