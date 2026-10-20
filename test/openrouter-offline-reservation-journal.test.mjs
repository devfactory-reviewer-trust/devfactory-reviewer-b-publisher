import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  inspectOfflineOpenRouterReservations,
  reserveOfflineOpenRouterExposure,
} from '../scripts/openrouter-offline-reservation-journal.mjs';

const NOW=Date.UTC(2026,9,20,8);
const SHA='a'.repeat(40),SHA2='b'.repeat(40),SHA3='c'.repeat(40);
const MODEL='qwen/qwen3-coder-30b-a3b-instruct';
const request={
  prNumber:940,headSha:SHA,runId:'gh-123-1',model:MODEL,
  requestCommentId:1234,proposedUpperBoundEur:0.25,
};
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'reviewer-b-atomic-ledger-'));
 fs.chmodSync(directory,0o700);
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 return directory;
}
const reserve=(directory,claim=request,now=()=>NOW)=>
  reserveOfflineOpenRouterExposure({directory,claim,now});
const inspect=(directory,now=()=>NOW)=>
  inspectOfflineOpenRouterReservations({directory,now});
const records=directory=>fs.readdirSync(directory).filter(n=>n.endsWith('.json'));

test('durable offline reservation charges the proposed bound once, never authorizes payment',t=>{
 const dir=fixture(t);
 const first=reserve(dir);
 assert.equal(first.ok,true);
 assert.equal(first.recorded,true);
 assert.equal(first.reservedMicroEur,250000);
 assert.equal(first.monthlyCeilingMicroEur,15000000);
 for(const key of ['mayReserve','maySpend','providerBillingAuthenticated',
   'fxAuthenticated','mayRetryAmbiguousRequest','mayMerge'])
   assert.equal(first[key],false,key);
 const snapshot=inspect(dir);
 assert.equal(snapshot.ok,true);
 assert.equal(snapshot.records,1);
 assert.equal(snapshot.reservedMicroEur,250000);
 const replay=reserve(dir);
 assert.equal(replay.ok,false);
 assert.equal(replay.reason,'OFFLINE_JOURNAL_DUPLICATE_POSSIBLY_BILLED');
 assert.equal(records(dir).length,1);
 assert.equal(inspect(dir).ok,true);
});

test('whole-month EUR15 upper bounds are enforced across different PRs',t=>{
 const dir=fixture(t);
 assert.equal(reserve(dir,{...request,proposedUpperBoundEur:10}).ok,true);
 assert.equal(reserve(dir,{
   ...request,prNumber:941,headSha:SHA2,requestCommentId:1235,
   proposedUpperBoundEur:4.999999,
 }).ok,true);
 const denied=reserve(dir,{
   ...request,prNumber:942,headSha:SHA3,requestCommentId:1236,
   proposedUpperBoundEur:0.000002,
 });
 assert.equal(denied.ok,false);
 assert.equal(denied.reason,'OFFLINE_JOURNAL_MONTHLY_CAP_EXCEEDED');
 assert.equal(records(dir).length,2);
 const snapshot=inspect(dir);
 assert.equal(snapshot.ok,true);
 assert.equal(snapshot.reservedMicroEur,14999999);
});

test('ambiguous old claim denies replay even after UTC month rollover',t=>{
 const dir=fixture(t);
 assert.equal(reserve(dir).ok,true);
 const later=()=>Date.UTC(2026,10,2,8);
 const duplicate=reserve(dir,request,later);
 assert.equal(duplicate.ok,false);
 assert.equal(duplicate.mayRetryAmbiguousRequest,false);
 assert.equal(reserve(dir,{
   ...request,prNumber:940,headSha:SHA2,requestCommentId:1237,
 },later).ok,true);
 assert.equal(inspect(dir,later).reservedMicroEur,250000);
});

test('same comment ID cannot pay for a different PR or changed head',t=>{
 const dir=fixture(t);
 assert.equal(reserve(dir).ok,true);
 const dup=reserve(dir,{...request,prNumber:941,headSha:SHA2});
 assert.equal(dup.ok,false);
 assert.equal(dup.reason,'OFFLINE_JOURNAL_DUPLICATE_POSSIBLY_BILLED');
});

test('torn lock blocks every new claim and is not auto-deleted',t=>{
 const dir=fixture(t);
 fs.writeFileSync(path.join(dir,'.reviewer-b-reservation-lock'),
   'possibly billed interrupted transaction\n',{mode:0o600});
 const r=reserve(dir);
 assert.equal(r.ok,false);
 assert.equal(r.maySpend,false);
 assert.equal(inspect(dir).ok,false);
 assert.equal(fs.existsSync(path.join(dir,'.reviewer-b-reservation-lock')),true);
});

test('corrupt, hardlinked or replaced record fails closed',t=>{
 const dir=fixture(t);
 assert.equal(reserve(dir).ok,true);
 const file=path.join(dir,records(dir)[0]);
 fs.writeFileSync(file,'{broken',{mode:0o600});
 assert.equal(inspect(dir).ok,false);
 assert.equal(reserve(dir,{...request,prNumber:941,headSha:SHA2,requestCommentId:55}).ok,false);
 assert.equal(records(dir).length,1);
});

test('unexpected files and public directory permissions fail without network',t=>{
 const dir=fixture(t);
 fs.writeFileSync(path.join(dir,'foreign.json'),'{}',{mode:0o600});
 assert.equal(reserve(dir).ok,false);
 assert.equal(inspect(dir).ok,false);
 fs.unlinkSync(path.join(dir,'foreign.json'));
 fs.chmodSync(dir,0o755);
 assert.equal(reserve(dir).ok,false);
 assert.equal(inspect(dir).ok,false);
});

test('invalid claim or forged upper bound never mutates reservation ledger',t=>{
 const dir=fixture(t);
 for(const patch of [
  {prNumber:0},{headSha:'ABC'},
  {headSha:[SHA]},{headSha:{toString:()=>SHA}},
  {model:'evil/model'},{runId:'../../bad'},
  {runId:['gh-123-1']},
  {requestCommentId:0},{proposedUpperBoundEur:0},
  {proposedUpperBoundEur:15.000001},
  {proposedUpperBoundEur:NaN},
  {proposedUpperBoundEur:'0.1'},
 ]){
  const r=reserve(dir,{...request,...patch});
  assert.equal(r.ok,false);
  assert.equal(r.maySpend,false);
 }
 assert.deepEqual(fs.readdirSync(dir),[]);
});

test('POSIX-only marker never creates a file on Windows native',t=>{
 if(process.platform!=='win32')return t.skip('Windows-only');
 const dir=fixture(t);
 assert.equal(reserve(dir).ok,false);
 assert.deepEqual(fs.readdirSync(dir),[]);
});

test('separate worker processes contend on one global O_EXCL lock',async t=>{
 if(process.platform==='win32')return t.skip('POSIX-only safety test');
 const dir=fixture(t);
 const url=new URL('../scripts/openrouter-offline-reservation-journal.mjs',import.meta.url).href;
 const runOne=i=>new Promise((resolve,reject)=>{
  const claim={...request,prNumber:940+i,
    headSha:String(i+1).repeat(40),runId:'gh-'+i,
    requestCommentId:4000+i,proposedUpperBoundEur:0.05};
  const script='import {reserveOfflineOpenRouterExposure as reserve} from '+
    JSON.stringify(url)+';process.stdout.write(reserve({directory:process.argv[1],claim:'+
    JSON.stringify(claim)+',now:()=>'+NOW+'}).ok?"YES":"NO");';
  const child=spawn(process.execPath,['--input-type=module','-e',script,dir],
    {stdio:['ignore','pipe','pipe']});
  let body='';
  child.stdout.on('data',chunk=>body+=chunk.toString());
  child.on('error',reject);
  child.on('close',code=>code===0?resolve(body):reject(Error('OFFLINE_CHILD_FAILED')));
 });
 const verdicts=await Promise.all(Array.from({length:8},(_,i)=>runOne(i)));
 assert.ok(verdicts.every(x=>x==='YES'||x==='NO'));
 assert.equal(verdicts.filter(x=>x==='YES').length,records(dir).length);
 assert.equal(inspect(dir).ok,true);
 assert.ok(records(dir).length>=1);
 assert.equal(fs.readdirSync(dir).includes('.reviewer-b-reservation-lock'),false);
});

test('explicit paid Publisher guard stays BLOCKED and never imports prototype',()=>{
 const root=new URL('../',import.meta.url);
 const gate=fs.readFileSync(fileURLToPath(
  new URL('scripts/openrouter-only-spend-gate.mjs',root)),'utf8');
 const real=fs.readFileSync(fileURLToPath(
  new URL('scripts/protected-real-openrouter-review.mjs',root)),'utf8');
 assert.match(gate,/OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED/);
 assert.doesNotMatch(gate,/openrouter-offline-reservation-journal/);
 assert.doesNotMatch(real,/openrouter-offline-reservation-journal/);
 assert.match(real,/budget\.verified!==true\|\|budget\.maySpend!==true/);
});

test('symlinked and hardlinked reservation records fail closed',t=>{
 if(process.platform==='win32')return t.skip('POSIX permissions required');
 const dir=fixture(t);
 assert.equal(reserve(dir).ok,true);
 const record=path.join(dir,records(dir)[0]);
 const outside=path.join(os.tmpdir(),'reviewer-b-hardlink-'+process.pid+'-'+Date.now());
 try{
  fs.linkSync(record,outside);
  assert.equal(inspect(dir).ok,false,'hardlink count cannot be 2');
  assert.equal(reserve(dir,{
   ...request,prNumber:945,headSha:SHA2,requestCommentId:1545,
  }).ok,false);
 }finally{try{fs.unlinkSync(outside)}catch{}}
 const copy=path.join(os.tmpdir(),'reviewer-b-symlink-'+process.pid+'-'+Date.now());
 try{
  fs.copyFileSync(record,copy);
  fs.unlinkSync(record);
  fs.symlinkSync(copy,record);
  assert.equal(inspect(dir).ok,false);
  assert.equal(reserve(dir,{
   ...request,prNumber:945,headSha:SHA2,requestCommentId:1545,
  }).ok,false);
 }finally{try{fs.unlinkSync(copy)}catch{}}
});

test('review ceiling cannot be reset by reused PR head with another model',t=>{
 const dir=fixture(t);
 assert.equal(reserve(dir).ok,true);
 const denied=reserve(dir,{
  ...request,requestCommentId:1235,
  model:'qwen/qwen3.6-35b-a3b',
 });
 assert.equal(denied.ok,false);
 assert.equal(denied.reason,'OFFLINE_JOURNAL_DUPLICATE_POSSIBLY_BILLED');
 assert.equal(records(dir).length,1);
});

test('500-record bound denies the 501st BEFORE mutating ledger',t=>{
 if(process.platform==='win32')return t.skip('POSIX journal');
 const dir=fixture(t);
 for(let i=0;i<500;i++){
  const r=reserve(dir,{
    ...request,prNumber:1000+i,headSha:i.toString(16).padStart(40,'0'),
    runId:'run'+i,requestCommentId:7000+i,
    proposedUpperBoundEur:0.000001,
  });
  assert.equal(r.ok,true,'failed before limit index '+i);
 }
 const denied=reserve(dir,{
  ...request,prNumber:9999,headSha:'f'.repeat(40),
  requestCommentId:9999,proposedUpperBoundEur:0.000001,
 });
 assert.equal(denied.ok,false);
 assert.equal(denied.reason,'OFFLINE_JOURNAL_TOO_MANY_RECORDS');
 assert.equal(inspect(dir).ok,true);
 assert.equal(inspect(dir).records,500);
 assert.equal(fs.readdirSync(dir).includes('.reviewer-b-reservation-lock'),false);
});

test('array-typed HEAD in a tampered record fails inspection; valid HEAD cannot replay',t=>{
 const dir=fixture(t);
 assert.equal(reserve(dir).ok,true);
 const file=path.join(dir,records(dir)[0]);
 const row=JSON.parse(fs.readFileSync(file,'utf8'));
 row.headSha=[row.headSha];
 fs.writeFileSync(file,JSON.stringify(row)+'\n',{mode:0o600});
 assert.equal(inspect(dir).ok,false);
 assert.equal(reserve(dir,{...request,prNumber:9998,headSha:SHA2,
   requestCommentId:7777}).ok,false);
});

[executed on device: MSI (9ce3a633-4309-4f3e-b074-f535afb4ef99)]