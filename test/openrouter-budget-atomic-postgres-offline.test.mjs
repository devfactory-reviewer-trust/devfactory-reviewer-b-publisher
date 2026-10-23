// Real SQL execution in an isolated PGlite instance; no provider, keys, or paid path.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const sql=readFileSync(new URL('../sql/openrouter_budget_offline_atomic_v1.sql',import.meta.url),'utf8');
const entry=process.env.SHADOW_PGLITE_ENTRY;
const source='a'.repeat(64);
const monthSql="date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date";
const flags=row=>{
  assert.equal(row.may_reserve,false);
  assert.equal(row.may_spend,false);
  assert.equal(row.may_start_runner,false);
};
const call=async(db,run,role,eur,usd,digest=source)=>{
  const result=await db.query(
    'SELECT * FROM openrouter_budget_offline.propose_quote($1,$2,$3,$4,$5)',
    [digest,run,role,eur,usd]);
  assert.equal(result.rows.length,1);
  flags(result.rows[0]);
  return result.rows[0];
};
const snapshot=async db=>{
  const m=await db.query('SELECT global_held_micro_eur::text AS total FROM openrouter_budget_offline.months');
  const r=await db.query('SELECT role,key_held_micro_usd::text AS total FROM openrouter_budget_offline.roles ORDER BY role');
  const q=await db.query('SELECT count(*)::integer AS n FROM openrouter_budget_offline.quotes');
  return {global:m.rows[0]?.total,roles:r.rows,quotes:q.rows[0].n};
};
const provision=async db=>{
  await db.query('INSERT INTO openrouter_budget_offline.months(month_utc) VALUES ('+monthSql+')');
  await db.query('INSERT INTO openrouter_budget_offline.roles(month_utc,role) VALUES ('+monthSql+",$1),("+monthSql+',$2)', ['reviewer_b','development']);
};
test('offline PostgreSQL capacity is atomic, idempotent and never grants authority',{
  skip:!entry?'isolated PGlite required':false,
  timeout:45000,
},async t=>{
  const {PGlite}=await import(pathToFileURL(resolve(entry)).href);
  const db=new PGlite();
  t.after(()=>db.close());
  await db.exec(sql);

  await t.test('unprovisioned period fails closed',async()=>{
    const r=await call(db,'unprovisioned','reviewer_b',1000000,1000000);
    assert.equal(r.recorded,false);
    assert.equal(r.reason,'OFFLINE_MONTH_UNPROVISIONED');
  });
  await provision(db);
  await t.test('invalid and zero amounts do not write',async()=>{
    for(const [run,role,eur,usd,digest] of [
      ['no-eur','reviewer_b',0,1,source],
      ['no-usd','reviewer_b',1,0,source],
      ['bad-role','owner',1,1,source],
      ['bad-id','reviewer_b',1,1,'forged'],
      ['too-large','development',15000001,1,source],
      ['too-many-usd','development',1,10000001,source],
    ]){
      const r=await call(db,run,role,eur,usd,digest);
      assert.equal(r.recorded,false);
      assert.equal(r.reason,'OFFLINE_INVALID_INPUT');
    }
    assert.equal((await snapshot(db)).quotes,0);
  });
  await t.test('rollbacks revert BOTH ledgers and identity row',async()=>{
    await db.exec('BEGIN');
    assert.equal((await call(db,'rolled','reviewer_b',1000000,1000000)).recorded,true);
    await db.exec('ROLLBACK');
    assert.deepEqual(await snapshot(db),{
      global:'0',
      roles:[{role:'development',total:'0'},{role:'reviewer_b',total:'0'}],
      quotes:0,
    });
  });
  await t.test('cross-role shared EUR cap and per-role USD caps',async()=>{
    assert.equal((await call(db,'r1','reviewer_b',5000000,1000000)).recorded,true);
    assert.equal((await call(db,'r2','reviewer_b',5000000,2000000)).recorded,true);
    assert.equal((await call(db,'r3','reviewer_b',1,1)).reason,'OFFLINE_CAP_EXCEEDED');
    assert.equal((await call(db,'d1','development',5000000,10000000)).recorded,true);
    const s=await snapshot(db);
    assert.equal(s.global,'15000000');
    assert.deepEqual(s.roles,[
      {role:'development',total:'10000000'},
      {role:'reviewer_b',total:'3000000'},
    ]);
    assert.equal(s.quotes,3);
    assert.equal((await call(db,'d2','development',1,1)).reason,'OFFLINE_CAP_EXCEEDED');
  });
  await t.test('same identity cannot be reused with changed amount or role',async()=>{
    assert.equal((await call(db,'r1','development',1,1)).reason,'OFFLINE_DUPLICATE_OR_AMBIGUOUS');
    assert.equal((await call(db,'r1','reviewer_b',3000000,2000000)).reason,'OFFLINE_DUPLICATE_OR_AMBIGUOUS');
    assert.equal((await snapshot(db)).quotes,3);
  });
  await t.test('migration cannot execute twice or silently repair privileges',async()=>{
    await assert.rejects(()=>db.exec(sql),/already exists|already in use|duplicate/i);
  });
});
test('offline migration cannot be imported by real paid gate',()=>{
  const real=readFileSync(new URL('../scripts/protected-real-openrouter-review.mjs',import.meta.url),'utf8');
  const gate=readFileSync(new URL('../scripts/openrouter-only-spend-gate.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(real,/openrouter_budget_offline|openrouter-budget-capacity-offline/);
  assert.doesNotMatch(gate,/openrouter_budget_offline|openrouter-budget-capacity-offline/);
  assert.match(gate,/OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED/);
  assert.doesNotMatch(sql,/may_spend\s*=\s*true|may_reserve\s*=\s*true/i);
});
