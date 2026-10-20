import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {canonicalJson} from '../src/canonical.mjs';
import {submitSignedShadowProposalSyntheticOnly}
  from '../scripts/openrouter-shadow-signed-admission-synthetic-only.mjs';

const sha=x=>createHash('sha256')
  .update(canonicalJson(x),'utf8').digest('hex');
const key=()=>generateKeyPairSync('ed25519');
const shadowKey=key(),serviceKey=key(),attackerKey=key();
const issuer='synthetic-service-account',audience='shadow-postgres-processor';
const UUID='22222222-3333-4333-8444-555555555555';
const DOMAIN_SHADOW=Buffer.from('DEVFACTORY-SHADOW-BUDGET-CLAIM-V1\0');
const DOMAIN_SERVICE=Buffer.from('DEVFACTORY-SHADOW-SERVICE-BINDING-V1\0');
const stamp=n=>new Date(Math.floor(n/1000)*1000).toISOString()
  .replace('.000Z','Z');
const spki=k=>createHash('sha256')
  .update(k.publicKey.export({type:'spki',format:'der'}))
  .digest('hex');
const month=()=>new Date().toISOString().slice(0,7);
function rec(k,owner,purpose){
 const now=Date.now();
 return {issuer:owner,purpose,
  publicKeyPem:k.publicKey.export({type:'spki',format:'pem'}),
  spkiSha256:spki(k),
  activatedAtMs:now-600000,retiredAtMs:now+600000,
  revokedAtMs:null};
}
function signed(payload,secret,prefix,id){
 const p={...payload};
 return {payload:p,signature:{algorithm:'Ed25519',
   key_id:id,value:sign(null,Buffer.concat([prefix,
     Buffer.from(canonicalJson(p))]),secret).toString('base64')}};
}
function fixture(){
 const now=Date.now();
 const shadowPayload={
   schema:'devfactory.reviewer-b.shadow-budget-claim.v1',
   issuer:'synthetic-shadow-issuer',
   key_purpose:'SHADOW_PROPOSAL_ONLY',
   repository:'deenkids7-dev/deenkids',
   pr_number:940,head_sha:'a'.repeat(40),
   model:'qwen/qwen3-coder-30b-a3b-instruct',
   service_comment_id:9222,owner_consent_comment_id:9333,
   month_utc:month(),upper_micro_eur:15000000,
   nonce:'11111111-2222-4333-8444-555555555555',
   issued_at:stamp(now-15000),expires_at:stamp(now+45000),
 };
 const shadow=signed(shadowPayload,shadowKey.privateKey,
   DOMAIN_SHADOW,'synthetic-shadow-key');
 const servicePayload={
   schema:'devfactory.shadow.service-binding.v1',
   issuer,audience,scope:'SHADOW_SERVICE_TRANSPORT_ONLY',
   shadow_envelope_sha256:sha(shadow),challenge:UUID,
   issued_at:stamp(now-5000),expires_at:stamp(now+35000),
 };
 const service=signed(servicePayload,serviceKey.privateKey,
   DOMAIN_SERVICE,'synthetic-service-key');
 const github=Object.fromEntries([
   'repository','pr_number','head_sha','model','service_comment_id',
   'owner_consent_comment_id','month_utc'].map(k=>[k,shadowPayload[k]]));
 return {shadow,service,github,
  trustedShadowKeys:new Map([['synthetic-shadow-key',
   rec(shadowKey,'synthetic-shadow-issuer','devfactory.shadow-only.v1')]]),
  trustedServiceKeys:new Map([['synthetic-service-key',
   rec(serviceKey,issuer,'devfactory.shadow-service-identity-only.v1')]]),
 };
}
function input(f,db){
 return {
  signedShadowJson:JSON.stringify(f.shadow),
  signedServiceJson:JSON.stringify(f.service),
  trustedShadowKeys:f.trustedShadowKeys,
  trustedServiceKeys:f.trustedServiceKeys,
  trustedGitHubContext:f.github,
  seenClaimNonces:new Set(),seenChallenges:new Set(),
  expectedIssuer:issuer,expectedAudience:audience,expectedChallenge:UUID,
  db,
 };
}
const synthetic=handler=>async()=>{
 const before=process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
 process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY='1';
 try{await handler()}finally{
  if(before===undefined)delete process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  else process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY=before;
 }
};
test('ordinary runtime refuses synthetic bridge before invoking database',async()=>{
 const old=process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
 delete process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
 try{
  const db={query:()=>{throw Error('SHOULD_NOT_BE_CALLED')}};
  const r=await submitSignedShadowProposalSyntheticOnly(input(fixture(),db));
  assert.equal(r.ok,false);
  assert.equal(r.reason,'SHADOW_SYNTHETIC_SWITCH_REQUIRED');
  assert.equal(r.maySpend,false);
 }finally{
  if(old!==undefined)process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY=old;
 }
});
test('dual signatures alone yield *only* verified, fixed SQL arguments',synthetic(async()=>{
 const f=fixture(),queries=[];
 const db={query:async(...args)=>{
  queries.push(args);
  return {rows:[{recorded:true,may_spend:false,
    provider_billing_authenticated:false}]};
 }};
 const r=await submitSignedShadowProposalSyntheticOnly(input(f,db));
 assert.equal(r.ok,true);
 assert.equal(r.recorded,true);
 for(const flag of ['mayReserve','maySpend','mayPublish','mayMerge',
   'providerBillingAuthenticated','protectedServiceAuthenticationDeployed',
   'serviceChallengeConsumedInProtectedProduction'])
   assert.equal(r[flag],false,flag);
 assert.equal(queries.length,1);
 const [query,values]=queries[0];
 assert.match(query,/^SELECT \* FROM reviewer_b_shadow.propose_exposure_with_challenge/);
 assert.deepEqual(values,[
  'deenkids7-dev/deenkids',940,'a'.repeat(40),9222,
  'qwen/qwen3-coder-30b-a3b-instruct','synthetic-9222',
  15000000,f.shadow.payload.nonce,sha(f.shadow),UUID,sha(f.service),
 ]);
 assert.equal(JSON.stringify(r).includes('synthetic-service-key'),false);
}));
test('mutated signature, forged HEAD, digest, context and challenge make ZERO SQL calls',synthetic(async()=>{
 const variations=[
  f=>{f.shadow.payload.head_sha='b'.repeat(40)},
  f=>{f.service.payload.challenge='33333333-4444-4333-8444-555555555555'},
  f=>{f.service.payload.shadow_envelope_sha256='f'.repeat(64)},
  f=>{f.github.head_sha='b'.repeat(40)},
  f=>{f.service.signature.value='A'.repeat(88)},
  f=>{f.service.signature.key_id='attacker-key'},
  f=>{f.shadow.payload.upper_micro_eur=1},
  f=>{f.trustedServiceKeys.get('synthetic-service-key').revokedAtMs=Date.now()-1000},
 ];
 for(const change of variations){
  const f=fixture();change(f);
  let calls=0;
  const db={query:async()=>{calls++;throw Error('NO DB')}};
  const r=await submitSignedShadowProposalSyntheticOnly(input(f,db));
  assert.equal(r.ok,false);
  assert.equal(r.reason,'SHADOW_SYNTHETIC_DUAL_SIGNATURE_UNVERIFIED');
  assert.equal(calls,0);
 }
}));
test('caller pricing, arbitrary DB SQL and dangerous JSON never become signed proof',synthetic(async()=>{
 const f=fixture(),db={query:()=>{throw Error('NEVER')}};
 for(const bad of [
  {signedShadowJson:'{"__proto__":{"admin":true}}'},
  {signedShadowJson:'x'.repeat(25000)},
  {signedShadowJson:{...f.shadow}},
  {signedServiceJson:'{"prototype":1}'},
  {signedServiceJson:'x'.repeat(9000)},
  {signedShadowJson:'[]'},
 ]){
  const r=await submitSignedShadowProposalSyntheticOnly({
   ...input(f,db),...bad,estimatedCostUsd:0,maySpend:true});
  assert.equal(r.ok,false);
  assert.equal(r.reason,'SHADOW_SYNTHETIC_JSON_INVALID');
 }
}));
test('unknown PostgreSQL outcome prevents automatic retries',synthetic(async()=>{
 const f=fixture();
 let calls=0;
 const db={query:async()=>{calls++;throw Error('ECONNRESET')}};
 const r=await submitSignedShadowProposalSyntheticOnly(input(f,db));
 assert.equal(r.reason,'SHADOW_SYNTHETIC_DB_OUTCOME_UNKNOWN_NO_RETRY');
 assert.equal(calls,1);
 assert.equal(r.maySpend,false);
}));
test('forged DB response never yields spend authority',synthetic(async()=>{
 const f=fixture();
 for(const row of [
  {recorded:true,may_spend:true,provider_billing_authenticated:false},
  {recorded:true,may_spend:false,provider_billing_authenticated:true},
  {recorded:'true',may_spend:false,provider_billing_authenticated:false},
 ]){
  const db={query:async()=>({rows:[row]})};
  const r=await submitSignedShadowProposalSyntheticOnly(input(f,db));
  assert.equal(r.ok,false);
  assert.equal(r.reason,'SHADOW_SYNTHETIC_DB_RESPONSE_UNTRUSTED');
  assert.equal(r.maySpend,false);
 }
}));
test('real protected Publisher does not import the synthetic signed bridge',async()=>{
 const {readFileSync}=await import('node:fs');
 for(const file of ['../scripts/protected-real-openrouter-review.mjs',
     '../scripts/openrouter-only-spend-gate.mjs']){
  const src=readFileSync(new URL(file,import.meta.url),'utf8');
  assert.doesNotMatch(src,/openrouter-shadow-signed-admission-synthetic-only/);
 }
 const gate=readFileSync(new URL('../scripts/openrouter-only-spend-gate.mjs',
   import.meta.url),'utf8');
 assert.match(gate,/OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED/);
});
test('disposable PGlite: genuine PostgreSQL migration consumes signed claim once',{
 skip:!process.env.SHADOW_PGLITE_ENTRY?
  'PGlite provisioned in isolated GitHub integration CI':false,
},synthetic(async()=>{
 const {readFileSync}=await import('node:fs');
 const {pathToFileURL}=await import('node:url');
 const {resolve}=await import('node:path');
 const {PGlite}=await import(pathToFileURL(
   resolve(process.env.SHADOW_PGLITE_ENTRY)).href);
 const db=new PGlite();
 try{
  for(const file of [
    'reviewer_b_shadow_central_pg_v1.sql',
    'reviewer_b_shadow_protected_roles_v1.sql',
    'reviewer_b_shadow_nonce_atomic_v1.sql',
    'reviewer_b_shadow_challenge_atomic_v1.sql',
  ]){
   await db.exec(readFileSync(new URL('../sql/'+file,import.meta.url),'utf8'));
  }
  const f=fixture();
  await db.query("INSERT INTO reviewer_b_shadow.monthly_periods(month_utc) VALUES(date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date)");
  await db.query(
    "INSERT INTO reviewer_b_shadow.issued_shadow_challenges("+
    "challenge_uuid,issuer,audience,month_utc,target_repo,pr_number,"+
    "head_sha,service_comment_id,model,upper_micro_eur,"+
    "shadow_digest,service_digest,issued_at,expires_at) VALUES("+
    "$1,'synthetic-service-account','shadow-postgres-processor',"+
    "date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date,"+
    "$2,$3,$4,$5,$6,15000000,$7,$8,clock_timestamp(),"+
    "clock_timestamp()+interval '45 seconds')",[
      UUID,'deenkids7-dev/deenkids',940,'a'.repeat(40),9222,
      'qwen/qwen3-coder-30b-a3b-instruct',
      sha(f.shadow),sha(f.service),
    ]);
  await db.exec('SET ROLE reviewer_b_shadow_invoker_v1');
  const positive=await submitSignedShadowProposalSyntheticOnly(input(f,db));
  assert.equal(positive.ok,true);
  assert.equal(positive.recorded,true);
  assert.equal(positive.maySpend,false);
  const again=await submitSignedShadowProposalSyntheticOnly(input(f,db));
  assert.equal(again.recorded,false);
  assert.equal(again.ok,false);
  await db.exec('RESET ROLE');
  const [ledger,nonces,challenges]=await Promise.all([
    db.query('SELECT reserved_micro_eur::text AS eur FROM reviewer_b_shadow.monthly_periods'),
    db.query('SELECT count(*)::integer AS n FROM reviewer_b_shadow.consumed_shadow_proofs'),
    db.query('SELECT count(*)::integer AS n FROM reviewer_b_shadow.issued_shadow_challenges WHERE consumed_at IS NOT NULL'),
  ]);
  assert.equal(ledger.rows[0].eur,'15000000');
  assert.equal(nonces.rows[0].n,1);
  assert.equal(challenges.rows[0].n,1);
 }finally{await db.close()}
}));
