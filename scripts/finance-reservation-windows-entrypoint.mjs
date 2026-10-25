// Single task-owned Windows Node process. Always NO-SPEND.
import {execFileSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openFinanceLedger} from './finance-reservation-ledger.mjs';
import {createFinanceServer} from './finance-reservation-server.mjs';

const appDir=dirname(fileURLToPath(import.meta.url));
const baseDir=dirname(appDir);
const decryptScript=join(appDir,'finance-reservation-windows-unseal.ps1');
const powershell=join(process.env.SystemRoot||'C:\\Windows','System32',
  'WindowsPowerShell','v1.0','powershell.exe');
const stdout=execFileSync(powershell,
  ['-NoProfile','-NonInteractive','-File',decryptScript],
  {encoding:'utf8',timeout:10000,maxBuffer:4096,windowsHide:true});
const credential=JSON.parse(stdout.trim());
if(!credential||typeof credential.client!=='string'||
   typeof credential.admin!=='string')
  throw Error('FINANCE_CREDENTIALS_UNAVAILABLE');

const ledger=openFinanceLedger(join(baseDir,'state','ledger.sqlite'));
const server=createFinanceServer({ledger,
  clientToken:credential.client,adminToken:credential.admin});
server.listen(47881,'127.0.0.1',()=>{
  console.log('FINANCE_LEDGER_LOCAL_READY_NO_SPEND');
});
for(const signal of ['SIGINT','SIGTERM']){
  process.on(signal,()=>server.close(()=>{ledger.close();process.exit(0)}));
}
