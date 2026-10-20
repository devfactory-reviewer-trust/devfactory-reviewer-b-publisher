// Real ephemeral PostgreSQL 16 integration; no provider requests or secrets.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const sql=['reviewer_b_shadow_central_pg_v1.sql',
 'reviewer_b_shadow_protected_roles_v1.sql',
 'reviewer_b_shadow_nonce_atomic_v1.sql',
 'reviewer_b_shadow_challenge_atomic_v1.sql']
 .map(n=>readFileSync(new URL('../sql/'+n,import.meta.url),'utf8'));
const PASS='synthetic-shadow-ci-only-20261020';
const uuid=i=>'11111111-2222-4333-8444-'+i.toString(16).padStart(12,'0');
const digest=i=>i.toString(16).padStart(64,'0');
const repo='deenkids7-dev/deenkids',model='qwen/qwen3-coder-30b-a3b-instruct';
const args=(i=10,n=30,s=40)=>[repo,5400,'a'.repeat(40),55440,model,
 'synthetic-challenge-5400',15000000,uuid(n),digest(n),uuid(i),digest(s)];
const query=(c,p)=>c.query(
 'SELECT * FROM reviewer_b_shadow.propose_exposure_with_challenge($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',p);
async function call(c,p){
 const rows=(await query(c,p)).rows;
 assert.equal(rows.length,1);
 assert.equal(rows[0].may_spend,false);
 assert.equal(rows[0].provider_billing_authenticated,false);
 return rows[0];
}
async function state(db){
 const [a,b,c,d]=await Promise.all([
   db.query('SELECT reserved_micro_eur::text AS n FROM reviewer_b_shadow.monthly_periods'),
   db.query('SELECT count(*)::integer AS n FROM reviewer_b_shadow.exposure_proposals'),
   db.query('SELECT count(*)::integer AS n FROM reviewer_b_shadow.consumed_shadow_proofs'),
   db.query('SELECT count(*)::integer AS n FROM reviewer_b_shadow.issued_shadow_challenges WHERE consumed_at IS NOT NULL')]);
 return {euros:a.rows[0].n,proposals:b.rows[0].n,
   nonces:c.rows[0].n,consumed:d.rows[0].n};
}
async function issue(db,{challenge=10,nonce=30,service=40,expired=false,
   durationSeconds=45,pr=5400,head='a'.repeat(40),comment=55440}={}){
 const insert='INSERT INTO reviewer_b_shadow.issued_shadow_challenges ('+
  'challenge_uuid,issuer,audience,month_utc,target_repo,pr_number,'+
  'head_sha,service_comment_id,model,upper_micro_eur,shadow_digest,'+
  'service_digest,issued_at,expires_at) VALUES ('+
  "$1,'synthetic-service-account','shadow-postgres-processor',"+
  "date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date,"+
  "$2,$3,$4,$5,$6,15000000,$7,$8,"+
  "clock_timestamp()-($9::integer*interval '1 second'),"+
  "clock_timestamp()+(($10::integer-$9::integer)*interval '1 second'))";
 await db.query(insert,[uuid(challenge),repo,pr,head,comment,model,
   digest(nonce),digest(service),expired?120:0,durationSeconds]);
}
test('PostgreSQL: nonce + receiver challenge consume atomically under contention',{
 skip:process.env.SHADOW_POSTGRES_REAL!=='1'||!process.env.SHADOW_PG_CLIENT_ENTRY?
   'isolated PostgreSQL16 CI required':false,
 timeout:75000,
},async t=>{
 assert.equal(process.env.PGHOST,'127.0.0.1');
 assert.equal(process.env.PGPASSWORD,PASS);
 const pg=await import(pathToFileURL(process.env.SHADOW_PG_CLIENT_ENTRY).href);
 const Client=pg.default?.Client||pg.Client;
 const client=(user='postgres')=>new Client({
   host:'127.0.0.1',port:5432,user,password:PASS,database:'postgres',
   connectionTimeoutMillis:3000,query_timeout:5000});
 const admin=client(),a=client('synthetic_challenge_client'),
   b=client('synthetic_challenge_client');
 t.after(async()=>Promise.all([admin,a,b].map(c=>c.end().catch(()=>{}))));
 await admin.connect();
 for(const migration of sql)await admin.query(migration);
 await admin.query("INSERT INTO reviewer_b_shadow.monthly_periods(month_utc) VALUES(date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date)");
 await admin.query("CREATE ROLE synthetic_challenge_client LOGIN INHERIT PASSWORD 'synthetic-shadow-ci-only-20261020'");
 await admin.query('GRANT reviewer_b_shadow_invoker_v1 TO synthetic_challenge_client');
 await a.connect();await b.connect();
 const access=await a.query(
 "SELECT has_function_privilege('reviewer_b_shadow.propose_exposure_once(text,integer,text,bigint,text,text,bigint,uuid,text)','EXECUTE') AS old,"+
 "has_function_privilege('reviewer_b_shadow.propose_exposure_with_challenge(text,integer,text,bigint,text,text,bigint,uuid,text,uuid,text)','EXECUTE') AS current,"+
 "has_table_privilege('reviewer_b_shadow.issued_shadow_challenges','INSERT') AS issue,"+
 "has_table_privilege('reviewer_b_shadow.issued_shadow_challenges','UPDATE') AS bypass");
 assert.deepEqual(access.rows[0],{old:false,current:true,issue:false,bypass:false});
 await assert.rejects(()=>a.query(
  'SELECT * FROM reviewer_b_shadow.propose_exposure_once($1,$2,$3,$4,$5,$6,$7,$8,$9)',
  args().slice(0,9)),e=>e.code==='42501');
 assert.equal((await call(a,args())).reason,'SHADOW_CHALLENGE_UNKNOWN');
 await issue(admin);

 // Adversarial issue-time regression: an operator-provisioned challenge
 // dated in the future is NOT available until its issued_at timestamp.
 // The previous SQL only checked expires_at, allowing premature use.
 await admin.query(
  "INSERT INTO reviewer_b_shadow.issued_shadow_challenges("+
  "challenge_uuid,issuer,audience,month_utc,target_repo,pr_number,"+
  "head_sha,service_comment_id,model,upper_micro_eur,shadow_digest,"+
  "service_digest,issued_at,expires_at) VALUES("+
  "$1,'synthetic-service-account','shadow-postgres-processor',"+
  "date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date,"+
  "$2,$3,$4,$5,$6,15000000,$7,$8,"+
  "clock_timestamp()+interval '20 seconds',"+
  "clock_timestamp()+interval '45 seconds')",
  [uuid(15),repo,5410,'e'.repeat(40),55450,model,digest(35),digest(45)]);
 const premature=[repo,5410,'e'.repeat(40),55450,model,
   'synthetic-challenge-5410',15000000,
   uuid(35),digest(35),uuid(15),digest(45)];
 assert.equal((await call(a,premature)).reason,
   'SHADOW_CHALLENGE_BINDING_INVALID_OR_EXPIRED');
 assert.deepEqual(await state(admin),{
   euros:'0',proposals:0,nonces:0,consumed:0});

 const wrongService=args();wrongService[10]=digest(41);
 const wrongShadow=args();wrongShadow[8]=digest(31);
 const wrongHead=args();wrongHead[2]='b'.repeat(40);
 for(const p of [wrongService,wrongShadow,wrongHead]){
  const row=await call(a,p);
  assert.equal(row.recorded,false);
  assert.equal(row.reason,'SHADOW_CHALLENGE_BINDING_INVALID_OR_EXPIRED');
 }
 const wrongPrice=args();wrongPrice[6]=1;
 assert.equal((await call(a,wrongPrice)).reason,'SHADOW_CHALLENGE_INPUT_INVALID');
 assert.deepEqual(await state(admin),{euros:'0',proposals:0,nonces:0,consumed:0});

 // NOWAIT and rollback: both proof and challenge remain invisible.
 await a.query('BEGIN');
 assert.equal((await call(a,args())).recorded,true);
 assert.deepEqual(await state(admin),{euros:'0',proposals:0,nonces:0,consumed:0});
 await assert.rejects(()=>call(b,args()),e=>e.code==='55P03');
 await a.query('ROLLBACK');
 assert.deepEqual(await state(admin),{euros:'0',proposals:0,nonces:0,consumed:0});

 // Deliberately fail the challenge update AFTER nonce and budget writes.
 const injector=[
 "CREATE FUNCTION public.synthetic_challenge_inject_fail() RETURNS trigger",
 "LANGUAGE plpgsql AS $f$",
 "BEGIN IF NEW.consumed_at IS NOT NULL THEN",
 "RAISE EXCEPTION 'SYNTHETIC_CHALLENGE_WRITE_FAILURE';",
 "END IF; RETURN NEW; END $f$;",
 "CREATE TRIGGER synthetic_challenge_failure BEFORE UPDATE",
 "ON reviewer_b_shadow.issued_shadow_challenges",
 "FOR EACH ROW EXECUTE FUNCTION public.synthetic_challenge_inject_fail();"
 ].join(' ');
 await admin.query(injector);
 await assert.rejects(()=>call(a,args()),
  e=>e.message.includes('SYNTHETIC_CHALLENGE_WRITE_FAILURE'));
 assert.deepEqual(await state(admin),{euros:'0',proposals:0,nonces:0,consumed:0});
 await admin.query('DROP TRIGGER synthetic_challenge_failure ON reviewer_b_shadow.issued_shadow_challenges');
 await admin.query('DROP FUNCTION public.synthetic_challenge_inject_fail()');

 // Adversarial TOCTOU: challenge is valid at SELECT FOR UPDATE, but
 // expires while a test-only BEFORE UPDATE trigger sleeps after the
 // nonce and budget have been written. The post-write expiry check MUST
 // raise, restoring all three tables to their prior empty state.
 await issue(admin,{challenge:13,nonce:33,service:43,durationSeconds:2,
   pr:5403,head:'d'.repeat(40),comment:55443});
 const delayed=[
   "CREATE FUNCTION public.synthetic_expiry_delay() RETURNS trigger",
   "LANGUAGE plpgsql AS $f$",
   "BEGIN IF NEW.challenge_uuid='11111111-2222-4333-8444-00000000000d'::uuid",
   "AND NEW.consumed_at IS NOT NULL THEN PERFORM pg_sleep(2.3);",
   "END IF; RETURN NEW; END $f$;",
   "CREATE TRIGGER synthetic_challenge_expiry BEFORE UPDATE",
   "ON reviewer_b_shadow.issued_shadow_challenges",
   "FOR EACH ROW EXECUTE FUNCTION public.synthetic_expiry_delay();"
 ].join(' ');
 await admin.query(delayed);
 const short=[
   repo,5403,'d'.repeat(40),55443,model,'synthetic-challenge-5403',
   15000000,uuid(33),digest(33),uuid(13),digest(43)];
 await assert.rejects(()=>call(a,short),
   e=>e.message.includes('SHADOW_CHALLENGE_EXPIRED_DURING_WRITE'));
 assert.deepEqual(await state(admin),{euros:'0',proposals:0,nonces:0,consumed:0});
 await admin.query('DROP TRIGGER synthetic_challenge_expiry ON reviewer_b_shadow.issued_shadow_challenges');
 await admin.query('DROP FUNCTION public.synthetic_expiry_delay()');

 const accepted=await call(a,args());
 assert.equal(accepted.recorded,true);
 assert.equal(accepted.reason,'SHADOW_CHALLENGE_AND_NONCE_ATOMIC_NO_SPEND');
 assert.deepEqual(await state(admin),{euros:'15000000',proposals:1,nonces:1,consumed:1});
 assert.equal((await call(b,args())).reason,'SHADOW_CHALLENGE_ALREADY_CONSUMED');

 await issue(admin,{challenge:11,nonce:31,service:41,
   pr:5401,head:'b'.repeat(40),comment:55441});
 const different=[repo,5401,'b'.repeat(40),55441,model,
  'synthetic-challenge-5401',15000000,uuid(31),digest(31),uuid(11),digest(41)];
 assert.equal((await call(b,different)).reason,'SHADOW_EUR15_CEILING_EXCEEDED');
 assert.deepEqual(await state(admin),{euros:'15000000',proposals:1,nonces:1,consumed:1});
 await issue(admin,{challenge:12,nonce:32,service:42,expired:true,
   pr:5402,head:'c'.repeat(40),comment:55442});
 const stale=[repo,5402,'c'.repeat(40),55442,model,
 'synthetic-challenge-5402',15000000,uuid(32),digest(32),uuid(12),digest(42)];
 assert.equal((await call(a,stale)).reason,'SHADOW_CHALLENGE_BINDING_INVALID_OR_EXPIRED');
});
test('only a synthetic shadow SQL ledger, no paid entrypoint changes',()=>{
 assert.match(sql[3],/FOR UPDATE NOWAIT/);
 assert.match(sql[3],/FOREIGN KEY \(consumed_nonce,shadow_digest\)/);
 assert.match(sql[3],/REVOKE EXECUTE ON FUNCTION reviewer_b_shadow.propose_exposure_once/);
 const paid=readFileSync(new URL('../scripts/openrouter-only-spend-gate.mjs',import.meta.url),'utf8');
 assert.match(paid,/OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED/);
 const actual=readFileSync(new URL('../scripts/protected-real-openrouter-review.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(actual,/propose_exposure_with_challenge|issued_shadow_challenges/);
});
