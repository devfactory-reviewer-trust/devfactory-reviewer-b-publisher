import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessSyntheticReadOnlyAcquisitionPlanOffline as assess,
  assessSyntheticProxyBoundaryOffline as probe,
  assessSyntheticProxyIncidentOffline as classifyIncident,
  assessSyntheticIncidentAuditOffline as assessAudit,
  assessSyntheticIncidentAuditContinuityOffline as compareAudit}
  from '../scripts/openrouter-shadow-readonly-acquisition-plan-offline.mjs';

const plan=()=>({
  schema:'devfactory.openrouter-readonly-plan.synthetic.v1',
  scope:'illustrative-only',
  transport:'no-network',
  credential:{kind:'management-key-capability',
    status:'not-provisioned',storage:'none'},
  workspaces:['default','fixture:second'],
  operations:[
    {kind:'keys',method:'GET',path:'/api/v1/keys',
      workspace:'default',offset:0,include_disabled:true},
    {kind:'keys',method:'GET',path:'/api/v1/keys',
      workspace:'default',offset:20,include_disabled:true},
    {kind:'keys',method:'GET',path:'/api/v1/keys',
      workspace:'fixture:second',offset:0,include_disabled:true},
    {kind:'credits',method:'GET',path:'/api/v1/credits'},
  ],
});
const encode=v=>JSON.stringify(v);
const withSwitch=fn=>{
  const previous=process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY='1';
  try{return fn()}finally{
    if(previous===undefined)
      delete process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
    else process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY=previous;
  }
};
const blocked=(response,reason)=>{
  assert.equal(response.status,'BLOCKED');
  assert.equal(response.syntheticOnly,true);
  for(const key of [
    'verified','managementCredentialPresent','providerDataFetched',
    'providerBillingAuthenticated','accountCoverageAuthenticated',
    'readOnlyEnforcedInProduction','mayReadProviderData',
    'mayMutateProvider','maySpend','mayReserve',
    'mayRetryAmbiguousRequest','mayReleaseHold','mayDeploy',
  ])assert.equal(response[key],false,key);
  assert.ok(Object.isFrozen(response));
  if(reason)assert.equal(response.reason,reason);
};
test('without explicit synthetic switch, even valid descriptor is rejected',()=>{
  const prev=process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  delete process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  try{blocked(assess(encode(plan())),
    'SHADOW_READONLY_SYNTHETIC_SWITCH_REQUIRED');}
  finally{
    if(prev!==undefined)process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY=prev;
  }
});
test('two-workspace GET-only descriptor still has no authenticated authority',()=>withSwitch(()=>{
  const r=assess(encode(plan()));
  blocked(r,'SHADOW_READONLY_STRUCTURAL_PLAN_ONLY');
  assert.equal(r.simulatedDeclaredWorkspaceCount,2);
  assert.equal(r.simulatedKeyListOperations,3);
  assert.equal(r.simulatedCreditsReadOperations,1);
  assert.equal(r.simulatedPaginationExhaustionVerified,false);
  assert.equal(r.simulatedAccountEnumerationVerified,false);
}));
test('default workspace alone cannot prove complete provider account coverage',()=>withSwitch(()=>{
  const s=plan();
  s.workspaces=['default'];
  s.operations.splice(2,1);
  const r=assess(encode(s));
  blocked(r,'SHADOW_READONLY_STRUCTURAL_PLAN_ONLY');
  assert.equal(r.simulatedDeclaredWorkspaceCount,1);
  assert.equal(r.accountCoverageAuthenticated,false);
}));
test('no actual provider credentials, token or network transport accepted',()=>withSwitch(()=>{
  const mutations=[
    s=>{s.credential.status='active';},
    s=>{s.credential.storage='github-secret';},
    s=>{s.credential.token='synthetic';},
    s=>{s.authorization='Bearer fake';},
    s=>{s.transport='https-client';},
    s=>{s.scope='account-wide-verified';},
    s=>{s.verified=true;},
  ];
  for(const mutate of mutations){
    const s=plan();mutate(s);
    blocked(assess(encode(s)),'SHADOW_READONLY_PLAN_UNTRUSTED');
  }
}));
test('mutation verbs and chat/completions API are never allowlisted',()=>withSwitch(()=>{
  const variants=[
    {kind:'keys',method:'PATCH',path:'/api/v1/keys',
      workspace:'default',offset:0,include_disabled:true},
    {kind:'keys',method:'POST',path:'/api/v1/chat/completions',
      workspace:'default',offset:0,include_disabled:true},
    {kind:'keys',method:'DELETE',path:'/api/v1/keys',
      workspace:'default',offset:0,include_disabled:true},
    {kind:'credits',method:'POST',path:'/api/v1/credits'},
    {kind:'credits',method:'GET',path:'/api/v1/keys'},
  ];
  for(const op of variants){
    const s=plan();s.operations[0]=op;
    const r=assess(encode(s));
    blocked(r);
    assert.match(r.reason,/OPERATION_FORBIDDEN/);
  }
}));
test('unknown, computed and mutation-capable endpoints stay denied',()=>withSwitch(()=>{
  const operations=[
    {kind:'generation',method:'GET',path:'/api/v1/generation'},
    {kind:'key_update',method:'PATCH',path:'/api/v1/keys/fake'},
    {kind:'keys',method:'GET',path:'/api/v1/keys?offset=0',
      workspace:'default',offset:0,include_disabled:true},
    {kind:'keys',method:'GET',path:'/api/v1/keys/',
      workspace:'default',offset:0,include_disabled:true},
  ];
  for(const op of operations){
    const s=plan();s.operations[0]=op;
    const r=assess(encode(s));blocked(r);
    assert.match(r.reason,/NOT_ALLOWLISTED|OPERATION_FORBIDDEN/);
  }
}));
test('disabled and rotated-key omission cannot be described as complete',()=>withSwitch(()=>{
  const s=plan();s.operations[0].include_disabled=false;
  blocked(assess(encode(s)),'SHADOW_READONLY_KEY_LIST_OPERATION_FORBIDDEN');
}));
test('missing workspace first page or offset 0 is detected',()=>withSwitch(()=>{
  const s=plan();
  s.operations.splice(2,1);
  blocked(assess(encode(s)),'SHADOW_READONLY_WORKSPACE_FIRST_PAGE_MISSING');
  const t=plan();t.operations[2].offset=50;
  blocked(assess(encode(t)),'SHADOW_READONLY_WORKSPACE_FIRST_PAGE_MISSING');
}));
test('pagination duplication, unordered offsets and invalid limits blocked',()=>withSwitch(()=>{
  for(const offset of [0,-1,1.5,100001,'20',null]){
    const s=plan();s.operations[1].offset=offset;
    const r=assess(encode(s));blocked(r);
    assert.match(r.reason,/PAGINATION_REUSED_OR_UNSORTED|OPERATION_FORBIDDEN/);
  }
}));
test('missing or duplicate aggregate credits descriptor fails closed',()=>withSwitch(()=>{
  const s=plan();s.operations.pop();
  blocked(assess(encode(s)),'SHADOW_READONLY_CREDITS_READ_MISSING_OR_DUPLICATE');
  const t=plan();t.operations.push(
    {kind:'credits',method:'GET',path:'/api/v1/credits'});
  blocked(assess(encode(t)),'SHADOW_READONLY_CREDITS_READ_MISSING_OR_DUPLICATE');
}));
test('user cannot forge workspace enumeration or insert foreign workspace',()=>withSwitch(()=>{
  const s=plan();s.workspaces.push('default');
  blocked(assess(encode(s)),'SHADOW_READONLY_WORKSPACE_INVALID_OR_DUPLICATE');
  const t=plan();t.operations[2].workspace='fixture:unknown';
  blocked(assess(encode(t)),'SHADOW_READONLY_KEY_LIST_OPERATION_FORBIDDEN');
  const u=plan();u.workspaces=['fixture:second'];
  blocked(assess(encode(u)),'SHADOW_READONLY_DEFAULT_WORKSPACE_NOT_DECLARED');
  const v=plan();v.workspaces.push('https://evil.invalid');
  blocked(assess(encode(v)),'SHADOW_READONLY_WORKSPACE_INVALID_OR_DUPLICATE');
}));
test('strict field typing denies runnable hostnames, headers and HTTP bodies',()=>withSwitch(()=>{
  const cases=[
    s=>{s.operations[0].url='https://openrouter.ai';},
    s=>{s.operations[0].headers={Authorization:'Bearer hidden'};},
    s=>{s.operations[0].body={model:'paid'};},
    s=>{s.operations[0].offset=true;},
    s=>{s.operations[0].include_disabled='true';},
    s=>{s.operations[3].workspace='default';},
  ];
  for(const change of cases){
    const s=plan();change(s);
    const r=assess(encode(s));blocked(r);
    assert.match(r.reason,/OPERATION_FORBIDDEN/);
  }
}));
test('malformed JSON and oversized declarations remain denied',()=>withSwitch(()=>{
  const inputs=[
    null,{},'not-json',' '.repeat(16385),
    encode({...plan(),workspaces:[]}),
    encode({...plan(),operations:[]}),
    encode({...plan(),workspaces:Array(13).fill('default')}),
    encode({...plan(),operations:Array(61).fill(plan().operations[0])}),
  ];
  for(const input of inputs){
    const r=assess(input);blocked(r);
    assert.equal(r.reason,'SHADOW_READONLY_PLAN_UNTRUSTED');
  }
}));
test('design checker stays unimported by protected paid paths',()=>{
  const protectedFile=readFileSync(new URL(
    '../scripts/protected-real-openrouter-review.mjs',import.meta.url),'utf8');
  const gate=readFileSync(new URL(
    '../scripts/openrouter-only-spend-gate.mjs',import.meta.url),'utf8');
  const self=readFileSync(new URL(
    '../scripts/openrouter-shadow-readonly-acquisition-plan-offline.mjs',
    import.meta.url),'utf8');
  for(const s of [protectedFile,gate])
    assert.doesNotMatch(s,/openrouter-shadow-readonly-acquisition-plan-offline/);
  assert.match(gate,/OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED/);
  assert.doesNotMatch(self,/OPENROUTER_API_KEY|https?:\/\/|fetch\s*\(/);
});

const proxyFixture=()=>({
  schema:'devfactory.shadow-get-boundary.synthetic.v1',
  scope:'illustrative-only',transport:'no-network',
  credential:{tokenPresent:false,secretStoreConnected:false},
  request:{kind:'keys',method:'GET',workspace:'default',
    offset:0,include_disabled:true},
  upstream:{target:'symbolic-fixed-openrouter-api',
    tls:'required-unverified',redirects:'deny',
    forwardedHeaders:'none',dnsVerification:'not-performed'},
  response:{source:'unverified-fixture',httpStatus:200,
    contentType:'application/json',sizeBytes:1234,
    redirected:false,unexpectedSecrets:false},
  audit:{rawAuthorization:false,rawHeaders:false,rawResponse:false,
    unredactedProviderIds:false,automaticReplay:false},
});
test('proxy fixture that matches offline shape still has no real authority',()=>withSwitch(()=>{
  const r=probe(encode(proxyFixture()));
  blocked(r,'SHADOW_PROXY_FIXTURE_POLICY_MATCH_NOT_AUTHORITY');
  assert.equal(r.simulatedRequestKind,'keys');
  assert.equal(r.simulatedResponseBytes,1234);
  assert.equal(r.proxyDeployed,false);
  assert.equal(r.actualEgressRestricted,false);
  assert.equal(r.secretRedactionVerified,false);
  assert.equal(r.providerResponseAuthenticated,false);
}));
test('without synthetic opt-in, proxy model denies even harmless fixture',()=>{
  const prev=process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  delete process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  try{blocked(probe(encode(proxyFixture())),
    'SHADOW_PROXY_SYNTHETIC_SWITCH_REQUIRED');}
  finally{
    if(prev!==undefined)process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY=prev;
  }
});
test('symbolic credits GET is the only other acceptable mock operation',()=>withSwitch(()=>{
  const s=proxyFixture();s.request={kind:'credits',method:'GET'};
  blocked(probe(encode(s)),'SHADOW_PROXY_FIXTURE_POLICY_MATCH_NOT_AUTHORITY');
  for(const method of ['HEAD','POST','PATCH','PUT','DELETE','OPTIONS']){
    const item=proxyFixture();item.request.method=method;
    blocked(probe(encode(item)),'SHADOW_PROXY_READ_OPERATION_FORBIDDEN');
  }
}));
test('caller-controlled URL, host, path, query, port and headers rejected',()=>withSwitch(()=>{
  const changes=[
    s=>{s.request.url='https://other.invalid';},
    s=>{s.request.host='localhost';},
    s=>{s.request.path='/api/v1/keys';},
    s=>{s.request.query='offset=0';},
    s=>{s.request.port=443;},
    s=>{s.request.headers={Authorization:'Bearer fake'};},
    s=>{s.request.body={model:'paid'};},
    s=>{s.request.kind='generation';},
    s=>{s.request.workspace='..';},
  ];
  for(const change of changes){
    const s=proxyFixture();change(s);
    blocked(probe(encode(s)),'SHADOW_PROXY_READ_OPERATION_FORBIDDEN');
  }
}));
test('proxy cannot receive a real token, secret or runnable transport',()=>withSwitch(()=>{
  const changes=[
    s=>{s.credential.tokenPresent=true;},
    s=>{s.credential.secretStoreConnected=true;},
    s=>{s.credential.token='not-a-real-key';},
    s=>{s.transport='network';},
    s=>{s.scope='provider-authenticated';},
    s=>{s.credential.secretName='LIVE_KEY';},
    s=>{s.managementKey='untrusted';},
  ];
  for(const change of changes){
    const s=proxyFixture();change(s);
    blocked(probe(encode(s)),'SHADOW_PROXY_ENVELOPE_UNTRUSTED');
  }
}));
test('upstream SSRF, redirect and TLS design tampering is blocked',()=>withSwitch(()=>{
  const changes=[
    s=>{s.upstream.target='other-host';},
    s=>{s.upstream.target='127.0.0.1';},
    s=>{s.upstream.tls='http';},
    s=>{s.upstream.redirects='follow';},
    s=>{s.upstream.forwardedHeaders='all';},
    s=>{s.upstream.dnsVerification='proved';},
    s=>{s.upstream.proxy='attacker';},
    s=>{s.upstream.path='/api/v1/chat/completions';},
  ];
  for(const change of changes){
    const s=proxyFixture();change(s);
    blocked(probe(encode(s)),'SHADOW_PROXY_UPSTREAM_POLICY_UNTRUSTED');
  }
}));
test('logs may not retain credentials, raw responses or identifiers',()=>withSwitch(()=>{
  for(const field of [
    'rawAuthorization','rawHeaders','rawResponse',
    'unredactedProviderIds','automaticReplay']){
    const s=proxyFixture();s.audit[field]=true;
    blocked(probe(encode(s)),'SHADOW_PROXY_AUDIT_OR_REPLAY_UNSAFE');
  }
  const t=proxyFixture();t.audit.destination='user-controlled';
  blocked(probe(encode(t)),'SHADOW_PROXY_AUDIT_OR_REPLAY_UNSAFE');
}));
test('3xx response or simulated redirection is always blocked',()=>withSwitch(()=>{
  for(const status of [301,302,307,308]){
    const s=proxyFixture();s.response.httpStatus=status;
    blocked(probe(encode(s)),'SHADOW_PROXY_REDIRECT_FORBIDDEN');
  }
  const s=proxyFixture();s.response.redirected=true;
  blocked(probe(encode(s)),'SHADOW_PROXY_REDIRECT_FORBIDDEN');
}));
test('HTTP 401, 403, 404, 429 and 5xx never prove a free request',()=>withSwitch(()=>{
  for(const status of [0,204,401,403,404,408,409,429,500,502,503]){
    const s=proxyFixture();s.response.httpStatus=status;
    blocked(probe(encode(s)),'SHADOW_PROXY_UPSTREAM_OUTCOME_UNKNOWN_NO_RETRY');
  }
}));
test('mock response containing a secret marker is quarantined',()=>withSwitch(()=>{
  const s=proxyFixture();s.response.unexpectedSecrets=true;
  blocked(probe(encode(s)),'SHADOW_PROXY_RESPONSE_SECRET_MARKER');
}));
test('untrusted MIME or empty success response cannot imply completeness',()=>withSwitch(()=>{
  for(const contentType of ['text/html','application/x-ndjson',
    'application/json; charset=utf-8',null]){
    const s=proxyFixture();s.response.contentType=contentType;
    blocked(probe(encode(s)),'SHADOW_PROXY_RESPONSE_TYPE_OR_SIZE_INVALID');
  }
  const s=proxyFixture();s.response.sizeBytes=0;
  blocked(probe(encode(s)),'SHADOW_PROXY_RESPONSE_TYPE_OR_SIZE_INVALID');
}));
test('oversize, wrong-type and surprising reply fields fail closed',()=>withSwitch(()=>{
  const changes=[
    s=>{s.response.sizeBytes=65537;},
    s=>{s.response.sizeBytes=-1;},
    s=>{s.response.sizeBytes=1.5;},
    s=>{s.response.httpStatus='200';},
    s=>{s.response.redirected='false';},
    s=>{s.response.source='provider-signed';},
    s=>{s.response.headers={'set-cookie':'secret'};},
    s=>{s.response.body='raw-secret';},
    s=>{s.response.unexpectedSecrets=null;},
  ];
  for(const change of changes){
    const s=proxyFixture();change(s);
    blocked(probe(encode(s)),'SHADOW_PROXY_RESPONSE_UNTRUSTED');
  }
}));
test('synthetic proxy envelope is strictly bounded and reject unknown keys',()=>withSwitch(()=>{
  const malformed=[
    null,{},'bad json',' '.repeat(8193),
    encode({...proxyFixture(),proxyAuthorization:true}),
    encode({...proxyFixture(),request:null}),
    encode({...proxyFixture(),response:null}),
  ];
  for(const item of malformed){
    const r=probe(item);blocked(r);
    assert.match(r.reason,/ENVELOPE_UNTRUSTED|RESPONSE_UNTRUSTED|REQUEST_UNTRUSTED/);
  }
}));
test('protected paid Publisher still cannot import synthetic proxy model',()=>{
  const paid=readFileSync(new URL(
    '../scripts/protected-real-openrouter-review.mjs',import.meta.url),'utf8');
  const gate=readFileSync(new URL(
    '../scripts/openrouter-only-spend-gate.mjs',import.meta.url),'utf8');
  for(const s of [paid,gate])
    assert.doesNotMatch(s,/assessSyntheticProxyBoundaryOffline|shadow-readonly-acquisition-plan-offline/);
  assert.match(gate,/OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED/);
});

const incidentFixture=()=>({
  schema:'devfactory.shadow-get-incident.synthetic.v1',
  scope:'illustrative-only',transport:'no-network',
  operation:'keys',event:'response',httpStatus:200,
  bodyBytes:256,contentType:'application/json',responseComplete:true,
  source:'unverified-fixture',hasSecretMarker:false,retryAfterSeconds:null,
  audit:{rawAuthorization:false,rawBody:false,
    unredactedIds:false,autoRetry:false,
    autoReleaseHold:false,autoResumeRunner:false},
});
const incidentBlocked=(r,reason,category)=>{
  blocked(r,reason);
  assert.equal(r.syntheticIncidentOnly,true);
  assert.equal(r.simulatedManualInvestigationRequired,true);
  assert.equal(r.automaticRetryScheduled,false);
  assert.equal(r.simulatedBillIsSettled,false);
  assert.equal(r.simulatedProviderEvidenceVerified,false);
  if(category)assert.equal(r.simulatedIncidentClass,category);
};
test('incident classifier requires the explicit OFFLINE switch',()=>{
  const previous=process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  delete process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  try{incidentBlocked(classifyIncident(encode(incidentFixture())),
    'SHADOW_INCIDENT_SYNTHETIC_SWITCH_REQUIRED','invalid');}
  finally{
    if(previous!==undefined)
      process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY=previous;
  }
});
test('HTTP 200 fixture is never authenticated billing or settled',()=>withSwitch(()=>{
  incidentBlocked(classifyIncident(encode(incidentFixture())),
    'SHADOW_INCIDENT_200_UNVERIFIED_NOT_SETTLED','provenance');
}));
test('401 and 403 require manual identity review, not credential escalation',()=>withSwitch(()=>{
  for(const [status,reason] of [
    [401,'SHADOW_INCIDENT_AUTHENTICATION_REVIEW'],
    [403,'SHADOW_INCIDENT_AUTHORIZATION_REVIEW'],
  ]){
    const s=incidentFixture();s.httpStatus=status;
    incidentBlocked(classifyIncident(encode(s)),reason,'identity');
  }
}));
test('429 retry-after value never schedules any automatic GET or paid retry',()=>withSwitch(()=>{
  for(const secs of [null,0,1,60,86400]){
    const s=incidentFixture();s.httpStatus=429;s.retryAfterSeconds=secs;
    incidentBlocked(classifyIncident(encode(s)),
      'SHADOW_INCIDENT_RATE_LIMIT_MANUAL_REVIEW','rate-limit');
  }
}));
test('5xx, 404, 408, 409, 204 are not proof of absent bills',()=>withSwitch(()=>{
  for(const sCode of [500,502,503,599,404,408,409,204]){
    const s=incidentFixture();s.httpStatus=sCode;
    const reason=sCode>=500?'SHADOW_INCIDENT_PROVIDER_FAILURE_UNKNOWN':
      'SHADOW_INCIDENT_OTHER_STATUS_UNRESOLVED';
    incidentBlocked(classifyIncident(encode(s)),reason,'provider');
  }
}));
test('timeout, connection reset, DNS and TLS failure remain unknown',()=>withSwitch(()=>{
  for(const event of ['timeout','connection_reset','dns_failure',
    'tls_failure']){
    const s=incidentFixture();s.event=event;s.httpStatus=0;
    incidentBlocked(classifyIncident(encode(s)),
      'SHADOW_INCIDENT_NETWORK_UNKNOWN_NO_RETRY','network');
  }
}));
test('302, 307, 308 redirects are never followed',()=>withSwitch(()=>{
  for(const status of [301,302,307,308]){
    const s=incidentFixture();s.event='redirect';s.httpStatus=status;
    incidentBlocked(classifyIncident(encode(s)),
      'SHADOW_INCIDENT_REDIRECT_FORBIDDEN','network');
  }
}));
test('truncated, invalid JSON and incomplete 200 are not complete bills',()=>withSwitch(()=>{
  const variants=[
    s=>{s.event='truncated';s.httpStatus=0;},
    s=>{s.event='invalid_json';s.httpStatus=0;},
    s=>{s.responseComplete=false;},
  ];
  for(const modify of variants){
    const s=incidentFixture();modify(s);
    incidentBlocked(classifyIncident(encode(s)),
      'SHADOW_INCIDENT_RESPONSE_INCOMPLETE','provenance');
  }
}));
test('HTTP 200 wrong MIME or zero body cannot establish provenance',()=>withSwitch(()=>{
  for(const v of [
    s=>{s.contentType='other';},
    s=>{s.contentType='none';},
    s=>{s.bodyBytes=0;},
  ]){
    const s=incidentFixture();v(s);
    incidentBlocked(classifyIncident(encode(s)),
      'SHADOW_INCIDENT_UNTRUSTED_200_PAYLOAD','provenance');
  }
}));
test('unexpected secret marker escalates mock incident without logging it',()=>withSwitch(()=>{
  const s=incidentFixture();s.hasSecretMarker=true;
  incidentBlocked(classifyIncident(encode(s)),
    'SHADOW_INCIDENT_SECRET_EXPOSURE_REVIEW','security');
}));
test('unredacted logs, auto retries, hold release and runner wakeup forbidden',()=>withSwitch(()=>{
  for(const key of Object.keys(incidentFixture().audit)){
    const s=incidentFixture();s.audit[key]=true;
    incidentBlocked(classifyIncident(encode(s)),
      'SHADOW_INCIDENT_AUDIT_OR_AUTOMATION_FORBIDDEN','security');
  }
}));
test('status-event contradictions, including 200 on timeout, are denied',()=>withSwitch(()=>{
  for(const variant of [
    s=>{s.event='timeout';},
    s=>{s.event='response';s.httpStatus=0;},
    s=>{s.event='redirect';s.httpStatus=200;},
  ]){
    const s=incidentFixture();variant(s);
    incidentBlocked(classifyIncident(encode(s)),
      'SHADOW_INCIDENT_EVENT_STATUS_CONTRADICTORY','invalid');
  }
}));
test('malformed input, fake provider origin, embedded secret and extra fields denied',()=>withSwitch(()=>{
  const invalid=[
    null,{},'bad-json',' '.repeat(4097),
    encode({...incidentFixture(),credential:'live'}),
    encode({...incidentFixture(),verified:true}),
    encode({...incidentFixture(),source:'authenticated-openrouter'}),
    encode({...incidentFixture(),httpStatus:'200'}),
    encode({...incidentFixture(),bodyBytes:65537}),
    encode({...incidentFixture(),retryAfterSeconds:86401}),
    encode({...incidentFixture(),retryAfterSeconds:'120'}),
    encode({...incidentFixture(),event:'paid_completion'}),
    encode({...incidentFixture(),operation:'chat/completions'}),
    encode({...incidentFixture(),audit:{...incidentFixture().audit,
      remoteSink:'log-private-token'}}),
  ];
  for(const raw of invalid)
    incidentBlocked(classifyIncident(raw),
      'SHADOW_INCIDENT_FIXTURE_UNTRUSTED','invalid');
}));
test('synthetic incident tool cannot flow into protected paid dispatch paths',()=>{
  const paid=readFileSync(new URL(
    '../scripts/protected-real-openrouter-review.mjs',import.meta.url),'utf8');
  const gate=readFileSync(new URL(
    '../scripts/openrouter-only-spend-gate.mjs',import.meta.url),'utf8');
  const model=readFileSync(new URL(
    '../scripts/openrouter-shadow-readonly-acquisition-plan-offline.mjs',
    import.meta.url),'utf8');
  for(const text of [paid,gate])
    assert.doesNotMatch(text,/assessSyntheticProxyIncidentOffline|openrouter-shadow-readonly-acquisition-plan-offline/);
  assert.match(gate,/OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED/);
  assert.doesNotMatch(model,/OPENROUTER_API_KEY|https?:\/\/|fetch\s*\(/);
});

const incidentAuditFixture=()=>({
  schema:'devfactory.shadow-incident-audit.synthetic.v1',
  scope:'illustrative-only',transport:'no-network',
  incident_id:'incident:fixture-001',head_sha:'a'.repeat(40),
  request_digest_sha256:'b'.repeat(64),key_role:'development',
  events:[
    {sequence:1,event_id:'event:detected',type:'detected',
      occurred_utc:'2026-10-20T16:00:00Z',evidence_digest_sha256:null},
    {sequence:2,event_id:'event:triaged',type:'triaged',
      occurred_utc:'2026-10-20T16:01:00Z',evidence_digest_sha256:null},
    {sequence:3,event_id:'event:observed',type:'evidence_noted',
      occurred_utc:'2026-10-20T16:02:00Z',
      evidence_digest_sha256:'c'.repeat(64)},
  ],
  review:{status:'pending',providerEvidenceAuthenticated:false,
    independentReviewerApproved:false,humanGoGranted:false,
    holdReleaseApproved:false},
});
const mockReviewRequest=(s)=>{
  s.events.push({sequence:s.events.length+1,event_id:'event:review',
    type:'manual_review_requested',
    occurred_utc:'2026-10-20T16:03:00Z',
    evidence_digest_sha256:null});
  return s;
};
const auditBlocked=(r,reason)=>{
  blocked(r,reason);
  assert.equal(r.syntheticAuditOnly,true);
  assert.equal(r.simulatedHumanInvestigationRequired,true);
  assert.equal(r.actualAppendOnlyAuditVerified,false);
  assert.equal(r.actualHumanApprovalVerified,false);
  assert.equal(r.actualProviderEvidenceVerified,false);
  assert.equal(r.incidentMayBeClosed,false);
  assert.equal(r.automaticIncidentResolution,false);
  assert.equal(r.automaticRetryScheduled,false);
};
test('mock incident audit denies without explicit synthetic switch',()=>{
  const prev=process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  delete process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  try{auditBlocked(assessAudit(encode(incidentAuditFixture())),
    'SHADOW_AUDIT_SYNTHETIC_SWITCH_REQUIRED');}
  finally{
    if(prev!==undefined)process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY=prev;
  }
});
test('strict redacted audit fixture remains unverified and unclosable',()=>withSwitch(()=>{
  const r=assessAudit(encode(incidentAuditFixture()));
  auditBlocked(r,'SHADOW_AUDIT_PENDING_HUMAN_REVIEW_NO_AUTHORITY');
  assert.equal(r.simulatedEventCount,3);
  assert.equal(r.simulatedUnverifiedEvidenceCount,1);
  assert.equal(r.simulatedReviewRequested,false);
}));
test('mock request for manual review does NOT grant signed human approval',()=>withSwitch(()=>{
  const r=assessAudit(encode(mockReviewRequest(incidentAuditFixture())));
  auditBlocked(r,'SHADOW_AUDIT_PENDING_HUMAN_REVIEW_NO_AUTHORITY');
  assert.equal(r.simulatedEventCount,4);
  assert.equal(r.simulatedReviewRequested,true);
}));
test('forged approvals, hold releases and closed case statuses denied',()=>withSwitch(()=>{
  for(const change of [
    s=>{s.review.status='closed';},
    s=>{s.review.providerEvidenceAuthenticated=true;},
    s=>{s.review.independentReviewerApproved=true;},
    s=>{s.review.humanGoGranted=true;},
    s=>{s.review.holdReleaseApproved=true;},
  ]){
    const s=incidentAuditFixture();change(s);
    auditBlocked(assessAudit(encode(s)),
      'SHADOW_AUDIT_FORGED_HUMAN_OR_FINANCIAL_APPROVAL');
  }
}));
test('raw credentials, HTTP bodies, personal details and actors excluded by schema',()=>withSwitch(()=>{
  const changes=[
    s=>{s.authorization='Bearer TOKEN';},
    s=>{s.account_email='user@example.invalid';},
    s=>{s.raw_provider_payload={data:'private'};},
    s=>{s.events[1].raw_headers={Authorization:'secret'};},
    s=>{s.events[2].provider_request_id='unverified-raw-id';},
    s=>{s.events[2].actor='external-alleged-reviewer';},
    s=>{s.events[2].prompt='private prompt';},
    s=>{s.review.reviewer_name='unknown-person';},
    s=>{s.review.comment='unredacted body';},
  ];
  for(const f of changes){
    const s=incidentAuditFixture();f(s);
    const r=assessAudit(encode(s));
    auditBlocked(r);
    assert.match(r.reason,
      /^SHADOW_AUDIT_(FIXTURE_UNTRUSTED|EVENT_INVALID_OR_DUPLICATE)$/);
  }
}));
test('invalid incident, role, request digest or HEAD are rejected',()=>withSwitch(()=>{
  for(const change of [
    s=>{s.incident_id='../../root';},
    s=>{s.head_sha='f'.repeat(39);},
    s=>{s.head_sha='Z'.repeat(40);},
    s=>{s.request_digest_sha256='a'.repeat(63);},
    s=>{s.key_role='real-payment';},
  ]){
    const s=incidentAuditFixture();change(s);
    auditBlocked(assessAudit(encode(s)),'SHADOW_AUDIT_FIXTURE_UNTRUSTED');
  }
}));
test('sequence gaps, duplicate event IDs and invalid event kinds are denied',()=>withSwitch(()=>{
  const a=incidentAuditFixture();a.events[1].sequence=4;
  auditBlocked(assessAudit(encode(a)),
    'SHADOW_AUDIT_EVENT_INVALID_OR_DUPLICATE');
  const b=incidentAuditFixture();b.events[1].event_id='event:detected';
  auditBlocked(assessAudit(encode(b)),
    'SHADOW_AUDIT_EVENT_INVALID_OR_DUPLICATE');
  const c=incidentAuditFixture();c.events[2].type='human_approved';
  auditBlocked(assessAudit(encode(c)),
    'SHADOW_AUDIT_EVENT_INVALID_OR_DUPLICATE');
}));
test('detection must precede triage and review request must be terminal',()=>withSwitch(()=>{
  const a=incidentAuditFixture();a.events[0].type='triaged';
  auditBlocked(assessAudit(encode(a)),'SHADOW_AUDIT_INVALID_EVENT_ORDER');
  const b=incidentAuditFixture();b.events[1].type='evidence_noted';
  b.events[1].evidence_digest_sha256='d'.repeat(64);
  auditBlocked(assessAudit(encode(b)),'SHADOW_AUDIT_INVALID_EVENT_ORDER');
  const c=mockReviewRequest(incidentAuditFixture());
  c.events[2].type='manual_review_requested';
  c.events[2].evidence_digest_sha256=null;
  c.events[3].type='evidence_noted';
  c.events[3].evidence_digest_sha256='d'.repeat(64);
  auditBlocked(assessAudit(encode(c)),'SHADOW_AUDIT_INVALID_EVENT_ORDER');
}));
test('time reversals, non-UTC times and impossible calendar days fail',()=>withSwitch(()=>{
  const a=incidentAuditFixture();a.events[2].occurred_utc='2026-10-20T15:00:00Z';
  auditBlocked(assessAudit(encode(a)),
    'SHADOW_AUDIT_TIME_REGRESSION_OR_INVALID');
  for(const value of [
    '2026-10-20T16:02:00+02:00',
    '2026-02-30T16:02:00Z','2026-13-20T16:02:00Z',
    '2026-10-20 16:02:00Z',
  ]){
    const b=incidentAuditFixture();b.events[2].occurred_utc=value;
    auditBlocked(assessAudit(encode(b)),
      'SHADOW_AUDIT_TIME_REGRESSION_OR_INVALID');
  }
}));
test('evidence events need distinct mock digests, never raw receipts',()=>withSwitch(()=>{
  const a=incidentAuditFixture();a.events[2].evidence_digest_sha256=null;
  auditBlocked(assessAudit(encode(a)),
    'SHADOW_AUDIT_EVIDENCE_DIGEST_UNTRUSTED');
  const b=incidentAuditFixture();b.events[1].evidence_digest_sha256='e'.repeat(64);
  auditBlocked(assessAudit(encode(b)),
    'SHADOW_AUDIT_EVIDENCE_DIGEST_UNTRUSTED');
  const c=incidentAuditFixture();
  c.events.push({sequence:4,event_id:'event:duplicate',type:'evidence_noted',
    occurred_utc:'2026-10-20T16:03:00Z',
    evidence_digest_sha256:'c'.repeat(64)});
  auditBlocked(assessAudit(encode(c)),'SHADOW_AUDIT_EVIDENCE_DIGEST_REUSED');
}));
test('empty, oversized, malformed and excessively long fixture denied',()=>withSwitch(()=>{
  const x=incidentAuditFixture();x.events.pop();x.events.pop();
  const y=incidentAuditFixture();
  for(let i=4;i<=66;i++)y.events.push({
    sequence:i,event_id:'event:'+i,type:'evidence_noted',
    occurred_utc:'2026-10-20T16:04:00Z',
    evidence_digest_sha256:i.toString(16).padStart(64,'0'),
  });
  for(const input of [null,{},'invalid',' '.repeat(16385),
    encode(x),encode(y),encode({...incidentAuditFixture(),scope:'trusted'})]){
    auditBlocked(assessAudit(input),'SHADOW_AUDIT_FIXTURE_UNTRUSTED');
  }
}));
test('immutable prefix accepts appended observation without granting rights',()=>withSwitch(()=>{
  const a=incidentAuditFixture(),b=incidentAuditFixture();
  b.events.push({sequence:4,event_id:'event:extra',type:'evidence_noted',
    occurred_utc:'2026-10-20T16:03:00Z',
    evidence_digest_sha256:'d'.repeat(64)});
  const r=compareAudit(encode(a),encode(b));
  auditBlocked(r,'SHADOW_AUDIT_CONTINUITY_UNVERIFIED_NO_RELEASE');
  assert.equal(r.simulatedPreviousEventCount,3);
  assert.equal(r.simulatedCurrentEventCount,4);
  assert.equal(r.simulatedAppendCount,1);
}));
test('retracted or edited prior event cannot silently rewrite mock audit',()=>withSwitch(()=>{
  const original=mockReviewRequest(incidentAuditFixture());
  const shrink=incidentAuditFixture();
  auditBlocked(compareAudit(encode(original),encode(shrink)),
    'SHADOW_AUDIT_EVENT_RETRACTED');
  const modified=mockReviewRequest(incidentAuditFixture());
  modified.events[2].evidence_digest_sha256='e'.repeat(64);
  auditBlocked(compareAudit(encode(original),encode(modified)),
    'SHADOW_AUDIT_EVENT_REWRITTEN');
}));
test('changed incident identity, future post-review append and forged state denied',()=>withSwitch(()=>{
  const a=incidentAuditFixture(),b=incidentAuditFixture();
  b.head_sha='f'.repeat(40);
  auditBlocked(compareAudit(encode(a),encode(b)),
    'SHADOW_AUDIT_INCIDENT_IDENTITY_CHANGED');
  const c=mockReviewRequest(incidentAuditFixture());
  const d=mockReviewRequest(incidentAuditFixture());
  d.events.push({sequence:5,event_id:'event:late',type:'evidence_noted',
    occurred_utc:'2026-10-20T16:04:00Z',
    evidence_digest_sha256:'e'.repeat(64)});
  auditBlocked(compareAudit(encode(c),encode(d)),
    'SHADOW_AUDIT_CONTINUITY_INPUT_UNTRUSTED');
  const e=incidentAuditFixture();e.review.status='approved';
  auditBlocked(compareAudit(encode(a),encode(e)),
    'SHADOW_AUDIT_CONTINUITY_INPUT_UNTRUSTED');
}));
test('audit proposal cannot be imported into paid Publisher or spend gate',()=>{
  const paid=readFileSync(new URL(
    '../scripts/protected-real-openrouter-review.mjs',import.meta.url),'utf8');
  const gate=readFileSync(new URL(
    '../scripts/openrouter-only-spend-gate.mjs',import.meta.url),'utf8');
  for(const code of [paid,gate])
    assert.doesNotMatch(code,/assessSyntheticIncidentAuditOffline|assessSyntheticIncidentAuditContinuityOffline|openrouter-shadow-readonly-acquisition-plan-offline/);
  assert.match(gate,/OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED/);
});
