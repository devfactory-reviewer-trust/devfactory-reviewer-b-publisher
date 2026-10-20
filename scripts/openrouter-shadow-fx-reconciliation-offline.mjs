/**
 * Offline synthetic USD -> EUR liability / FX stress model.
 * NOT a real quote, provider invoice, reserved balance or spend permit.
 * No network, keys, provider API requests or writes.
 */
const MAX_INPUT_BYTES=32768;
const MAX_ENTRIES=200;
const CAP_MICRO_EUR=15000000n;
const MAX_SAFE=BigInt(Number.MAX_SAFE_INTEGER);
const ROOT=['coverage','entries','fx_quote','month_utc','observed_at'];
const FX=['denominator','expires_at','issued_at','numerator','pair','source'];
const ENTRY=['billed_micro_usd','charge_month_utc','held_micro_usd',
  'key_role','request_id','state'];
const ROLES=new Set(['development','reviewer_b']);
const STATES=new Set(['settled','pending','ambiguous']);
const denial=(reason,diagnostics={})=>Object.freeze({
  status:'BLOCKED',reason,syntheticOnly:true,verified:false,
  maySpend:false,mayReserve:false,mayRetryAmbiguousRequest:false,
  providerBillingAuthenticated:false,accountCoverageAuthenticated:false,
  fxAuthenticated:false,...diagnostics,
});
const keysExact=(v,fields)=>v!==null&&typeof v==='object'&&
  !Array.isArray(v)&&Object.keys(v).length===fields.length&&
  fields.every(k=>Object.hasOwn(v,k));
const monthValid=v=>typeof v==='string'&&
  /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const unsigned=v=>typeof v==='string'&&
  /^(0|[1-9]\d{0,14})$/.test(v);
const positiveRate=v=>typeof v==='string'&&
  /^[1-9]\d{0,5}$/.test(v);
function utcSecond(v){
  if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(v))
    return null;
  const n=Date.parse(v);
  if(!Number.isFinite(n)||new Date(n).toISOString()!==v.replace('Z','.000Z'))
    return null;
  return n;
}
const ceilDiv=(n,d)=>(n+d-1n)/d;

/**
 * Uses fixture-controlled timestamps and an untrusted upper-bound FX ratio.
 * Safe arithmetic only means a consistent simulation; not FX provenance.
 */
export function assessSyntheticUsdFxLiabilityOffline(snapshotJson){
  if(process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY!=='1')
    return denial('SHADOW_FX_SYNTHETIC_SWITCH_REQUIRED');
  if(typeof snapshotJson!=='string'||
     Buffer.byteLength(snapshotJson,'utf8')>MAX_INPUT_BYTES)
    return denial('SHADOW_FX_INPUT_UNTRUSTED');
  let s;
  try{s=JSON.parse(snapshotJson)}catch{
    return denial('SHADOW_FX_INPUT_UNTRUSTED');
  }
  if(!keysExact(s,ROOT)||s.coverage!=='illustrative-only'||
     !monthValid(s.month_utc)||!Array.isArray(s.entries)||
     s.entries.length<1||s.entries.length>MAX_ENTRIES||
     !keysExact(s.fx_quote,FX))
    return denial('SHADOW_FX_INPUT_UNTRUSTED');
  const observed=utcSecond(s.observed_at);
  const issued=utcSecond(s.fx_quote.issued_at);
  const expires=utcSecond(s.fx_quote.expires_at);
  if(observed===null||issued===null||expires===null||
     s.observed_at.slice(0,7)!==s.month_utc||
     s.fx_quote.source!=='synthetic-fixture'||
     s.fx_quote.pair!=='USD/EUR'||!positiveRate(s.fx_quote.numerator)||
     !positiveRate(s.fx_quote.denominator))
    return denial('SHADOW_FX_QUOTE_UNTRUSTED');
  // This compares only untrusted fixture timestamps. Not live freshness.
  if(observed<issued||observed>=expires||
     expires-issued>300000||expires-issued<=0)
    return denial('SHADOW_FX_QUOTE_WINDOW_INVALID');
  const n=BigInt(s.fx_quote.numerator),d=BigInt(s.fx_quote.denominator);
  let total=0n,unresolved=0;
  const seen=new Set(),roles=new Set();
  for(const e of s.entries){
    if(!keysExact(e,ENTRY)||typeof e.request_id!=='string'||
       !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/.test(e.request_id)||
       seen.has(e.request_id)||!ROLES.has(e.key_role)||
       !STATES.has(e.state)||e.charge_month_utc!==s.month_utc||
       !unsigned(e.billed_micro_usd)||!unsigned(e.held_micro_usd))
      return denial('SHADOW_FX_ENTRY_UNTRUSTED_OR_DUPLICATE');
    seen.add(e.request_id);
    roles.add(e.key_role);
    if(e.state==='settled'&&e.held_micro_usd!=='0')
      return denial('SHADOW_FX_SETTLED_STILL_HELD');
    if(e.state!=='settled'&&e.held_micro_usd==='0')
      return denial('SHADOW_FX_UNKNOWN_BILLING_WITHOUT_HOLD');
    if(e.state!=='settled')unresolved++;
    // Round EACH component upward, never just the aggregate sum.
    const billed=ceilDiv(BigInt(e.billed_micro_usd)*n,d);
    const held=ceilDiv(BigInt(e.held_micro_usd)*n,d);
    total+=billed+held;
    if(total>MAX_SAFE)return denial('SHADOW_FX_SIMULATED_OVERFLOW');
  }
  const overCap=total>CAP_MICRO_EUR;
  return denial(overCap?'SHADOW_FX_SIMULATED_CAP_EXCEEDED':
    unresolved?'SHADOW_FX_UNRESOLVED_NO_RETRY':
    'SHADOW_FX_NO_AUTHENTICATED_PROVIDER_OR_RATE',{
      monthUtc:s.month_utc,simulatedExposureMicroEur:Number(total),
      simulatedOverCap:overCap,
      simulatedUnallocatedMicroEur:overCap?0:Number(CAP_MICRO_EUR-total),
      unresolvedCount:unresolved,requestCount:seen.size,
      simulatedRoleCount:roles.size,
      quoteProvenance:'synthetic-fixture-only',
    });
}
