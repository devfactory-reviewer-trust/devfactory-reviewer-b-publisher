// Ephemeral PostgreSQL16: synthetic durable attempt tombstones, no model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const sql=readFileSync(new URL(
  '../sql/reviewer_b_attempt_tombstone_synthetic_v1.sql',import.meta.url),'utf8');
const quarantineSql=readFileSync(new URL(
  '../sql/reviewer_b_attempt_quarantine_synthetic_v1.sql',
  import.meta.url),'utf8');
const HEAD='a'.repeat(40),PASS='synthetic-shadow-ci-only-20261020';
const makeClient=(Client,user='postgres',password=PASS)=>new Client({
  host:'127.0.0.1',port:5432,database:'postgres',user,password,
  connectionTimeoutMillis:2500,query_timeout:4000,
});
const query=(c,fn,params)=>c.query(
  'SELECT * FROM reviewer_b_attempt_shadow.'+fn+'('+
  params.map((_,i)=>'$'+(i+1)).join(',')+')',params);
function blockedResult(result,recorded){
  assert.equal(result.rows.length,1);
  const row=result.rows[0];
  assert.equal(row.may_spend,false);
  assert.equal(row.may_dispatch,false);
  assert.equal(row.recorded,recorded);
}
test('real PostgreSQL16: durable synthetic risk tombstone, no retry or privilege escalation',{
  skip:process.env.SHADOW_POSTGRES_REAL!=='1'||!process.env.SHADOW_PG_CLIENT_ENTRY?
    'isolated GitHub Actions Postgres16 required':false,
  timeout:60000,
},async t=>{
  assert.equal(process.env.PGHOST,'127.0.0.1');
  assert.equal(process.env.PGPASSWORD,PASS);
  const mod=await import(pathToFileURL(process.env.SHADOW_PG_CLIENT_ENTRY).href);
  const Client=mod.default?.Client||mod.Client;
  const admin=makeClient(Client),writer=makeClient(Client,'attempt_shadow_ci_login'),
    observer=makeClient(Client),reconnected=makeClient(Client,'attempt_shadow_ci_login');
  t.after(async()=>Promise.all(
    [admin,writer,observer,reconnected].map(c=>c.end().catch(()=>{}))));
  await admin.connect();
  await observer.connect();
  await admin.query(sql);
  await admin.query(quarantineSql);
  const role=await admin.query(
    "SELECT rolcanlogin FROM pg_catalog.pg_roles WHERE rolname='reviewer_b_attempt_invoker_v1'");
  assert.equal(role.rows[0].rolcanlogin,false);
  await admin.query(
    "CREATE ROLE attempt_shadow_ci_login LOGIN INHERIT PASSWORD 'synthetic-shadow-ci-only-20261020'");
  await admin.query('GRANT reviewer_b_attempt_invoker_v1 TO attempt_shadow_ci_login');
  const bad=makeClient(Client,'attempt_shadow_ci_login','synthetic-wrong-password');
  t.after(async()=>bad.end().catch(()=>{}));
  await assert.rejects(()=>bad.connect(),e=>e.code==='28P01');
  await writer.connect();
  await reconnected.connect();

  // No data privileges for untrusted invoker, no owner role membership.
  const privileges=(await writer.query(
    "SELECT has_table_privilege('reviewer_b_attempt_shadow.attempts','SELECT') AS can_read,"+
    " has_table_privilege('reviewer_b_attempt_shadow.attempts','UPDATE') AS can_write,"+
    " has_schema_privilege('reviewer_b_attempt_shadow','CREATE') AS can_create,"+
    " has_function_privilege('reviewer_b_attempt_shadow.record_dispatch_risk(text,text,text)','EXECUTE') AS can_record"
  )).rows[0];
  assert.deepEqual(privileges,{
    can_read:false,can_write:false,can_create:false,can_record:true,
  });
  await assert.rejects(
    ()=>writer.query('SELECT * FROM reviewer_b_attempt_shadow.attempts'),
    e=>e.code==='42501');
  await assert.rejects(
    ()=>writer.query("UPDATE reviewer_b_attempt_shadow.attempts SET status='registered'"),
    e=>e.code==='42501');
  await assert.rejects(
    ()=>writer.query('SET ROLE reviewer_b_attempt_owner_v1'),
    e=>e.code==='42501');

  const call=(client,fn,...args)=>query(client,fn,args);
  const register=(client,req,attempt,role='reviewer_b',head=HEAD)=>
    call(client,'register_synthetic_attempt',req,attempt,role,head);
  const risk=(client,req,attempt,head=HEAD)=>
    call(client,'record_dispatch_risk',req,attempt,head);
  const unknown=(client,req,attempt,head=HEAD)=>
    call(client,'mark_outcome_unknown',req,attempt,head);
  const cancel=(client,req,attempt,head=HEAD)=>
    call(client,'cancel_before_dispatch',req,attempt,head);
  const recover=(client,req,attempt,head=HEAD)=>
    call(client,'observe_attempt_after_uncertain_commit',req,attempt,head);
  const blockedRecovery=(result,found,status=null)=>{
    assert.equal(result.rows.length,1);
    const row=result.rows[0];
    assert.equal(row.identity_found,found);
    assert.equal(row.observed_state,status);
    assert.equal(row.may_spend,false);
    assert.equal(row.may_dispatch,false);
    assert.equal(row.may_retry,false);
  };
  const state=async req=>(await observer.query(
    'SELECT status,dispatch_marker_at,unknown_at,cancelled_at FROM '+
    'reviewer_b_attempt_shadow.attempts WHERE request_id=$1',[req])).rows[0];
  
  blockedResult(await register(writer,'req:1','attempt:1'),true);
  blockedResult(await register(reconnected,'req:1','attempt:2'),false);
  blockedResult(await register(reconnected,'req:2','attempt:1','development'),false);
  blockedResult(await risk(writer,'req:1','wrong-attempt'),false);
  blockedResult(await risk(writer,'req:1','attempt:1','b'.repeat(40)),false);
  assert.equal((await state('req:1')).status,'registered');
  blockedRecovery(await recover(reconnected,'req:1','attempt:1'),
    true,'registered');
  blockedRecovery(await recover(reconnected,'req:1','wrong'),false);
  blockedRecovery(await recover(reconnected,'missing','attempt:1'),false);
  blockedRecovery(await recover(reconnected,'req:1','attempt:1',
    'b'.repeat(40)),false);

  // Real physical connection A holds the target row; separate invoker B
  // must fail immediately via NOWAIT. There is no automated retry.
  await admin.query('BEGIN');
  await admin.query(
    "SELECT request_id FROM reviewer_b_attempt_shadow.attempts WHERE request_id='req:1' FOR UPDATE");
  await assert.rejects(()=>risk(reconnected,'req:1','attempt:1'),
    e=>e.code==='55P03');
  // A read-only recovery observation must also refuse an in-flight write.
  await assert.rejects(()=>recover(reconnected,'req:1','attempt:1'),
    e=>e.code==='55P03');
  await admin.query('ROLLBACK');
  assert.equal((await state('req:1')).status,'registered');

  // Race TWO authenticated invokers for the same prospective dispatch:
  // a transaction holding the tombstone must block the other writer
  // without waiting or performing any hypothetical second dispatch.
  blockedResult(await register(writer,'req:race','attempt:race'),true);
  await writer.query('BEGIN');
  blockedResult(await risk(writer,'req:race','attempt:race'),true);
  assert.equal((await state('req:race')).status,'registered');
  await assert.rejects(
    ()=>risk(reconnected,'req:race','attempt:race'),
    e=>e.code==='55P03');
  await writer.query('COMMIT');
  assert.equal((await state('req:race')).status,
    'dispatch_may_have_occurred');
  blockedResult(await risk(reconnected,'req:race','attempt:race'),false);
  blockedResult(await register(reconnected,'req:race','attempt:other'),false);

  // One committed risk tombstone survives a different backend connection.
  blockedResult(await risk(writer,'req:1','attempt:1'),true);
  const after=await state('req:1');
  assert.equal(after.status,'dispatch_may_have_occurred');
  assert.ok(after.dispatch_marker_at);
  blockedResult(await risk(reconnected,'req:1','attempt:1'),false);
  blockedResult(await register(reconnected,'req:1','attempt:3'),false);
  blockedResult(await cancel(reconnected,'req:1','attempt:1'),false);
  blockedResult(await unknown(reconnected,'req:1','attempt:1'),true);
  assert.equal((await state('req:1')).status,'outcome_unknown');
  blockedResult(await unknown(writer,'req:1','attempt:1'),false);
  blockedResult(await risk(writer,'req:1','attempt:1'),false);

  // Closing and recreating the authenticated physical session does NOT
  // resurrect the request ID in the database.
  await writer.end();
  const restart=makeClient(Client,'attempt_shadow_ci_login');
  t.after(async()=>restart.end().catch(()=>{}));
  await restart.connect();
  blockedResult(await risk(restart,'req:1','attempt:1'),false);
  blockedResult(await register(restart,'req:1','attempt:4'),false);

  // Deterministically simulate transport discarding a successful COMMIT
  // response. This is NOT a real network-fault injection or provider call.
  blockedResult(await register(restart,'req:ack','attempt:ack'),true);
  await restart.query('BEGIN');
  blockedResult(await risk(restart,'req:ack','attempt:ack'),true);
  await assert.rejects(async()=>{
    await restart.query('COMMIT');
    throw Object.assign(new Error('synthetic commit reply lost'),
      {code:'SYNTHETIC_COMMIT_REPLY_LOST'});
  },e=>e.code==='SYNTHETIC_COMMIT_REPLY_LOST');
  const recovery=makeClient(Client,'attempt_shadow_ci_login');
  t.after(async()=>recovery.end().catch(()=>{}));
  await recovery.connect();
  blockedRecovery(await recover(recovery,'req:ack','attempt:ack'),
    true,'dispatch_may_have_occurred');
  blockedResult(await risk(recovery,'req:ack','attempt:ack'),false);
  blockedResult(await register(recovery,'req:ack','attempt:other'),false);
  // A missing row or a REGISTERED row never gives recovery permission to
  // send. A future paid dispatcher would have to remain blocked.
  blockedRecovery(await recover(recovery,'req:unseen','attempt:unseen'),
    false);

  // A cancellation is only possible BEFORE any risk marker exists.
  blockedResult(await register(restart,'req:cancel','attempt:cancel',
    'development'),true);
  blockedResult(await cancel(restart,'req:cancel','attempt:cancel'),true);
  assert.equal((await state('req:cancel')).status,'cancelled_before_dispatch');
  blockedResult(await risk(restart,'req:cancel','attempt:cancel'),false);
  blockedResult(await register(restart,'req:cancel','attempt:new'),false);

  // A test-only rollback discards UNCOMMITTED risk markers. This is
  // precisely why a real network send before COMMIT would be unsafe.
  blockedResult(await register(restart,'req:rollback','attempt:rollback'),true);
  await reconnected.query('BEGIN');
  blockedResult(await risk(reconnected,'req:rollback','attempt:rollback'),true);
  assert.equal((await state('req:rollback')).status,'registered');
  await reconnected.query('ROLLBACK');
  assert.equal((await state('req:rollback')).status,'registered');
  blockedRecovery(await recover(recovery,'req:rollback','attempt:rollback'),
    true,'registered');
  // Recovery is an observation, NOT evidence that an external API request
  // did not occur. The status must never authorize a retry.
  await recovery.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  blockedRecovery(await recover(recovery,'req:ack','attempt:ack'),false);
  await recovery.query('ROLLBACK');

  // A REAL PostgreSQL backend disappears with an UNCOMMITTED synthetic
  // marker. PostgreSQL rolls that transaction back, but recovery still
  // cannot infer absence of external egress or authorize a second call.
  blockedResult(await register(recovery,'req:backend-lost',
    'attempt:backend-lost','development'),true);
  const lost=makeClient(Client,'attempt_shadow_ci_login');
  lost.on('error',()=>{}); // pg emits an expected connection-loss event.
  t.after(async()=>lost.end().catch(()=>{}));
  await lost.connect();
  const doomedPid=lost.processID;
  assert.ok(Number.isInteger(doomedPid)&&doomedPid>0);
  await lost.query('BEGIN');
  blockedResult(await risk(lost,'req:backend-lost',
    'attempt:backend-lost'),true);
  assert.equal((await state('req:backend-lost')).status,'registered');
  // pg_terminate_backend is authorized only in this disposable test DB.
  const killed=await admin.query(
    'SELECT pg_terminate_backend($1,5000) AS terminated',[doomedPid]);
  assert.equal(killed.rows[0].terminated,true);
  assert.equal((await state('req:backend-lost')).status,'registered');
  blockedRecovery(await recover(recovery,'req:backend-lost',
    'attempt:backend-lost'),true,'registered');
  // A new connection is able to see the row, but the observation is NOT
  // proof the outside world has seen no request; may_retry is always false.
  await lost.end().catch(()=>{});

  // A stale snapshot cannot be used for admission.
  await reconnected.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  const stale=await register(reconnected,'req:stale','attempt:stale');
  blockedResult(stale,false);
  assert.equal(stale.rows[0].reason,'SHADOW_ATTEMPT_REGISTER_INVALID');
  await reconnected.query('ROLLBACK');

  // No public function EXECUTE or privilege to alter synthetic attempts.
  const grants=await observer.query(
    "SELECT count(*)::int AS n FROM pg_catalog.pg_proc p "+
    "JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace "+
    "CROSS JOIN LATERAL pg_catalog.aclexplode("+
    "COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a "+
    "WHERE n.nspname='reviewer_b_attempt_shadow' AND a.grantee=0 "+
    "AND a.privilege_type='EXECUTE'");
  assert.equal(grants.rows[0].n,0);
  const count=await observer.query(
    'SELECT count(*)::int AS n FROM reviewer_b_attempt_shadow.attempts');
  assert.equal(count.rows[0].n,6);

  // The additive quarantine tables are not visible or mutable to the
  // restricted CI login: only narrow SECURITY DEFINER functions are usable.
  const privateRights=(await recovery.query(
    "SELECT has_table_privilege("+
    "'reviewer_b_attempt_shadow.quarantines','SELECT') AS can_see,"+
    " has_table_privilege("+
    "'reviewer_b_attempt_shadow.unverified_evidence','INSERT') AS can_insert"
  )).rows[0];
  assert.deepEqual(privateRights,{can_see:false,can_insert:false});
  await assert.rejects(
    ()=>recovery.query('SELECT * FROM reviewer_b_attempt_shadow.quarantines'),
    e=>e.code==='42501');
  await assert.rejects(
    ()=>recovery.query(
      "DELETE FROM reviewer_b_attempt_shadow.quarantines WHERE request_id='req:1'"),
    e=>e.code==='42501');

  const quarantine=(client,request,attempt,reason,head=HEAD)=>
    call(client,'quarantine_synthetic_attempt',
      request,attempt,head,reason);
  const evidence=(client,request,id,digest,kind,amount)=>
    call(client,'record_unverified_evidence_fixture',
      request,id,digest,kind,amount);
  const quarantineBlocked=(result,recorded)=>{
    assert.equal(result.rows.length,1);
    const row=result.rows[0];
    assert.equal(row.recorded,recorded);
    for(const k of ['may_spend','may_dispatch','may_retry',
      'may_release_hold'])assert.equal(row[k],false,k);
  };
  const evidenceBlocked=(result,recorded)=>{
    quarantineBlocked(result,recorded);
    assert.equal(result.rows[0].provider_authenticated,false);
  };

  // A registered or cancelled intention is not a dispatch-risk claim.
  quarantineBlocked(await quarantine(recovery,'req:rollback',
    'attempt:rollback','ambiguous_commit'),false);
  quarantineBlocked(await quarantine(recovery,'req:cancel',
    'attempt:cancel','provider_outcome_unknown'),false);
  quarantineBlocked(await quarantine(recovery,'req:ack',
    'wrong-attempt','ambiguous_commit'),false);
  quarantineBlocked(await quarantine(recovery,'req:ack',
    'attempt:ack','ambiguous_commit','b'.repeat(40)),false);

  // Only committed risk/unknown states can be quarantined. Quarantine
  // cannot be undone, rewritten, promoted to verified or used to retry.
  quarantineBlocked(await quarantine(recovery,'req:ack',
    'attempt:ack','ambiguous_commit'),true);
  quarantineBlocked(await quarantine(recovery,'req:ack',
    'attempt:ack','ambiguous_commit'),false);
  quarantineBlocked(await quarantine(recovery,'req:1',
    'attempt:1','provider_outcome_unknown'),true);
  evidenceBlocked(await evidence(recovery,'req:rollback',
    'proof:orphan','e'.repeat(64),'mock_invoice',200),false);

  evidenceBlocked(await evidence(recovery,'req:ack',
    'proof:1','a'.repeat(64),'mock_invoice',500),true);
  evidenceBlocked(await evidence(recovery,'req:ack',
    'proof:1','b'.repeat(64),'mock_invoice',500),false);
  evidenceBlocked(await evidence(recovery,'req:1',
    'proof:2','a'.repeat(64),'mock_invoice',500),false);
  evidenceBlocked(await evidence(recovery,'req:ack',
    'proof:3','c'.repeat(64),'provider-authenticated',500),false);
  evidenceBlocked(await evidence(recovery,'req:ack',
    'proof:4','d'.repeat(64),'mock_adjustment',-1),false);
  evidenceBlocked(await evidence(recovery,'req:ack',
    'proof:absence','f'.repeat(64),'mock_absence',0),true);
  const trusted=await admin.query(
    'SELECT count(*)::int AS n FROM reviewer_b_attempt_shadow.unverified_evidence');
  assert.equal(trusted.rows[0].n,2);
  const allSources=await admin.query(
    'SELECT DISTINCT source FROM reviewer_b_attempt_shadow.unverified_evidence');
  assert.deepEqual(allSources.rows,[{source:'unverified-fixture'}]);

  // Real PostgreSQL concurrency: lock holder's uncommitted quarantine
  // cannot be raced by an independent authenticated SQL connection.
  blockedResult(await register(recovery,'req:quarantine-race',
    'attempt:quarantine-race','development'),true);
  blockedResult(await risk(recovery,'req:quarantine-race',
    'attempt:quarantine-race'),true);
  await reconnected.query('BEGIN');
  quarantineBlocked(await quarantine(reconnected,'req:quarantine-race',
    'attempt:quarantine-race','dispatch_risk_unresolved'),true);
  await assert.rejects(
    ()=>quarantine(recovery,'req:quarantine-race',
      'attempt:quarantine-race','dispatch_risk_unresolved'),
    e=>e.code==='55P03');
  await reconnected.query('ROLLBACK');
  const absent=await admin.query(
    'SELECT count(*)::int AS n FROM reviewer_b_attempt_shadow.quarantines '+
    "WHERE request_id='req:quarantine-race'");
  assert.equal(absent.rows[0].n,0);
  quarantineBlocked(await quarantine(recovery,'req:quarantine-race',
    'attempt:quarantine-race','dispatch_risk_unresolved'),true);
  const quarantined=await admin.query(
    'SELECT count(*)::int AS n FROM reviewer_b_attempt_shadow.quarantines');
  assert.equal(quarantined.rows[0].n,3);
  blockedRecovery(await recover(recovery,'req:quarantine-race',
    'attempt:quarantine-race'),true,'dispatch_may_have_occurred');

  // PostgreSQL, not just the SECURITY DEFINER code, must enforce the
  // (request_id, attempt_id, exact HEAD) binding. Deliberately use
  // privileged CI setup access to bypass the function and try corrupt
  // inserts/updates: every mismatched identity must fail with FK 23503.
  blockedResult(await register(recovery,'req:fk','attempt:fk',
    'reviewer_b'),true);
  blockedResult(await risk(recovery,'req:fk','attempt:fk'),true);
  await assert.rejects(
    ()=>admin.query(
      'INSERT INTO reviewer_b_attempt_shadow.quarantines '+
      '(request_id,attempt_id,head_sha,quarantine_reason) '+
      'VALUES($1,$2,$3,$4)',
      ['req:fk','attempt:WRONG',HEAD,'ambiguous_commit']),
    e=>e.code==='23503');
  await assert.rejects(
    ()=>admin.query(
      'INSERT INTO reviewer_b_attempt_shadow.quarantines '+
      '(request_id,attempt_id,head_sha,quarantine_reason) '+
      'VALUES($1,$2,$3,$4)',
      ['req:fk','attempt:fk','b'.repeat(40),'ambiguous_commit']),
    e=>e.code==='23503');
  const preBind=(await admin.query(
    "SELECT count(*)::int AS n FROM reviewer_b_attempt_shadow.quarantines "+
    "WHERE request_id='req:fk'")).rows[0];
  assert.equal(preBind.n,0);

  quarantineBlocked(await quarantine(recovery,'req:fk','attempt:fk',
    'ambiguous_commit'),true);
  await assert.rejects(
    ()=>admin.query(
      "UPDATE reviewer_b_attempt_shadow.attempts "+
      "SET attempt_id='attempt:replaced' WHERE request_id='req:fk'"),
    e=>e.code==='23503');
  await assert.rejects(
    ()=>admin.query(
      "UPDATE reviewer_b_attempt_shadow.attempts "+
      "SET head_sha=$1 WHERE request_id='req:fk'",['b'.repeat(40)]),
    e=>e.code==='23503');
  await assert.rejects(
    ()=>admin.query(
      "UPDATE reviewer_b_attempt_shadow.quarantines "+
      "SET attempt_id='attempt:forged' WHERE request_id='req:fk'"),
    e=>e.code==='23503');
  const stored=(await admin.query(
    "SELECT q.attempt_id, q.head_sha FROM "+
    "reviewer_b_attempt_shadow.quarantines q WHERE q.request_id='req:fk'"
  )).rows[0];
  assert.deepEqual(stored,{attempt_id:'attempt:fk',head_sha:HEAD});
  blockedRecovery(await recover(recovery,'req:fk','attempt:fk'),
    true,'dispatch_may_have_occurred');

});
