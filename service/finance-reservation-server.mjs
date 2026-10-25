import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {openFinanceLedger} from './finance-reservation-ledger.mjs';

const TOKEN=/^[A-Za-z0-9._-]{32,256}$/;
const MAX_BODY=8192;
function matchToken(provided,expected){
  const got=Buffer.from(provided,'utf8'),want=Buffer.from(expected,'utf8');
  return got.length===want.length&&timingSafeEqual(got,want);
}
function send(res,status,body){
  const data=Buffer.from(JSON.stringify({...body,maySpend:false}));
  res.writeHead(status,{'content-type':'application/json; charset=utf-8',
    'content-length':data.length,'cache-control':'no-store',
    'x-content-type-options':'nosniff'});
  res.end(data);
}
async function readJson(req){
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))
    throw Error('INVALID_CONTENT_TYPE');
  let bytes=0,tooLarge=false;
  const parts=[];
  for await (const chunk of req){
    bytes+=chunk.length;
    if(bytes>MAX_BODY){tooLarge=true;continue}
    parts.push(chunk);
  }
  if(tooLarge)throw Error('PAYLOAD_TOO_LARGE');
  if(bytes<2)throw Error('INVALID_JSON');
  let result;
  try{result=JSON.parse(Buffer.concat(parts).toString('utf8'))}
  catch{throw Error('INVALID_JSON')}
  if(result===null||typeof result!=='object'||Array.isArray(result))
    throw Error('INVALID_JSON');
  return result;
}
function statusFor(err){
  const msg=err?.message||'SERVICE_UNAVAILABLE';
  if(msg==='PAYLOAD_TOO_LARGE')return [413,msg];
  if(['INVALID_CONTENT_TYPE','INVALID_JSON','INVALID_RESERVATION',
    'INVALID_CHARGE','INVALID_PHYSICAL_ATTEMPT'].includes(msg))return [400,msg];
  if(['RESERVATION_CONFLICT','CHARGE_CONFLICT','ROLE_CAP_EXCEEDED',
    'GLOBAL_CAP_EXCEEDED','UNKNOWN_RESERVATION',
    'PHYSICAL_ATTEMPT_ALREADY_RECORDED',
    'RESERVATION_ALREADY_CHARGED','CHARGE_EXCEEDS_RESERVATION'].includes(msg))
    return [409,msg];
  return [503,'SERVICE_UNAVAILABLE'];
}
export function createFinanceServer({ledger,clientToken,adminToken}={}){
  if(!ledger||typeof ledger.reserve!=='function'||
     typeof ledger.recordCharge!=='function'||
     typeof ledger.reservePhysicalAttempt!=='function'||
     typeof ledger.status!=='function')
    throw Error('LEDGER_REQUIRED');
  if(typeof clientToken!=='string'||!TOKEN.test(clientToken)||
     typeof adminToken!=='string'||!TOKEN.test(adminToken)||
     clientToken===adminToken)
    throw Error('TOKEN_POLICY_INVALID');
  const server=createServer(async(req,res)=>{
    const pathname=new URL(req.url,'http://127.0.0.1').pathname;
    if(pathname==='/health'&&req.method==='GET'){
      send(res,200,{status:'ok'});return;
    }
    const routes={
      '/v1/status':'GET',
      '/v1/reservations':'POST',
      '/v1/physical-attempts':'POST',
      '/v1/charges':'POST',
    };
    if(!Object.hasOwn(routes,pathname)){
      send(res,404,{error:'NOT_FOUND'});return;
    }
    const header=req.headers.authorization;
    if(typeof header!=='string'||!header.startsWith('Bearer ')){
      send(res,401,{error:'UNAUTHENTICATED'});return;
    }
    const candidate=header.slice(7);
    const client=matchToken(candidate,clientToken);
    const admin=matchToken(candidate,adminToken);
    if(!client&&!admin){
      send(res,401,{error:'UNAUTHENTICATED'});return;
    }
    if((['/v1/reservations','/v1/physical-attempts'].includes(pathname)&&!client)||
       (pathname==='/v1/charges'&&!admin)){
      send(res,403,{error:'WRONG_ROLE'});return;
    }
    if(req.method!==routes[pathname]){
      send(res,405,{error:'METHOD_NOT_ALLOWED'});return;
    }
    try{
      if(pathname==='/v1/status'){
        send(res,200,ledger.status());return;
      }
      const payload=await readJson(req);
      if(pathname==='/v1/reservations'){
        const result=ledger.reserve(payload);
        send(res,result.idempotent?200:201,result);
      }else if(pathname==='/v1/physical-attempts'){
        const result=ledger.reservePhysicalAttempt(payload);
        send(res,201,result);
      }else{
        const result=ledger.recordCharge(payload);
        send(res,result.idempotent?200:201,result);
      }
    }catch(err){
      const [code,error]=statusFor(err);
      send(res,code,{error});
    }
  });
  server.requestTimeout=10_000;
  server.maxRequestsPerSocket=100;
  return server;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const port=Number(process.env.DF_FINANCE_PORT);
  if(!Number.isInteger(port)||port<1||port>65535)
    throw Error('PORT_POLICY_INVALID');
  const ledger=openFinanceLedger(process.env.DF_FINANCE_DB);
  const server=createFinanceServer({ledger,
    clientToken:process.env.DF_FINANCE_CLIENT_TOKEN,
    adminToken:process.env.DF_FINANCE_ADMIN_TOKEN});
  server.listen(port,'127.0.0.1',()=>{
    console.log('FINANCE_LEDGER_LOCAL_READY_NO_SPEND');
  });
  for(const signal of ['SIGINT','SIGTERM']){
    process.on(signal,()=>server.close(()=>{ledger.close();process.exit(0)}));
  }
}
