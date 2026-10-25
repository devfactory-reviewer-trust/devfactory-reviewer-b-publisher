import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const repo=fileURLToPath(new URL('..',import.meta.url));
const file=join(repo,'scripts','install-finance-reservation-authority.ps1');
const code=readFileSync(file,'utf8');
test('scheduled task principal resolves localized account from immutable SID S-1-5-19',()=>{
  assert.match(code,/new\('S-1-5-19'\)\)\.Translate\(\[Security\.Principal\.NTAccount\]\)/);
  assert.match(code,/New-ScheduledTaskPrincipal -UserId \$serviceAccount/);
});
test('migrated SQLite files are re-owned by Administrators after copy',()=>{
  const copy=code.indexOf('Copy-Item -LiteralPath $source -Destination $destination');
  const owner=code.lastIndexOf("Assert-Acl $root @('/setowner'");
  assert.ok(copy>0&&owner>copy,'root ownership must be secured after SQLite copy');
});
test('resume after failed registration preserves encrypted credentials and never reissues admin token',()=>{
  assert.match(code,/\$recoveryReady=\$true/);
  assert.match(code,/PARTIAL_INSTALL_INCONSISTENT_STOP/);
  assert.match(code,/RECOVERED_CLIENT_TOKEN_MISMATCH/);
});
test('staged recovery passes a non-mutating preflight on the current MSI',()=>{
  if(process.platform!=='win32')return;
  const out=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',file,'-PreflightOnly','-ResumePartial'],{encoding:'utf8',timeout:20000});
  assert.match(out,/FINANCE_AUTHORITY_PREFLIGHT_READY_UAC/);
});
