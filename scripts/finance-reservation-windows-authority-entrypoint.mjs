// Windows Task Scheduler runs this directly as NT AUTHORITY\LOCAL SERVICE.
// Credentials and SQLite are in admin-owned %ProgramData%; Runner cannot mutate either.
// Safe before provider billing, ZDR, and policy attestations: no spend permission.
import {execFileSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openFinanceLedger} from './finance-reservation-ledger.mjs';
import {createFinanceServer} from './finance-reservation-server.mjs';

const appDir=dirname(fileURLToPath(import.meta.url));
const root=dirname(appDir);
const powershell=join(process.env.SystemRoot||'C:\\Windows',
  'System32','WindowsPowerShell','v1.0','powershell.exe');
const output=execFileSync(powershell,[
  '-NoProfile','-NonInteractive','-File',
  join(appDir,'finance-reservation-windows-authority-unseal.ps1')
],{encoding:'utf8',timeout:10000,maxBuffer:4096,windowsHide:true});
const credentials=JSON.parse(output.trim());
if(!credentials||typeof credentials.client!=='string'||
   typeof credentials.admin!=='string')
  throw Error('FINANCE_AUTHORITY_CREDENTIALS_INVALID');
const ledger=openFinanceLedger(join(root,'state','ledger.sqlite'));
const server=createFinanceServer({
  ledger,clientToken:credentials.client,adminToken:credentials.admin
});
server.listen(47881,'127.0.0.1',()=>{
  console.log('FINANCE_AUTHORITY_LOCAL_READY_NO_SPEND');
});
for(const signal of ['SIGINT','SIGTERM']){
  process.on(signal,()=>server.close(()=>{ledger.close();process.exit(0)}));
}
