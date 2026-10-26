/**
 * Fail-closed bridge to a separately operated, durable financial authority.
 * The Publisher cannot mint, refund or replay reservations. In particular,
 * a read-only OpenRouter key limit is NOT an independent money reservation.
 * This module cannot attest that a remote broker was correctly deployed:
 * its pinned signer and atomic ledger must be reviewed separately.
 */
import {createHash,createPublicKey,verify as verifySignature} from 'node:crypto';
const sha=v=>createHash('sha256').update(v).digest('hex');
const DOMAIN='DEVFACTORY_REVIEWER_B_FINANCIAL_RESERVATION_V1\n';
const SHA40=/^[a-f0-9]{40}$/,SHA64=/^[a-f0-9]{64}$/;
const RUN=/^gh-[1-9][0-9]{0,18}-[1-9][0-9]{0,18}$/;
const ID=/^res-[a-f0-9]{32,64}$/;
const SIG=/^[A-Za-z0-9+/]{86}==$/;
const SCHEMA=1,GLOBAL_CAP=13_000_000,REVIEWER_CAP=3_000_000;
const PROOFS=new WeakMap(),CONSUMED=new WeakSet();
const deny=c=>{throw Error(c)};
export const FINANCIAL_RESERVATION_DOMAIN=DOMAIN;

function requestFields({prNumber,headSha,runId,shardIndex,model,
 requestSha256,upperMicroUsd,atMs}={}){
 if(!Number.isSafeInteger(prNumber)||prNumber<1||prNumber>2147483647||
    !SHA40.test(headSha||'')||!RUN.test(runId||'')||
    !Number.isSafeInteger(shardIndex)||shardIndex<0||shardIndex>95||
    !['qwen/qwen3-coder-30b-a3b-instruct','qwen/qwen3.6-35b-a3b'].includes(model)||
    !SHA64.test(requestSha256||'')||
    !Number.isSafeInteger(upperMicroUsd)||upperMicroUsd<1||
    upperMicroUsd>10000||
    !Number.isSafeInteger(atMs)||atMs<1)
   deny('OR_FINANCIAL_SCOPE_INVALID');
 const monthUtc=new Date(atMs).toISOString().slice(0,7);
 const identity={schemaVersion:SCHEMA,role:'reviewer-b',
   prNumber,headSha,runId,shardIndex,model,requestSha256,
   upperMicroUsd,monthUtc,globalMonthCapMicroUsd:GLOBAL_CAP,
   reviewerMonthCapMicroUsd:REVIEWER_CAP};
 return Object.freeze({...identity,
   idempotencyKey:sha(DOMAIN+JSON.stringify(identity))});
}

function receiptBytes(receipt){
 const row={schemaVersion:receipt.schemaVersion,status:receipt.status,
   role:receipt.role,prNumber:receipt.prNumber,headSha:receipt.headSha,
   runId:receipt.runId,shardIndex:receipt.shardIndex,model:receipt.model,
   requestSha256:receipt.requestSha256,
   upperMicroUsd:receipt.upperMicroUsd,monthUtc:receipt.monthUtc,
   globalMonthCapMicroUsd:receipt.globalMonthCapMicroUsd,
   reviewerMonthCapMicroUsd:receipt.reviewerMonthCapMicroUsd,
   idempotencyKey:receipt.idempotencyKey,
   reservationId:receipt.reservationId,expiresAtMs:receipt.expiresAtMs};
 return Buffer.from(DOMAIN+JSON.stringify(row),'utf8');
}
export function makeFinancialReservationReceiptBytes(receipt){
 return receiptBytes(receipt);
}
function keyFromPinnedPolicy(publicKeyPem,fingerprint){
 if(typeof publicKeyPem!=='string'||!SHA64.test(fingerprint||''))
   deny('OR_FINANCIAL_SIGNER_UNPINNED');
 let key;
 try{
  key=createPublicKey(publicKeyPem);
  if(key.asymmetricKeyType!=='ed25519'||key.type!=='public')
    deny('OR_FINANCIAL_SIGNER_UNPINNED');
  const actual=sha(key.export({type:'spki',format:'der'}));
  if(actual!==fingerprint)deny('OR_FINANCIAL_SIGNER_UNPINNED');
 }catch{deny('OR_FINANCIAL_SIGNER_UNPINNED')}
 return key;
}
function trustedEndpoint(s){
 if(typeof s!=='string')deny('OR_FINANCIAL_ENDPOINT_UNTRUSTED');
 let url;
 try{url=new URL(s)}catch{deny('OR_FINANCIAL_ENDPOINT_UNTRUSTED')}
 if(url.protocol!=='https:'||url.username||url.password||
    url.port||url.search||url.hash||
    url.pathname!=='/v1/financial-reservations/openrouter-reviewer-b'||
    !/^[a-z0-9.-]+$/i.test(url.hostname)||!url.hostname.includes('.')||
    url.hostname==='localhost'||url.hostname.endsWith('.localhost')||
    /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname))
   deny('OR_FINANCIAL_ENDPOINT_UNTRUSTED');
 return url.href;
}
export function validateIndependentFinancialConfig(config={}){
 try{
  const endpoint=trustedEndpoint(config.endpoint);
  const key=keyFromPinnedPolicy(config.trustedSignerPublicKeyPem,
    config.trustedSignerFingerprintSha256);
  // A signed receipt is not proof that an unauthenticated caller is allowed
  // to reserve; both endpoint and Publisher require the same protected token.
  if(typeof config.authorizationToken!=='string'||
     !/^[A-Za-z0-9_-]{40,256}$/.test(config.authorizationToken))
    deny('OR_FINANCIAL_BROKER_AUTH_UNCONFIGURED');
  return Object.freeze({ok:true,endpoint,signer:key,
    authorizationToken:config.authorizationToken});
 }catch{return Object.freeze({ok:false})}
}
export async function reserveIndependentFinancialShard({
 config,context,fetchImpl=globalThis.fetch,now=()=>Date.now()
}={}){
 const ready=validateIndependentFinancialConfig(config);
 if(!ready.ok||typeof fetchImpl!=='function'||typeof now!=='function')
   deny('OR_FINANCIAL_AUTHORITY_NOT_CONFIGURED');
 const atMs=now();
 const expected=requestFields({...context,atMs});
 let r;
 try{
  r=await fetchImpl(ready.endpoint,{
   method:'POST',redirect:'error',cache:'no-store',
   signal:AbortSignal.timeout(12000),
   headers:{'Content-Type':'application/json',Accept:'application/json',
    Authorization:'Bearer '+ready.authorizationToken},
   body:JSON.stringify(expected)
  });
 }catch{deny('OR_FINANCIAL_RESERVATION_UNCERTAIN_NO_RETRY')}
 if(r?.status!==200||r.url!==ready.endpoint||r.redirected!==false||
    !/^application\/json(?:\s*;|$)/i.test(r.headers?.get?.('content-type')||''))
   deny('OR_FINANCIAL_RESERVATION_UNVERIFIED');
 const len=r.headers.get('content-length');
 if(len!==null&&(!/^\d+$/.test(len)||Number(len)>4096))
   deny('OR_FINANCIAL_RESERVATION_UNVERIFIED');
 let receipt;
 try{
  if(typeof r.body?.getReader!=='function')deny('OR_FINANCIAL_RESERVATION_UNVERIFIED');
  const reader=r.body.getReader(),chunks=[];let bytes=0;
  try{
   for(;;){
    const chunk=await reader.read();
    if(chunk.done)break;
    if(!(chunk.value instanceof Uint8Array))deny('OR_FINANCIAL_RESERVATION_UNVERIFIED');
    bytes+=chunk.value.length;
    if(bytes>4096)deny('OR_FINANCIAL_RESERVATION_UNVERIFIED');
    chunks.push(Buffer.from(chunk.value));
   }
  }finally{reader.releaseLock()}
  receipt=JSON.parse(Buffer.concat(chunks,bytes).toString('utf8'));
 }catch{deny('OR_FINANCIAL_RESERVATION_UNVERIFIED')}
 if(!receipt||typeof receipt!=='object'||Array.isArray(receipt)||
    receipt.schemaVersion!==SCHEMA||
    receipt.status!=='RESERVED_POSSIBLY_BILLED_NO_AUTO_REFUND'||
    !ID.test(receipt.reservationId||'')||
    !SIG.test(receipt.signature||'')||
    !Number.isSafeInteger(receipt.expiresAtMs)||
    receipt.expiresAtMs<=atMs||
    receipt.expiresAtMs>atMs+75_000)
   deny('OR_FINANCIAL_RESERVATION_UNVERIFIED');
 for(const [key,value] of Object.entries(expected))
  if(receipt[key]!==value)deny('OR_FINANCIAL_RESERVATION_SCOPE_MISMATCH');
 const time=now();
 if(!Number.isSafeInteger(time)||time<atMs||time>=receipt.expiresAtMs)
   deny('OR_FINANCIAL_RESERVATION_EXPIRED');
 const signed=Buffer.from(receipt.signature,'base64');
 if(signed.length!==64||!verifySignature(null,receiptBytes(receipt),ready.signer,signed))
   deny('OR_FINANCIAL_RESERVATION_SIGNATURE_INVALID');
 // The opaque proof can only be minted by this verified network path.
 const proof=Object.freeze(Object.create(null));
 PROOFS.set(proof,{expected,expiresAtMs:receipt.expiresAtMs,
   reservationId:receipt.reservationId});
 return proof;
}
export function consumeIndependentFinancialShard({proof,context,now=Date.now}={}){
 const verified=proof&&PROOFS.get(proof);
 if(!verified||CONSUMED.has(proof))
   deny('OR_FINANCIAL_RESERVATION_REQUIRED');
 const {expected,expiresAtMs}=verified;
 const actualNow=typeof now==='function'?now():now;
 const at=Number.isSafeInteger(actualNow)?actualNow:NaN;
 if(!Number.isSafeInteger(at)||at>=expiresAtMs||
    at<new Date(expected.monthUtc+'-01T00:00:00Z').getTime())
   deny('OR_FINANCIAL_RESERVATION_EXPIRED');
 const {atMs:_ignored,...a}=requestFields({...context,atMs:at});
 for(const key of Object.keys(expected))
  if(a[key]!==expected[key])deny('OR_FINANCIAL_RESERVATION_SCOPE_MISMATCH');
 // Burn BEFORE a potentially billed attempt; ambiguity is never a retry.
 CONSUMED.add(proof);
 return Object.freeze({ok:true,reservationId:verified.reservationId});
}
