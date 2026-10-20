import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const base=readFileSync(new URL('../sql/reviewer_b_shadow_central_pg_v1.sql',import.meta.url),'utf8');
const roles=readFileSync(new URL('../sql/reviewer_b_shadow_protected_roles_v1.sql',import.meta.url),'utf8');
const migration=readFileSync(new URL('../sql/reviewer_b_shadow_nonce_atomic_v1.sql',import.meta.url),'utf8');
const entry=process.env.SHADOW_PGLITE_ENTRY||'';
const nonce=i=>'11111111-2222-4333-8444-'+i.toString(16).padStart(12,'0');
const digest=i=>i.toString(16).padStart(64,'0');
const claim=(i,n=i,d=i,amount=1_000_000)=>[
 'deenkids7-dev/deenkids',3000+i,i.toString(16).padStart(40,'0'),200000+i,
 'qwen/qwen3-coder-30b-a3b-instruct','shadow-test-'+i,amount,
 nonce(n),digest(d)
];
async function call(db,args){
 const r=await db.query('SELECT * FROM reviewer_b_shadow.propose_exposure_once($1,$2,$3,$4,$5,$6,$7,$8,$9)',args);
 assert.equal(r.rows.length,1);
 assert.equal(r.rows[0].may_spend,false);
 assert.equal(r.rows[0].provider_billing_authenticated,false);
 return r.rows[0];
}
async function counters(db){
 const r=await db.query('SELECT reserved_micro_eur::text AS spent,proposal_count FROM reviewer_b_shadow.monthly_periods');
 return r.rows[0];
}
test('static: new nonce table/restricted entrypoint never authorizes payment',()=>{
 assert.match(migration,/signed_claim_sha256 text NOT NULL UNIQUE/);
 assert.match(migration,/nonce uuid PRIMARY KEY/);
 assert.match(migration,/EXCEPTION\s+WHEN unique_violation/);
 assert.match(migration,/REVOKE EXECUTE ON FUNCTION reviewer_b_shadow\.propose_exposure/);
 assert.match(migration,/SECURITY DEFINER/);
 assert.doesNotMatch(migration,/http_post|openrouter\.ai|api_key|CREATE EXTENSION/i);
 const paid=readFileSync(new URL('../scripts/openrouter-only-spend-gate.mjs',import.meta.url),'utf8');
 const real=readFileSync(new URL('../scripts/protected-real-openrouter-review.mjs',import.meta.url),'utf8');
 assert.match(paid,/OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED/);
 assert.doesNotMatch(real,/propose_exposure_once|reviewer_b_shadow_nonce_atomic_v1/);
});
test('PGlite: atomic nonce and proposal with denied replay/unchanged cap',{
 skip:!entry?'local PGlite dependency required':false,
},async t=>{
 const {PGlite}=await import(pathToFileURL(path.resolve(entry)).href);
 const db=new PGlite();t.after(async()=>db.close());
 await db.exec(base);await db.exec(roles);await db.exec(migration);
 await db.query("INSERT INTO reviewer_b_shadow.monthly_periods(month_utc) VALUES (date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date)");
 await db.exec('SET ROLE reviewer_b_shadow_invoker_v1');
 try{
  await assert.rejects(()=>db.query(
   "SELECT * FROM reviewer_b_shadow.propose_exposure($1,$2,$3,$4,$5,$6,$7)",
   claim(9).slice(0,7)),/permission denied/i);
  await assert.rejects(()=>db.query('SELECT * FROM reviewer_b_shadow.consumed_shadow_proofs'),/permission denied/i);
  const r=await call(db,claim(1,1,1,7_000_000));
  assert.equal(r.recorded,true);
  const replay=await call(db,claim(1,1,1,1));
  assert.equal(replay.recorded,false);
  assert.equal(replay.reason,'SHADOW_SIGNED_PROOF_REPLAY');
  const otherPRSameNonce=await call(db,claim(2,1,2,1));
  assert.equal(otherPRSameNonce.recorded,false);
  const otherPRSameDigest=await call(db,claim(2,2,1,1));
  assert.equal(otherPRSameDigest.recorded,false);
  const denied=await call(db,claim(2,2,2,9_000_000));
  assert.equal(denied.recorded,false);
  assert.equal(denied.reason,'SHADOW_EUR15_CEILING_EXCEEDED');
  const accepted=await call(db,claim(2,2,2,8_000_000));
  assert.equal(accepted.recorded,true);
  const more=await call(db,claim(3,3,3,1));
  assert.equal(more.recorded,false);
 }finally{await db.exec('RESET ROLE')}
 const periods=await counters(db);
 assert.equal(periods.spent,'15000000');
 assert.equal(periods.proposal_count,2);
 const nonceRows=await db.query('SELECT count(*)::int AS n FROM reviewer_b_shadow.consumed_shadow_proofs');
 assert.equal(nonceRows.rows[0].n,2);
 const proposals=await db.query('SELECT count(*)::int AS n FROM reviewer_b_shadow.exposure_proposals');
 assert.equal(proposals.rows[0].n,2);
});
test('PGlite: malformed nonce/digest is never consumed',{
 skip:!entry?'local PGlite dependency required':false,
},async t=>{
 const {PGlite}=await import(pathToFileURL(path.resolve(entry)).href);
 const db=new PGlite();t.after(async()=>db.close());
 await db.exec(base);await db.exec(roles);await db.exec(migration);
 await db.query("INSERT INTO reviewer_b_shadow.monthly_periods(month_utc) VALUES (date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date)");
 await db.exec('SET ROLE reviewer_b_shadow_invoker_v1');
 try{
  const wrongDigest=await call(db,[...claim(10).slice(0,8),'ABC']);
  assert.equal(wrongDigest.recorded,false);
  const nullNonce=await call(db,[...claim(10).slice(0,7),null,digest(10)]);
  assert.equal(nullNonce.recorded,false);
 }finally{await db.exec('RESET ROLE')}
 const summary=await db.query('SELECT count(*)::int AS n FROM reviewer_b_shadow.consumed_shadow_proofs');
 assert.equal(summary.rows[0].n,0);
});
