import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessSyntheticEvidenceCoverageOffline as assess,
  assessSyntheticEvidenceContinuityOffline as compare}
  from '../scripts/openrouter-shadow-evidence-coverage-offline.mjs';

const statement=(statement_id,key_id,month_utc,digit,request_ids)=>({
  statement_id,key_id,month_utc,source:'unverified-fixture',
  digest_sha256:digit.repeat(64),request_ids,
});
const example=()=>({
  schema:'devfactory.shadow-evidence-coverage.synthetic.v1',
  scope:'illustrative-only',watermark:'unverified-fixture',
  window:{first_month_utc:'2026-09',last_month_utc:'2026-10'},
  keys:[
    {key_id:'dev-key',role:'development',valid_from_month_utc:'2026-09',
      retired_after_month_utc:null},
    {key_id:'retired-review-key',role:'reviewer_b',
      valid_from_month_utc:'2026-09',retired_after_month_utc:'2026-09'},
  ],
  attempts:[
    {request_id:'dev-old',key_id:'dev-key',initiated_month_utc:'2026-09',
      state:'ambiguous'},
    {request_id:'review-old',key_id:'retired-review-key',
      initiated_month_utc:'2026-09',state:'settled_fixture'},
  ],
  statements:[
    statement('dev-sep','dev-key','2026-09','a',['dev-old']),
    statement('dev-oct','dev-key','2026-10','b',['dev-old']),
    statement('review-sep','retired-review-key','2026-09','c',['review-old']),
  ],
});
const encode=x=>JSON.stringify(x);
const withSwitch=fn=>{
  const prev=process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY='1';
  try{return fn()}finally{
    if(prev===undefined)delete process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
    else process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY=prev;
  }
};
const blocked=(r,reason)=>{
  assert.equal(r.status,'BLOCKED');
  for(const k of ['verified','maySpend','mayReserve',
    'mayRetryAmbiguousRequest','mayReleaseHold','providerBillingAuthenticated',
    'accountCoverageAuthenticated','keyInventoryAuthenticated',
    'statementProvenanceAuthenticated','fxAuthenticated'])
    assert.equal(r[k],false,k);
  assert.equal(r.syntheticOnly,true);
  assert.ok(Object.isFrozen(r));
  if(reason)assert.equal(r.reason,reason);
};
test('synthetic switch absent: cannot claim any coverage authority',()=>{
  const prior=process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  delete process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  try{blocked(assess(encode(example())),
    'SHADOW_COVERAGE_SYNTHETIC_SWITCH_REQUIRED');
  }finally{
    if(prior!==undefined)process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY=prior;
  }
});
test('all illustrative statements still prove neither origin nor completeness',()=>withSwitch(()=>{
  const r=assess(encode(example()));
  blocked(r,'SHADOW_COVERAGE_ALL_FIXTURES_STILL_UNVERIFIED');
  assert.equal(r.simulatedDeclaredKeyCount,2);
  assert.equal(r.simulatedRequiredKeyMonthPairs,3);
  assert.equal(r.simulatedObservedKeyMonthPairs,3);
  assert.equal(r.simulatedMissingKeyMonthPairs,0);
  assert.equal(r.simulatedUnmatchedRequestCount,0);
  assert.equal(r.simulatedUnknownOutcomeCount,1);
  assert.equal(r.simulatedStatementCount,3);
}));
test('missing retired key-month fixture is reported, not considered free',()=>withSwitch(()=>{
  const s=example();s.statements.pop();
  const r=assess(encode(s));
  blocked(r,'SHADOW_COVERAGE_MISSING_KEY_MONTH_FIXTURES');
  assert.equal(r.simulatedMissingKeyMonthPairs,1);
  assert.equal(r.simulatedUnmatchedRequestCount,1);
}));
test('active key missing later month is reported despite prior statement',()=>withSwitch(()=>{
  const s=example();s.statements.splice(1,1);
  const r=assess(encode(s));
  blocked(r,'SHADOW_COVERAGE_MISSING_KEY_MONTH_FIXTURES');
  assert.equal(r.simulatedMissingKeyMonthPairs,1);
  assert.equal(r.simulatedUnmatchedRequestCount,0);
}));
test('unmatched request remains unresolved even if all monthly fixtures exist',()=>withSwitch(()=>{
  const s=example();s.statements[2].request_ids=[];
  const r=assess(encode(s));
  blocked(r,'SHADOW_COVERAGE_UNMATCHED_REQUEST_FIXTURES');
  assert.equal(r.simulatedUnmatchedRequestCount,1);
}));
test('omitted key cannot be discovered from caller controlled inventory',()=>withSwitch(()=>{
  const s=example();
  s.keys.pop();s.attempts.pop();s.statements.pop();
  const r=assess(encode(s));
  blocked(r,'SHADOW_COVERAGE_ALL_FIXTURES_STILL_UNVERIFIED');
  assert.equal(r.simulatedDeclaredKeyCount,1);
  assert.equal(r.simulatedRequiredKeyMonthPairs,2);
}));
test('retired key cannot receive another month or later request',()=>withSwitch(()=>{
  const s=example();
  s.statements.push(statement('review-oct','retired-review-key','2026-10',
    'd',['review-old']));
  blocked(assess(encode(s)),'SHADOW_COVERAGE_STATEMENT_OUTSIDE_KEY_LIFECYCLE');
  const s2=example();s2.attempts[1].initiated_month_utc='2026-10';
  blocked(assess(encode(s2)),'SHADOW_COVERAGE_ATTEMPT_OUTSIDE_KEY_LIFECYCLE');
}));
test('duplicate keys, including across mock roles, are invalid',()=>withSwitch(()=>{
  const s=example();s.keys[1].key_id='dev-key';
  blocked(assess(encode(s)),'SHADOW_COVERAGE_KEY_INVALID_OR_DUPLICATE');
}));
test('duplicate statement IDs, SHA-form digests and key-month pairs rejected',()=>withSwitch(()=>{
  const a=example();a.statements[1].statement_id='dev-sep';
  blocked(assess(encode(a)),'SHADOW_COVERAGE_STATEMENT_UNTRUSTED_OR_DUPLICATE');
  const b=example();b.statements[1].digest_sha256='a'.repeat(64);
  blocked(assess(encode(b)),'SHADOW_COVERAGE_STATEMENT_UNTRUSTED_OR_DUPLICATE');
  const c=example();c.statements.push(
    statement('dev-sep-extra','dev-key','2026-09','d',[]));
  blocked(assess(encode(c)),
    'SHADOW_COVERAGE_MULTIPLE_STATEMENTS_SAME_KEY_MONTH');
}));
test('orphan invoice request, cross-key and predating lines rejected',()=>withSwitch(()=>{
  const a=example();a.statements[0].request_ids=['missing'];
  blocked(assess(encode(a)),'SHADOW_COVERAGE_ORPHAN_INVOICE_REQUEST');
  const b=example();b.statements[2].request_ids=['dev-old'];
  blocked(assess(encode(b)),'SHADOW_COVERAGE_CROSS_KEY_OR_PREDATED_INVOICE');
  const c=example();c.attempts[0].initiated_month_utc='2026-10';
  blocked(assess(encode(c)),'SHADOW_COVERAGE_CROSS_KEY_OR_PREDATED_INVOICE');
}));
test('within-statement duplicate request IDs rejected, late bills allowed but unverified',()=>withSwitch(()=>{
  const a=example();a.statements[0].request_ids.push('dev-old');
  blocked(assess(encode(a)),
    'SHADOW_COVERAGE_STATEMENT_REQUEST_INVALID_OR_DUPLICATE');
  const r=assess(encode(example()));
  blocked(r,'SHADOW_COVERAGE_ALL_FIXTURES_STILL_UNVERIFIED');
}));
test('untrusted provenance, fake provider coverage and injected fields rejected',()=>withSwitch(()=>{
  const changes=[
    s=>{s.scope='provider-verified';},
    s=>{s.watermark='authenticated';},
    s=>{s.providerBillingAuthenticated=true;},
    s=>{s.window.complete_through='2026-10';},
    s=>{s.keys[0].provider_account='live';},
    s=>{s.statements[0].source='openrouter-provider';},
    s=>{s.statements[0].provider_authenticated=true;},
    s=>{s.statements[0].digest_sha256='signed-by-openrouter';},
    s=>{s.statements[0].request_ids=['dev-old','../etc'];},
    s=>{s.attempts[0].state='paid-and-complete';},
    s=>{s.keys[0].role='production';},
    s=>{s.keys[1].retired_after_month_utc='2026-08';},
  ];
  for(const mutation of changes){
    const s=example();mutation(s);
    const r=assess(encode(s));blocked(r);
    assert.equal(r.simulatedObservedKeyMonthPairs,undefined);
  }
}));
test('window boundaries, excessive rows and malformed JSON fail closed',()=>withSwitch(()=>{
  const cases=[
    null,{},'not json',' '.repeat(65537),
    encode({...example(),keys:[]}),
    encode({...example(),window:{first_month_utc:'2025-01',
      last_month_utc:'2026-10'}}),
    encode({...example(),window:{first_month_utc:'2026-11',
      last_month_utc:'2026-10'}}),
    encode({...example(),statements:Array(241).fill(example().statements[0])}),
    encode({...example(),keys:Array(21).fill(example().keys[0])}),
  ];
  for(const input of cases){
    const r=assess(input);blocked(r);
    assert.equal(r.simulatedObservedKeyMonthPairs,undefined);
  }
}));
test('real spend gate and real Publisher do not import fixture coverage module',()=>{
  const real=readFileSync(new URL(
    '../scripts/protected-real-openrouter-review.mjs',import.meta.url),'utf8');
  const gate=readFileSync(new URL(
    '../scripts/openrouter-only-spend-gate.mjs',import.meta.url),'utf8');
  const module=readFileSync(new URL(
    '../scripts/openrouter-shadow-evidence-coverage-offline.mjs',
    import.meta.url),'utf8');
  for(const code of [real,gate])
    assert.doesNotMatch(code,/openrouter-shadow-evidence-coverage-offline/);
  assert.match(gate,/OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED/);
  assert.doesNotMatch(module,/OPENROUTER_API_KEY|https?:\/\/|fetch\s*\(/);
});

test('two unchanged synthetic snapshots remain BLOCKED, not authenticated',()=>withSwitch(()=>{
  const s=example();
  const r=compare(encode(s),encode(s));
  blocked(r,'SHADOW_CONTINUITY_STABLE_BUT_UNVERIFIED');
  assert.equal(r.simulatedRetainedKeyCount,2);
  assert.equal(r.simulatedRetainedStatementCount,3);
  assert.equal(r.simulatedAddedStatementCount,0);
}));
test('future month and later retirement can be added but remain unverified',()=>withSwitch(()=>{
  const s=example();s.window.last_month_utc='2026-11';
  s.keys[0].retired_after_month_utc='2026-10';
  const r=compare(encode(example()),encode(s));
  blocked(r,'SHADOW_CONTINUITY_STABLE_BUT_UNVERIFIED');
  assert.equal(r.currentCoverageReason,
    'SHADOW_COVERAGE_ALL_FIXTURES_STILL_UNVERIFIED');
}));
test('untrusted new snapshot and synthetic switch disabled fail closed',()=>{
  const previous=encode(example());
  const s=example();s.scope='provider-authenticated';
  blocked(withSwitch(()=>compare(previous,encode(s))),
    'SHADOW_CONTINUITY_SNAPSHOT_UNTRUSTED');
  const was=process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  delete process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  try{blocked(compare(previous,previous),
    'SHADOW_CONTINUITY_SNAPSHOT_UNTRUSTED');}
  finally{
    if(was!==undefined)process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY=was;
  }
});
test('shrinking a snapshot window is a blocked regression',()=>withSwitch(()=>{
  const next=example();
  next.window.last_month_utc='2026-09';
  next.statements.splice(1,1);
  blocked(compare(encode(example()),encode(next)),
    'SHADOW_CONTINUITY_WINDOW_REGRESSION');
}));
test('dropped key, old request and prior statement are detected',()=>withSwitch(()=>{
  const a=example();a.keys.pop();a.attempts.pop();a.statements.pop();
  blocked(compare(encode(example()),encode(a)),
    'SHADOW_CONTINUITY_KEY_DISAPPEARED');
  const b=example();b.attempts.pop();
  // Avoid an orphan mock invoice: this checks disappearance of the
  // registered request, not schema rejection of its old reference.
  b.statements[2].request_ids=[];
  blocked(compare(encode(example()),encode(b)),
    'SHADOW_CONTINUITY_ATTEMPT_DISAPPEARED');
  const c=example();c.statements.pop();
  blocked(compare(encode(example()),encode(c)),
    'SHADOW_CONTINUITY_STATEMENT_DISAPPEARED');
}));
test('reassigned key role or retroactive retirement cannot rewrite history',()=>withSwitch(()=>{
  const a=example();a.keys[0].role='reviewer_b';
  blocked(compare(encode(example()),encode(a)),
    'SHADOW_CONTINUITY_KEY_IDENTITY_CHANGED');
  const b=example();b.keys[1].retired_after_month_utc='2026-10';
  blocked(compare(encode(example()),encode(b)),
    'SHADOW_CONTINUITY_KEY_RETIREMENT_REWRITTEN');
}));
test('retroactive key introduced later is reported, never verified',()=>withSwitch(()=>{
  const s=example();
  s.keys.push({key_id:'hidden-old',role:'development',
    valid_from_month_utc:'2026-09',retired_after_month_utc:'2026-09'});
  s.statements.push(statement('hidden-sep','hidden-old','2026-09','d',[]));
  blocked(compare(encode(example()),encode(s)),
    'SHADOW_CONTINUITY_RETROACTIVE_KEY_DISCOVERY');
}));
test('retroactive request discovered after prior inventory is reported',()=>withSwitch(()=>{
  const s=example();
  s.attempts.push({request_id:'hidden-req',key_id:'dev-key',
    initiated_month_utc:'2026-09',state:'ambiguous'});
  blocked(compare(encode(example()),encode(s)),
    'SHADOW_CONTINUITY_RETROACTIVE_ATTEMPT_DISCOVERY');
}));
test('reclassification from ambiguous to fake settled is blocked',()=>withSwitch(()=>{
  const s=example();s.attempts[0].state='settled_fixture';
  blocked(compare(encode(example()),encode(s)),
    'SHADOW_CONTINUITY_ATTEMPT_RECLASSIFIED_UNVERIFIED');
}));
test('old invoice digest, key and request references cannot be rewritten',()=>withSwitch(()=>{
  const a=example();a.statements[0].digest_sha256='d'.repeat(64);
  blocked(compare(encode(example()),encode(a)),
    'SHADOW_CONTINUITY_STATEMENT_REWRITTEN');
  const b=example();b.statements[0].request_ids=[];
  blocked(compare(encode(example()),encode(b)),
    'SHADOW_CONTINUITY_STATEMENT_REWRITTEN');
}));
test('late insertion of previously missing key-month remains diagnostic',()=>withSwitch(()=>{
  const s=example();s.statements.pop();
  blocked(compare(encode(s),encode(example())),
    'SHADOW_CONTINUITY_RETROACTIVE_STATEMENT_DISCOVERY');
}));
test('fixture continuity is not imported into paid reviewer or spend gate',()=>{
  const real=readFileSync(new URL(
    '../scripts/protected-real-openrouter-review.mjs',import.meta.url),'utf8');
  const gate=readFileSync(new URL(
    '../scripts/openrouter-only-spend-gate.mjs',import.meta.url),'utf8');
  for(const s of [real,gate])
    assert.doesNotMatch(s,/assessSyntheticEvidenceContinuityOffline/);
  assert.match(gate,/OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED/);
});
