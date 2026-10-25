import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openFinanceLedger} from '../service/finance-reservation-ledger.mjs';

const A='a'.repeat(40);
const B='b'.repeat(40);
function fixture(t, now=()=>new Date('2026-10-25T10:00:00.000Z')) {
  const dir=mkdtempSync(join(tmpdir(),'df-finance-ledger-'));
  return {file:join(dir,'finance.sqlite'),now,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
const request=(id,role='reviewer_b',usd=500000)=>({id,role,pr:940,head:A,upperUsdMicros:usd});

test('reservation is durable after close and reopen, with no spend authorization',t=>{
  const f=fixture(t);
  t.after(()=>f.cleanup());
  const first=openFinanceLedger(f.file,{now:f.now});
  assert.deepEqual(first.reserve(request('one')),{recorded:true,id:'one',idempotent:false,maySpend:false});
  assert.equal(first.status().reservedUsdMicros,500000);
  first.close();
  const restarted=openFinanceLedger(f.file,{now:f.now});
  assert.equal(restarted.status().reservedUsdMicros,500000);
  assert.equal(restarted.status().maySpend,false);
  restarted.close();
});

test('same ID same payload is idempotent; changed payload is refused',t=>{
  const f=fixture(t), ledger=openFinanceLedger(f.file,{now:f.now});
  t.after(()=>{ledger.close();f.cleanup()});
  ledger.reserve(request('same'));
  assert.equal(ledger.reserve(request('same')).idempotent,true);
  assert.equal(ledger.status().reservationCount,1);
  assert.throws(()=>ledger.reserve({...request('same'),head:B}),/RESERVATION_CONFLICT/);
});

test('two independent connections cannot overbook per-role 3 USD or shared 15 EUR',t=>{
  const f=fixture(t), a=openFinanceLedger(f.file,{now:f.now}),b=openFinanceLedger(f.file,{now:f.now});
  t.after(()=>{a.close();b.close();f.cleanup()});
  for(let i=0;i<6;i++) assert.equal((i%2?a:b).reserve(request('r'+i)).recorded,true);
  assert.throws(()=>b.reserve(request('r-extra')),/ROLE_CAP_EXCEEDED/);
  assert.equal(a.reserve(request('d1','development',1000000)).recorded,true);
  assert.equal(b.reserve(request('d2','development',1000000)).recorded,true);
  assert.throws(()=>a.reserve(request('d3','development',1000000)),/GLOBAL_CAP_EXCEEDED/);
  assert.equal(a.status().reservedEurMicros,15000000);
  assert.equal(a.status().reservationCount,8);
});

test('expenses form a durable conservative journal and cannot clear prior holds',t=>{
  const f=fixture(t), a=openFinanceLedger(f.file,{now:f.now});
  t.after(()=>f.cleanup());
  a.reserve(request('r1'));
  assert.deepEqual(a.recordCharge({eventId:'bill1',reservationId:'r1',amountUsdMicros:200000}),
    {recorded:true,eventId:'bill1',idempotent:false,maySpend:false});
  assert.equal(a.recordCharge({eventId:'bill1',reservationId:'r1',amountUsdMicros:200000}).idempotent,true);
  assert.throws(()=>a.recordCharge({eventId:'bill1',reservationId:'r1',amountUsdMicros:300000}),/CHARGE_CONFLICT/);
  assert.throws(()=>a.recordCharge({eventId:'bill2',reservationId:'unknown',amountUsdMicros:1000}),/UNKNOWN_RESERVATION/);
  assert.deepEqual([a.status().reservedEurMicros,a.status().chargedEurMicros],[1500000,600000]);
  a.close();
  const b=openFinanceLedger(f.file,{now:f.now});
  assert.equal(b.status().chargeCount,1);
  assert.equal(b.status().exposureEurMicros,2100000);
  assert.equal(b.status().maySpend,false);
  b.close();
});

test('monthly quotas do not erase prior months',t=>{
  let moment=new Date('2026-10-31T23:59:00.000Z');
  const f=fixture(t,()=>moment),a=openFinanceLedger(f.file,{now:f.now});
  t.after(()=>{a.close();f.cleanup()});
  a.reserve(request('oct'));
  moment=new Date('2026-11-01T00:01:00.000Z');
  assert.equal(a.status().reservationCount,0);
  assert.equal(a.reserve(request('nov')).recorded,true);
  assert.equal(a.status().reservationCount,1);
  moment=new Date('2026-10-31T23:59:00.000Z');
  assert.equal(a.status().reservationCount,1);
});

test('malformed data and unsafe path fail closed',t=>{
  const f=fixture(t),a=openFinanceLedger(f.file,{now:f.now});
  t.after(()=>{a.close();f.cleanup()});
  assert.throws(()=>a.reserve({...request('bad'),upperUsdMicros:1.5}),/INVALID_RESERVATION/);
  assert.throws(()=>a.reserve({...request('bad'),role:'admin'}),/INVALID_RESERVATION/);
  assert.throws(()=>a.reserve({...request('bad'),head:'not-sha'}),/INVALID_RESERVATION/);
  assert.throws(()=>a.reserve({...request('bad'),extra:true}),/INVALID_RESERVATION/);
  assert.throws(()=>a.recordCharge({eventId:'b',reservationId:'none',amountUsdMicros:-1}),/INVALID_CHARGE/);
});
