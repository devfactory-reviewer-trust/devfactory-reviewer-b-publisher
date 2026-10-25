import {DatabaseSync} from 'node:sqlite';
import {isAbsolute,dirname} from 'node:path';
import {lstatSync} from 'node:fs';

const GLOBAL_EUR=15_000_000;
const FX_CEILING=3; // Pessimistic EUR per USD; an upper bound, not a live FX quote.
const ROLES=Object.freeze({reviewer_b:{monthly:3_000_000,perRequest:500_000},
  development:{monthly:10_000_000,perRequest:1_000_000}});
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;
const SHA=/^[a-f0-9]{40}$/;
const SHA256=/^[a-f0-9]{64}$/;
const MODELS=new Set([
  'deepseek/deepseek-v4.1-flash-1017',
  'deepseek/deepseek-v4.1-flash-20261017',
  'qwen/qwen3-coder-30b-a3b-instruct',
]);
const fail=reason=>{throw Error(reason)};
const exact=(o,keys)=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(o))&&
  Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const micro=n=>Number.isSafeInteger(n)&&n>=0;
function monthOf(now){
  const date=now();
  if(!(date instanceof Date)||!Number.isFinite(date.getTime()))
    fail('CLOCK_UNVERIFIED');
  return date.toISOString().slice(0,7);
}
function validateReservation(r){
  if(!exact(r,['id','role','pr','head','upperUsdMicros'])||
     typeof r.id!=='string'||!ID.test(r.id)||
     !Object.hasOwn(ROLES,r.role)||!Number.isSafeInteger(r.pr)||
     r.pr<1||r.pr>9_999_999||
     typeof r.head!=='string'||!SHA.test(r.head)||
     !micro(r.upperUsdMicros)||r.upperUsdMicros<1||
     r.upperUsdMicros>ROLES[r.role].perRequest)
    fail('INVALID_RESERVATION');
}
function validatePhysicalAttempt(p){
  if(!exact(p,['id','role','pr','head','upperUsdMicros',
     'requestBodySha256','model','runId','attemptId'])||
     !SHA256.test(p.requestBodySha256||'')||
     typeof p.runId!=='string'||!ID.test(p.runId)||
     typeof p.attemptId!=='string'||!ID.test(p.attemptId)||
     !MODELS.has(p.model)||
     (p.role==='development' &&
       !['deepseek/deepseek-v4.1-flash-1017',
         'deepseek/deepseek-v4.1-flash-20261017'].includes(p.model))||
     (p.role==='reviewer_b' &&
       p.model!=='qwen/qwen3-coder-30b-a3b-instruct'))
    fail('INVALID_PHYSICAL_ATTEMPT');
  validateReservation({
    id:p.id,role:p.role,pr:p.pr,head:p.head,
    upperUsdMicros:p.upperUsdMicros,
  });
}
function validateCharge(c){
  if(!exact(c,['eventId','reservationId','amountUsdMicros'])||
     typeof c.eventId!=='string'||!ID.test(c.eventId)||
     typeof c.reservationId!=='string'||!ID.test(c.reservationId)||
     !micro(c.amountUsdMicros)||c.amountUsdMicros>10_000_000)
    fail('INVALID_CHARGE');
}
function assertSafeFile(file){
  if(typeof file!=='string'||!isAbsolute(file)||file.length>2048)
    fail('LEDGER_PATH_UNSAFE');
  for(const path of [dirname(file),file]){
    try{
      const stat=lstatSync(path);
      if(stat.isSymbolicLink()||(path===dirname(file)&&!stat.isDirectory())||
         (path===file&&!stat.isFile()))
        fail('LEDGER_PATH_UNSAFE');
    }catch(err){
      if(err.code==='ENOENT'&&path===file)continue;
      throw err;
    }
  }
}
export function openFinanceLedger(file,{now=()=>new Date()}={}){
  assertSafeFile(file);
  if(typeof now!=='function')fail('CLOCK_UNVERIFIED');
  const db=new DatabaseSync(file,{timeout:2500});
  try{
    db.exec(`PRAGMA foreign_keys=ON;
      PRAGMA trusted_schema=OFF;
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      PRAGMA busy_timeout=2500;
      CREATE TABLE IF NOT EXISTS reservations (
        id TEXT PRIMARY KEY, month TEXT NOT NULL, role TEXT NOT NULL,
        pr INTEGER NOT NULL, head TEXT NOT NULL,
        upper_usd INTEGER NOT NULL, upper_eur INTEGER NOT NULL,
        created_utc TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS charges (
        event_id TEXT PRIMARY KEY, reservation_id TEXT NOT NULL
          REFERENCES reservations(id), month TEXT NOT NULL,
        amount_usd INTEGER NOT NULL, amount_eur INTEGER NOT NULL,
        created_utc TEXT NOT NULL
      );
      -- An individual reservation may be settled once only. Historical
      -- duplicates cause startup to fail closed; nothing is normalized.
      CREATE UNIQUE INDEX IF NOT EXISTS one_charge_per_reservation
        ON charges(reservation_id);
      CREATE TABLE IF NOT EXISTS physical_attempts (
        reservation_id TEXT PRIMARY KEY REFERENCES reservations(id),
        run_id TEXT NOT NULL, attempt_id TEXT NOT NULL,
        request_sha256 TEXT NOT NULL, model TEXT NOT NULL,
        created_utc TEXT NOT NULL,
        UNIQUE(run_id,attempt_id)
      );`);
    const getReservation=db.prepare('SELECT * FROM reservations WHERE id=?');
    const getPhysical=db.prepare('SELECT * FROM physical_attempts WHERE run_id=? AND attempt_id=?');
    const getCharge=db.prepare('SELECT * FROM charges WHERE event_id=?');
    const getChargeByReservation=db.prepare('SELECT * FROM charges WHERE reservation_id=?');
    const getRoleSum=db.prepare('SELECT COALESCE(SUM(upper_usd),0) AS total FROM reservations WHERE month=? AND role=?');
    const getReservationSum=db.prepare('SELECT COALESCE(SUM(upper_usd),0) AS usd, COALESCE(SUM(upper_eur),0) AS eur, COUNT(*) AS count FROM reservations WHERE month=?');
    const getChargeSum=db.prepare('SELECT COALESCE(SUM(amount_usd),0) AS usd, COALESCE(SUM(amount_eur),0) AS eur, COUNT(*) AS count FROM charges WHERE month=?');
    const insertReservation=db.prepare('INSERT INTO reservations(id,month,role,pr,head,upper_usd,upper_eur,created_utc) VALUES(?,?,?,?,?,?,?,?)');
    const insertPhysical=db.prepare('INSERT INTO physical_attempts(reservation_id,run_id,attempt_id,request_sha256,model,created_utc) VALUES(?,?,?,?,?,?)');
    const insertCharge=db.prepare('INSERT INTO charges(event_id,reservation_id,month,amount_usd,amount_eur,created_utc) VALUES(?,?,?,?,?,?)');
    const transact=fn=>{
      db.exec('BEGIN IMMEDIATE');
      try{const value=fn();db.exec('COMMIT');return value}
      catch(e){db.exec('ROLLBACK');throw e}
    };
    const totalFor=month=>{
      const r=getReservationSum.get(month),c=getChargeSum.get(month);
      return {
        reservationCount:Number(r.count),chargeCount:Number(c.count),
        reservedUsdMicros:Number(r.usd),reservedEurMicros:Number(r.eur),
        chargedUsdMicros:Number(c.usd),chargedEurMicros:Number(c.eur),
        exposureEurMicros:Number(r.eur)+Number(c.eur),
        maySpend:false,
      };
    };
    const reserveInside=r=>{
      const existing=getReservation.get(r.id);
      if(existing){
        if(existing.role!==r.role||existing.pr!==r.pr||
           existing.head!==r.head||existing.upper_usd!==r.upperUsdMicros)
          fail('RESERVATION_CONFLICT');
        return {recorded:true,id:r.id,idempotent:true,maySpend:false};
      }
      const month=monthOf(now),eur=r.upperUsdMicros*FX_CEILING;
      const roleUsed=Number(getRoleSum.get(month,r.role).total);
      if(roleUsed+r.upperUsdMicros>ROLES[r.role].monthly)
        fail('ROLE_CAP_EXCEEDED');
      if(totalFor(month).exposureEurMicros+eur>GLOBAL_EUR)
        fail('GLOBAL_CAP_EXCEEDED');
      insertReservation.run(r.id,month,r.role,r.pr,r.head,
        r.upperUsdMicros,eur,now().toISOString());
      return {recorded:true,id:r.id,idempotent:false,maySpend:false};
    };
    return Object.freeze({
      reserve(r){
        validateReservation(r);
        return transact(()=>reserveInside(r));
      },
      reservePhysicalAttempt(p){
        validatePhysicalAttempt(p);
        return transact(()=>{
          // Replay, including after a crash, must NEVER re-enable a POST.
          if(getReservation.get(p.id)||getPhysical.get(p.runId,p.attemptId))
            fail('PHYSICAL_ATTEMPT_ALREADY_RECORDED');
          const reserved=reserveInside({id:p.id,role:p.role,pr:p.pr,
            head:p.head,upperUsdMicros:p.upperUsdMicros});
          if(reserved.idempotent)fail('PHYSICAL_ATTEMPT_ALREADY_RECORDED');
          insertPhysical.run(p.id,p.runId,p.attemptId,
            p.requestBodySha256,p.model,now().toISOString());
          return {recorded:true,id:p.id,physicalAttemptRecorded:true,
            mayReserveForPaidRun:false,maySpend:false};
        });
      },
      recordCharge(c){
        validateCharge(c);
        return transact(()=>{
          const existing=getCharge.get(c.eventId);
          if(existing){
            if(existing.reservation_id!==c.reservationId||
               existing.amount_usd!==c.amountUsdMicros)
              fail('CHARGE_CONFLICT');
            return {recorded:true,eventId:c.eventId,idempotent:true,maySpend:false};
          }
          const reservation=getReservation.get(c.reservationId);
          if(!reservation)fail('UNKNOWN_RESERVATION');
          if(getChargeByReservation.get(c.reservationId))
            fail('RESERVATION_ALREADY_CHARGED');
          if(c.amountUsdMicros>reservation.upper_usd)
            fail('CHARGE_EXCEEDS_RESERVATION');
          insertCharge.run(c.eventId,c.reservationId,reservation.month,
            c.amountUsdMicros,c.amountUsdMicros*FX_CEILING,now().toISOString());
          return {recorded:true,eventId:c.eventId,idempotent:false,maySpend:false};
        });
      },
      status(){
        const month=monthOf(now);
        return {month,...totalFor(month),globalLimitEurMicros:GLOBAL_EUR,
          reviewerLimitUsdMicros:ROLES.reviewer_b.monthly,
          developerLimitUsdMicros:ROLES.development.monthly,
          fxCeilingEurPerUsd:FX_CEILING,providerBillingVerified:false,
          independentSignerVerified:false,mayReserveForPaidRun:false,maySpend:false};
      },
      close(){db.close()},
    });
  }catch(err){db.close();throw err}
}
