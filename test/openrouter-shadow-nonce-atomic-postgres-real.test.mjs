// Genuine synthetic PostgreSQL 16, distinct authenticated client sessions,
// NO provider request, secrets, spending or production DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const enabled=process.env.SHADOW_POSTGRES_REAL==='1';
const modulePath=process.env.SHADOW_PG_CLIENT_ENTRY;
const pass='synthetic-shadow-ci-only-20261020';
const sql=[
  'reviewer_b_shadow_central_pg_v1.sql',
  'reviewer_b_shadow_protected_roles_v1.sql',
  'reviewer_b_shadow_nonce_atomic_v1.sql',
].map(n=>readFileSync(new URL('../sql/'+n,import.meta.url),'utf8'));
const nonce=i=>'11111111-2222-4333-8444-'+i.toString(16).padStart(12,'0');
const digest=i=>i.toString(16).padStart(64,'0');
const args=(i,n=i,hash=i,bound=1_000_000)=>[
 'deenkids7-dev/deenkids',10000+i,i.toString(16).padStart(40,'0'),
 11000+i,'qwen/qwen3-coder-30b-a3b-instruct','synthetic-nonce-'+i,bound,
 nonce(n),digest(hash),
];
const wrapper=(db,p)=>db.query(
 'SELECT * FROM reviewer_b_shadow.propose_exposure_once($1,$2,$3,$4,$5,$6,$7,$8,$9)',p);
async function state(db){
 const a=await db.query('SELECT reserved_micro_eur::text AS total,proposal_count AS n FROM reviewer_b_shadow.monthly_periods');
 const b=await db.query('SELECT count(*)::int AS n FROM reviewer_b_shadow.consumed_shadow_proofs');
 const c=await db.query('SELECT count(*)::int AS n FROM reviewer_b_shadow.exposure_proposals');
 return {total:a.rows[0].total,count:a.rows[0].n,nonces:b.rows[0].n,proposals:c.rows[0].n};
}
test('PostgreSQL 16: atomic nonce consumption survives contention, crash and replay',{
 skip:!enabled||!modulePath?'dedicated ephemeral PostgreSQL 16 CI job required':false,
 timeout:60000,
},async t=>{
 assert.equal(process.env.PGHOST,'127.0.0.1');
 assert.equal(process.env.PGPASSWORD,pass);
 const pg=await import(pathToFileURL(modulePath).href);
 const Client=pg.default?.Client||pg.Client;
 const create=(user='postgres')=>new Client({
  host:'127.0.0.1',port:5432,user,
  password:pass,database:'postgres',connectionTimeoutMillis:2500,query_timeout:4000,
 });
 const admin=create(),a=create('shadow_nonce_test'),b=create('shadow_nonce_test');
 t.after(async()=>Promise.all([admin,a,b].map(c=>c.end().catch(()=>{}))));
 await admin.connect();
 for(const migration of sql)await admin.query(migration);
 await admin.query("INSERT INTO reviewer_b_shadow.monthly_periods(month_utc) VALUES (date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date)");
 await admin.query("CREATE ROLE shadow_nonce_test LOGIN INHERIT PASSWORD 'synthetic-shadow-ci-only-20261020'");
 await admin.query('GRANT reviewer_b_shadow_invoker_v1 TO shadow_nonce_test');
 await a.connect();await b.connect();

 // Force the hard-to-reach UNIQUE violation AFTER a reservation is
 // accepted: an isolated, superuser-owned TEST-ONLY trigger inserts the
 // same proof before the wrapper inserts its own nonce row. A correct
 // nested exception handler must roll back both its reservation and the
 // trigger's inserted proof, preserving the surrounding transaction.
 await admin.query(`
   CREATE TABLE public.shadow_nonce_test_marker (value integer);
   GRANT INSERT ON public.shadow_nonce_test_marker TO shadow_nonce_test;
   CREATE FUNCTION public.shadow_nonce_test_inject() RETURNS trigger
   LANGUAGE plpgsql SECURITY DEFINER
   SET search_path=pg_catalog,reviewer_b_shadow,pg_temp
   AS $test_inject$
   BEGIN
     IF NEW.pr_number=10060 THEN
       INSERT INTO reviewer_b_shadow.consumed_shadow_proofs(
         nonce,signed_claim_sha256,target_repo,pr_number,head_sha)
       VALUES (
         '11111111-2222-4333-8444-00000000003c',
         '000000000000000000000000000000000000000000000000000000000000003c',
         NEW.target_repo,NEW.pr_number,NEW.head_sha);
     END IF;
     RETURN NEW;
   END
   $test_inject$;
   CREATE TRIGGER shadow_nonce_test_trigger
     AFTER INSERT ON reviewer_b_shadow.exposure_proposals
     FOR EACH ROW EXECUTE FUNCTION public.shadow_nonce_test_inject();
 `);
 await a.query('BEGIN');
 const injected=await wrapper(a,args(60,60,60,1_000_000));
 assert.equal(injected.rows[0].recorded,false);
 assert.equal(injected.rows[0].reason,'SHADOW_SIGNED_PROOF_REPLAY_OR_DUPLICATE');
 await a.query('INSERT INTO public.shadow_nonce_test_marker(value) VALUES (777)');
 await a.query('COMMIT');
 assert.deepEqual(await state(admin),{total:'0',count:0,nonces:0,proposals:0});
 const persistedMarker=await admin.query(
   'SELECT count(*)::int AS n FROM public.shadow_nonce_test_marker');
 assert.equal(persistedMarker.rows[0].n,1);
 await admin.query('DROP TRIGGER shadow_nonce_test_trigger ON reviewer_b_shadow.exposure_proposals');
 await admin.query('DROP FUNCTION public.shadow_nonce_test_inject()');

 const cannot=await a.query(
  "SELECT has_function_privilege('reviewer_b_shadow.propose_exposure(text,integer,text,bigint,text,text,bigint)','EXECUTE') AS old, has_function_privilege('reviewer_b_shadow.propose_exposure_once(text,integer,text,bigint,text,text,bigint,uuid,text)','EXECUTE') AS new, has_table_privilege('reviewer_b_shadow.consumed_shadow_proofs','INSERT') AS raw");
 assert.deepEqual(cannot.rows[0],{old:false,new:true,raw:false});
 await assert.rejects(()=>a.query(
  'SELECT * FROM reviewer_b_shadow.propose_exposure($1,$2,$3,$4,$5,$6,$7)',
  args(1).slice(0,7)),e=>e.code==='42501');

 // An uncommitted proposal and its nonce MUST both be invisible.
 await a.query('BEGIN');
 const first=await wrapper(a,args(1,1,1,10_000_000));
 assert.equal(first.rows[0].recorded,true);
 assert.equal(first.rows[0].may_spend,false);
 assert.deepEqual(await state(admin),{total:'0',count:0,nonces:0,proposals:0});
 await assert.rejects(()=>wrapper(b,args(2,1,2,1_000_000)),
  e=>e.code==='55P03');
 await a.query('ROLLBACK');
 assert.deepEqual(await state(admin),{total:'0',count:0,nonces:0,proposals:0});

 // A process/connection terminated BEFORE COMMIT must also leave no
 // durable nonce, proposal or reserved exposure. No provider call occurs.
 const crashed=create('shadow_nonce_test');
 crashed.on('error',()=>{}); // expected backend termination is test-only
 t.after(async()=>crashed.end().catch(()=>{}));
 await crashed.connect();
 await crashed.query('BEGIN');
 assert.equal((await wrapper(crashed,args(50,50,50,1_000_000))).rows[0].recorded,true);
 const pid=(await crashed.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
 assert.deepEqual(await state(admin),{total:'0',count:0,nonces:0,proposals:0});
 const killed=await admin.query('SELECT pg_terminate_backend($1) AS done',[pid]);
 assert.equal(killed.rows[0].done,true);
 assert.deepEqual(await state(admin),{total:'0',count:0,nonces:0,proposals:0});

 // Re-use after a rollback is allowed in this purely synthetic system.
 // No external bill was ever attempted; a paid-HTTP ambiguity MUST NOT be retried.
 const committed=await wrapper(a,args(1,1,1,10_000_000));
 assert.equal(committed.rows[0].recorded,true);
 assert.deepEqual(await state(admin),
  {total:'10000000',count:1,nonces:1,proposals:1});

 // A nonce cannot be reused for a different PR, even with new digest.
 const nonceReplay=await wrapper(b,args(2,1,2,1_000_000));
 assert.equal(nonceReplay.rows[0].recorded,false);
 assert.equal(nonceReplay.rows[0].reason,'SHADOW_SIGNED_PROOF_REPLAY');
 // An envelope hash cannot be reused with another nonce.
 const digestReplay=await wrapper(b,args(2,2,1,1_000_000));
 assert.equal(digestReplay.rows[0].recorded,false);
 assert.equal(digestReplay.rows[0].reason,'SHADOW_SIGNED_PROOF_REPLAY');

 const tooLarge=await wrapper(b,args(2,2,2,6_000_000));
 assert.equal(tooLarge.rows[0].recorded,false);
 assert.equal(tooLarge.rows[0].reason,'SHADOW_EUR15_CEILING_EXCEEDED');
 const final=await wrapper(b,args(2,2,2,5_000_000));
 assert.equal(final.rows[0].recorded,true);
 assert.equal(final.rows[0].may_spend,false);
 assert.deepEqual(await state(admin),
  {total:'15000000',count:2,nonces:2,proposals:2});
 const allDenied=await wrapper(a,args(3,3,3,1));
 assert.equal(allDenied.rows[0].recorded,false);
 assert.deepEqual(await state(admin),
  {total:'15000000',count:2,nonces:2,proposals:2});
});
