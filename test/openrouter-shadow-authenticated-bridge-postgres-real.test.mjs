import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {canonicalJson} from '../src/canonical.mjs';
import {submitViaProtectedReceiverSyntheticOnly}
 from '../scripts/openrouter-shadow-authenticated-bridge-synthetic-only.mjs';

const migrations=[
 'reviewer_b_shadow_central_pg_v1.sql',
 'reviewer_b_shadow_protected_roles_v1.sql',
 'reviewer_b_shadow_nonce_atomic_v1.sql',
 'reviewer_b_shadow_challenge_atomic_v1.sql',
 'reviewer_b_shadow_authenticated_receiver_v1.sql',
].map(name=>readFileSync(new URL('../sql/'+name,import.meta.url),'utf8'));
const PASS='synthetic-shadow-ci-only-20261020';
const repo='deenkids7-dev/deenkids';
const issuer='synthetic-service-account',audience='shadow-postgres-processor';
const challenge='22222222-3333-4333-8444-555555555555';
const shadowKey=generateKeyPairSync('ed25519');
const serviceKey=generateKeyPairSync('ed25519');
const issued=n=>new Date(Math.floor(n/1000)*1000).toISOString().replace('.000Z','Z');
const hash=o=>createHash('sha256').update(canonicalJson(o)).digest('hex');
function keys(pair,owner,purpose){
 const time=Date.now();
 return {issuer:owner,purpose,
  publicKeyPem:pair.publicKey.export({format:'pem',type:'spki'}),
  spkiSha256:createHash('sha256')
    .update(pair.publicKey.export({format:'der',type:'spki'}))
    .digest('hex'),
  activatedAtMs:time-600000,retiredAtMs:time+600000,revokedAtMs:null};
}
function signed(p,pair,prefix,id){
 const payload={...p};
 return {payload,signature:{algorithm:'Ed25519',key_id:id,
  value:sign(null,Buffer.concat([Buffer.from(prefix),Buffer.from(canonicalJson(payload))]),
   pair.privateKey).toString('base64')}};
}
function proof(){
 const now=Date.now();
 const shadow=signed({
  schema:'devfactory.reviewer-b.shadow-budget-claim.v1',
  issuer:'synthetic-shadow-issuer',key_purpose:'SHADOW_PROPOSAL_ONLY',
  repository:repo,pr_number:940,head_sha:'a'.repeat(40),
  model:'qwen/qwen3-coder-30b-a3b-instruct',
  service_comment_id:9222,owner_consent_comment_id:9333,
  month_utc:new Date(now).toISOString().slice(0,7),
  upper_micro_eur:15000000,
  nonce:'11111111-2222-4333-8444-555555555555',
  issued_at:issued(now-10000),expires_at:issued(now+45000),
 },shadowKey,'DEVFACTORY-SHADOW-BUDGET-CLAIM-V1\0','test-shadow');
 const service=signed({
  schema:'devfactory.shadow.service-binding.v1',
  issuer,audience,scope:'SHADOW_SERVICE_TRANSPORT_ONLY',
  shadow_envelope_sha256:hash(shadow),challenge,
  issued_at:issued(now-5000),expires_at:issued(now+35000),
 },serviceKey,'DEVFACTORY-SHADOW-SERVICE-BINDING-V1\0','test-service');
 const c=shadow.payload;
 return {shadow,service,
  params:{
   signedShadowJson:JSON.stringify(shadow),
   signedServiceJson:JSON.stringify(service),
   trustedShadowKeys:new Map([['test-shadow',keys(shadowKey,
    'synthetic-shadow-issuer','devfactory.shadow-only.v1')]]),
   trustedServiceKeys:new Map([['test-service',keys(serviceKey,
    issuer,'devfactory.shadow-service-identity-only.v1')]]),
   trustedGitHubContext:Object.fromEntries([
    'repository','pr_number','head_sha','model','service_comment_id',
    'owner_consent_comment_id','month_utc'].map(k=>[k,c[k]])),
   seenClaimNonces:new Set(),seenChallenges:new Set(),
   expectedIssuer:issuer,expectedAudience:audience,expectedChallenge:challenge,
  }};
}
test('real PostgreSQL16 authenticated session + two Ed25519 proofs (no paid calls)',{
 skip:process.env.SHADOW_POSTGRES_REAL!=='1'||!process.env.SHADOW_PG_CLIENT_ENTRY?
  'isolated GitHub Actions postgres:16.4 job only':false,
 timeout:60000,
},async t=>{
 assert.equal(process.env.PGHOST,'127.0.0.1');
 assert.equal(process.env.PGPASSWORD,PASS);
 const pg=await import(pathToFileURL(process.env.SHADOW_PG_CLIENT_ENTRY).href);
 const Client=pg.default?.Client||pg.Client;
 const connect=(user='postgres')=>new Client({
  host:'127.0.0.1',port:5432,user,password:PASS,database:'postgres',
  connectionTimeoutMillis:2500,query_timeout:4500});
 const admin=connect(),receiver=connect('reviewer_b_shadow_receiver_v1'),
   wrong=connect('synthetic_attacker_client');
 t.after(async()=>Promise.all([admin,receiver,wrong].map(c=>c.end().catch(()=>{}))));
 await admin.connect();
 for(const migration of migrations)await admin.query(migration);
 await admin.query("INSERT INTO reviewer_b_shadow.monthly_periods(month_utc) VALUES(date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date)");
 const signedProof=proof();
 const shadow=signedProof.shadow,service=signedProof.service;
 await admin.query(
  'INSERT INTO reviewer_b_shadow.issued_shadow_challenges('+
  'challenge_uuid,issuer,audience,month_utc,target_repo,pr_number,'+
  'head_sha,service_comment_id,model,upper_micro_eur,'+
  'shadow_digest,service_digest,issued_at,expires_at) VALUES ('+
  "$1,'synthetic-service-account','shadow-postgres-processor',"+
  "date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date,"+
  "$2,$3,$4,$5,$6,15000000,$7,$8,"+
  "clock_timestamp(),clock_timestamp()+interval '45 seconds')",
  [challenge,repo,940,'a'.repeat(40),9222,
   'qwen/qwen3-coder-30b-a3b-instruct',hash(shadow),hash(service)]);
 await admin.query("CREATE ROLE synthetic_attacker_client LOGIN INHERIT PASSWORD 'synthetic-shadow-ci-only-20261020'");
 await admin.query('GRANT reviewer_b_shadow_receiver_v1 TO synthetic_attacker_client');
 await wrong.connect();
 await wrong.query('SET ROLE reviewer_b_shadow_receiver_v1');
 const wrongIdentity=(await wrong.query('SELECT session_user AS who')).rows[0].who;
 assert.equal(wrongIdentity,'synthetic_attacker_client');
 const prior=process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
 process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY='1';
 try{
  const fake=await submitViaProtectedReceiverSyntheticOnly({
   ...signedProof.params,db:wrong});
  assert.equal(fake.recorded,false);
  assert.equal(fake.maySpend,false);
  const untouched=await admin.query(
   'SELECT count(*)::integer AS n FROM reviewer_b_shadow.consumed_shadow_proofs');
  assert.equal(untouched.rows[0].n,0);

  // The receiver was NOLOGIN until this test-only superuser action.
  const role=await admin.query(
   "SELECT rolcanlogin FROM pg_catalog.pg_roles WHERE rolname='reviewer_b_shadow_receiver_v1'");
  assert.equal(role.rows[0].rolcanlogin,false);
  await admin.query("ALTER ROLE reviewer_b_shadow_receiver_v1 LOGIN PASSWORD 'synthetic-shadow-ci-only-20261020'");
  await receiver.connect();
  const real=(await receiver.query('SELECT session_user AS who')).rows[0].who;
  assert.equal(real,'reviewer_b_shadow_receiver_v1');

  // A genuinely authenticated PostgreSQL receiver LOGIN is NOT proof
  // that its caller presented valid Ed25519 envelopes. Reject malformed
  // or independently mismatched proof data BEFORE sending any SQL write.
  const negativeClaims=[
   {...signedProof.params,signedShadowJson:JSON.stringify({
     ...shadow,payload:{...shadow.payload,head_sha:'b'.repeat(40)}})},
   {...signedProof.params,signedShadowJson:JSON.stringify({
     ...shadow,payload:{...shadow.payload,upper_micro_eur:1}})},
   {...signedProof.params,signedServiceJson:JSON.stringify({
     ...service,signature:{...service.signature,value:'A'.repeat(88)}})},
   {...signedProof.params,trustedGitHubContext:{
     ...signedProof.params.trustedGitHubContext,head_sha:'b'.repeat(40)}},
   {...signedProof.params,expectedChallenge:
     '33333333-4444-4333-8444-555555555555'},
  ];
  for(const invalid of negativeClaims){
    const rejected=await submitViaProtectedReceiverSyntheticOnly({
      ...invalid,db:receiver});
    assert.equal(rejected.ok,false);
    assert.equal(rejected.recorded,false);
    assert.equal(rejected.maySpend,false);
  }
  const beforePositive=await Promise.all([
   admin.query('SELECT reserved_micro_eur::text AS total FROM reviewer_b_shadow.monthly_periods'),
   admin.query('SELECT count(*)::integer AS n FROM reviewer_b_shadow.consumed_shadow_proofs'),
   admin.query('SELECT count(*)::integer AS n FROM reviewer_b_shadow.issued_shadow_challenges WHERE consumed_at IS NOT NULL'),
  ]);
  assert.equal(beforePositive[0].rows[0].total,'0');
  assert.equal(beforePositive[1].rows[0].n,0);
  assert.equal(beforePositive[2].rows[0].n,0);

  const approved=await submitViaProtectedReceiverSyntheticOnly({
   ...signedProof.params,db:receiver});
  assert.equal(approved.ok,true);
  assert.equal(approved.recorded,true);
  for(const key of ['maySpend','mayReserve','mayMerge','mayPublish',
   'protectedServiceAuthenticationDeployed'])
   assert.equal(approved[key],false,key);
  const replay=await submitViaProtectedReceiverSyntheticOnly({
   ...signedProof.params,db:receiver});
  assert.equal(replay.ok,false);
  assert.equal(replay.recorded,false);
  const [period,nonce,consumed]=await Promise.all([
   admin.query('SELECT reserved_micro_eur::text AS total FROM reviewer_b_shadow.monthly_periods'),
   admin.query('SELECT count(*)::integer AS n FROM reviewer_b_shadow.consumed_shadow_proofs'),
   admin.query('SELECT count(*)::integer AS n FROM reviewer_b_shadow.issued_shadow_challenges WHERE consumed_at IS NOT NULL'),
  ]);
  assert.equal(period.rows[0].total,'15000000');
  assert.equal(nonce.rows[0].n,1);
  assert.equal(consumed.rows[0].n,1);
 }finally{
  if(prior===undefined)delete process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  else process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY=prior;
 }
});
test('synthetic receiver rejects option smuggling and accessor traps before SQL',async()=>{
 const prior=process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
 process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY='1';
 try{
  let queries=0,getters=0;
  const db={query(){queries++;return {rows:[]}}};
  const validShape={...proof().params,db};
  const accessor=Object.defineProperty({...validShape},'expectedIssuer',{
   enumerable:true,get(){getters++;return issuer;},
  });
  const queryAccessor=Object.defineProperty({},'query',{
   enumerable:true,get(){getters++;return ()=>{queries++;};},
  });
  const badInputs=[
   {...validShape,sql:'SELECT 1'},
   {...validShape,upper_micro_eur:1},
   {...validShape,head_sha:'b'.repeat(40)},
   {...validShape,now:0},
   accessor,
   {...validShape,db:queryAccessor},
   Object.create(validShape),
  ];
  for(const input of badInputs){
   const result=await submitViaProtectedReceiverSyntheticOnly(input);
   assert.equal(result.ok,false);
   assert.equal(result.recorded,false);
   assert.equal(result.maySpend,false);
   assert.equal(result.mayReserve,false);
   assert.equal(result.reason,'SHADOW_RECEIVER_SYNTHETIC_INPUT_UNTRUSTED');
  }
  assert.equal(queries,0,'no SQL from rejected inputs');
  assert.equal(getters,0,'no getter evaluated');
 }finally{
  if(prior===undefined)delete process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY;
  else process.env.REVIEWER_B_SYNTHETIC_SHADOW_ONLY=prior;
 }
});
test('static: authenticated test bridge cannot import or alter paid Publisher',()=>{
 const module=readFileSync(new URL('../scripts/openrouter-shadow-authenticated-bridge-synthetic-only.mjs',import.meta.url),'utf8');
 assert.match(module,/propose_exposure_authenticated_receiver/);
 assert.doesNotMatch(module,/maySpend:true|OPENROUTER_API_KEY/);
 for(const file of ['../scripts/openrouter-only-spend-gate.mjs',
   '../scripts/protected-real-openrouter-review.mjs']){
  const source=readFileSync(new URL(file,import.meta.url),'utf8');
  assert.doesNotMatch(source,/openrouter-shadow-authenticated-bridge-synthetic-only/);
 }
 const lock=readFileSync(new URL('../scripts/openrouter-only-spend-gate.mjs',import.meta.url),'utf8');
 assert.match(lock,/OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED/);
});
