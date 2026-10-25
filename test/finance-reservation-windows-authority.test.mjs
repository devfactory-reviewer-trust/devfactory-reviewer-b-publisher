import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const repo=join(fileURLToPath(new URL('.',import.meta.url)),'..');
const installer=join(repo,'scripts','install-finance-reservation-authority.ps1');
const unseal=join(repo,'scripts','finance-reservation-windows-authority-unseal.ps1');
const entrypoint=join(repo,'scripts','finance-reservation-windows-authority-entrypoint.mjs');

test('preflight is non-mutating and requires admin for the actual migration',()=>{
  if(process.platform!=='win32')return;
  const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',installer,'-PreflightOnly','-ResumePartial'],{encoding:'utf8',timeout:20000});
  assert.match(output,/FINANCE_AUTHORITY_PREFLIGHT_/);
  assert.match(readFileSync(installer,'utf8'),/IsInRole\(\[Security\.Principal\.WindowsBuiltInRole\]::Administrator\)/);
});
test('authority task runs as LocalService, not the interactive Runner identity',()=>{
  const script=readFileSync(installer,'utf8');
  assert.match(script,/SecurityIdentifier\]::new\('S-1-5-19'\)/);
  assert.match(script,/New-ScheduledTaskPrincipal/);
  assert.match(script,/-LogonType ServiceAccount/);
  assert.doesNotMatch(script,/-UserId \(\[Security\.Principal\.WindowsIdentity\]::GetCurrent\(\)\.Name\)/);
});
test('secrets rotate into protected machine scope and are excluded from Runner ACL',()=>{
  const script=readFileSync(installer,'utf8');
  assert.match(script,/DataProtectionScope\]::LocalMachine/);
  assert.match(script,/\*S-1-5-19:/); // LocalService only in protected stores
  assert.match(script,/\*S-1-5-32-544:/); // Administrators
  assert.match(script,/icacls\.exe/);
  assert.match(script,/finance-reservation-windows-authority-unseal\.ps1/);
  assert.doesNotMatch(script,/Copy-Item\s+.*admin\.dpapi/i);
  const helper=readFileSync(unseal,'utf8');
  assert.match(helper,/DataProtectionScope\]::LocalMachine/);
});
test('task owns the Node process and restores shadow on failed migration',()=>{
  const script=readFileSync(installer,'utf8');
  assert.match(script,/Stop-ScheduledTask/);
  assert.match(script,/Start-ScheduledTask/);
  assert.match(script,/catch\s*\{/);
  assert.match(script,/FINANCE_AUTHORITY_HEALTHY/);
  assert.match(readFileSync(entrypoint,'utf8'),/127\.0\.0\.1/);
  assert.match(readFileSync(entrypoint,'utf8'),/maySpend|NO_SPEND/);
});
