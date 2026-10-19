import { createHash } from 'node:crypto';
import { inspect } from 'node:util';
import { deriveAddedLinesFromDiff,isAddedLine } from './diff-added-lines.mjs';
import {deriveRemovedLinesFromDiff,isRemovedLine} from './diff-removed-lines.mjs';
import { canonicalJson } from '../src/canonical.mjs';
import {verifiedDiffDeclarationSummary} from './semantic-diff-declarations.mjs';
import { normalizeUntrustedModelFindings,prepareBoundedSemanticReview }
  from './semantic-review-request.mjs';

// Dormant, pure Ollama adapter. No network, no tokens, no inference and no POST.
// Inspired by MIT-licensed The-PR-Agent/pr-agent, without copying its source.
const MODELS=Object.freeze(['qwen2.5-coder:1.5b','qwen2.5-coder:7b','qwen2.5-coder:14b','qwen3:8b','qwen3-coder:30b','qwen3.5:4b','qwen3.5:9b']);
// GPU 35B is an opt-in fixed synthetic-only candidate; protected real review
// still pins Qwen 7B and cannot opt into this model.
const EXPERIMENTAL_GPU_SYNTHETIC_MODEL='qwen3.6:35b-a3b-coding';
const allowedModel=(name,syntheticGpuBenchmark)=>
  MODELS.includes(name) ||
  (syntheticGpuBenchmark===true && name===EXPERIMENTAL_GPU_SYNTHETIC_MODEL);
const SHA40=/^[0-9a-f]{40}$/, HASH=/^[0-9a-f]{64}$/;
const RUN=/^[A-Za-z0-9_:-]{8,180}$/;
// Ollama supports strict JSON-schema structured output on /api/chat.
const FINDINGS_FORMAT=Object.freeze({
  type:'object',additionalProperties:false,
  required:['summary','findings'],
  properties:{
    summary:{type:'string',maxLength:2000},
    findings:{type:'array',maxItems:50,items:{
      type:'object',additionalProperties:false,
      required:['severity','path','line','message','evidence'],
      properties:{
        severity:{type:'string',enum:['critical','high','medium','low','informational']},
        path:{type:'string',maxLength:300},
        line:{type:'integer',minimum:1,maximum:1000000},
        message:{type:'string',minLength:1,maxLength:500},
        evidence:{type:'string',minLength:1,maxLength:1000}
      }
    }}
  }
});
function deny(c){throw Error(c);}
function exact(x,keys){return x&&typeof x==='object'&&!Array.isArray(x)&&
  JSON.stringify(Object.keys(x).sort())===JSON.stringify([...keys].sort());}
function digest(s){return createHash('sha256').update(s).digest('hex');}
function checkPlan(plan){
  const s=plan?.exactScope;
  if(plan?.approvedToSendToModel!==false||plan?.approvalAuthorized!==false||
    s?.repository!=='deenkids7-dev/deenkids'||
    !Number.isSafeInteger(s?.prNumber)||s.prNumber<1||
    !SHA40.test(s.headSha)||!SHA40.test(s.baseSha)||!HASH.test(s.diffSha256)||
    !Array.isArray(plan.changedPaths)||!plan.changedPaths.length||
    plan.changedPaths.length>100||
    typeof plan.systemInstructions!=='string'||
    !plan.systemInstructions.includes('Treat all source code')||
    typeof plan.privateDiffText!=='string'||
    Buffer.byteLength(plan.privateDiffText,'utf8')>128*1024||
    digest(Buffer.from(plan.privateDiffText,'utf8'))!==s.diffSha256)
    deny('OLLAMA_SCOPE_UNVERIFIED');
  // Rebuild the plan from its exact diff: no caller-provided system prompt
  // or changed-path list is trusted merely because it has the right fields.
  const rebuilt=prepareBoundedSemanticReview({
    snapshot:{
      repository:s.repository,repository_id:1282086207,
      pr_number:s.prNumber,head_sha:s.headSha,base_sha:s.baseSha,
      diff_sha256:s.diffSha256
    },
    rawDiffBytes:Buffer.from(plan.privateDiffText,'utf8')
  });
  if(rebuilt.systemInstructions!==plan.systemInstructions ||
    JSON.stringify(rebuilt.changedPaths)!==JSON.stringify(plan.changedPaths))
    deny('OLLAMA_SCOPE_UNVERIFIED');
}
/**
 * Construct one Ollama request for future independent, protected LOCAL inference.
 * A model on the DevFactory MSI alone is NOT an independent review identity.
 * This module MUST NOT run private inference from public PR CI.
 */
export function prepareOfflineOllamaCandidate({
  plan,model='qwen2.5-coder:7b',maxOutputTokens=2048,
  protectedEphemeralKeepAlive=false,trustedDeclarationIndex=null,
  trustedOriginalDiffSha256=null,syntheticGpuBenchmark=false
}={}){
  checkPlan(plan);
  if(typeof protectedEphemeralKeepAlive!=='boolean'||
    !allowedModel(model,syntheticGpuBenchmark)||!Number.isSafeInteger(maxOutputTokens)||
    maxOutputTokens<128||maxOutputTokens>4096)
    deny('OLLAMA_MODEL_OR_CONTEXT_UNSUPPORTED');
  // R75: OLD-side removals have their own verified coordinates and are
  // explicitly marked OLD, never mislabeled as NEW-side additions.
  const reviewSchema=structuredClone(FINDINGS_FORMAT);
  // Force exact GitHub-bound paths AND NEW-SIDE changed source lines
  // into the model's JSON schema grammar, not just a prose instruction.
  // A one-file shard cannot claim a deleted/context line as a finding.
  // The downstream completion validator STILL independently checks anchors.
  reviewSchema.properties.findings.items.properties.path.enum=[...plan.changedPaths];
  const anchors=deriveAddedLinesFromDiff({
    diffBytes:Buffer.from(plan.privateDiffText,'utf8')
  });
  const removedAnchors=deriveRemovedLinesFromDiff({
    diffBytes:Buffer.from(plan.privateDiffText,'utf8')
  });
  // R86: unioned numeric anchors were insufficient. Ollama could output
  // side=NEW with a real OLD-only line from the same authenticated shard.
  // Build coupled path/side/line schemas instead of independently enumerated
  // side and line; retain v1 form for the simple one-file additions-only path.
  const addedLines=[...new Set(plan.changedPaths.flatMap(path=>anchors[path]||[]))];
  const removedLines=[...new Set(plan.changedPaths.flatMap(path=>removedAnchors[path]||[]))];
  const allowedLines=[...new Set([...addedLines,...removedLines])].sort((a,b)=>a-b);
  if(allowedLines.length>1000)deny('OLLAMA_CHANGED_LINE_SET_TOO_LARGE');
  if(!allowedLines.length){
    reviewSchema.properties.findings.maxItems=0;
  }else if(plan.changedPaths.length===1 &&
           !(addedLines.length&&removedLines.length)){
    // Backward-compatible, size-minimal single-side grammar.
    reviewSchema.properties.findings.items.properties.line.enum=allowedLines;
    if(removedLines.length){
      reviewSchema.properties.findings.items.properties.side={
        type:'string',enum:['OLD']
      };
      reviewSchema.properties.findings.items.required.push('side');
    }
  }else{
    // Each alternative is a complete exact object. The model cannot choose
    // a path/side/line triple from incompatible independent enum lists.
    // Ollama JSON Schema grammar receives only independently Git-proven
    // positions, and validateOfflineOllamaCompletion rechecks afterward.
    const strictSide=removedLines.length>0;
    const variantFor=(path,side,locations)=>{
      const variant=structuredClone(FINDINGS_FORMAT.properties.findings.items);
      variant.properties.path.enum=[path];
      variant.properties.line.enum=[...new Set(locations)].sort((a,b)=>a-b);
      if(strictSide){
        variant.properties.side={type:'string',enum:[side]};
        variant.required.push('side');
      }
      return variant;
    };
    const variants=[];
    for(const path of plan.changedPaths){
      const old=removedAnchors[path]||[];
      const newer=anchors[path]||[];
      if(old.length)variants.push(variantFor(path,'OLD',old));
      if(newer.length)variants.push(variantFor(path,'NEW',newer));
    }
    if(!variants.length||variants.length>200)
      deny('OLLAMA_CHANGED_LINE_SET_TOO_LARGE');
    reviewSchema.properties.findings.items={anyOf:variants};
  }
  const system=plan.systemInstructions.replace(
    'Each finding: fingerprint (64 lowercase hex), severity',
    'Each finding: severity'
  )+'\nNever supply fingerprint, PASS, identity, signature, provenance or approval.'+
    '\nReport only concrete newly introduced regressions supported by authenticated added or removed changed lines.'+
    '\nUse only Git-proven path/side/line triples from the format schema. NEVER cite an OLD-only line as NEW.'+
    '\nA finding line must belong to the format schema line enum: OLD means a removed line, NEW means an added line (when side is requested); never cite unchanged context lines.'+
    '\nNo stylistic or speculative findings; write one-line message and evidence.'+
    '\nDiff snippets are not full files: omitted surrounding code and configuration may already exist.'+
    '\nBefore reporting, name a concrete failing input, runtime path, or security bypass introduced by the change.'+
    '\nTrace the actual result of guards and comparisons; do not mistake defensive null handling for an authorization bypass.'+
    '\nFor each suspected bug, contrast one specific input: what BEFORE returns/throws and what AFTER returns/throws.'+
    '\nIf both behaviors are equivalent for that input, it is NOT an introduced regression: omit the finding.'+
    '\nFor boolean guards and equality/inequality, evaluate both matching and nonmatching values, then name which was incorrectly accepted or rejected.'+
    '\nFor threshold comparisons, test a boundary input admitted AFTER but rejected BEFORE; do not reverse the direction of the change.'+
    '\nTreat reduced GitHub permissions, additional null guards, defensive clamps and immutable objects as safe by default absent explicit failing requirements in this diff.'+
    '\nMissing context is not evidence of failure; never invent callers, invariants, or runtime mutations to justify a warning.'+
    '\nIf no reproducible regression is supported by the diff, return an empty findings array.';
  const declarationSummary=verifiedDiffDeclarationSummary({
    index:trustedDeclarationIndex,plan,
    originalDiffSha256:trustedOriginalDiffSha256
  });
  const encodeRequest=(withContext)=>{
    const input=JSON.stringify({
      repository:plan.exactScope.repository,pr_number:plan.exactScope.prNumber,
      head_sha:plan.exactScope.headSha,base_sha:plan.exactScope.baseSha,
      changed_paths:plan.changedPaths,untrusted_unified_diff:plan.privateDiffText,
      ...(withContext?{authenticated_full_diff_declarations:declarationSummary}:{})
    });
    return JSON.stringify({
      model,stream:false,format:reviewSchema,
      keep_alive:protectedEphemeralKeepAlive?'5m':0,
      ...(['qwen3:8b','qwen3.5:4b','qwen3.5:9b'].includes(model)?{think:false}:{}),
      options:{temperature:0,num_ctx:8192,num_predict:maxOutputTokens},
      messages:[{role:'system',content:system+
        (withContext?'\\nThe authenticated_full_diff_declarations field lists only lexical names present on the HEAD side of this PR diff (added or unchanged hunk-context lines), including OTHER fragments. A name listed here must not be claimed absent solely because it is omitted from this shard; lexical scope and imports are not proven.':'')},
        {role:'user',content:input}]
    });
  };
  let indexIncluded=declarationSummary.length>0;
  let privateRequest=encodeRequest(indexIncluded);
  // Never allow optional context to turn a previously valid bounded shard
  // into an expensive failed inference. The omission is explicitly flagged.
  const maxInputBytes=8192-maxOutputTokens-512;
  if(indexIncluded&&Buffer.byteLength(privateRequest,'utf8')>maxInputBytes){
    indexIncluded=false;
    privateRequest=encodeRequest(false);
  }
  // Safety first: Ollama may silently truncate prompts exceeding num_ctx.
  // Count the FULL UTF-8 request, even schema/control JSON bytes, as a
  // pessimistic upper bound on tokenizer input. Reserve all requested output
  // tokens plus 512 tokens for chat framing, and FAIL CLOSED if over budget.
  // This does not claim independent full-context proof at inference time.
  const conservativeInputBytes=Buffer.byteLength(privateRequest,'utf8');
  const remainingContext=8192-maxOutputTokens-512;
  if(remainingContext<1||conservativeInputBytes>remainingContext)
    deny('OLLAMA_CONTEXT_CAPACITY_UNVERIFIED');
  const result=({
    provider:'local-ollama-no-api-fee',model,
    repository:plan.exactScope.repository,prNumber:plan.exactScope.prNumber,
    headSha:plan.exactScope.headSha,baseSha:plan.exactScope.baseSha,
    diffSha256:plan.exactScope.diffSha256,
    changedFiles:plan.changedPaths.length,maxOutputTokens,
    diffDeclarationContext:indexIncluded?'BOUNDED_INCLUDED':
      (declarationSummary?'OMITTED_CONTEXT_LIMIT':'UNAVAILABLE'),
    modelContextCompletenessVerified:false,
    modelExecuted:false,independentReviewVerified:false,
    privateSourceProcessingAuthorized:false,approvalAuthorized:false,
    publishEvent:null
  });
  Object.defineProperties(result,{
    privateRequestJson:{enumerable:false,writable:false,configurable:false,
      value:privateRequest},
    toJSON:{enumerable:false,writable:false,configurable:false,
      value:()=>({...Object.fromEntries(Object.entries(result)),
        privateRequestJson:'[REDACTED]'})},
    [inspect.custom]:{enumerable:false,writable:false,configurable:false,
      value:()=> '[OfflineOllamaCandidate: PRIVATE REQUEST REDACTED; NOT AUTHORIZED]'}
  });
  return Object.freeze(result);
}
/**
 * Parse a *supplied* Ollama /api/chat JSON response, without contacting it.
 * The LLM never assigns fingerprints or independent provenance.
 */
export function validateOfflineOllamaCompletion({
  response,expectedModel,runId,trustedChangedPaths,
  trustedDiffBytes,expectedDiffSha256,
  maxPromptTokens=8192,maxCompletionTokens=2048,syntheticGpuBenchmark=false
}={}){
  // A valid local model may exhaust its finite output budget while writing
  // structured JSON. Distinguish ONLY this exact, safely bounded condition
  // from malformed/wrong-model/untrusted responses, so the protected caller
  // can attempt a single COMPLETE reanalysis of smaller authenticated shards.
  // The truncated response is NEVER parsed, trusted or published.
  if(response?.model===expectedModel&&response?.error===undefined&&
     response?.done===true&&response?.done_reason==='length'&&
     response?.message?.role==='assistant'&&
     typeof response.message.content==='string'&&
     Number.isSafeInteger(response?.prompt_eval_count)&&
     response.prompt_eval_count>0&&response.prompt_eval_count<=8192&&
     Number.isSafeInteger(response?.eval_count)&&
     response.eval_count>0&&response.eval_count<=maxCompletionTokens&&
     response.prompt_eval_count+response.eval_count+512<=8192)
    deny('OLLAMA_OUTPUT_TRUNCATED');
  if(!allowedModel(expectedModel,syntheticGpuBenchmark)||!RUN.test(runId)||
    !Number.isSafeInteger(maxPromptTokens)||maxPromptTokens<1||
    maxPromptTokens>8192||
    !Number.isSafeInteger(maxCompletionTokens)||maxCompletionTokens<128||
    maxCompletionTokens>4096||
    !response||typeof response!=='object'||Array.isArray(response)||
    response.error!==undefined||response.model!==expectedModel||
    response.done!==true||response.done_reason!=='stop'||
    response.message?.role!=='assistant'||
    typeof response.message.content!=='string'||
    !response.message.content.trim()||
    Buffer.byteLength(response.message.content,'utf8')>64*1024||
    response.message.tool_calls!==undefined||
    !Number.isSafeInteger(response.prompt_eval_count)||
    response.prompt_eval_count<1||
    !Number.isSafeInteger(response.eval_count)||response.eval_count<1)
    deny('OLLAMA_COMPLETION_UNVERIFIED');
  // A completion accepted outside the advertised 8192-token window could
  // hide truncation. Independent worker provenance is STILL not established.
  // Reserve 512 tokens for chat framing, even when Ollama usage is misleading.
  if(response.prompt_eval_count>maxPromptTokens||
    response.eval_count>maxCompletionTokens||
    response.prompt_eval_count+response.eval_count+512>8192)
    deny('OLLAMA_CONTEXT_LIMIT_EXCEEDED');
  let parsed;
  try{parsed=JSON.parse(response.message.content);}
  catch{deny('OLLAMA_INVALID_JSON');}
  if(!exact(parsed,['summary','findings'])||
    typeof parsed.summary!=='string'||!Array.isArray(parsed.findings)||
    parsed.findings.length>50)deny('OLLAMA_FINDINGS_SCHEMA_INVALID');
  if(!Buffer.isBuffer(trustedDiffBytes)||
    !HASH.test(expectedDiffSha256)||
    digest(trustedDiffBytes)!==expectedDiffSha256)
    deny('OLLAMA_ADDED_LINE_SCOPE_UNVERIFIED');
  const anchors=deriveAddedLinesFromDiff({diffBytes:trustedDiffBytes});
  const removedAnchors=deriveRemovedLinesFromDiff({diffBytes:trustedDiffBytes});
  if(!Array.isArray(trustedChangedPaths)||
    JSON.stringify(Object.keys(anchors))!==JSON.stringify(trustedChangedPaths))
    deny('OLLAMA_ADDED_LINE_SCOPE_UNVERIFIED');
  const changed=new Set(trustedChangedPaths);
  const seen=new Set();
  // Normalize harmless layout whitespace, never drop a finding or guess data.
  // Other control characters, empty text and oversized evidence remain blocked.
  const normalizedText=(value,max,code)=>{
    if(typeof value!=='string')deny(code);
    const clean=value.replace(/[\t\r\n ]+/g,' ').trim();
    if(!clean.length||clean.length>max||
      /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(clean))deny(code);
    return clean;
  };
  const findings=[];
  for(const f of parsed.findings){
    const hasSide=Object.hasOwn(f||{},'side');
    if(!exact(f,hasSide?
      ['severity','path','line','message','evidence','side']:
      ['severity','path','line','message','evidence']))
      deny('OLLAMA_FINDINGS_SCHEMA_INVALID');
    if(!changed.has(f.path))deny('OLLAMA_FINDING_PATH_MISMATCH');
    if(!Number.isSafeInteger(f.line)||f.line<1||f.line>1000000)
      deny('OLLAMA_FINDING_LINE_INVALID');
    // Backwards-compatible missing side ALWAYS means NEW. The independent
    // added-line anchor check below rejects unmarked OLD-side findings.
    // Protected Qwen grammar explicitly requires side on removal shards.
    if(hasSide&&!['OLD','NEW'].includes(f.side))
      deny('OLLAMA_FINDING_SIDE_INVALID');
    if(f.side==='OLD'){
      if(!isRemovedLine({anchors:removedAnchors,path:f.path,line:f.line}))
        deny('OLLAMA_FINDING_NOT_REMOVED_LINE');
    }else if(!isAddedLine({anchors,path:f.path,line:f.line}))
      deny('OLLAMA_FINDING_NOT_ADDED_LINE');
    if(!['critical','high','medium','low','informational'].includes(f.severity))
      deny('OLLAMA_FINDING_SEVERITY_INVALID');
    const normalized={
      ...f,
      message:normalizedText(f.message,500,'OLLAMA_FINDING_TEXT_INVALID'),
      evidence:normalizedText(f.evidence,1000,'OLLAMA_FINDING_TEXT_INVALID')
    };
    const fingerprint=digest(
      'devfactory.review-finding.v1\0'+canonicalJson(normalized));
    if(seen.has(fingerprint))deny('OLLAMA_FINDING_DUPLICATE');
    seen.add(fingerprint);
    findings.push({...normalized,fingerprint});
  }
  const summary=normalizedText(parsed.summary,2000,'OLLAMA_SUMMARY_TEXT_INVALID');
  const checked=normalizeUntrustedModelFindings({
    rawModelOutput:canonicalJson({summary,findings}),
    runId,trustedChangedPaths
  });
  const report=Buffer.from(checked.reportBytes);
  const safe={
    provisionalState:checked.provisionalState,findingCount:checked.findingCount,
    reportedPromptTokens:response.prompt_eval_count,
    reportedCompletionTokens:response.eval_count,
    modelProvenanceVerified:false,modelContextCompletenessVerified:false,
    independentReviewVerified:false,
    approvalAuthorized:false,publishEvent:null
  };
  Object.defineProperties(safe,{
    privateCanonicalReportBytes:{enumerable:false,configurable:false,
      get:()=>Buffer.from(report)},
    toJSON:{enumerable:false,writable:false,configurable:false,
      value:()=>({...Object.fromEntries(Object.entries(safe)),
        privateCanonicalReportBytes:'[REDACTED]'})},
    [inspect.custom]:{enumerable:false,writable:false,configurable:false,
      value:()=> '[OfflineOllamaCompletion: PRIVATE REPORT REDACTED; NOT AUTHORIZED]'}
  });
  return Object.freeze(safe);
}
