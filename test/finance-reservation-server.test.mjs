import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {openFinanceLedger} from '../service/finance-reservation-ledger.mjs';
import {createFinanceServer} from '../service/finance-reservation-server.mjs';

const CLIENT='c'.repeat(44);
const ADMIN='d'.repeat(44);
const HEAD='e'.repeat(40);
async function fixture(t){
  const dir=mkdtempSync(join(tmpdir(),'df-finance-server-'));
  const ledger=openFinanceLedger(join(dir,'db.sqlite'),{now:()=>new Date('2026-10-25T12:00:00Z')});
  const server=createFinanceServer({ledger,clientToken:CLIENT,adminToken:ADMIN});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(async()=>{
    await new Promise(resolve=>server.close(resolve));
    ledger.close();
    rmSync(dir,{recursive:true,force:true});
  });
  const url='http://127.0.0.1:'+server.address().port;
  const request=(path,{method='GET',token,body,headers={}}={})=>fetch(url+path,{
    method,
    headers:{...headers,...(token?{authorization:'Bearer '+token}:{}),
      ...(body!==undefined?{'content-type':'application/json'}:{})},
    ...(body!==undefined?{body:JSON.stringify(body)}:{}),
  });
  return {request};
}
const reserve=(id='r1')=>({id,role:'reviewer_b',pr:940,head:HEAD,upperUsdMicros:500000});

test('health reveals no secrets and all responses refuse paid inference',async t=>{
  const {request}=await fixture(t);
  const res=await request('/health');
  assert.equal(res.status,200);
  const json=await res.json();
  assert.deepEqual(json,{status:'ok',maySpend:false});
  assert.equal(JSON.stringify(json).includes(CLIENT),false);
});

test('client can reserve idempotently; no or wrong credential is rejected',async t=>{
  const {request}=await fixture(t);
  const unauth=await request('/v1/reservations',{method:'POST',body:reserve()});
  assert.equal(unauth.status,401);
  const forbidden=await request('/v1/reservations',{method:'POST',token:ADMIN,body:reserve()});
  assert.equal(forbidden.status,403);
  const created=await request('/v1/reservations',{method:'POST',token:CLIENT,body:reserve()});
  assert.equal(created.status,201);
  const record=await created.json();
  assert.equal(record.maySpend,false);
  assert.equal(record.recorded,true);
  const duplicate=await request('/v1/reservations',{method:'POST',token:CLIENT,body:reserve()});
  assert.equal(duplicate.status,200);
  assert.equal((await duplicate.json()).idempotent,true);
  const status=await request('/v1/status',{token:CLIENT});
  assert.equal(status.status,200);
  const totals=await status.json();
  assert.equal(totals.reservationCount,1);
  assert.equal(totals.maySpend,false);
  assert.equal(totals.mayReserveForPaidRun,false);
});

test('separate admin may record a charge but a client may not',async t=>{
  const {request}=await fixture(t);
  await request('/v1/reservations',{method:'POST',token:CLIENT,body:reserve()});
  const charge={eventId:'bill1',reservationId:'r1',amountUsdMicros:125000};
  const rejected=await request('/v1/charges',{method:'POST',token:CLIENT,body:charge});
  assert.equal(rejected.status,403);
  const accepted=await request('/v1/charges',{method:'POST',token:ADMIN,body:charge});
  assert.equal(accepted.status,201);
  assert.equal((await accepted.json()).maySpend,false);
  const status=await request('/v1/status',{token:ADMIN});
  assert.equal((await status.json()).chargeCount,1);
});

test('unsupported method, conflicting ID, and malformed or huge JSON fail closed',async t=>{
  const {request}=await fixture(t);
  assert.equal((await request('/v1/reservations',{method:'GET',token:CLIENT})).status,405);
  assert.equal((await request('/not-a-route',{token:CLIENT})).status,404);
  await request('/v1/reservations',{method:'POST',token:CLIENT,body:reserve()});
  const conflict=await request('/v1/reservations',{method:'POST',token:CLIENT,body:{...reserve(),head:'f'.repeat(40)}});
  assert.equal(conflict.status,409);
  const extra=await request('/v1/reservations',{method:'POST',token:CLIENT,body:{...reserve('extra'),admin:true}});
  assert.equal(extra.status,400);
  const huge=await request('/v1/reservations',{method:'POST',token:CLIENT,
    body:{...reserve('big'),padding:'x'.repeat(9000)}});
  assert.equal(huge.status,413);
});

test('service refuses weak or shared credentials before listening',t=>{
  const dir=mkdtempSync(join(tmpdir(),'df-finance-auth-'));
  const ledger=openFinanceLedger(join(dir,'db.sqlite'));
  t.after(()=>{ledger.close();rmSync(dir,{recursive:true,force:true})});
  assert.throws(()=>createFinanceServer({ledger,clientToken:'short',adminToken:ADMIN}),/TOKEN_POLICY_INVALID/);
  assert.throws(()=>createFinanceServer({ledger,clientToken:CLIENT,adminToken:CLIENT}),/TOKEN_POLICY_INVALID/);
});
