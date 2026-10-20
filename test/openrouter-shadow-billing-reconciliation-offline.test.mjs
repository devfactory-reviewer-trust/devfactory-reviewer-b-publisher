import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {assessSyntheticBillingLiabilitiesOffline as assess}
  from '../scripts/openrouter-shadow-billing-reconciliation-offline.mjs';

const record=(request_id,key_role,state,billed,hold)=>({
  request_id,key_role,state,
  already_billed_micro_eur:billed,unsettled_upper_micro_eur:hold,
});
const input=records=>JSON.stringify({
  month_utc:'2026-10',currency:'EUR',coverage:'illustrative-only',records,
});
const base=()=>[
  record('dev:1','development','settled',3_000_000,0),
  record('review:1','reviewer_b','settled',4_000_000,0),
];
async function synthetic(fn){
 const prior=process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
 process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY='1';
 try{await fn()}finally{
  if(prior===undefined)delete process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  else process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY=prior;
 }
}
function noAuthority(result){
 assert.equal(result.status,'BLOCKED');
 assert.equal(result.maySpend,false);
 assert.equal(result.mayReserve,false);
 assert.equal(result.mayRetryAmbiguousRequest,false);
 assert.equal(result.providerBillingAuthenticated,false);
 assert.equal(result.fxAuthenticated,false);
 assert.equal(result.verified,false);
 assert.equal(result.syntheticOnly,true);
 assert.ok(Object.isFrozen(result));
}
test('default is blocked, even for a simulated fully settled account',()=>{
 const prev=process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
 delete process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
 try{
  const result=assess(input(base()));
  noAuthority(result);
  assert.equal(result.reason,'SHADOW_BILLING_SYNTHETIC_SWITCH_REQUIRED');
 }finally{if(prev!==undefined)process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY=prev}
});
test('both simulated key roles are aggregated but never authorized',()=>synthetic(()=>{
 const result=assess(input(base()));
 noAuthority(result);
 assert.equal(result.simulatedExposureMicroEur,7_000_000);
 assert.equal(result.simulatedUnallocatedMicroEur,8_000_000);
 assert.equal(result.requestCount,2);
 assert.equal(result.reason,'SHADOW_BILLING_NO_PROVIDER_OR_FX_PROOF');
 assert.equal(result.accountCoverageAuthenticated,false);
}));
test('pending and ambiguous requests retain full holds and block retry',()=>synthetic(()=>{
 const result=assess(input([
  record('dev:1','development','settled',3_000_000,0),
  record('review:1','reviewer_b','pending',2_000_000,4_000_000),
  record('review:2','reviewer_b','ambiguous',0,1_000_000),
 ]));
 noAuthority(result);
 assert.equal(result.unresolvedCount,2);
 assert.equal(result.simulatedExposureMicroEur,10_000_000);
 assert.equal(result.reason,'SHADOW_BILLING_UNRESOLVED_NO_RETRY');
}));
test('partial invoice PLUS hold can exceed cap without release',()=>synthetic(()=>{
 const result=assess(input([
  record('dev:1','development','settled',9_000_000,0),
  record('review:1','reviewer_b','ambiguous',2_000_000,5_000_000),
 ]));
 noAuthority(result);
 assert.equal(result.simulatedExposureMicroEur,16_000_000);
 assert.equal(result.simulatedOverCap,true);
 assert.equal(result.simulatedUnallocatedMicroEur,0);
 assert.equal(result.reason,'SHADOW_BILLING_SIMULATED_CAP_EXCEEDED');
}));
test('duplicate request IDs, even across roles, fail closed',()=>synthetic(()=>{
 const result=assess(input([
  record('same','reviewer_b','pending',0,3_000_000),
  record('same','development','settled',3_000_000,0),
 ]));
 noAuthority(result);
 assert.equal(result.reason,'SHADOW_BILLING_UNTRUSTED_OR_DUPLICATE_REQUEST');
 assert.equal(result.simulatedUnallocatedMicroEur,undefined);
}));
test('settled cannot retain hold, pending cannot have zero hold',()=>synthetic(()=>{
 for(const [state,hold] of [['settled',1],['pending',0],['ambiguous',0]]){
  const result=assess(input([record('id','development',state,1,hold)]));
  noAuthority(result);
  assert.match(result.reason,/CONTRADICTION|WITHOUT_HOLD/);
 }
}));
test('unknown coverage, currency, identities, state and forgeable fields are refused',()=>synthetic(()=>{
 const fixtures=[
  {...JSON.parse(input(base())),coverage:'provider-authenticated'},
  {...JSON.parse(input(base())),currency:'USD'},
  {...JSON.parse(input(base())),providerBillingAuthenticated:true},
  {...JSON.parse(input(base())),fxQuote:'1'},
  {...JSON.parse(input(base())),records:[record('bad','other_key','settled',1,0)]},
  {...JSON.parse(input(base())),records:[record('bad','development','cancelled',1,0)]},
  {...JSON.parse(input(base())),records:[{...base()[0],maySpend:true}]},
  {...JSON.parse(input(base())),records:[{...base()[0],already_billed_micro_eur:-1}]},
  {...JSON.parse(input(base())),records:[{...base()[0],already_billed_micro_eur:0.5}]},
  {...JSON.parse(input(base())),records:[{...base()[0],already_billed_micro_eur:2**53}]},
  {...JSON.parse(input(base())),records:[{...base()[0],request_id:'../../x'}]},
  {...JSON.parse(input(base())),month_utc:'2026-13'},
 ];
 for(const f of fixtures){
  const result=assess(JSON.stringify(f));
  noAuthority(result);
  assert.equal(result.simulatedExposureMicroEur,undefined);
 }
}));
test('oversized, empty, invalid JSON, dangerous properties and nonstrings are refused',()=>synthetic(()=>{
 for(const value of [
  null,{},'not JSON',JSON.stringify({__proto__:null}),
  '{"__proto__":{},"month_utc":"2026-10","currency":"EUR","coverage":"illustrative-only","records":[]}',
  ' '.repeat(32769),input([]),
 ]){
  const result=assess(value);
  noAuthority(result);
  assert.equal(result.reason,'SHADOW_BILLING_UNTRUSTED_INPUT');
 }
}));
test('int64-scale simulated exposure overflow fails closed',()=>synthetic(()=>{
 const huge=Number.MAX_SAFE_INTEGER;
 const result=assess(input([
  record('a','development','settled',huge,0),
  record('b','reviewer_b','settled',1,0),
 ]));
 noAuthority(result);
 assert.equal(result.reason,'SHADOW_BILLING_EXPOSURE_OVERFLOW');
}));
test('not imported into paid Publisher or actual spend gate',()=>{
 const script=readFileSync(new URL(
  '../scripts/openrouter-shadow-billing-reconciliation-offline.mjs',import.meta.url),'utf8');
 const gate=readFileSync(new URL(
  '../scripts/openrouter-only-spend-gate.mjs',import.meta.url),'utf8');
 const paid=readFileSync(new URL(
  '../scripts/protected-real-openrouter-review.mjs',import.meta.url),'utf8');
 for(const source of [gate,paid])
  assert.doesNotMatch(source,/openrouter-shadow-billing-reconciliation-offline/);
 assert.match(gate,/OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED/);
 assert.doesNotMatch(script,/OPENROUTER_API_KEY|https?:\/\/|fetch\s*\(/);
});
