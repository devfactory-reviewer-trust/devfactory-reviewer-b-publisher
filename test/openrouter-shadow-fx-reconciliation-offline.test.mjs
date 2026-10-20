import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {assessSyntheticUsdFxLiabilityOffline as assess}
  from '../scripts/openrouter-shadow-fx-reconciliation-offline.mjs';

const record=(request_id,key_role,state,billed_micro_usd,held_micro_usd,
  charge_month_utc='2026-10')=>({
  request_id,key_role,state,billed_micro_usd,held_micro_usd,
  charge_month_utc,
});
const sample=()=>({
  coverage:'illustrative-only',month_utc:'2026-10',
  observed_at:'2026-10-20T14:30:00Z',
  fx_quote:{
    source:'synthetic-fixture',pair:'USD/EUR',
    numerator:'9',denominator:'10',
    issued_at:'2026-10-20T14:29:00Z',
    expires_at:'2026-10-20T14:34:00Z',
  },
  entries:[
    record('development:1','development','settled','1000000','0'),
    record('review:1','reviewer_b','pending','200000','800000'),
  ],
});
async function synthetic(fn){
  const previous=process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY='1';
  try{await fn()}finally{
    if(previous===undefined)delete process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
    else process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY=previous;
  }
}
function blocked(r){
  assert.equal(r.status,'BLOCKED');
  for(const k of ['maySpend','mayReserve','mayRetryAmbiguousRequest',
    'providerBillingAuthenticated','accountCoverageAuthenticated',
    'fxAuthenticated','verified'])assert.equal(r[k],false,k);
  assert.equal(r.syntheticOnly,true);
  assert.ok(Object.isFrozen(r));
}
test('no synthetic switch: fail closed even with complete fake proof',()=>{
  const p=process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  delete process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  try{
    const r=assess(JSON.stringify(sample()));
    blocked(r);
    assert.equal(r.reason,'SHADOW_FX_SYNTHETIC_SWITCH_REQUIRED');
  }finally{if(p!==undefined)process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY=p}
});
test('rational USD/EUR upper rounding, both roles, no payment grant',()=>synthetic(()=>{
  const r=assess(JSON.stringify(sample()));
  blocked(r);
  assert.equal(r.simulatedExposureMicroEur,1800000);
  assert.equal(r.simulatedUnallocatedMicroEur,13200000);
  assert.equal(r.unresolvedCount,1);
  assert.equal(r.simulatedRoleCount,2);
  assert.equal(r.reason,'SHADOW_FX_UNRESOLVED_NO_RETRY');
  assert.equal(r.quoteProvenance,'synthetic-fixture-only');
}));
test('ceil EACH billed and held component independently, even 1 micro-unit',()=>synthetic(()=>{
  const s=sample();
  s.fx_quote.numerator='1';
  s.fx_quote.denominator='3';
  s.entries=[
    record('r1','development','ambiguous','1','1'),
    record('r2','reviewer_b','settled','1','0'),
  ];
  const r=assess(JSON.stringify(s));
  blocked(r);
  assert.equal(r.simulatedExposureMicroEur,3);
  assert.equal(r.unresolvedCount,1);
}));
test('uncertain partly billed request retains all USD hold through conversion',()=>synthetic(()=>{
  const s=sample();
  s.entries=[
    record('one','development','settled','9000000','0'),
    record('two','reviewer_b','ambiguous','2000000','8000000'),
  ];
  const r=assess(JSON.stringify(s));
  blocked(r);
  assert.equal(r.simulatedExposureMicroEur,17100000);
  assert.equal(r.simulatedOverCap,true);
  assert.equal(r.simulatedUnallocatedMicroEur,0);
  assert.equal(r.reason,'SHADOW_FX_SIMULATED_CAP_EXCEEDED');
}));
test('duplicate request across different keys denied, no partial total shown',()=>synthetic(()=>{
  const s=sample();
  s.entries=[
    record('same','development','settled','1','0'),
    record('same','reviewer_b','pending','0','1'),
  ];
  const r=assess(JSON.stringify(s));
  blocked(r);
  assert.equal(r.reason,'SHADOW_FX_ENTRY_UNTRUSTED_OR_DUPLICATE');
  assert.equal(r.simulatedExposureMicroEur,undefined);
}));
test('missing, stale, future, long-lived or mismatched FX quote fail closed',()=>synthetic(()=>{
  const inputs=[
    s=>{delete s.fx_quote;},
    s=>{s.fx_quote.source='OpenRouter real confirmed';},
    s=>{s.fx_quote.pair='EUR/USD';},
    s=>{s.fx_quote.issued_at='2026-10-20T14:31:00Z';},
    s=>{s.fx_quote.expires_at='2026-10-20T14:30:00Z';},
    s=>{s.fx_quote.expires_at='2026-10-20T14:35:01Z';},
    s=>{s.fx_quote.denominator='0';},
    s=>{s.fx_quote.numerator='0';},
    s=>{s.fx_quote.numerator='1000000';},
    s=>{s.fx_quote.denominator=10;},
    s=>{s.fx_quote.authenticated=true;},
    s=>{s.observed_at='2026-11-01T00:00:00Z';},
    s=>{s.observed_at='2026-10-32T14:30:00Z';},
    s=>{s.observed_at='2026-10-20T14:30:00+00:00';},
  ];
  for(const mutate of inputs){
    const s=sample();mutate(s);
    const r=assess(JSON.stringify(s));
    blocked(r);
    assert.equal(r.simulatedExposureMicroEur,undefined);
  }
}));
test('invalid monetary strings and contradictory states cannot silently settle',()=>synthetic(()=>{
  const entries=[
    record('r','development','pending','0','0'),
    record('r','development','ambiguous','0','0'),
    record('r','development','settled','2','1'),
    record('r','development','settled',1,'0'),
    record('r','development','settled','-1','0'),
    record('r','development','settled','0.1','0'),
    record('r','development','settled','01','0'),
    record('r','development','settled','9999999999999999','0'),
    record('bad space','development','settled','0','0'),
    record('r','fake_role','settled','0','0'),
    record('r','development','done','0','0'),
    record('r','development','settled','0','0','2026-09'),
    {...record('r','development','settled','0','0'),maySpend:true},
  ];
  for(const e of entries){
    const s=sample();s.entries=[e];
    const r=assess(JSON.stringify(s));
    blocked(r);
    assert.equal(r.simulatedExposureMicroEur,undefined);
  }
}));
test('large conversion overflow never exposes apparent budget',()=>synthetic(()=>{
  const s=sample();
  s.fx_quote.numerator='999999';
  s.fx_quote.denominator='1';
  s.entries=[record('r','reviewer_b','settled','999999999999999','0')];
  const r=assess(JSON.stringify(s));
  blocked(r);
  assert.equal(r.reason,'SHADOW_FX_SIMULATED_OVERFLOW');
}));
test('invalid, oversized, extra-fields and missing-coverage inputs fail closed',()=>synthetic(()=>{
  const s=sample();
  for(const value of [
    null,{},'not JSON',' '.repeat(32769),
    JSON.stringify({...s,accountCoverageAuthenticated:true}),
    JSON.stringify({...s,coverage:'provider-authenticated'}),
    JSON.stringify({...s,entries:[]}),
    JSON.stringify({...s,entries:Array(201).fill(s.entries[0])}),
    JSON.stringify({...s,month_utc:'2026-13'}),
  ]){
    const r=assess(value);
    blocked(r);
    assert.equal(r.reason,'SHADOW_FX_INPUT_UNTRUSTED');
  }
}));
test('FX simulation remains disconnected from the paid Publisher',()=>{
  const script=readFileSync(new URL(
    '../scripts/openrouter-shadow-fx-reconciliation-offline.mjs',import.meta.url),'utf8');
  const real=readFileSync(new URL(
    '../scripts/protected-real-openrouter-review.mjs',import.meta.url),'utf8');
  const gate=readFileSync(new URL(
    '../scripts/openrouter-only-spend-gate.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(real,/openrouter-shadow-fx-reconciliation-offline/);
  assert.doesNotMatch(gate,/openrouter-shadow-fx-reconciliation-offline/);
  assert.match(gate,/OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED/);
  assert.doesNotMatch(script,/OPENROUTER_API_KEY|https?:\/\/|fetch\s*\(/);
});
