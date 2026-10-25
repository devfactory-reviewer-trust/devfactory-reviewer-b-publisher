# Staging-only finance ledger launcher. NEVER grants provider spend.
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$secrets=Join-Path $root 'secrets'
function Unseal([string]$file) {
  $secure=(Get-Content -LiteralPath $file -Raw).Trim() | ConvertTo-SecureString
  $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
$env:DF_FINANCE_CLIENT_TOKEN=Unseal (Join-Path $secrets 'client.dpapi')
$env:DF_FINANCE_ADMIN_TOKEN=Unseal (Join-Path $secrets 'admin.dpapi')
$env:DF_FINANCE_DB=Join-Path (Join-Path $root 'state') 'ledger.sqlite'
$env:DF_FINANCE_PORT='47881'
$node='C:\Program Files\nodejs\node.exe'
$service=Join-Path $PSScriptRoot 'finance-reservation-server.mjs'
if(-not (Test-Path -LiteralPath $node -PathType Leaf)) { throw 'NODE_RUNTIME_MISSING' }
if(-not (Test-Path -LiteralPath $service -PathType Leaf)) { throw 'SERVICE_MISSING' }
try {
  & $node $service *>> (Join-Path $root 'service.log')
  exit $LASTEXITCODE
} finally {
  Remove-Item Env:DF_FINANCE_CLIENT_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:DF_FINANCE_ADMIN_TOKEN -ErrorAction SilentlyContinue
}
