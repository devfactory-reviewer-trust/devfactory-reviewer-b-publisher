/**
 * OFFLINE SYNTHETIC-ONLY OpenRouter liability stress model.
 * Not an OpenRouter billing reader, FX oracle, ledger or spend permit.
 * No network requests, keys, secrets, persistence or provider calls.
 *
 * Simulated micro-EUR amounts are hypothetical; converting USD invoices
 * to trustworthy EUR and covering all keys/accounts remain UNSOLVED.
 */
const CAP_MICRO_EUR=15_000_000;
const MAX_JSON_BYTES=32768,MAX_RECORDS=500;
const RECORD_FIELDS=[
  'already_billed_micro_eur','key_role','request_id','state',
  'unsettled_upper_micro_eur',
];
const ROOT_FIELDS=['coverage','currency','month_utc','records'];
const STATES=new Set(['settled','pending','ambiguous']);
const ROLES=new Set(['development','reviewer_b']);
const denial=(reason,details={})=>Object.freeze({
  status:'BLOCKED',reason,syntheticOnly:true,verified:false,
  maySpend:false,mayReserve:false,mayRetryAmbiguousRequest:false,
  providerBillingAuthenticated:false,fxAuthenticated:false,
  ...details,
});
const exactKeys=(obj,keys)=>obj!==null&&typeof obj==='object'&&
  !Array.isArray(obj)&&Object.keys(obj).length===keys.length&&
  keys.every(k=>Object.hasOwn(obj,k));
const nonNegativeSafe=n=>Number.isSafeInteger(n)&&n>=0;
const validMonth=m=>typeof m==='string'&&
  /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

/**
 * A pure demonstration of conservative exposure accounting:
 * billed amount PLUS unresolved reserved upper-bound, per request.
 * Uncertain requests ALWAYS stay blocked and cannot be retried.
 * Accept serialized JSON only, so caller-supplied JS getters are never used.
 */
export function assessSyntheticBillingLiabilitiesOffline(snapshotJson){
  if(process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY!=='1')
    return denial('SHADOW_BILLING_SYNTHETIC_SWITCH_REQUIRED');
  if(typeof snapshotJson!=='string'||
      Buffer.byteLength(snapshotJson,'utf8')>MAX_JSON_BYTES)
    return denial('SHADOW_BILLING_UNTRUSTED_INPUT');
  let s;
  try{s=JSON.parse(snapshotJson)}catch{
    return denial('SHADOW_BILLING_UNTRUSTED_INPUT');
  }
  if(!exactKeys(s,ROOT_FIELDS)||!validMonth(s.month_utc)||
     s.coverage!=='illustrative-only'||s.currency!=='EUR'||
     !Array.isArray(s.records)||s.records.length===0||
     s.records.length>MAX_RECORDS)
    return denial('SHADOW_BILLING_UNTRUSTED_INPUT');
  let exposure=0n,unresolved=0;
  const seen=new Set();
  for(const r of s.records){
    if(!exactKeys(r,RECORD_FIELDS)||
       typeof r.request_id!=='string'||
       !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/.test(r.request_id)||
       seen.has(r.request_id)||!ROLES.has(r.key_role)||
       !STATES.has(r.state)||
       !nonNegativeSafe(r.already_billed_micro_eur)||
       !nonNegativeSafe(r.unsettled_upper_micro_eur))
      return denial('SHADOW_BILLING_UNTRUSTED_OR_DUPLICATE_REQUEST');
    seen.add(r.request_id);
    if(r.state==='settled'&&r.unsettled_upper_micro_eur!==0)
      return denial('SHADOW_BILLING_SETTLEMENT_CONTRADICTION');
    if(r.state!=='settled'&&r.unsettled_upper_micro_eur===0)
      return denial('SHADOW_BILLING_UNRESOLVED_WITHOUT_HOLD');
    if(r.state!=='settled')unresolved++;
    // Deliberately double-count partial invoices PLUS all outstanding holds.
    // Never release a hold just because a provider request timed out.
    exposure+=BigInt(r.already_billed_micro_eur)+
      BigInt(r.unsettled_upper_micro_eur);
    if(exposure>BigInt(Number.MAX_SAFE_INTEGER))
      return denial('SHADOW_BILLING_EXPOSURE_OVERFLOW');
  }
  const overCap=exposure>BigInt(CAP_MICRO_EUR);
  return denial(overCap?'SHADOW_BILLING_SIMULATED_CAP_EXCEEDED':
    unresolved?'SHADOW_BILLING_UNRESOLVED_NO_RETRY':
    'SHADOW_BILLING_NO_PROVIDER_OR_FX_PROOF',{
    monthUtc:s.month_utc,
    simulatedExposureMicroEur:Number(exposure),
    simulatedUnallocatedMicroEur:overCap?0:CAP_MICRO_EUR-Number(exposure),
    simulatedOverCap:overCap,
    unresolvedCount:unresolved,
    requestCount:seen.size,
    // No account-wide bills, FX proof, reconciliation or spend authority.
    accountCoverageAuthenticated:false,
  });
}
