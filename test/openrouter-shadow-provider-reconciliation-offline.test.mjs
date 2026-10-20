import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessSyntheticProviderReconciliationOffline as assess}
  from '../scripts/openrouter-shadow-provider-reconciliation-offline.mjs';

const intent=(request_id,key_role,initiated_month_utc,state,held_micro_usd)=>({
  request_id,key_role,initiated_month_utc,state,held_micro_usd,
});
const charge=(charge_id,request_id,billed_month_utc,amount_micro_usd)=>({
  charge_id,request_id,billed_month_utc,amount_micro_usd,
});
const fixture=()=>({
 schema:'devfactory.shadow-reconciliation.synthetic.v1',
 coverage:'illustrative-only',as_of_month_utc:'2026-10',
 watermark:'unverified-fixture',
 intents:[
  intent('dev-old','development','2026-09','ambiguous','2000000'),
  intent('review-current','reviewer_b','2026-10','settled','0'),
 ],
 charges:[
  charge('invoice:1','dev-old','2026-10','1000000'),
  charge('invoice:2','review-current','2026-10','3000000'),
 ],
});
const encode=s=>JSON.stringify(s);
const withSwitch=async fn=>{
 const prior=process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
 process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY='1';
 try{await fn()}finally{
  if(prior===undefined)delete process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  else process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY=prior;
 }
};
const blocked=r=>{
 assert.equal(r.status,'BLOCKED');
 for(const key of ['verified','maySpend','mayReserve',
  'mayRetryAmbiguousRequest','providerBillingAuthenticated',
  'accountCoverageAuthenticated','fxAuthenticated'])
  assert.equal(r[key],false,key);
 assert.equal(r.syntheticOnly,true);
 assert.ok(Object.isFrozen(r));
};
test('without synthetic switch: no result can authorize spending',()=>{
 const prior=process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
 delete process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
 try{
  const r=assess(encode(fixture()));
  blocked(r);
  assert.equal(r.reason,'SHADOW_RECON_SYNTHETIC_SWITCH_REQUIRED');
 }finally{
  if(prior!==undefined)process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY=prior;
 }
});
test('cross-month charge and unresolved hold are both retained',()=>withSwitch(()=>{
 const r=assess(encode(fixture()));
 blocked(r);
 assert.equal(r.reason,'SHADOW_RECON_UNKNOWN_LIABILITY_NO_RETRY');
 assert.equal(r.simulatedBilledMicroUsd,4000000);
 assert.equal(r.simulatedHeldMicroUsd,2000000);
 assert.equal(r.simulatedExposureMicroUsd,6000000);
 assert.equal(r.simulatedCarryForwardHeldMicroUsd,2000000);
 assert.equal(r.simulatedRequestCount,2);
 assert.equal(r.simulatedSettledCount,1);
 assert.equal(r.simulatedUnresolvedCount,1);
 assert.equal(r.simulatedChargeLineCount,2);
}));
test('multiple invoice lines can match one request without removing hold',()=>withSwitch(()=>{
 const s=fixture();
 s.charges.push(charge('invoice:3','dev-old','2026-10','500000'));
 const r=assess(encode(s));
 blocked(r);
 assert.equal(r.simulatedBilledMicroUsd,4500000);
 assert.equal(r.simulatedExposureMicroUsd,6500000);
 assert.equal(r.simulatedCarryForwardHeldMicroUsd,2000000);
}));
test('even all apparently settled synthetic records are not billing proof',()=>withSwitch(()=>{
 const s=fixture();
 s.intents[0].state='settled';
 s.intents[0].held_micro_usd='0';
 const r=assess(encode(s));
 blocked(r);
 assert.equal(r.reason,'SHADOW_RECON_NO_AUTHENTICATED_BILLING_PROOF');
 assert.equal(r.simulatedHeldMicroUsd,0);
 assert.equal(r.simulatedBilledMicroUsd,4000000);
}));
test('orphan charge is a blocked mismatch, never discarded',()=>withSwitch(()=>{
 const s=fixture();s.charges.push(charge('invoice:orphan','unknown','2026-10','1'));
 const r=assess(encode(s));
 blocked(r);
 assert.equal(r.reason,'SHADOW_RECON_ORPHAN_PROVIDER_LINE');
 assert.equal(r.simulatedExposureMicroUsd,undefined);
}));
test('duplicate request IDs across both roles and duplicate charge IDs denied',()=>withSwitch(()=>{
 const a=fixture();
 a.intents.push(intent('dev-old','reviewer_b','2026-10','pending','1000000'));
 const b=fixture();
 b.charges.push(charge('invoice:1','dev-old','2026-10','1000000'));
 for(const [s,reason] of [
  [a,'SHADOW_RECON_INTENT_INVALID_OR_DUPLICATE'],
  [b,'SHADOW_RECON_CHARGE_INVALID_OR_DUPLICATE'],
 ]){
  const r=assess(encode(s));blocked(r);assert.equal(r.reason,reason);
 }
}));
test('late invoice may follow month boundary, but never precedes intent',()=>withSwitch(()=>{
 const s=fixture();
 s.charges[0].billed_month_utc='2026-09';
 const valid=assess(encode(s));
 blocked(valid);
 assert.equal(valid.simulatedExposureMicroUsd,6000000);
 s.charges[0].billed_month_utc='2026-08';
 const invalid=assess(encode(s));
 blocked(invalid);
 assert.equal(invalid.reason,'SHADOW_RECON_BILLING_BEFORE_REQUEST');
}));
test('a settled request without charge evidence fails closed',()=>withSwitch(()=>{
 const s=fixture();s.charges.pop();
 const r=assess(encode(s));
 blocked(r);
 assert.equal(r.reason,'SHADOW_RECON_SETTLED_WITHOUT_CHARGE');
}));
test('unknown charges cannot be auto-closed or released with zero hold',()=>withSwitch(()=>{
 const s=fixture();
 s.intents[0].held_micro_usd='0';
 const r=assess(encode(s));
 blocked(r);
 assert.equal(r.reason,'SHADOW_RECON_UNKNOWN_OUTCOME_WITHOUT_HOLD');
}));
test('untrusted evidence source, unknown fields and claims of verified invoices refused',()=>withSwitch(()=>{
 const changes=[
  s=>{s.watermark='provider-authenticated';},
  s=>{s.coverage='verified-every-account';},
  s=>{s.providerBillingAuthenticated=true;},
  s=>{s.verified=true;},
  s=>{s.intents[0].provider_id='verified';},
  s=>{s.charges[0].source='provider';},
  s=>{s.intents[0].key_role='other-key';},
  s=>{s.intents[0].state='cancelled';},
  s=>{s.schema='production';},
  s=>{s.as_of_month_utc='2026-13';},
  s=>{s.intents[0].initiated_month_utc='2026-11';},
  s=>{s.charges[0].billed_month_utc='2026-11';},
  s=>{s.intents[0].held_micro_usd=2;},
  s=>{s.intents[0].held_micro_usd='-1';},
  s=>{s.charges[0].amount_micro_usd='0';},
  s=>{s.charges[0].amount_micro_usd='0.5';},
  s=>{s.charges[0].charge_id='../../etc';},
 ];
 for(const change of changes){
  const s=fixture();change(s);
  const r=assess(encode(s));blocked(r);
  assert.equal(r.simulatedExposureMicroUsd,undefined);
 }
}));
test('oversized, empty, nonstring or malformed snapshots refused',()=>withSwitch(()=>{
 const s=fixture();
 for(const input of [
  null,{},'not JSON',' '.repeat(32769),
  encode({...s,intents:[]}),
  encode({...s,charges:Array(201).fill(s.charges[0])}),
  encode({...s,intents:Array(201).fill(s.intents[0])}),
 ]){
  const r=assess(input);blocked(r);
  assert.equal(r.reason,'SHADOW_RECON_INPUT_UNTRUSTED');
 }
}));
test('large simulated charges overflow before exposing a budget',()=>withSwitch(()=>{
 const s=fixture();
 s.intents=[
  intent('big','development','2026-10','pending','999999999999999'),
 ];
 s.charges=[];
 for(let i=0;i<11;i++)
  s.charges.push(charge('l'+i,'big','2026-10','999999999999999'));
 const r=assess(encode(s));blocked(r);
 assert.equal(r.reason,'SHADOW_RECON_BILLED_OVERFLOW');
 assert.equal(r.simulatedExposureMicroUsd,undefined);
}));
test('reconciliation cannot be imported by paid Publisher or real gate',()=>{
 const real=readFileSync(new URL('../scripts/protected-real-openrouter-review.mjs',import.meta.url),'utf8');
 const gate=readFileSync(new URL('../scripts/openrouter-only-spend-gate.mjs',import.meta.url),'utf8');
 const module=readFileSync(new URL('../scripts/openrouter-shadow-provider-reconciliation-offline.mjs',import.meta.url),'utf8');
 for(const s of [real,gate])
  assert.doesNotMatch(s,/openrouter-shadow-provider-reconciliation-offline/);
 assert.match(gate,/OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED/);
 assert.doesNotMatch(module,/OPENROUTER_API_KEY|https?:\/\/|fetch\s*\(/);
});
