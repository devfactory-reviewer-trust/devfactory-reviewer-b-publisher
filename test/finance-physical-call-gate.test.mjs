import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {openFinanceLedger} from '../service/finance-reservation-ledger.mjs';
import {createFinanceServer} from '../service/finance-reservation-server.mjs';

const CLIENT='c'.repeat(48),ADMIN='a'.repeat(48);
const HEAD='e'.repeat(40);
const attempt=(id='call-001',runId='run-01',attemptId='attempt-01')=>({
  id,role:'development',pr:952,head:HEAD,upperUsdMicros:100000,
  requestBodySha256:'b'.repeat(64),
  model:'deepseek/deepseek-v4.1-flash-1017',runId,attemptId,
});
function ledgerFixture(){
  const dir=mkdtempSync(join(tmpdir(),'df-physical-'));
  return {db:join(dir,'ledger.sqlite'),
    cleanup:()=>rmSync(dir,{recursive:true,force:true,maxRetries:3,retryDelay:50})};
}

test('one physical attempt is a durable, one-use reservation, not spend permission',t=>{
  const {db,cleanup}=ledgerFixture(),a=openFinanceLedger(db);
  t.after(cleanup);
  const first=a.reservePhysicalAttempt(attempt());
  assert.deepEqual(first,{recorded:true,id:'call-001',
    physicalAttemptRecorded:true,mayReserveForPaidRun:false,maySpend:false});
  assert.throws(()=>a.reservePhysicalAttempt(attempt()),
    /PHYSICAL_ATTEMPT_ALREADY_RECORDED/);
  assert.throws(()=>a.reservePhysicalAttempt(attempt('altered-id')),
    /PHYSICAL_ATTEMPT_ALREADY_RECORDED/);
  assert.equal(a.status().reservedUsdMicros,100000);
  assert.equal(a.status().reservationCount,1);
  a.close();
  const restarted=openFinanceLedger(db);
  assert.throws(()=>restarted.reservePhysicalAttempt(attempt()),
    /PHYSICAL_ATTEMPT_ALREADY_RECORDED/);
  assert.throws(()=>restarted.reservePhysicalAttempt(
    {...attempt('other-id'),requestBodySha256:'c'.repeat(64)}),
    /PHYSICAL_ATTEMPT_ALREADY_RECORDED/);
  assert.equal(restarted.status().reservationCount,1);
  assert.equal(restarted.status().mayReserveForPaidRun,false);
  restarted.close();
});

test('race, mismatched role/model and replay never double-book',t=>{
  const {db,cleanup}=ledgerFixture(),a=openFinanceLedger(db),b=openFinanceLedger(db);
  t.after(()=>{a.close();b.close();cleanup()});
  assert.throws(()=>a.reservePhysicalAttempt({...attempt(),model:'not-allowed'}),
    /INVALID_PHYSICAL_ATTEMPT/);
  assert.throws(()=>a.reservePhysicalAttempt({...attempt(),role:'reviewer_b'}),
    /INVALID_PHYSICAL_ATTEMPT/);
  a.reservePhysicalAttempt(attempt());
  assert.throws(()=>b.reservePhysicalAttempt(attempt('call-002')),
    /PHYSICAL_ATTEMPT_ALREADY_RECORDED/);
  assert.throws(()=>b.reservePhysicalAttempt(attempt('call-001','different-run','next')),
    /PHYSICAL_ATTEMPT_ALREADY_RECORDED/);
  assert.equal(b.status().reservationCount,1);
  assert.equal(b.status().reservedUsdMicros,100000);
});

test('one recorded charge per physical reservation, bound to upper cost',t=>{
  const {db,cleanup}=ledgerFixture(),a=openFinanceLedger(db);
  t.after(()=>{a.close();cleanup()});
  a.reservePhysicalAttempt(attempt());
  const charge={eventId:'bill-001',reservationId:'call-001',amountUsdMicros:40000};
  assert.throws(()=>a.recordCharge({...charge,amountUsdMicros:100001}),
    /CHARGE_EXCEEDS_RESERVATION/);
  assert.equal(a.recordCharge(charge).recorded,true);
  assert.equal(a.recordCharge(charge).idempotent,true);
  assert.throws(()=>a.recordCharge({...charge,eventId:'bill-002'}),
    /RESERVATION_ALREADY_CHARGED/);
  assert.throws(()=>a.recordCharge({...charge,amountUsdMicros:50000}),
    /CHARGE_CONFLICT/);
  assert.equal(a.status().chargeCount,1);
  assert.equal(a.status().chargedUsdMicros,40000);
  assert.equal(a.status().maySpend,false);
});

test('authenticated API refuses duplicated physical calls and forged receipts',async t=>{
  const {db,cleanup}=ledgerFixture(),ledger=openFinanceLedger(db);
  const server=createFinanceServer({ledger,clientToken:CLIENT,adminToken:ADMIN});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));ledger.close();cleanup()});
  const base='http://127.0.0.1:'+server.address().port;
  const post=(payload,token=CLIENT)=>fetch(base+'/v1/physical-attempts',{
    method:'POST',headers:{'content-type':'application/json',
      authorization:'Bearer '+token},
    body:JSON.stringify(payload),signal:AbortSignal.timeout(5000),
  });
  assert.equal((await post(attempt(),ADMIN)).status,403);
  const results=await Promise.all([post(attempt()),post(attempt('call-two'))]);
  const statuses=results.map(r=>r.status).sort();
  assert.deepEqual(statuses,[201,409]);
  const first=await results.find(r=>r.status===201)?.json().catch(()=>null);
  assert.equal(first?.maySpend,false);
  assert.equal(first?.mayReserveForPaidRun,false);
  assert.equal((await post(attempt())).status,409);
  assert.equal(ledger.status().reservationCount,1);
  assert.equal(ledger.status().maySpend,false);
});
