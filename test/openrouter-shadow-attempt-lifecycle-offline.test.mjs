import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditSyntheticAttemptLifecycleOffline as audit}
  from '../scripts/openrouter-shadow-attempt-lifecycle-offline.mjs';

const event=(event_no,kind,overrides={})=>({
  attempt_id:'attempt:1',event_no,head_sha:'a'.repeat(40),
  kind,month_utc:'2026-10',request_id:'request:1',
  role:'reviewer_b',...overrides,
});
const fixture=(...events)=>JSON.stringify({
  schema:'devfactory.shadow-attempt.synthetic.v1',
  coverage:'illustrative-only',events,
});
function withSwitch(fn){
  const prior=process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY='1';
  try{return fn()}finally{
    if(prior===undefined)delete process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
    else process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY=prior;
  }
}
function blocked(r,reason){
  assert.equal(r.status,'BLOCKED');
  for(const k of ['verified','maySpend','mayReserve','mayRetryAmbiguousRequest',
    'providerBillingAuthenticated','durableIdempotencyVerified',
    'protectedDispatcherDeployed'])assert.equal(r[k],false,k);
  assert.equal(r.syntheticOnly,true);
  assert.ok(Object.isFrozen(r));
  if(reason)assert.equal(r.reason,reason);
}
test('off by default, even if mock timeline looks normal',()=>{
  const prev=process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  delete process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  try{blocked(audit(fixture(event(1,'reserved'))),
    'SHADOW_ATTEMPT_SYNTHETIC_SWITCH_REQUIRED');
  }finally{
    if(prev!==undefined)process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY=prev;
  }
});
test('reserved-only fixture is not permission to dispatch',()=>withSwitch(()=>{
  const r=audit(fixture(event(1,'reserved')));
  blocked(r,'SHADOW_ATTEMPT_NO_DURABLE_PROVIDER_PROOF');
  assert.equal(r.simulatedOpenReservations,1);
  assert.equal(r.simulatedPotentiallyDispatched,0);
}));
test('unresolved dispatch permanently blocks replay, even next UTC month',()=>withSwitch(()=>{
  const timeline=fixture(event(1,'reserved'),
    event(2,'dispatch_recorded'),
    event(3,'outcome_unknown',{month_utc:'2026-11'}));
  const r=audit(timeline);
  blocked(r,'SHADOW_ATTEMPT_UNKNOWN_NO_RETRY');
  assert.equal(r.simulatedUnknownCount,1);
  assert.equal(r.simulatedPotentiallyDispatched,1);
  assert.equal(r.simulatedRequestCount,1);
}));
test('second dispatch with same ID after outcome unknown is forbidden',()=>withSwitch(()=>{
  const r=audit(fixture(event(1,'reserved'),event(2,'dispatch_recorded'),
    event(3,'outcome_unknown'),event(4,'dispatch_recorded')));
  blocked(r,'SHADOW_ATTEMPT_REPLAY_OR_RETRY_FORBIDDEN');
  assert.equal(r.simulatedRequestCount,undefined);
}));
test('replay is still forbidden after simulated settlement',()=>withSwitch(()=>{
  const r=audit(fixture(event(1,'reserved'),event(2,'dispatch_recorded'),
    event(3,'outcome_unknown'),event(4,'settled_fixture'),
    event(5,'dispatch_recorded')));
  blocked(r,'SHADOW_ATTEMPT_REPLAY_OR_RETRY_FORBIDDEN');
}));
test('mock settlement after unknown does not authenticate provider proof',()=>withSwitch(()=>{
  const r=audit(fixture(event(1,'reserved'),event(2,'dispatch_recorded'),
    event(3,'outcome_unknown'),event(4,'settled_fixture')));
  blocked(r,'SHADOW_ATTEMPT_NO_DURABLE_PROVIDER_PROOF');
  assert.equal(r.simulatedPotentiallyDispatched,1);
}));
test('cancel allowed only before dispatch, never after uncertain call',()=>withSwitch(()=>{
  const ok=audit(fixture(event(1,'reserved'),
    event(2,'cancelled_before_dispatch')));
  blocked(ok,'SHADOW_ATTEMPT_NO_DURABLE_PROVIDER_PROOF');
  assert.equal(ok.simulatedCancelledBeforeDispatch,1);
  for(const events of [
    [event(1,'reserved'),event(2,'dispatch_recorded'),
      event(3,'cancelled_before_dispatch')],
    [event(1,'reserved'),event(2,'cancelled_before_dispatch'),
      event(3,'dispatch_recorded')],
  ]){
    const r=audit(fixture(...events));
    blocked(r);
    assert.match(r.reason,/CANCEL_AFTER_DISPATCH|REPLAY_OR_RETRY/);
  }
}));
test('duplicate reservation or duplicate attempt IDs across roles refused',()=>withSwitch(()=>{
  const a=audit(fixture(event(1,'reserved'),event(2,'reserved')));
  blocked(a,'SHADOW_ATTEMPT_DUPLICATE_RESERVATION_OR_ID');
  const b=audit(fixture(event(1,'reserved'),event(2,'reserved',{
    role:'development',request_id:'request:2',
  })));
  blocked(b,'SHADOW_ATTEMPT_DUPLICATE_RESERVATION_OR_ID');
}));
test('identity drift, reordering and backdated month fail closed',()=>withSwitch(()=>{
  const bad=[
    [event(1,'reserved'),event(2,'dispatch_recorded',{role:'development'})],
    [event(1,'reserved'),event(2,'dispatch_recorded',{head_sha:'b'.repeat(40)})],
    [event(1,'reserved'),event(2,'dispatch_recorded',{attempt_id:'attempt:2'})],
    [event(1,'reserved',{foo:'bar'})],
    [event(1,'reserved'),event(4,'dispatch_recorded')],
    [event(1,'reserved',{month_utc:'2026-11'}),
      event(2,'dispatch_recorded',{month_utc:'2026-10'})],
  ];
  for(const item of bad){
    const r=audit(fixture(...item));
    blocked(r);
    assert.equal(r.simulatedRequestCount,undefined);
  }
}));
test('dispatch, settlement, unknown or cancellation without proper phase denied',()=>withSwitch(()=>{
  const bad=[
    [event(1,'dispatch_recorded')],
    [event(1,'settled_fixture')],
    [event(1,'reserved'),event(2,'outcome_unknown')],
    [event(1,'reserved'),event(2,'settled_fixture')],
    [event(1,'reserved'),event(2,'dispatch_recorded'),
      event(3,'outcome_unknown'),event(4,'outcome_unknown')],
  ];
  for(const item of bad)blocked(audit(fixture(...item)));
}));
test('two different roles with distinct identities produce only blocked diagnostics',()=>withSwitch(()=>{
  const r=audit(fixture(event(1,'reserved'),
    event(2,'reserved',{role:'development',request_id:'request:2',
      attempt_id:'attempt:2'}),
    event(3,'dispatch_recorded'),event(4,'outcome_unknown')));
  blocked(r,'SHADOW_ATTEMPT_UNKNOWN_NO_RETRY');
  assert.equal(r.simulatedRequestCount,2);
  assert.equal(r.simulatedOpenReservations,1);
}));
test('extra fields, forged authority, invalid JSON and excessive events denied',()=>withSwitch(()=>{
  const s=JSON.parse(fixture(event(1,'reserved')));
  const examples=[null,{},'not JSON',' '.repeat(32769),
    JSON.stringify({...s,maySpend:true}),
    JSON.stringify({...s,coverage:'provider-verified'}),
    JSON.stringify({...s,events:[]}),
    JSON.stringify({...s,events:[{...event(1,'reserved'),sql:'SELECT 1'}]}),
    JSON.stringify({...s,events:[{...event(1,'reserved'),event_no:0}]}),
    JSON.stringify({...s,events:[{...event(1,'reserved'),kind:'retry'}]}),
    JSON.stringify({...s,events:[{...event(1,'reserved'),head_sha:'INVALID'}]}),
    JSON.stringify({...s,events:Array(201).fill(event(1,'reserved'))}),
  ];
  for(const e of examples){
    const r=audit(e);blocked(r);
    assert.equal(r.simulatedRequestCount,undefined);
  }
}));
test('production Publisher and spend gate do not import offline lifecycle',()=>{
  const gate=readFileSync(new URL(
    '../scripts/openrouter-only-spend-gate.mjs',import.meta.url),'utf8');
  const paid=readFileSync(new URL(
    '../scripts/protected-real-openrouter-review.mjs',import.meta.url),'utf8');
  const module=readFileSync(new URL(
    '../scripts/openrouter-shadow-attempt-lifecycle-offline.mjs',import.meta.url),'utf8');
  for(const s of [gate,paid])
    assert.doesNotMatch(s,/openrouter-shadow-attempt-lifecycle-offline/);
  assert.match(gate,/OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED/);
  assert.doesNotMatch(module,/OPENROUTER_API_KEY|https?:\/\/|fetch\s*\(/);
});
