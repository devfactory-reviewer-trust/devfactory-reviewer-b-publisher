/**
 * Offline synthetic attempt-lifecycle replay only.
 * Not a durable journal, network dispatcher, provider acknowledgement or
 * idempotency authority. No OpenRouter API, secrets, DB or permission to pay.
 */
const MAX_BYTES=32768,MAX_EVENTS=200;
const ROOT=['coverage','events','schema'];
const FIELDS=['attempt_id','event_no','head_sha','kind','month_utc',
  'request_id','role'];
const KINDS=new Set(['reserved','dispatch_recorded','outcome_unknown',
  'settled_fixture','cancelled_before_dispatch']);
const ROLES=new Set(['development','reviewer_b']);
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const HEAD=/^[a-f0-9]{40}$/;
const MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;
const fail=(reason,extra={})=>Object.freeze({
  status:'BLOCKED',reason,syntheticOnly:true,verified:false,
  maySpend:false,mayReserve:false,mayRetryAmbiguousRequest:false,
  providerBillingAuthenticated:false,durableIdempotencyVerified:false,
  protectedDispatcherDeployed:false,...extra,
});
function exact(v,fields){
  return v!==null&&typeof v==='object'&&!Array.isArray(v)&&
    Object.keys(v).length===fields.length&&
    fields.every(k=>Object.hasOwn(v,k));
}
/**
 * Replay a fully untrusted, serialized fixture to expose forbidden
 * transitions. Requires a separate durable linearizable store, trusted
 * event provenance, request identity and crash recovery before production.
 */
export function auditSyntheticAttemptLifecycleOffline(input){
  if(process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY!=='1')
    return fail('SHADOW_ATTEMPT_SYNTHETIC_SWITCH_REQUIRED');
  if(typeof input!=='string'||Buffer.byteLength(input,'utf8')>MAX_BYTES)
    return fail('SHADOW_ATTEMPT_INPUT_UNTRUSTED');
  let s;
  try{s=JSON.parse(input)}catch{
    return fail('SHADOW_ATTEMPT_INPUT_UNTRUSTED');
  }
  if(!exact(s,ROOT)||s.schema!=='devfactory.shadow-attempt.synthetic.v1'||
     s.coverage!=='illustrative-only'||!Array.isArray(s.events)||
     s.events.length<1||s.events.length>MAX_EVENTS)
    return fail('SHADOW_ATTEMPT_INPUT_UNTRUSTED');
  const requests=new Map(),attemptIds=new Set();
  for(let i=0;i<s.events.length;i++){
    const e=s.events[i];
    if(!exact(e,FIELDS)||e.event_no!==i+1||
       typeof e.request_id!=='string'||!ID.test(e.request_id)||
       typeof e.attempt_id!=='string'||!ID.test(e.attempt_id)||
       typeof e.head_sha!=='string'||!HEAD.test(e.head_sha)||
       !ROLES.has(e.role)||typeof e.month_utc!=='string'||
       !MONTH.test(e.month_utc)||!KINDS.has(e.kind))
      return fail('SHADOW_ATTEMPT_EVENT_INVALID_OR_REORDERED');
    if(e.kind==='reserved'){
      if(requests.has(e.request_id)||attemptIds.has(e.attempt_id))
        return fail('SHADOW_ATTEMPT_DUPLICATE_RESERVATION_OR_ID');
      requests.set(e.request_id,{
        attempt_id:e.attempt_id,head_sha:e.head_sha,role:e.role,
        firstMonth:e.month_utc,lastMonth:e.month_utc,state:'reserved',
        dispatchCount:0,
      });
      attemptIds.add(e.attempt_id);
      continue;
    }
    const prior=requests.get(e.request_id);
    if(!prior)return fail('SHADOW_ATTEMPT_EVENT_WITHOUT_RESERVATION');
    if(prior.attempt_id!==e.attempt_id||prior.head_sha!==e.head_sha||
       prior.role!==e.role||e.month_utc<prior.lastMonth)
      return fail('SHADOW_ATTEMPT_IDENTITY_OR_TIME_CHANGED');
    prior.lastMonth=e.month_utc;
    if(e.kind==='dispatch_recorded'){
      // A prospective external call is permitted once in a hypothetical
      // protocol, but this fixture NEVER authorizes or performs that call.
      if(prior.state!=='reserved'||prior.dispatchCount!==0)
        return fail('SHADOW_ATTEMPT_REPLAY_OR_RETRY_FORBIDDEN');
      prior.dispatchCount++;
      prior.state='dispatch_recorded';
    }else if(e.kind==='outcome_unknown'){
      if(prior.state!=='dispatch_recorded')
        return fail('SHADOW_ATTEMPT_AMBIGUOUS_TRANSITION_INVALID');
      prior.state='outcome_unknown';
    }else if(e.kind==='settled_fixture'){
      if(!['dispatch_recorded','outcome_unknown'].includes(prior.state))
        return fail('SHADOW_ATTEMPT_SETTLEMENT_TRANSITION_INVALID');
      prior.state='settled_fixture';
    }else if(e.kind==='cancelled_before_dispatch'){
      if(prior.state!=='reserved')
        return fail('SHADOW_ATTEMPT_CANCEL_AFTER_DISPATCH_FORBIDDEN');
      prior.state='cancelled_before_dispatch';
    }
  }
  const states=Array.from(requests.values());
  const unknown=states.filter(x=>x.state==='outcome_unknown').length;
  const potentiallyDispatched=states.filter(x=>x.dispatchCount===1).length;
  return fail(unknown?'SHADOW_ATTEMPT_UNKNOWN_NO_RETRY':
    'SHADOW_ATTEMPT_NO_DURABLE_PROVIDER_PROOF',{
    simulatedRequestCount:requests.size,
    simulatedPotentiallyDispatched:potentiallyDispatched,
    simulatedUnknownCount:unknown,
    simulatedOpenReservations:states.filter(x=>x.state==='reserved').length,
    simulatedCancelledBeforeDispatch:states.filter(
      x=>x.state==='cancelled_before_dispatch').length,
  });
}
