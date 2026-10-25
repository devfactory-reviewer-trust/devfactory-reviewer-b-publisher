import {createHash} from 'node:crypto';

// Non-authorizing bridge between a physical OpenRouter POST descriptor and
// the separate Windows finance service. This never returns a paid permit:
// authenticated durable accounting is necessary, but NOT sufficient, for
// protected provider dispatch. Production additionally needs the LocalService
// task, independently signed clearance and a network-enforced dispatch gate.
const ENDPOINT='http://127.0.0.1:47881/v1/physical-attempts';
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;
const SHA40=/^[a-f0-9]{40}$/;
const SHA64=/^[a-f0-9]{64}$/;
const TOKEN=/^[A-Za-z0-9._-]{32,256}$/;
const MODELS=Object.freeze({
  developer:['deepseek/deepseek-v4.1-flash-1017',
    'deepseek/deepseek-v4.1-flash-20261017'],
  'reviewer-b':['qwen/qwen3-coder-30b-a3b-instruct'],
});
const KEYS=['role','pr','head','upperUsdMicros','requestBodySha256',
  'model','runId','attemptId'];
const denial=reason=>Object.freeze({
  ok:false,reason,financeHoldRecorded:false,mayStart:false,
  maySpend:false,mayMerge:false,retryAllowed:false,
  independentAuthorityVerified:false,
  providerDispatchAuthorized:false,
});
const exact=(v,keys)=>v!==null&&typeof v==='object'&&
  !Array.isArray(v)&&Object.keys(v).length===keys.length&&
  keys.every(k=>Object.hasOwn(v,k));

// Converts the exact metadata exposed by the OpenCode V2 HTTP hook into
// a stable ledger identity. The trusted LOT/PR context must originate from
// the controller, never from generated code or the prompt. No contents of
// the request body, provider API key, or original prompt cross this boundary.
export function bindOpenCodeAttemptToFinanceContext({hook,context}={}){
  const hookKeys=['schemaVersion','role','sessionId','modelId','attempt',
    'requestBodySha256','atMs'];
  const contextKeys=['pr','head','runId','upperUsdMicros'];
  if(!exact(hook,hookKeys)||!exact(context,contextKeys)||
     hook.schemaVersion!==1||hook.role!=='developer'||
     !ID.test(hook.sessionId||'')||
     !Number.isSafeInteger(hook.attempt)||hook.attempt<1||
     !Number.isSafeInteger(hook.atMs)||hook.atMs<=0||
     !SHA64.test(hook.requestBodySha256||'')||
     !MODELS.developer.includes(hook.modelId)||
     !ID.test(context.runId||''))
    return null;
  const suffix=createHash('sha256').update(hook.sessionId).digest('hex')
    .slice(0,24);
  const attemptId='call-'+hook.attempt+'-'+suffix;
  return Object.freeze({
    role:'developer',pr:context.pr,head:context.head,
    upperUsdMicros:context.upperUsdMicros,
    requestBodySha256:hook.requestBodySha256,
    model:hook.modelId,runId:context.runId,attemptId,
  });
}

export function buildOpenRouterPhysicalFinanceHold(descriptor){
  if(!exact(descriptor,KEYS)||!Object.hasOwn(MODELS,descriptor.role)||
     !MODELS[descriptor.role].includes(descriptor.model)||
     !Number.isSafeInteger(descriptor.pr)||descriptor.pr<1||
     descriptor.pr>9_999_999||!SHA40.test(descriptor.head)||
     !SHA64.test(descriptor.requestBodySha256)||
     typeof descriptor.runId!=='string'||!ID.test(descriptor.runId)||
     typeof descriptor.attemptId!=='string'||!ID.test(descriptor.attemptId)||
     !Number.isSafeInteger(descriptor.upperUsdMicros)||
     descriptor.upperUsdMicros<1||
     descriptor.upperUsdMicros>(descriptor.role==='developer'?1_000_000:500_000))
    return null;
  const ordered=Object.fromEntries(KEYS.map(k=>[k,descriptor[k]]));
  const id='phys-'+createHash('sha256').update(
    'DEVFACTORY_PHYSICAL_CALL_V1\n'+JSON.stringify(ordered))
    .digest('hex');
  return Object.freeze({
    id,role:descriptor.role==='developer'?'development':'reviewer_b',
    pr:descriptor.pr,head:descriptor.head,
    upperUsdMicros:descriptor.upperUsdMicros,
    requestBodySha256:descriptor.requestBodySha256,
    model:descriptor.model,runId:descriptor.runId,
    attemptId:descriptor.attemptId,
  });
}

async function safeResponse(res){
  if(res?.status!==201||res.ok!==true||res.redirected!==false||
     res.url!==ENDPOINT)return null;
  const length=res.headers?.get?.('content-length');
  if(length!=null&&(!/^(0|[1-9][0-9]*)$/.test(length)||Number(length)>2048))
    return null;
  let raw;
  try{
    const reader=res.body?.getReader?.();
    if(!reader)return null;
    const chunks=[];
    let bytes=0,done=false;
    try{
      for(;;){
        const part=await reader.read();
        if(part.done){done=true;break;}
        if(!(part.value instanceof Uint8Array))return null;
        bytes+=part.value.byteLength;
        if(bytes>2048)return null;
        chunks.push(Buffer.from(part.value));
      }
      raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes));
    }finally{
      if(!done)try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}
      try{reader.releaseLock()}catch{}
    }
  }catch{return null;}
  try{return JSON.parse(raw);}catch{return null;}
}

/**
 * Physical-hold endpoint is fixed; no caller-supplied URL/port or redirect.
 * Only a privileged, independently authenticated component should hold the
 * client token. An ordinary Runner must never obtain that credential.
 *
 * A successful ledger record is NOT permission to send a paid provider POST.
 * This client is deliberately one-shot: timeout, connection loss, 409 replay,
 * unknown response, and restart do not trigger an automatic retry.
 */
export async function recordOpenRouterPhysicalFinanceHoldNoSpend({
  descriptor,clientToken,fetchImpl=fetch,timeoutMs=5000,...unexpected
}={}){
  if(Object.keys(unexpected).length!==0)return denial('BRIDGE_INPUT_UNTRUSTED');
  const hold=buildOpenRouterPhysicalFinanceHold(descriptor);
  if(!hold||typeof clientToken!=='string'||!TOKEN.test(clientToken)||
     typeof fetchImpl!=='function'||!Number.isSafeInteger(timeoutMs)||
     timeoutMs<1000||timeoutMs>5000)
    return denial('BRIDGE_INPUT_INVALID');
  let response;
  try{
    response=await fetchImpl(ENDPOINT,{
      method:'POST',redirect:'error',cache:'no-store',
      signal:AbortSignal.timeout(timeoutMs),
      headers:{Authorization:'Bearer '+clientToken,
        Accept:'application/json','Content-Type':'application/json'},
      body:JSON.stringify(hold),
    });
  }catch{return denial('FINANCE_HOLD_OUTCOME_UNKNOWN_NO_RETRY');}
  const receipt=await safeResponse(response);
  if(!receipt||!exact(receipt,['recorded','id',
      'physicalAttemptRecorded','mayReserveForPaidRun','maySpend'])||
     receipt.recorded!==true||receipt.id!==hold.id||
     receipt.physicalAttemptRecorded!==true||
     receipt.mayReserveForPaidRun!==false||receipt.maySpend!==false)
    return denial('FINANCE_HOLD_UNVERIFIED_OR_REPLAYED_NO_RETRY');
  return Object.freeze({
    ok:true,status:'DURABLE_ACCOUNTING_HOLD_ONLY_NO_PAID_DISPATCH',
    financeHoldRecorded:true,reservationId:hold.id,
    mayStart:false,maySpend:false,mayMerge:false,retryAllowed:false,
    independentAuthorityVerified:false,providerDispatchAuthorized:false,
  });
}
