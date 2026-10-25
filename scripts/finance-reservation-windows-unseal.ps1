# Called only by the single supervised Node process; emits secrets to its private stdout pipe.
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$secrets=Join-Path $root 'secrets'
function Unseal([string]$name){
  $path=Join-Path $secrets ($name+'.dpapi')
  $secure=(Get-Content -LiteralPath $path -Raw).Trim() | ConvertTo-SecureString
  $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try{return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}
  finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
}
$tokens=[ordered]@{client=(Unseal 'client');admin=(Unseal 'admin')}
$tokens | ConvertTo-Json -Compress
