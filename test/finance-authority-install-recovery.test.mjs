import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
const script=join(root,'scripts','install-finance-reservation-authority.ps1');
const unseal=join(root,'scripts','finance-reservation-windows-authority-unseal.ps1');
test('the one-time interrupted install can safely preflight a partial staging directory',()=>{
  if(process.platform!=='win32')return;
  const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',script,'-PreflightOnly','-ResumePartial'],{encoding:'utf8',timeout:20000});
  assert.match(output,/FINANCE_AUTHORITY_PREFLIGHT_READY_UAC/);
});
test('ACL helper does not shadow Powershell automatic $args',()=>{
  const c=readFileSync(script,'utf8');
  assert.match(c,/\[string\[\]\]\$aclArguments/);
  assert.doesNotMatch(c,/\[string\[\]\]\$args\b/);
});
test('Windows PowerShell loads the DPAPI assembly in installer and service unsealer',()=>{
  assert.match(readFileSync(script,'utf8'),/Add-Type\s+-AssemblyName\s+System\.Security/);
  assert.match(readFileSync(unseal,'utf8'),/Add-Type\s+-AssemblyName\s+System\.Security/);
});
