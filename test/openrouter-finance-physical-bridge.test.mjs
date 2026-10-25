import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {openFinanceLedger} from '../service/finance-reservation-ledger.mjs';
import {createFinanceServer} from '../service/finance-reservation-server.mjs';
import {buildOpenRouterPhysicalFinanceHold,
  bindOpenCodeAttemptToFinanceContext,
  recordOpenRouterPhysicalFinanceHoldNoSpend}
  from '../service/openrouter-physical-finance-client.mjs';

const CLIENT='c'.repeat(48),ADMIN='a'.repeat(48);
const ENDPOINT='http://127.0.0.1:47881/v1/physical-attempts';
const call=Object.freeze({
  role:'developer',pr:952,head:'f'.repeat(40),
  upperUsdMicros:100000,requestBodySha256:'b'.repeat(64),
  model:'deepseek/deepseek-v4.1-flash-20261017',
  runId:'test-run-01',attemptId:'test-attempt-01',
});
async function fixture(t){
  const dir=mkdtempSync(join(tmpdir(),'df-bridge-'));
  const ledger=openFinanceLedger(join(dir,'ledger.sqlite'));
  const service=createFinanceServer({ledger,clientToken:CLIENT,adminToken:ADMIN});
  service.listen(0,'127.0.0.1');
  await once(service,'listening');
  t.after(async()=>{
    await new Promise(done=>service.close(done));
    ledger.close();rmSync(dir,{recursive:true,force:true,maxRetries:3,retryDelay:50});
  });
  let count=0,identityChecked=true,onlyPost=true;
  const fetchImpl=async(url,options)=>{
    count++;
    if(url!==ENDPOINT)identityChecked=false;
    if(options.method!=='POST'||options.redirect!=='error')onlyPost=false;
    const real=await fetch('http://127.0.0.1:'+service.address().port+
      '/v1/physical-attempts',options);
    // A test fixture authenticates the request and simulates the fixed URL's
    // response identity. Production has NO such URL override.
    Object.defineProperty(real,'url',{value:ENDPOINT});
    return real;
  };
  return {ledger,fetchImpl,count:()=>count,
    verified:()=>identityChecked&&onlyPost};
}

test('exact hook descriptor becomes a deterministic single physical finance hold',()=>{
  const a=buildOpenRouterPhysicalFinanceHold(call);
  const b=buildOpenRouterPhysicalFinanceHold({...call});
  assert.deepEqual(a,b);
  assert.match(a.id,/^phys-[a-f0-9]{64}$/);
  assert.equal(a.role,'development');
  assert.equal(Object.hasOwn(a,'messages'),false);
  assert.equal(Object.hasOwn(a,'apiKey'),false);
  assert.notEqual(buildOpenRouterPhysicalFinanceHold({
    ...call,attemptId:'test-attempt-02'}).id,a.id);
  assert.equal(buildOpenRouterPhysicalFinanceHold({
    ...call,role:'unknown'}),null);
  assert.equal(buildOpenRouterPhysicalFinanceHold({
    ...call,model:'foreign-model'}),null);
});

test('real OpenCode V2 hook metadata binds to immutable PR/LOT identity without prompt',()=>{
  const hook={
    schemaVersion:1,role:'developer',
    sessionId:'session-mock-001',
    modelId:'deepseek/deepseek-v4.1-flash-20261017',
    attempt:2,requestBodySha256:'b'.repeat(64),atMs:1761402000000,
  };
  const context={pr:952,head:'f'.repeat(40),
    runId:'run-001',upperUsdMicros:100000};
  const descriptor=bindOpenCodeAttemptToFinanceContext({hook,context});
  assert.equal(descriptor?.role,'developer');
  assert.equal(descriptor.model,hook.modelId);
  assert.equal(descriptor.requestBodySha256,hook.requestBodySha256);
  assert.match(descriptor.attemptId,/^call-2-[a-f0-9]{24}$/);
  assert.deepEqual(descriptor,bindOpenCodeAttemptToFinanceContext({hook,context}));
  assert.equal(buildOpenRouterPhysicalFinanceHold(descriptor)?.role,'development');
  assert.equal(bindOpenCodeAttemptToFinanceContext({
    hook:{...hook,role:'reviewer-b'},context}),null);
  assert.equal(bindOpenCodeAttemptToFinanceContext({
    hook:{...hook,requestBodySha256:'invalid'},context}),null);
  assert.equal(bindOpenCodeAttemptToFinanceContext({
    hook:{...hook,messages:['secret']},context}),null);
});

test('real isolated loopback finance server records hold but cannot grant paid POST',async t=>{
  const f=await fixture(t);
  const result=await recordOpenRouterPhysicalFinanceHoldNoSpend({
    descriptor:call,clientToken:CLIENT,fetchImpl:f.fetchImpl,
  });
  assert.equal(result.ok,true);
  assert.equal(result.financeHoldRecorded,true);
  assert.equal(result.maySpend,false);
  assert.equal(result.providerDispatchAuthorized,false);
  assert.equal(result.independentAuthorityVerified,false);
  assert.equal(result.retryAllowed,false);
  assert.equal(f.verified(),true);
  assert.equal(f.count(),1);
  assert.equal(f.ledger.status().reservationCount,1);
  const replay=await recordOpenRouterPhysicalFinanceHoldNoSpend({
    descriptor:call,clientToken:CLIENT,fetchImpl:f.fetchImpl,
  });
  assert.equal(replay.ok,false);
  assert.match(replay.reason,/REPLAYED_NO_RETRY/);
  assert.equal(f.count(),2);
  assert.equal(f.ledger.status().reservationCount,1);
  const sameAttemptNewBody=await recordOpenRouterPhysicalFinanceHoldNoSpend({
    descriptor:{...call,requestBodySha256:'c'.repeat(64)},
    clientToken:CLIENT,fetchImpl:f.fetchImpl,
  });
  assert.equal(sameAttemptNewBody.ok,false);
  assert.equal(f.ledger.status().reservationCount,1);
});

test('wrong bearer, network failure, forged approval, or malformed input never authorizes spend',async t=>{
  const f=await fixture(t);
  const noKey=await recordOpenRouterPhysicalFinanceHoldNoSpend({
    descriptor:call,clientToken:'invalid',fetchImpl:f.fetchImpl,
  });
  assert.equal(noKey.ok,false);
  assert.equal(f.count(),0);
  const wrong=await recordOpenRouterPhysicalFinanceHoldNoSpend({
    descriptor:call,clientToken:ADMIN,fetchImpl:f.fetchImpl,
  });
  assert.equal(wrong.ok,false);
  assert.equal(wrong.maySpend,false);
  assert.equal(f.ledger.status().reservationCount,0);
  let sent=0;
  const broken=await recordOpenRouterPhysicalFinanceHoldNoSpend({
    descriptor:call,clientToken:CLIENT,
    fetchImpl:async()=>{sent++;throw Error('timeout');},
  });
  assert.equal(sent,1);
  assert.equal(broken.ok,false);
  assert.match(broken.reason,/NO_RETRY/);
  const fake=await recordOpenRouterPhysicalFinanceHoldNoSpend({
    descriptor:call,clientToken:CLIENT,
    fetchImpl:async(url)=>{
      const res=new Response(JSON.stringify({recorded:true,
        id:buildOpenRouterPhysicalFinanceHold(call).id,
        physicalAttemptRecorded:true,mayReserveForPaidRun:false,
        maySpend:true}),{status:201});
      Object.defineProperty(res,'url',{value:url});
      return res;
    },
  });
  assert.equal(fake.ok,false);
  assert.equal(fake.maySpend,false);
  assert.equal(f.ledger.status().reservationCount,0);
});
