/**
 * Reviewer B: POSIX-only, OFFLINE reservation journal prototype.
 *
 * Durable upper-bound reservation for at-most-once private review attempts.
 * This records conservative proposed EUR exposure across distinct PR/HEADs
 * and processes. It CANNOT authenticate FX, complete provider billing, owner
 * consent, ZDR or cross-run account usage, and must never authorize inference.
 * NOT connected to the protected Publisher or its paid spend gate.
 *
 * On ambiguous write/crash, an orphaned lock blocks later reservations until
 * separately audited operator repair. Never delete it or auto-retry.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const CEILING_MICRO_EUR=15_000_000;
const SHA=/^[0-9a-f]{40}$/;
const RUN=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const MODELS=new Set([
  'qwen/qwen3-coder-30b-a3b-instruct','qwen/qwen3.6-35b-a3b',
]);
const PREFIX='reservation-';
const RECORD=/^reservation-[a-f0-9]{64}\.json$/;
const LOCK='.reviewer-b-reservation-lock';
const MAX_RECORDS=500;
const deny=reason=>Object.freeze({
  ok:false,reason,recorded:false,maySpend:false,mayReserve:false,
  providerBillingAuthenticated:false,fxAuthenticated:false,
  mayRetryAmbiguousRequest:false,mayMerge:false,
});
function digest(pr,head){
  return createHash('sha256').update('reviewer-b-private-review-v1:'+pr+':'+head).digest('hex');
}
function directorySafe(dir){
  if(process.platform==='win32'||typeof dir!=='string'||
     !path.isAbsolute(dir))return false;
  try{
    const s=fs.lstatSync(dir);
    return s.isDirectory()&&!s.isSymbolicLink()&&
      s.uid===process.getuid()&&(s.mode&0o077)===0&&
      fs.realpathSync(dir)===path.resolve(dir);
  }catch{return false;}
}
function safeClock(now){
  try{
    const n=now();
    return Number.isSafeInteger(n)&&n>0&&n<8_640_000_000_000_000?n:null;
  }catch{return null;}
}
function toMicroEur(value){
  if(typeof value!=='number'||!Number.isFinite(value)||value<=0||
     value>15)return null;
  const micros=Math.ceil(value*1e6);
  return Number.isSafeInteger(micros)&&micros>0&&
    micros<=CEILING_MICRO_EUR?micros:null;
}
function inspectRecord(dir,name,now){
  let fd;
  try{
    const full=path.join(dir,name);
    const before=fs.lstatSync(full);
    if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||
       before.uid!==process.getuid()||(before.mode&0o077)!==0||
       before.size<50||before.size>1200)return null;
    fd=fs.openSync(full,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
    const opened=fs.fstatSync(fd);
    if(!opened.isFile()||opened.ino!==before.ino||
       opened.dev!==before.dev||opened.nlink!==1||
       opened.size!==before.size||opened.mtimeMs!==before.mtimeMs||
       opened.ctimeMs!==before.ctimeMs)return null;
    const text=fs.readFileSync(fd,'utf8');
    const after=fs.fstatSync(fd),named=fs.lstatSync(full);
    if(Buffer.byteLength(text,'utf8')!==opened.size||
       after.size!==opened.size||after.mtimeMs!==opened.mtimeMs||
       after.ctimeMs!==opened.ctimeMs||named.ino!==opened.ino||
       named.dev!==opened.dev||named.nlink!==1||
       named.size!==opened.size||named.mtimeMs!==opened.mtimeMs||
       named.ctimeMs!==opened.ctimeMs)return null;
    const r=JSON.parse(text);
    if(r?.schemaVersion!==1||
       !Number.isSafeInteger(r.prNumber)||r.prNumber<1||
       r.prNumber>2147483647||typeof r.headSha!=='string'||
       !SHA.test(r.headSha)||typeof r.runId!=='string'||
       !RUN.test(r.runId)||!MODELS.has(r.model)||
       !Number.isSafeInteger(r.requestCommentId)||r.requestCommentId<1||
       !Number.isSafeInteger(r.upperMicroEur)||r.upperMicroEur<1||
       r.upperMicroEur>CEILING_MICRO_EUR||
       !Number.isSafeInteger(r.createdAtMs)||r.createdAtMs<=0||
       r.createdAtMs>now+60_000||
       r.monthUtc!==new Date(r.createdAtMs).toISOString().slice(0,7)||
       name!==PREFIX+digest(r.prNumber,r.headSha)+'.json')return null;
    return r;
  }catch{return null}
  finally{if(fd!==undefined)try{fs.closeSync(fd)}catch{/* fail closed */}}
}
function scan(dir,now,{lockHeld=false}={}){
  if(!directorySafe(dir))return {error:'OFFLINE_JOURNAL_DIRECTORY_UNVERIFIED'};
  let names;
  try{names=fs.readdirSync(dir)}catch{
    return {error:'OFFLINE_JOURNAL_LIST_UNVERIFIED'};
  }
  if(names.length>MAX_RECORDS+Number(lockHeld))
    return {error:'OFFLINE_JOURNAL_TOO_MANY_RECORDS'};
  if(names.includes(LOCK)!==lockHeld)
    return {error:'OFFLINE_JOURNAL_LOCK_OR_FOREIGN_FILE'};
  const rows=[];
  const comments=new Set(),claims=new Set();
  for(const name of names){
    if(lockHeld&&name===LOCK)continue;
    if(!RECORD.test(name))return {error:'OFFLINE_JOURNAL_LOCK_OR_FOREIGN_FILE'};
    const r=inspectRecord(dir,name,now);
    if(!r||comments.has(r.requestCommentId)||
       claims.has(r.prNumber+':'+r.headSha))
      return {error:'OFFLINE_JOURNAL_RECORD_UNVERIFIED'};
    comments.add(r.requestCommentId);
    claims.add(r.prNumber+':'+r.headSha);
    rows.push(r);
  }
  return {rows};
}
function fsyncDirectory(dir){
  const fd=fs.openSync(dir,fs.constants.O_RDONLY|(fs.constants.O_DIRECTORY||0));
  try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
}
function validateClaim(c){
  if(!c||typeof c!=='object'||Array.isArray(c)||
     !Number.isSafeInteger(c.prNumber)||c.prNumber<1||
     c.prNumber>2147483647||typeof c.headSha!=='string'||
     !SHA.test(c.headSha)||typeof c.runId!=='string'||
     !RUN.test(c.runId)||!MODELS.has(c.model)||
     !Number.isSafeInteger(c.requestCommentId)||c.requestCommentId<1)
    return null;
  const micros=toMicroEur(c.proposedUpperBoundEur);
  return micros===null?null:{...c,upperMicroEur:micros};
}
export function inspectOfflineOpenRouterReservations({
  directory,now=Date.now,
}={}){
  const time=safeClock(now);
  if(time===null)return deny('OFFLINE_JOURNAL_CLOCK_UNVERIFIED');
  const snap=scan(directory,time);
  if(snap.error)return deny(snap.error);
  const monthUtc=new Date(time).toISOString().slice(0,7);
  const current=snap.rows.filter(r=>r.monthUtc===monthUtc);
  const reservedMicroEur=current.reduce((s,r)=>s+r.upperMicroEur,0);
  if(!Number.isSafeInteger(reservedMicroEur)||
     reservedMicroEur>CEILING_MICRO_EUR)
    return deny('OFFLINE_JOURNAL_LIMIT_EXCEEDED');
  return Object.freeze({
    ok:true,status:'OFFLINE_RESERVATION_SNAPSHOT_NOT_BILLING_PROOF',
    monthUtc,records:snap.rows.length,reservedMicroEur,
    monthlyCeilingMicroEur:CEILING_MICRO_EUR,
    maySpend:false,mayReserve:false,providerBillingAuthenticated:false,
    fxAuthenticated:false,mayRetryAmbiguousRequest:false,mayMerge:false,
  });
}
export function reserveOfflineOpenRouterExposure({
  directory,claim,now=Date.now,
}={}){
  const time=safeClock(now),r=validateClaim(claim);
  if(time===null)return deny('OFFLINE_JOURNAL_CLOCK_UNVERIFIED');
  if(!r)return deny('OFFLINE_JOURNAL_CLAIM_INVALID');
  if(!directorySafe(directory))
    return deny('OFFLINE_JOURNAL_DIRECTORY_UNVERIFIED');
  // Acquire one shared lock before reading ANY reservation. A second
  // process is denied immediately; it must never wait/retry a billed claim.
  const lockPath=path.join(directory,LOCK);
  let lockFd,cleanRelease=false;
  try{
    lockFd=fs.openSync(lockPath,
      fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|
      (fs.constants.O_NOFOLLOW||0),0o600);
    fs.writeFileSync(lockFd,'exclusive offline audit lock\n');
    fs.fsyncSync(lockFd);
    fs.closeSync(lockFd);lockFd=null;
    fsyncDirectory(directory);
    const snap=scan(directory,time,{lockHeld:true});
    if(snap.error)return deny(snap.error);
    // Never create a record that would make all subsequent inspections
    // fail the global MAX_RECORDS limit, even when EUR exposure is tiny.
    if(snap.rows.length>=MAX_RECORDS){
      cleanRelease=true;
      return deny('OFFLINE_JOURNAL_TOO_MANY_RECORDS');
    }
    const monthUtc=new Date(time).toISOString().slice(0,7);
    if(snap.rows.some(row=>
       (row.prNumber===r.prNumber&&row.headSha===r.headSha)||
        row.requestCommentId===r.requestCommentId)){
      cleanRelease=true;
      return deny('OFFLINE_JOURNAL_DUPLICATE_POSSIBLY_BILLED');
    }
    let reserved=0;
    for(const row of snap.rows){
      if(row.monthUtc===monthUtc)reserved+=row.upperMicroEur;
    }
    if(!Number.isSafeInteger(reserved)||
       reserved+r.upperMicroEur>CEILING_MICRO_EUR){
      cleanRelease=true;
      return deny('OFFLINE_JOURNAL_MONTHLY_CAP_EXCEEDED');
    }
    const record={
      schemaVersion:1,prNumber:r.prNumber,headSha:r.headSha,
      runId:r.runId,model:r.model,requestCommentId:r.requestCommentId,
      upperMicroEur:r.upperMicroEur,monthUtc,createdAtMs:time,
    };
    const recordPath=path.join(directory,
      PREFIX+digest(r.prNumber,r.headSha)+'.json');
    let fd=null;
    try{
      fd=fs.openSync(recordPath,
        fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|
        (fs.constants.O_NOFOLLOW||0),0o600);
      fs.writeFileSync(fd,JSON.stringify(record)+'\n');
      fs.fsyncSync(fd);
      fs.closeSync(fd);fd=null;
      fsyncDirectory(directory);
    }finally{
      if(fd!==null)try{fs.closeSync(fd)}catch{/* retain lock */ }
    }
    cleanRelease=true;
    // A durable offline reservation is NOT authenticated monthly billing,
    // not authenticated EUR conversion, and never a permit for any POST.
    return Object.freeze({
      ok:true,status:'OFFLINE_PROPOSED_RESERVATION_NOT_SPEND_AUTHORITY',
      recorded:true,monthUtc,records:snap.rows.length+1,
      reservedMicroEur:reserved+r.upperMicroEur,
      monthlyCeilingMicroEur:CEILING_MICRO_EUR,
      mayReserve:false,maySpend:false,providerBillingAuthenticated:false,
      fxAuthenticated:false,mayRetryAmbiguousRequest:false,mayMerge:false,
    });
  }catch{
    return deny('OFFLINE_JOURNAL_LOCK_OR_IO_UNVERIFIED');
  }finally{
    if(lockFd!==undefined&&lockFd!==null)
      try{fs.closeSync(lockFd)}catch{/* retain lock */ }
    if(cleanRelease){
      try{fs.unlinkSync(lockPath);fsyncDirectory(directory)}
      catch{/* Any remaining lock fails future requests closed. */}
    }
  }
}

[executed on device: MSI (9ce3a633-4309-4f3e-b074-f535afb4ef99)]