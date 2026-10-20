/**
 * OFFLINE SYNTHETIC ONLY: reconcile mock request intentions with mock billing
 * lines across UTC months. No OpenRouter API, network, credentials, database,
 * invoice authenticity, user consent, spending authority or automatic retry.
 */
const MAX_BYTES=32768;
const MAX_ROWS=200;
const MAX_SAFE=BigInt(Number.MAX_SAFE_INTEGER);
const ROOT=['schema','coverage','as_of_month_utc','watermark','intents','charges'];
const INTENT=['request_id','key_role','initiated_month_utc','state','held_micro_usd'];
const CHARGE=['charge_id','request_id','billed_month_utc','amount_micro_usd'];
const ROLES=new Set(['development','reviewer_b']);
const STATES=new Set(['settled','pending','ambiguous']);
const denial=(reason,extra={})=>Object.freeze({
  status:'BLOCKED',reason,syntheticOnly:true,verified:false,
  maySpend:false,mayReserve:false,mayRetryAmbiguousRequest:false,
  providerBillingAuthenticated:false,accountCoverageAuthenticated:false,
  fxAuthenticated:false,...extra,
});
const keys=(v,expected)=>v!==null&&typeof v==='object'&&
  !Array.isArray(v)&&Object.keys(v).length===expected.length&&
  expected.every(key=>Object.hasOwn(v,key));
const month=v=>typeof v==='string'&&
  /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const ident=v=>typeof v==='string'&&
  /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/.test(v);
const amount=v=>typeof v==='string'&&
  /^(0|[1-9]\d{0,14})$/.test(v);

/**
 * A pure accounting stress test, NOT a real reconciliation.
 * Already charged + still held liabilities are deliberately both counted.
 * Carries ambiguous holds forward across month boundaries without release.
 */
export function assessSyntheticProviderReconciliationOffline(snapshotJson){
  if(process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY!=='1')
    return denial('SHADOW_RECON_SYNTHETIC_SWITCH_REQUIRED');
  if(typeof snapshotJson!=='string'||
     Buffer.byteLength(snapshotJson,'utf8')>MAX_BYTES)
    return denial('SHADOW_RECON_INPUT_UNTRUSTED');
  let s;
  try{s=JSON.parse(snapshotJson)}catch{
    return denial('SHADOW_RECON_INPUT_UNTRUSTED');
  }
  if(!keys(s,ROOT)||
     s.schema!=='devfactory.shadow-reconciliation.synthetic.v1'||
     s.coverage!=='illustrative-only'||
     s.watermark!=='unverified-fixture'||
     !month(s.as_of_month_utc)||
     !Array.isArray(s.intents)||s.intents.length<1||
     s.intents.length>MAX_ROWS||
     !Array.isArray(s.charges)||s.charges.length>MAX_ROWS)
    return denial('SHADOW_RECON_INPUT_UNTRUSTED');
  const intents=new Map(),ids=new Set();
  for(const item of s.intents){
    if(!keys(item,INTENT)||!ident(item.request_id)||
       ids.has(item.request_id)||!ROLES.has(item.key_role)||
       !STATES.has(item.state)||!month(item.initiated_month_utc)||
       item.initiated_month_utc>s.as_of_month_utc||
       !amount(item.held_micro_usd))
      return denial('SHADOW_RECON_INTENT_INVALID_OR_DUPLICATE');
    if(item.state==='settled'&&item.held_micro_usd!=='0')
      return denial('SHADOW_RECON_SETTLED_STILL_HELD');
    if(item.state!=='settled'&&item.held_micro_usd==='0')
      return denial('SHADOW_RECON_UNKNOWN_OUTCOME_WITHOUT_HOLD');
    ids.add(item.request_id);
    intents.set(item.request_id,{...item,billed:0n,chargeCount:0});
  }
  let billed=0n;
  const chargeIds=new Set();
  for(const line of s.charges){
    if(!keys(line,CHARGE)||!ident(line.charge_id)||
       chargeIds.has(line.charge_id)||!ident(line.request_id)||
       !month(line.billed_month_utc)||
       line.billed_month_utc>s.as_of_month_utc||
       !amount(line.amount_micro_usd)||line.amount_micro_usd==='0')
      return denial('SHADOW_RECON_CHARGE_INVALID_OR_DUPLICATE');
    chargeIds.add(line.charge_id);
    const item=intents.get(line.request_id);
    if(!item)return denial('SHADOW_RECON_ORPHAN_PROVIDER_LINE');
    // A line invoiced before the claimed request was created is untrusted.
    if(line.billed_month_utc<item.initiated_month_utc)
      return denial('SHADOW_RECON_BILLING_BEFORE_REQUEST');
    const value=BigInt(line.amount_micro_usd);
    billed+=value;
    item.billed+=value;
    item.chargeCount++;
    if(billed>MAX_SAFE)return denial('SHADOW_RECON_BILLED_OVERFLOW');
  }
  let held=0n,carried=0n,unresolved=0,settled=0;
  for(const item of intents.values()){
    if(item.state==='settled'){
      // No provider proof: a synthetic missing charge is a mismatch, not 0.
      if(item.chargeCount===0)
        return denial('SHADOW_RECON_SETTLED_WITHOUT_CHARGE');
      settled++;
    }else{
      unresolved++;
      const value=BigInt(item.held_micro_usd);
      held+=value;
      if(item.initiated_month_utc<s.as_of_month_utc)carried+=value;
      if(held>MAX_SAFE)return denial('SHADOW_RECON_HELD_OVERFLOW');
    }
  }
  if(billed+held>MAX_SAFE)return denial('SHADOW_RECON_EXPOSURE_OVERFLOW');
  const extra={
    asOfMonthUtc:s.as_of_month_utc,
    simulatedBilledMicroUsd:Number(billed),
    simulatedHeldMicroUsd:Number(held),
    simulatedExposureMicroUsd:Number(billed+held),
    simulatedCarryForwardHeldMicroUsd:Number(carried),
    simulatedUnresolvedCount:unresolved,
    simulatedSettledCount:settled,
    simulatedChargeLineCount:chargeIds.size,
    simulatedRequestCount:intents.size,
  };
  return denial(unresolved>0?'SHADOW_RECON_UNKNOWN_LIABILITY_NO_RETRY':
    'SHADOW_RECON_NO_AUTHENTICATED_BILLING_PROOF',extra);
}
