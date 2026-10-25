import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {createServer as createTcpServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';

const executable=fileURLToPath(new URL('../service/finance-reservation-server.mjs',import.meta.url));
async function availablePort(){
  const probe=createTcpServer();
  probe.listen(0,'127.0.0.1');
  await once(probe,'listening');
  const port=probe.address().port;
  await new Promise(resolve=>probe.close(resolve));
  return port;
}
async function launch({db,port,client,admin}){
  const child=spawn(process.execPath,[executable],{
    windowsHide:true,stdio:['ignore','pipe','pipe'],
    env:{...process.env,DF_FINANCE_DB:db,DF_FINANCE_PORT:String(port),
      DF_FINANCE_CLIENT_TOKEN:client,DF_FINANCE_ADMIN_TOKEN:admin},
  });
  let errorOutput='';
  child.stderr.on('data',chunk=>{errorOutput+=String(chunk).slice(0,1024)});
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('CHILD_START_TIMEOUT: '+errorOutput)),8000);
    const done=(err)=>{
      clearTimeout(timeout);
      child.stdout.off('data',onData);
      child.off('exit',onExit);
      child.off('error',onError);
      err?reject(err):resolve();
    };
    const onData=data=>{
      if(String(data).includes('FINANCE_LEDGER_LOCAL_READY_NO_SPEND'))done();
    };
    const onExit=(code)=>done(Error('CHILD_EXITED_BEFORE_READY '+code+' '+errorOutput));
    const onError=err=>done(err);
    child.stdout.on('data',onData);
    child.once('exit',onExit);
    child.once('error',onError);
  });
  return child;
}
async function stop(child){
  if(child.exitCode!==null||child.signalCode!==null)return;
  const exited=once(child,'exit');
  child.kill('SIGKILL');
  await exited;
}
test('separate CLI process recovers persistent ledger after restart and never authorizes spend',
  {timeout:30000},async t=>{
    const dir=mkdtempSync(join(tmpdir(),'df-finance-child-'));
    const db=join(dir,'finance.sqlite');
    const client=randomBytes(32).toString('hex');
    const admin=randomBytes(32).toString('hex');
    const port=await availablePort();
    const children=[];
    t.after(async()=>{
      for(const child of children)await stop(child);
      rmSync(dir,{recursive:true,force:true});
    });
    const request=(path,{method='GET',token=client,payload}={})=>fetch('http://127.0.0.1:'+port+path,{
      method,signal:AbortSignal.timeout(5000),
      headers:{authorization:'Bearer '+token,...(payload?{'content-type':'application/json'}:{})},
      ...(payload?{body:JSON.stringify(payload)}:{}),
    });

    const first=await launch({db,port,client,admin});
    children.push(first);
    const health=await fetch('http://127.0.0.1:'+port+'/health',{signal:AbortSignal.timeout(5000)});
    assert.deepEqual(await health.json(),{status:'ok',maySpend:false});
    const created=await request('/v1/reservations',{
      method:'POST',payload:{id:'reboot-test',role:'reviewer_b',pr:940,
        head:'a'.repeat(40),upperUsdMicros:100000},
    });
    assert.equal(created.status,201);
    assert.equal((await created.json()).maySpend,false);
    await stop(first);

    const second=await launch({db,port,client,admin});
    children.push(second);
    const resumed=await request('/v1/status');
    assert.equal(resumed.status,200);
    const state=await resumed.json();
    assert.equal(state.reservationCount,1);
    assert.equal(state.reservedUsdMicros,100000);
    assert.equal(state.mayReserveForPaidRun,false);
    assert.equal(state.maySpend,false);
    const settled=await request('/v1/charges',{method:'POST',token:admin,
      payload:{eventId:'reboot-charge',reservationId:'reboot-test',amountUsdMicros:25000}});
    assert.equal(settled.status,201);
    assert.equal((await settled.json()).maySpend,false);
    assert.equal((await (await request('/v1/status')).json()).chargeCount,1);
  });

test('killed finance server cannot enable replayed physical calls or double settlement',
  {timeout:30000},async t=>{
    const dir=mkdtempSync(join(tmpdir(),'df-finance-physical-crash-'));
    const db=join(dir,'finance.sqlite');
    const client=randomBytes(32).toString('hex');
    const admin=randomBytes(32).toString('hex');
    const port=await availablePort();
    const children=[];
    t.after(async()=>{
      for(const child of children)await stop(child);
      rmSync(dir,{recursive:true,force:true,maxRetries:3,retryDelay:50});
    });
    const request=(path,{token=client,payload}={})=>fetch('http://127.0.0.1:'+port+path,{
      method:'POST',signal:AbortSignal.timeout(5000),
      headers:{authorization:'Bearer '+token,'content-type':'application/json'},
      body:JSON.stringify(payload),
    });
    const physical={
      id:'durable-run-001',role:'development',pr:952,
      head:'b'.repeat(40),upperUsdMicros:100000,
      requestBodySha256:'f'.repeat(64),
      model:'deepseek/deepseek-v4.1-flash-1017',
      runId:'run-crash-001',attemptId:'attempt-crash-001',
    };
    const original=await launch({db,port,client,admin});
    children.push(original);
    const first=await request('/v1/physical-attempts',{payload:physical});
    assert.equal(first.status,201);
    // Simulate a response lost before it is processed by an agent.
    await stop(original);
    const restarted=await launch({db,port,client,admin});
    children.push(restarted);
    const replay=await request('/v1/physical-attempts',{payload:physical});
    assert.equal(replay.status,409);
    assert.equal((await replay.json()).error,'PHYSICAL_ATTEMPT_ALREADY_RECORDED');
    const changedId=await request('/v1/physical-attempts',{
      payload:{...physical,id:'changed-id'},
    });
    assert.equal(changedId.status,409);
    const over=await request('/v1/charges',{token:admin,
      payload:{eventId:'overcharge',reservationId:physical.id,
        amountUsdMicros:100001},
    });
    assert.equal(over.status,409);
    const charge={eventId:'one-charge',reservationId:physical.id,
      amountUsdMicros:40000};
    assert.equal((await request('/v1/charges',{token:admin,payload:charge})).status,201);
    assert.equal((await request('/v1/charges',{token:admin,payload:charge})).status,200);
    assert.equal((await request('/v1/charges',{token:admin,
      payload:{...charge,eventId:'second-charge'}})).status,409);
    const state=await fetch('http://127.0.0.1:'+port+'/v1/status',{
      headers:{authorization:'Bearer '+client},signal:AbortSignal.timeout(5000),
    }).then(r=>r.json());
    assert.equal(state.reservationCount,1);
    assert.equal(state.chargeCount,1);
    assert.equal(state.reservedUsdMicros,100000);
    assert.equal(state.chargedUsdMicros,40000);
    assert.equal(state.mayReserveForPaidRun,false);
    assert.equal(state.maySpend,false);
  });
