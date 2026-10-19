/** PUBLIC synthetic GPU holdout residency, read-only via the existing pinned
 * SSH loopback. This never processes PRIVATE source or authorizes a review.
 * Ollama memory counters are not proof of actual CUDA kernels or provider billing.
 */
const PS='http://127.0.0.1:11434/api/ps';
const MODEL='qwen3.6:35b-a3b-coding';
const GPU7B='qwen2.5-coder:7b';
const deny=code=>{throw Error(code)};
export async function verifyPublicGpuResidency({
 fetchImpl=globalThis.fetch,model=MODEL
}={}){
 if(![MODEL,GPU7B].includes(model)||typeof fetchImpl!=='function')
  deny('GPU_RESIDENCY_MODEL_UNTRUSTED');
 let r;
 try{
  r=await fetchImpl(PS,{method:'GET',redirect:'error',cache:'no-store',
   signal:AbortSignal.timeout(5000),headers:{Accept:'application/json'}});
 }catch{deny('GPU_RESIDENCY_REQUEST_FAILED')}
 if(r?.status!==200||r?.redirected!==false||r?.url!==PS||
    !/^application\/json(?:\s*;|$)/i.test(r.headers?.get?.('content-type')||''))
  deny('GPU_RESIDENCY_ENDPOINT_UNVERIFIED');
 const len=r.headers.get('content-length');
 if(len!==null&&(!/^\d+$/.test(len)||Number(len)>16384))
  deny('GPU_RESIDENCY_RESPONSE_OVERSIZED');
 if(typeof r.body?.getReader!=='function')deny('GPU_RESIDENCY_RESPONSE_INVALID');
 const reader=r.body.getReader(),blocks=[];
 let count=0,complete=false;
 try{
  for(;;){
   const x=await reader.read();
   if(x.done){complete=true;break}
   if(!(x.value instanceof Uint8Array))deny('GPU_RESIDENCY_RESPONSE_INVALID');
   count+=x.value.byteLength;
   if(count>16384)deny('GPU_RESIDENCY_RESPONSE_OVERSIZED');
   blocks.push(Buffer.from(x.value));
  }
 }finally{
  if(!complete){try{Promise.resolve(reader.cancel()).catch(()=>{})}catch{}}
  reader.releaseLock();
 }
 const bytes=Buffer.concat(blocks,count),raw=bytes.toString('utf8');
 if(!Buffer.from(raw,'utf8').equals(bytes))deny('GPU_RESIDENCY_RESPONSE_INVALID');
 let data;
 try{data=JSON.parse(raw)}catch{deny('GPU_RESIDENCY_RESPONSE_INVALID')}
 if(!Array.isArray(data?.models)||data.models.length>5)
  deny('GPU_RESIDENCY_RESPONSE_INVALID');
 const matches=data.models.filter(x=>
  (x?.name===model||x?.model===model)&&
  (x.name===undefined||x.name===model)&&
  (x.model===undefined||x.model===model));
 if(matches.length!==1)deny('GPU_RESIDENCY_MODEL_NOT_EXACT');
 const x=matches[0];
 if(!Number.isSafeInteger(x.size)||x.size<=0||
    !Number.isSafeInteger(x.size_vram)||x.size_vram<x.size)
  deny('GPU_RESIDENCY_CPU_OFFLOAD_OR_INVALID_METRIC');
 return Object.freeze({
  model,ollamaReportedFullyInVram:true,gpuResidencyVerified:true,
  privateSourceReviewed:false,approvalAuthorized:false,
  mayStartPod:false,mayPublishReview:false,mayMerge:false
 });
}
