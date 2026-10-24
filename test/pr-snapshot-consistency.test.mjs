import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deriveConsistentPrSnapshot as snapshot } from '../src/pr-snapshot-consistency.mjs';

const h = 'a'.repeat(40);
const b = 'b'.repeat(40);
const diff = Buffer.from('diff --git a/file.mjs b/file.mjs\nindex 0000000..1111111 100644\n--- a/file.mjs\n+++ b/file.mjs\n@@ -1 +1 @@\n-before\n+after\n');
const metadata = () => ({
  number:898,state:'open',merged_at:null,draft:false,changed_files:1,
  head:{sha:h,repo:{full_name:'deenkids7-dev/deenkids',id:1282086207}},base:{sha:b,ref:'master',repo:{
    full_name:'deenkids7-dev/deenkids',id:1282086207
  }}
});
const fixture=(changes={})=>({
  requestedPr:898,metadataBefore:metadata(),metadataAfter:metadata(),rawDiff:diff,...changes
});
function rejects(name,changes,code){
  test(name,()=>assert.throws(()=>snapshot(fixture(changes)),e=>e.message===code));
}
test('hashes exact stable synthetic diff; does NOT attest GitHub provenance',()=>{
  const actual=snapshot(fixture());
  assert.deepEqual(actual,{
    repository:'deenkids7-dev/deenkids',repository_id:1282086207,
    pr_number:898,head_sha:h,base_sha:b,
    diff_sha256:createHash('sha256').update(diff).digest('hex')
  });
  assert.ok(Object.isFrozen(actual));
});
rejects('rejects moved HEAD', {
  metadataAfter:{...metadata(),head:{...metadata().head,sha:'c'.repeat(40)}}
},'GITHUB_PR_CHANGED_DURING_READ');
rejects('rejects moved BASE', {
  metadataAfter:{...metadata(),base:{...metadata().base,sha:'c'.repeat(40)}}
},'GITHUB_PR_CHANGED_DURING_READ');
rejects('rejects different repo', {
  metadataBefore:{...metadata(),base:{...metadata().base,repo:{
    full_name:'someone/else',id:1282086207
  }}}
},'GITHUB_PR_NOT_ELIGIBLE');
rejects('rejects wrong repo ID', {
  metadataBefore:{...metadata(),base:{...metadata().base,repo:{
    full_name:'deenkids7-dev/deenkids',id:100
  }}}
},'GITHUB_PR_NOT_ELIGIBLE');
rejects('rejects draft PR', {
  metadataBefore:{...metadata(),draft:true}
},'GITHUB_PR_NOT_ELIGIBLE');
rejects('rejects closed PR', {
  metadataBefore:{...metadata(),state:'closed'}
},'GITHUB_PR_NOT_ELIGIBLE');
rejects('rejects wrong PR', {
  metadataBefore:{...metadata(),number:899}
},'GITHUB_PR_NOT_ELIGIBLE');
rejects('rejects wrong base branch', {
  metadataBefore:{...metadata(),base:{...metadata().base,ref:'release'}}
},'GITHUB_PR_NOT_ELIGIBLE');

test('exact same-repo codex stacked PR is advisory-eligible only by explicit opt-in',()=>{
  const stacked={...metadata(),base:{...metadata().base,
    ref:'codex/openrouter-offline-startup-audit-20261021'}};
  const params=fixture({metadataBefore:stacked,metadataAfter:stacked});
  assert.throws(()=>snapshot(params),e=>e.message==='GITHUB_PR_NOT_ELIGIBLE');
  const permitted=snapshot({...params,allowAdvisoryStackedBase:true});
  assert.equal(permitted.base_ref,stacked.base.ref);
  assert.equal(permitted.diff_sha256,createHash('sha256').update(diff).digest('hex'));
});

test('advisory stacked eligibility fails closed on unsafe bases, forks and base drift',()=>{
  for(const ref of ['release','main','codex/../master','codex/', 'codex/Bad']){
    const bad={...metadata(),base:{...metadata().base,ref}};
    assert.throws(()=>snapshot({...fixture({metadataBefore:bad,metadataAfter:bad}),
      allowAdvisoryStackedBase:true}),e=>e.message==='GITHUB_PR_NOT_ELIGIBLE');
  }
  const stacked={...metadata(),base:{...metadata().base,ref:'codex/stack-one'}};
  const moved={...metadata(),base:{...metadata().base,
    ref:'codex/stack-one',sha:'c'.repeat(40)}};
  assert.throws(()=>snapshot({...fixture({metadataBefore:stacked,metadataAfter:moved}),
    allowAdvisoryStackedBase:true}),e=>e.message==='GITHUB_PR_CHANGED_DURING_READ');
  const fork={...stacked,head:{...stacked.head,
    repo:{full_name:'attacker/fork',id:1282086207}}};
  assert.throws(()=>snapshot({...fixture({metadataBefore:fork,metadataAfter:fork}),
    allowAdvisoryStackedBase:true}),e=>e.message==='GITHUB_PR_NOT_ELIGIBLE');
});
test('target private master is required even though public Publisher uses main',()=>{
  const pinned=snapshot(fixture());
  assert.equal(pinned.repository,'deenkids7-dev/deenkids');
  for(const field of ['metadataBefore','metadataAfter']){
    const forged={...metadata(),base:{...metadata().base,ref:'main'}};
    const input=fixture({[field]:forged});
    assert.throws(()=>snapshot(input),e=>e.message==='GITHUB_PR_NOT_ELIGIBLE');
  }
  const both={...metadata(),base:{...metadata().base,ref:'main'}};
  assert.throws(()=>snapshot(fixture({
    metadataBefore:both,metadataAfter:both
  })),e=>e.message==='GITHUB_PR_NOT_ELIGIBLE');
});
rejects('rejects diff without a hunk', {
  rawDiff:Buffer.from('diff --git a/f b/f\n--- a/f\n+++ b/f\n')
},'GITHUB_DIFF_COVERAGE_UNVERIFIED');
rejects('rejects truncated diff with 2 files expected', {
  metadataBefore:{...metadata(),changed_files:2},
  metadataAfter:{...metadata(),changed_files:2}
},'GITHUB_DIFF_COVERAGE_UNVERIFIED');
rejects('rejects unsupported binary changes', {
  rawDiff:Buffer.from('diff --git a/img b/img\nBinary files a/img and b/img differ\n@@ -1 +1 @@\n-a\n+b\n')
},'GITHUB_DIFF_ENCODING_OR_BINARY_UNSUPPORTED');
rejects('rejects oversized diff', {
  rawDiff:Buffer.alloc(2*1024*1024+1,65)
},'GITHUB_DIFF_BYTES_UNSUPPORTED');
rejects('rejects malformed UTF8 diff', {
  rawDiff:Buffer.from([0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff])
},'GITHUB_DIFF_ENCODING_OR_BINARY_UNSUPPORTED');
rejects('rejects noninteger PR selector', {
  requestedPr:'898'
},'GITHUB_PR_NOT_ELIGIBLE');
test('rejects untrusted null metadata',()=>{
  assert.throws(()=>snapshot(fixture({metadataBefore:null})),
    e=>e.message==='INVALID_GITHUB_PR_METADATA');
});

test('rejects missing per-file hunk even if total hunk count matches file count',()=>{
  const incomplete=Buffer.from(
    'diff --git a/a.mjs b/a.mjs\n--- a/a.mjs\n+++ b/a.mjs\n'+
    '@@ -1 +1 @@\n-a\n+b\n@@ -3 +3 @@\n-x\n+y\n'+
    'diff --git a/b.mjs b/b.mjs\n--- a/b.mjs\n+++ b/b.mjs\n'
  );
  const m={...metadata(),changed_files:2};
  assert.throws(()=>snapshot(fixture({
    metadataBefore:m,metadataAfter:m,rawDiff:incomplete
  })),e=>e.message==='GITHUB_DIFF_COVERAGE_UNVERIFIED');
});
test('rejects duplicate changed-file path and mismatched header path',()=>{
  for(const raw of [
    Buffer.from(diff.toString()+diff.toString()),
    Buffer.from('diff --git a/a.mjs b/b.mjs\n'+
      '--- a/a.mjs\n+++ b/b.mjs\n@@ -1 +1 @@\n-a\n+b\n'),
    Buffer.from('diff --git a/a.mjs b/a.mjs\n'+
      '--- a/a.mjs\n+++ b/other.mjs\n@@ -1 +1 @@\n-a\n+b\n')
  ]){
    const count=raw.equals(Buffer.from(diff.toString()+diff.toString()))?2:1;
    const m={...metadata(),changed_files:count};
    assert.throws(()=>snapshot(fixture({
      metadataBefore:m,metadataAfter:m,rawDiff:raw
    })),e=>e.message==='GITHUB_DIFF_COVERAGE_UNVERIFIED');
  }
});
test('two complete text files are accepted with exact counted hunks',()=>{
  const second=Buffer.from(
    diff.toString()+
    'diff --git a/other.mjs b/other.mjs\n'+
    'index ab..cd 100644\n--- a/other.mjs\n+++ b/other.mjs\n'+
    '@@ -1 +1 @@\n-old\n+new\n'
  );
  const m={...metadata(),changed_files:2};
  const result=snapshot(fixture({
    metadataBefore:m,metadataAfter:m,rawDiff:second
  }));
  assert.equal(result.diff_sha256,createHash('sha256').update(second).digest('hex'));
});

test('rejects silently truncated hunk even with valid headers and file count',()=>{
  for(const patch of [
    '@@ -1,2 +1,2 @@\n-before\n+after\n',
    '@@ -1,1 +1,2 @@\n-before\n+after\n',
    '@@ -1,1 +1,1 @@\n-before\n+after\n+unexpected\n',
    '@@ -1,1 +1,1 @@\n-before\n',
    '@@ -1,1 +1,1 @@\n+after\n',
  ]) {
    const raw=Buffer.from(
      'diff --git a/demo.mjs b/demo.mjs\n--- a/demo.mjs\n+++ b/demo.mjs\n'+patch);
    assert.throws(()=>snapshot(fixture({rawDiff:raw})),
      /GITHUB_DIFF_HUNK_LENGTH_MISMATCH/);
  }
});
test('permits counted context/deletion/addition lines within complete hunks',()=>{
  const raw=Buffer.from(
    'diff --git a/demo.mjs b/demo.mjs\nindex abc..def 100644\n'+
    '--- a/demo.mjs\n+++ b/demo.mjs\n@@ -1,3 +1,3 @@ render\n'+
    ' context\n-old\n+new\n context2\n'
  );
  const result=snapshot(fixture({rawDiff:raw}));
  assert.equal(result.diff_sha256,createHash('sha256').update(raw).digest('hex'));
});

test('forked or missing head repository cannot impersonate internal DevFactory changes',()=>{
  const badHeadRepositories=[
    {full_name:'attacker/fork',id:1282086207},
    {full_name:'deenkids7-dev/deenkids',id:33},
    null
  ];
  for(const badRepo of badHeadRepositories) {
    const m=metadata();
    m.head={sha:h,repo:badRepo};
    assert.throws(()=>snapshot(fixture({metadataBefore:m})),
      /(?:INVALID_GITHUB_PR_METADATA|GITHUB_PR_NOT_ELIGIBLE)/);
  }
});

test('immutable Git diff metadata must reject overlapping and nonmonotonic hunks',()=>{
 const before='diff --git a/demo.mjs b/demo.mjs\n--- a/demo.mjs\n+++ b/demo.mjs\n';
 const examples=[
  '@@ -1 +1 @@\n-old\n+new\n@@ -1 +1 @@\n-again\n+again\n',
  '@@ -10 +10 @@\n-old\n+new\n@@ -2 +2 @@\n-old\n+new\n',
  '@@ -0 +1 @@\n-old\n+new\n',
  '@@ -1 +0 @@\n-old\n+new\n'
 ];
 for(const caseText of examples)
  assert.throws(()=>snapshot(fixture({rawDiff:Buffer.from(before+caseText)})),
    /GITHUB_DIFF_HUNK_ORDER_INVALID/);
});
test('allows new-file and deletion-only zero-span origin where Git format requires it',()=>{
 for(const raw of [
  'diff --git a/demo.mjs b/demo.mjs\nnew file mode 100644\n--- /dev/null\n+++ b/demo.mjs\n@@ -0,0 +1 @@\n+new\n',
  'diff --git a/demo.mjs b/demo.mjs\ndeleted file mode 100644\n--- a/demo.mjs\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n'
 ])assert.doesNotThrow(()=>snapshot(fixture({rawDiff:Buffer.from(raw)})));
});

test('CRLF diff is parsed without modifying immutable original diff digest',()=>{
 const raw=Buffer.from(diff.toString('utf8').replace(/\n/g,'\r\n'));
 const expected=createHash('sha256').update(raw).digest('hex');
 const actual=snapshot(fixture({rawDiff:raw}));
 assert.equal(actual.diff_sha256,expected);
 assert.notEqual(actual.diff_sha256,createHash('sha256').update(diff).digest('hex'));
});
