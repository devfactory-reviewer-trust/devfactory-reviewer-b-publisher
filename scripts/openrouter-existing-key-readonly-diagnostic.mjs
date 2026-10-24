/**
 * Read-only identity and monthly-cap diagnostic for the EXISTING protected
 * Reviewer B key. Never obtains a new key, reads private GitHub diff, sends
 * paid inference, activates a policy, publishes a review or enables Runner.
 */
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {
  OPENROUTER_MODEL_IDS,
  preflightOpenRouterKey,
  verifyAuthenticatedOpenRouterNativeCap,
} from './openrouter-zdr-executor.mjs';

const REPO='devfactory-reviewer-trust/devfactory-reviewer-b-publisher';
const WORKFLOW=REPO+'/.github/workflows/reviewer-b-openrouter-key-readonly.yml@refs/heads/main';
const MODEL='qwen/qwen3-coder-30b-a3b-instruct';
const denied=Object.freeze({
  ok:false,code:'EXISTING_KEY_READONLY_CHECK_DENIED',
  maySpend:false,mayMerge:false,mayStart:false,
});
const verified=Object.freeze({
  ok:true,code:'EXISTING_KEY_CAP_LE_3_AND_ZDR_CANDIDATE_VERIFIED',
  maySpend:false,mayMerge:false,mayStart:false,
});

export async function runExistingOpenRouterKeyReadOnlyDiagnostic({
  env={},fetchImpl=globalThis.fetch,
}={}){
  // This does not confer privilege by itself: the GitHub job separately
  // requires the protected environment before injecting its EXISTING secret.
  if(env.GITHUB_REPOSITORY!==REPO||
     env.GITHUB_REF!=='refs/heads/main'||
     env.GITHUB_ACTOR!=='devfactory-reviewer-service'||
     env.GITHUB_EVENT_NAME!=='workflow_dispatch'||
     env.GITHUB_WORKFLOW_REF!==WORKFLOW||
     env.GITHUB_RUN_ATTEMPT!=='1'||
     !OPENROUTER_MODEL_IDS.includes(MODEL)||
     typeof env.REVIEWER_B_OPENROUTER_API_KEY!=='string'||
     !/^sk-or-[A-Za-z0-9_-]{20,200}$/.test(env.REVIEWER_B_OPENROUTER_API_KEY))
    return denied;
  try {
    const p=await preflightOpenRouterKey({
      apiKey:env.REVIEWER_B_OPENROUTER_API_KEY,
      model:MODEL,
      fetchImpl,
    });
    if(!verifyAuthenticatedOpenRouterNativeCap({
      apiKey:env.REVIEWER_B_OPENROUTER_API_KEY,
      preflight:p,model:MODEL,maxMonthlyUsd:3,
    }))return denied;
    return verified;
  }catch{
    // Never print provider response, credential, transport details or stack.
    return denied;
  }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  const result=await runExistingOpenRouterKeyReadOnlyDiagnostic({env:process.env});
  console.log('REVIEWER_B_OPENROUTER_READ_ONLY_'+result.code);
  if(!result.ok)process.exitCode=2;
}
