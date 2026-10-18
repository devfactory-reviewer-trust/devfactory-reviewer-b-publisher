import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const src=path.join(root,'src');
const workflows=path.join(root,'.github','workflows');

test('prototype has no privileged runtime entrypoint or secret access',()=>{
  const sources=readdirSync(src).filter(name=>name.endsWith('.mjs'));
  assert.ok(sources.length>=4);
  for(const filename of sources){
    const text=readFileSync(path.join(src,filename),'utf8');
    assert.doesNotMatch(text,/\bprocess\.env\b/);
    assert.doesNotMatch(text,/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/);
    assert.doesNotMatch(text,/\b(?:exec|execFile|spawn|fork|eval)\s*\(/);
    assert.doesNotMatch(text,/\b(?:Octokit|createAppAuth|createTokenAuth)\s*\(/);
    assert.doesNotMatch(text,/\b(?:PRIVATE_KEY|APP_TOKEN|GITHUB_TOKEN|GH_TOKEN)\b\s*=/);
    assert.doesNotMatch(text,/\bhttps?:\/\/api\.github\.com\/repos\/.*\/reviews\b/);
    assert.doesNotMatch(text,/\bimport\s*\(/);
    assert.doesNotMatch(text,/from\s*['"](?:node:(?:child_process|https|http|net|tls)|@octokit|axios)/);
  }
});

test('no workflow has access to private App secrets, write token or privileged triggers',()=>{
  const files=readdirSync(workflows).filter(name=>/\.ya?ml$/.test(name));
  assert.ok(files.length>=2);
  for(const filename of files){
    const contents=readFileSync(path.join(workflows,filename),'utf8');
    // GitHub job-level permissions can OVERRIDE a safe workflow-level block.
    // Permit exactly one root permissions mapping; reject ANY nested one.
    assert.equal((contents.match(/^permissions\s*:/gm)||[]).length,1);
    assert.doesNotMatch(contents,/^[ \t]+permissions\s*:/m);
    // Owner permanently retired these provider start/read lanes.
    // Keep legacy YAML for audit, but require its sole job to stay dead.
    if(new Set([
      'runpod-control-bounded-start.yml',
      'runpod-control-readonly-diagnostics.yml',
      'runpod-control-readonly-scope-test.yml',
      'runpod-gpu-readonly-preflight.yml',
    ]).has(filename)){
      assert.match(contents,/^permissions: \{\}$/m);
      assert.match(contents,/^    if: \$\{\{ false \}\}$/m);
      assert.equal((contents.match(/^    if:/gm)||[]).length,1);
      assert.doesNotMatch(contents,/^[ \t]+permissions\s*:/m);
      continue;
    }
    if(filename==='runpod-control-readonly-diagnostics.yml'){
      assert.match(contents,/^on:\n  issue_comment:\n    types: \[created\]\n/m);
      assert.match(contents,/^permissions: \{\}\n/m);
      assert.match(contents,/environment:\s*runpod-gpu-control/);
      assert.match(contents,/github\.repository == 'devfactory-reviewer-trust\/devfactory-reviewer-b-publisher'/);
      assert.match(contents,/github\.ref == 'refs\/heads\/main'/);
      assert.match(contents,/github\.actor == 'devfactory-reviewer-service'/);
      assert.match(contents,/github\.event\.issue\.number == 52/);
      assert.match(contents,/github\.event\.comment\.body == 'DEVFACTORY_RUNPOD_DIAGNOSTICS_R165'/);
      assert.equal((contents.match(/^      - name:/gm)||[]).length,2);
      assert.equal((contents.match(/secrets\.RUNPOD_CONTROL_API_KEY/g)||[]).length,1);
      assert.match(contents,/node source\/scripts\/runpod-control-readonly-diagnostics\.mjs --read-only/);
      assert.match(contents,/node --test source\/test\/runpod-control-readonly-diagnostics\.test\.mjs/);
      assert.match(contents,/--proto '=https' --proto-redir '=https'/);
      assert.doesNotMatch(contents,/\b(?:pull_request|pull_request_target|push|workflow_run|workflow_call|schedule|workflow_dispatch)\s*:/);
      assert.doesNotMatch(contents,/\b[A-Za-z-]+\s*:\s*write\b|\bwrite-all\b/);
      assert.doesNotMatch(contents,/\b(?:github\.token|GITHUB_TOKEN|GH_TOKEN|actions\/checkout)\b/);
      assert.doesNotMatch(contents,/\b(?:podResume|podStop|podTerminate|podFindAndDeployOnDemand)\b/);
      continue;
    }
    if(filename==='runpod-control-bounded-start.yml'){
      // Guard the only ever allowed billed Pod activation workflow.
      // A live independent watchdog and conservative monthly budget are
      // checked in the exact privileged script BEFORE a fixed Pod START.
      assert.match(contents,/^on:\n  issue_comment:\n    types: \[created\]\n/m);
      assert.match(contents,/^permissions: \{\}\n/m);
      assert.match(contents,/environment:\s*runpod-gpu-control/);
      assert.match(contents,/github\.repository == 'devfactory-reviewer-trust\/devfactory-reviewer-b-publisher'/);
      assert.match(contents,/github\.ref == 'refs\/heads\/main'/);
      assert.match(contents,/github\.actor == 'devfactory-reviewer-service'/);
      assert.match(contents,/github\.event\.issue\.number == 52/);
      assert.match(contents,/github\.event\.comment\.body == 'DEVFACTORY_RUNPOD_START_24MIN_R164'/);
      assert.match(contents,/cancel-in-progress: false/);
      assert.match(contents,/sleep 1440/);
      assert.match(contents,/timeout-minutes: 33/);
      assert.match(contents,/if: \$\{\{ always\(\) \}\}/);
      assert.equal((contents.match(/secrets\.RUNPOD_CONTROL_API_KEY/g)||[]).length,2);
      assert.match(contents,/node source\/scripts\/runpod-control-bounded-start-v2\.mjs --start-exact-bounded/);
      assert.match(contents,/node --test source\/test\/runpod-control-bounded-start-v2\.test\.mjs/);
      assert.match(contents,/node source\/scripts\/runpod-control-stop-exact-pod\.mjs --stop-exact/);
      assert.equal((contents.match(/^      - name:/gm)||[]).length,4);
      assert.match(contents,/--proto '=https' --proto-redir '=https'/);
      assert.doesNotMatch(contents,/\b(?:pull_request|pull_request_target|push|workflow_run|workflow_call|schedule|workflow_dispatch)\s*:/);
      assert.doesNotMatch(contents,/\b[A-Za-z-]+\s*:\s*write\b|\bwrite-all\b/);
      assert.doesNotMatch(contents,/\b(?:github\.token|GITHUB_TOKEN|GH_TOKEN|actions\/checkout)\b/);
      assert.doesNotMatch(contents,/\b(?:delete-pod|terminate-pod|force-push)\b/);
      continue;
    }
    if(filename==='runpod-control-stop-and-watchdog.yml'){
      // The powerful CONTROL secret is accessible only in an owner-approved,
      // exact protected main STOP-only workflow. No START, create or schedule.
      assert.match(contents,/^on:\n  issue_comment:\n    types: \[created\]\n/m);
      assert.match(contents,/^permissions: \{\}\n/m);
      assert.match(contents,/environment:\s*runpod-gpu-control/g);
      assert.equal((contents.match(/environment:\s*runpod-gpu-control/g)||[]).length,2);
      assert.match(contents,/github\.actor == 'devfactory-reviewer-service'/g);
      assert.equal((contents.match(/github\.actor == 'devfactory-reviewer-service'/g)||[]).length,2);
      assert.match(contents,/github\.repository == 'devfactory-reviewer-trust\/devfactory-reviewer-b-publisher'/);
      assert.match(contents,/github\.ref == 'refs\/heads\/main'/);
      assert.equal((contents.match(/github\.event\.issue\.number == 52/g)||[]).length,2);
      assert.match(contents,/github\.event\.comment\.body == 'DEVFACTORY_RUNPOD_STOP_EXACT_R162'/);
      assert.match(contents,/github\.event\.comment\.body == 'DEVFACTORY_RUNPOD_WATCHDOG_ARM_R163'/);
      assert.match(contents,/cancel-in-progress: false/);
      assert.match(contents,/sleep 1800/);
      assert.equal((contents.match(/^      - name:/gm)||[]).length,5);
      assert.equal((contents.match(/secrets\.RUNPOD_CONTROL_API_KEY/g)||[]).length,2);
      assert.equal((contents.match(/node source\/scripts\/runpod-control-stop-exact-pod\.mjs --stop-exact/g)||[]).length,2);
      assert.equal((contents.match(/node --test source\/test\/runpod-control-stop-exact-pod\.test\.mjs/g)||[]).length,2);
      assert.match(contents,/--proto '=https' --proto-redir '=https'/);
      assert.doesNotMatch(contents,/\b(?:pull_request|pull_request_target|push|workflow_run|workflow_call|schedule|workflow_dispatch)\s*:/);
      assert.doesNotMatch(contents,/\b[A-Za-z-]+\s*:\s*write\b|\bwrite-all\b/);
      assert.doesNotMatch(contents,/\b(?:github\.token|GITHUB_TOKEN|GH_TOKEN|actions\/checkout)\b/);
      assert.doesNotMatch(contents,/\b(?:podResume|podFindAndDeployOnDemand|podTerminate|start-pod|resume-pod)\b/);
      continue;
    }
    if(filename==='runpod-control-readonly-scope-test.yml'){
      // CONTROL secret is extraordinarily sensitive, even in a GET-only
      // GraphQL query. Accept ONLY the exact owner-approved isolated lane.
      assert.match(contents,/^on:\n  issue_comment:\n    types: \[created\]\n/m);
      assert.match(contents,/^permissions: \{\}\n/m);
      assert.match(contents,/^concurrency:\n  group: runpod-control-scope-test\n  cancel-in-progress: false\n/m);
      assert.match(contents,/environment:\s*runpod-gpu-control/);
      assert.match(contents,/github\.repository == 'devfactory-reviewer-trust\/devfactory-reviewer-b-publisher'/);
      assert.match(contents,/github\.ref == 'refs\/heads\/main'/);
      assert.match(contents,/github\.actor == 'devfactory-reviewer-service'/);
      assert.match(contents,/github\.event_name == 'issue_comment'/);
      assert.match(contents,/github\.event\.action == 'created'/);
      assert.match(contents,/github\.event\.issue\.number == 52/);
      assert.match(contents,/!github\.event\.issue\.pull_request/);
      assert.match(contents,/github\.event\.comment\.body == 'DEVFACTORY_RUNPOD_CONTROL_PREFLIGHT_R161'/);
      assert.equal((contents.match(/secrets\./g)||[]).length,1);
      assert.match(contents,/secrets\.RUNPOD_CONTROL_API_KEY/);
      assert.equal((contents.match(/^      - name:/gm)||[]).length,2);
      assert.match(contents,/node source\/scripts\/runpod-control-readonly-preflight\.mjs --read-only/);
      assert.match(contents,/node --test source\/test\/runpod-control-readonly-preflight\.test\.mjs/);
      assert.match(contents,/--proto '=https' --proto-redir '=https'/);
      assert.doesNotMatch(contents,/\b(?:pull_request|pull_request_target|push|workflow_run|workflow_call|schedule|workflow_dispatch)\s*:/);
      assert.doesNotMatch(contents,/\b[A-Za-z-]+\s*:\s*write\b|\bwrite-all\b/);
      assert.doesNotMatch(contents,/\b(?:github\.token|GITHUB_TOKEN|GH_TOKEN|actions\/checkout)\b/);
      assert.doesNotMatch(contents,/\b(?:podStop|podResume|podTerminate|podFindAndDeployOnDemand|start-pod|stop-pod)\b/);
      continue;
    }
    if(filename==='runpod-gpu-readonly-preflight.yml'){
      // One extra READ-ONLY Pod API preflight, manual and owner-approved.
      // Do not treat it as an ordinary public synthetic workflow: access
      // to the environment secret requires a separately protected gate.
      assert.match(contents,/^on:\n  workflow_dispatch:\n  issue_comment:\n    types: \[created\]\n/m);
      assert.match(contents,/^permissions: \{\}\n/m);
      assert.match(contents,/^concurrency:\n  group: runpod-readonly-preflight-manual\n  cancel-in-progress: false\n/m);
      assert.match(contents,/environment:\s*'runpod-gpu-preflight\.'/);
      assert.doesNotMatch(contents,/environment:\s*runpod-gpu-preflight\s*\n/);
      assert.match(contents,/github\.ref == 'refs\/heads\/main'/);
      assert.match(contents,/github\.actor == 'devfactory-reviewer-service'/);
      assert.match(contents,/github\.repository == 'devfactory-reviewer-trust\/devfactory-reviewer-b-publisher'/);
      assert.match(contents,/github\.event_name == 'workflow_dispatch'/);
      assert.match(contents,/github\.event_name == 'issue_comment'/);
      assert.match(contents,/github\.event\.action == 'created'/);
      assert.match(contents,/github\.event\.issue\.number == 52/);
      assert.match(contents,/!github\.event\.issue\.pull_request/);
      assert.match(contents,/github\.event\.comment\.body == 'DEVFACTORY_RUNPOD_READONLY_PREFLIGHT_R154'/);
      assert.equal((contents.match(/secrets\./g)||[]).length,2);
      assert.match(contents,/secrets\.RUNPOD_API_KEY/);
      assert.equal((contents.match(/^      - name:/gm)||[]).length,3);
      assert.match(contents,/node source\/scripts\/runpod-gpu-readonly-preflight\.mjs --read-only/);
      assert.match(contents,/node source\/scripts\/runpod-gpu-billing-readonly\.mjs --read-only-monthly/);
      assert.match(contents,/--proto '=https' --proto-redir '=https'/);
      assert.doesNotMatch(contents,/\b(?:pull_request|pull_request_target|push|workflow_run|workflow_call|schedule)\s*:/);
      assert.doesNotMatch(contents,/\b[A-Za-z-]+\s*:\s*write\b|\bwrite-all\b/);
      assert.doesNotMatch(contents,/\b(?:github\.token|GITHUB_TOKEN|GH_TOKEN|actions\/checkout)\b/);
      continue;
    }
    if(filename==='reviewer-b-oidc-permission-probe.yml'){
      // Diagnostic-only protected-main one-shot; no actual OIDC request.
      assert.match(contents,/^on:\n  push:\n    branches:\n      - main\n    paths:\n      - docs\/reviewer-b-oidc-diagnostic-20261011\.marker\n/m);
      assert.match(contents,/^permissions:\n  id-token: write\n  attestations: write\n/m);
      assert.match(contents,/environment:\s*reviewer-b-publish/);
      const guard=contents.match(/^    if: (.+)$/m)?.[1];
      assert.equal(guard,"\${{ github.repository == 'devfactory-reviewer-trust/devfactory-reviewer-b-publisher' && github.ref == 'refs/heads/main' && github.event_name == 'push' && github.actor == 'devfactory-reviewer-service' }}");
      assert.equal((contents.match(/^      - name:/gm)||[]).length,1);
      assert.match(contents,/OIDC_PERMISSION_AVAILABLE_NO_ATTESTATION/);
      assert.doesNotMatch(contents,/(?:secrets\.|GITHUB_TOKEN|GH_TOKEN|\bcheckout\b|\bcurl\b|\bwget\b|\bgh api\b|\bactions\/attest\b)/);
      assert.doesNotMatch(contents,/\b(?:pull_request|pull_request_target|workflow_run|workflow_call|schedule|workflow_dispatch)\s*:/);
      continue;
    }
    if(filename==='reviewer-b-one-shot-approval-probe.yml'){
      // Narrow one-shot push marker, no source/secrets/network, held by
      // the existing environment; never a substitute for review approval.
      assert.match(contents,/^on:\n  push:\n    branches:\n      - main\n    paths:\n      - docs\/reviewer-b-one-shot-approval-20261011\.marker\n/m);
      assert.match(contents,/^permissions: \{\}\n/m);
      assert.match(contents,/environment:\s*reviewer-b-publish/);
      const guard=contents.match(/^    if: (.+)$/m)?.[1];
      assert.equal(guard,"\${{ github.repository == 'devfactory-reviewer-trust/devfactory-reviewer-b-publisher' && github.ref == 'refs/heads/main' && github.event_name == 'push' && github.actor == 'devfactory-reviewer-service' }}");
      assert.equal((contents.match(/^      - name:/gm)||[]).length,1);
      assert.match(contents,/NO_SECRETS_APPROVAL_GATE_RELEASED/);
      assert.doesNotMatch(contents,/(?:secrets\.|GITHUB_TOKEN|GH_TOKEN|\bcheckout\b|\bcurl\b|\bwget\b|\bgh api\b)/);
      assert.doesNotMatch(contents,/\b(?:id-token|attestations|contents|actions|issues|pull-requests)\s*:\s*write\b/);
      assert.doesNotMatch(contents,/\b(?:pull_request|pull_request_target|workflow_run|schedule|workflow_dispatch)\s*:/);
      continue;
    }
    if(filename==='reviewer-b-private-semantic.yml'){
      // Only the distinct, approved protected-main service principal can
      // execute a PRIVATE model. No PR-branch workflow, write GITHUB_TOKEN
      // or external paid inference provider can be used. Exact one-shot
      // push marker is still protected by the same environment and actor.
      assert.match(contents,/^on:\n  workflow_dispatch:[\s\S]*?  push:\n    branches:\n      - main\n    paths:\n      - docs\/reviewer-b-semantic-live-899-20261011\.marker\n/m);
      assert.equal((contents.match(/^  push:/gm)||[]).length,1);
      assert.match(contents,/^permissions: \{\}\n/m);
      assert.match(contents,/^concurrency:\n  group: reviewer-b-protected-real-semantic-manual\n  cancel-in-progress: false\n/m);
      assert.match(contents,/environment:\s*reviewer-b-publish/);
      assert.match(contents,/github\.ref == 'refs\/heads\/main'/);
      assert.match(contents,/github\.actor == 'devfactory-reviewer-service'/);
      assert.match(contents,/github\.repository == 'devfactory-reviewer-trust\/devfactory-reviewer-b-publisher'/);
      assert.equal((contents.match(/secrets\./g)||[]).length,1);
      assert.match(contents,/secrets\.REVIEWER_B_GITHUB_APP_PRIVATE_KEY_PEM/);
      assert.match(contents,/REVIEWER_B_EXPECTED_MODEL: 'qwen2\.5-coder:7b'/);
      assert.match(contents,/OLLAMA_NO_CLOUD: '1'/);
      assert.match(contents,/127\.0\.0\.1:11434/);
      assert.match(contents,/sha256sum -c -/);
      assert.match(contents,/node scripts\/protected-real-semantic-review\.mjs/);
      assert.match(contents,/^  issue_comment:\n    types: \[created\]\n/m);
      assert.match(contents,/github\.event\.issue\.number == 21/);
      assert.match(contents,/github\.event\.action == 'created'/);
      assert.match(contents,/!github\.event\.issue\.pull_request/);
      assert.match(contents,/node source\/scripts\/protected-review-request\.mjs/);
      assert.match(contents,/REVIEWER_B_TARGET_PR: \$\{\{ steps\.review_request\.outputs\.pr_number \}\}/);
      assert.match(contents,/REVIEWER_B_EXPECTED_HEAD: \$\{\{ steps\.review_request\.outputs\.expected_head \}\}/);
      assert.match(contents,/github\.event_name == 'workflow_dispatch' \|\| github\.event_name == 'push'/);
      assert.match(contents,/--proto '=https' --proto-redir '=https'/);
      assert.doesNotMatch(contents,/\b(?:pull_request|pull_request_target|workflow_run|workflow_call|schedule)\s*:/);
      assert.doesNotMatch(contents,/\b[A-Za-z-]+\s*:\s*write\b/);
      assert.doesNotMatch(contents,/github\.token|GH_TOKEN|GITHUB_TOKEN|actions\/checkout/);
      continue;
    }
    if(filename==='reviewer-b-native-comment-once.yml'){
      // Exactly one protected-main service-actor native COMMENTED proof.
      // It has no GITHUB_TOKEN write access; GitHub App identity is separate.
      assert.match(contents,/^on:\n  push:\n    branches:\n      - main\n    paths:\n      - docs\/reviewer-b-native-comment-once-20261011\.marker\n/m);
      assert.match(contents,/^permissions: \{\}\n/m);
      assert.match(contents,/environment:\s*reviewer-b-publish/);
      assert.match(contents,/^concurrency:\n  group: reviewer-b-native-comment-only-pr899\n  cancel-in-progress: false\n/m);
      const guard=contents.match(/^    if: (.+)$/m)?.[1];
      assert.equal(guard,"\${{ github.repository == 'devfactory-reviewer-trust/devfactory-reviewer-b-publisher' && github.ref == 'refs/heads/main' && github.actor == 'devfactory-reviewer-service' && github.event_name == 'push' }}");
      assert.equal((contents.match(/secrets\./g)||[]).length,1);
      assert.match(contents,/secrets\.REVIEWER_B_GITHUB_APP_PRIVATE_KEY_PEM/);
      assert.match(contents,/REVIEWER_B_TARGET_PR: '899'/);
      assert.match(contents,/node scripts\/protected-native-comment-entrypoint\.mjs/);
      assert.equal((contents.match(/^      - name:/gm)||[]).length,2);
      assert.doesNotMatch(contents,/(?:github\.token|GITHUB_TOKEN|GH_TOKEN|Authorization: Bearer)/);
      assert.match(contents,/--proto '=https' --proto-redir '=https'/);
      assert.match(contents,/--max-time 45 --max-filesize 8388608/);
      assert.doesNotMatch(contents,/\b(?:pull_request|pull_request_target|workflow_dispatch|workflow_run|workflow_call|schedule)\s*:/);
      assert.doesNotMatch(contents,/\b[A-Za-z-]+\s*:\s*write\b/);
      continue;
    }
    if(filename==='reviewer-b-private-readonly-preflight.yml'){
      // A distinct manual-only future privileged PRIVATE-read probe,
      // guarded by actor, protected main and the existing environment.
      assert.match(contents,/^permissions: \{\}\n/m);
      assert.doesNotMatch(contents,/(?:GH_READ_TOKEN|github\.token|Authorization: Bearer)/);
      assert.match(contents,/--proto '=https' --proto-redir '=https'/);
      assert.match(contents,/--max-time 45 --max-filesize 8388608/);
      const guard=contents.match(/^    if: (.+)$/m)?.[1];
      assert.equal(guard,"\${{ github.repository == 'devfactory-reviewer-trust/devfactory-reviewer-b-publisher' && github.ref == 'refs/heads/main' && github.actor == 'devfactory-reviewer-service' && (github.event_name == 'workflow_dispatch' || github.event_name == 'push') }}");
      assert.match(contents,/^on:\n  workflow_dispatch:[\s\S]*?  push:\n    branches:\n      - main\n    paths:\n      - docs\/reviewer-b-private-read-once-20261011\.marker\n/m);
      assert.match(contents,/REVIEWER_B_TARGET_PR: \$\{\{ github\.event_name == 'push' && '899' \|\| inputs\.pr_number \}\}/);
      assert.match(contents,/^on:\n  workflow_dispatch:/m);
      assert.match(contents,/environment:\s*reviewer-b-publish/);
      assert.equal((contents.match(/secrets\./g)||[]).length,1);
      assert.match(contents,/secrets\.REVIEWER_B_GITHUB_APP_PRIVATE_KEY_PEM/);
      assert.match(contents,/tarball\/\$\{GH_SHA\}/);
      assert.match(contents,/node scripts\/protected-private-read-entrypoint\.mjs/);
      assert.equal((contents.match(/^      - name:/gm)||[]).length,2);
      assert.doesNotMatch(contents,/\b(?:pull_request|pull_request_target|workflow_run|workflow_call|schedule)\s*:/);
      assert.doesNotMatch(contents,/\b[A-Za-z-]+\s*:\s*write\b/);
      assert.doesNotMatch(contents,/\b(?:actions\/checkout|id-token|attestations)\b/);
      continue;
    }
    if(filename==='reviewer-b-keyless-synthetic-proof.yml'){
      // One audited manual synthetic OIDC probe: no PR trigger or private
      // source, pinned official action, no publisher signing credentials.
      const granted=contents.match(/^permissions:\n((?: {2}[^\n]+\n)+)/m)?.[1];
      assert.equal(granted,'  id-token: write\n  attestations: write\n');
      assert.match(contents,/workflow_dispatch\s*:/);
      assert.match(contents,/environment:\s*reviewer-b-publish/);
      assert.match(contents,/github\.ref == 'refs\/heads\/main'/);
      // Event types are restricted by the workflow's exact on: mappings.
      assert.match(contents,/github\.actor == 'devfactory-reviewer-service'/);
      assert.match(contents,/github\.repository == 'devfactory-reviewer-trust\/devfactory-reviewer-b-publisher'/);
      assert.match(contents,/^on:\n  workflow_dispatch:\n  push:\n    branches:\n      - main\n    paths:\n      - docs\/reviewer-b-keyless-post-allowlist-20261011\.marker\n/m);
      const gate=contents.match(/^    if: (.+)$/m)?.[1];
      assert.equal(gate,"\${{ github.repository == 'devfactory-reviewer-trust/devfactory-reviewer-b-publisher' && github.ref == 'refs/heads/main' && github.actor == 'devfactory-reviewer-service' }}");
      assert.match(contents,/actions\/attest@1e69f48acb82d1966a394da916b4c1698aa569d6/);
      assert.equal((contents.match(/^      - name:/gm)||[]).length,2);
      assert.match(contents,/create-storage-record:\s*false/);
      assert.match(contents,/not_a_review/);
      assert.doesNotMatch(contents,/\b(?:pull_request|pull_request_target|workflow_run|workflow_call|schedule)\s*:/);
      assert.doesNotMatch(contents,/\b(?:secrets\.|GITHUB_TOKEN|GH_TOKEN|checkout|curl|wget|gh api)\b/);
      assert.doesNotMatch(contents,/\b(?:contents|pull-requests|issues|actions|checks|administration)\s*:\s*write\b/);
      continue;
    }
    assert.doesNotMatch(contents,/\b[A-Za-z][A-Za-z-]*\s*:\s*write\b/);
    assert.doesNotMatch(contents,/\bpermissions\s*:\s*write-all\b/);
    if(filename==='reviewer-b-environment-hold-probe.yml'){
      // This one workflow is intentionally deployed to the protected
      // environment AFTER independent review on protected main. No secret,
      // PR trigger, token, checkout or network access is permitted.
      assert.match(contents,/permissions:\s*\{\s*\}/);
      assert.match(contents,/workflow_dispatch\s*:/);
      assert.match(contents,/environment:\s*reviewer-b-publish/);
      assert.doesNotMatch(contents,/\b(?:pull_request|pull_request_target|workflow_run|workflow_call|push|schedule)\s*:/);
      assert.doesNotMatch(contents,/(?:secrets\.|github\.token|GITHUB_TOKEN|GH_TOKEN|\bcurl\b|\bwget\b|\bcheckout\b|\bfetch\b)/);
      assert.doesNotMatch(contents,/\b(?:id-token|pull-requests|contents)\s*:\s*write\b/);
      continue;
    }
    if(filename==='reviewer-b-private-openrouter.yml'){
      // Exact protected service-owned CLOUD lane; public PR tests never
      // run inference, retrieve secrets, read private code, or publish.
      // Owner model/HEAD/month consent and protected policy secret are required.
      assert.match(contents,/^permissions: \{\}\n/m);
      assert.match(contents,/^on:\n  workflow_dispatch:\n/m);
      assert.match(contents,/environment:\s*reviewer-b-publish/);
      assert.match(contents,/github\.actor == 'devfactory-reviewer-service'/);
      assert.match(contents,/github\.ref == 'refs\/heads\/main'/);
      assert.match(contents,/github\.event_name == 'workflow_dispatch'/);
      assert.match(contents,/issue_comment:\n    types: \[created\]/);
      assert.match(contents,/github\.event\.issue\.number == 62/);
      assert.match(contents,/!github\.event\.issue\.pull_request/);
      assert.doesNotMatch(contents,/github\.event\.issue\.number == 21/);
      assert.match(contents,/node source\/scripts\/protected-openrouter-review-request\.mjs/);
      assert.match(contents,/REVIEWER_B_CLOUD_REQUEST_VERIFIED: \$\{\{ steps\.cloud_request\.outputs\.verified \}\}/);
      assert.ok(contents.indexOf('node source/scripts/protected-openrouter-review-request.mjs')<
        contents.indexOf('node scripts/protected-real-openrouter-review.mjs'));
      assert.match(contents,/^  group: reviewer-b-protected-real-semantic-manual$/m);
      assert.equal((contents.match(/secrets\./g)||[]).length,3);
      assert.match(contents,/secrets\.REVIEWER_B_OPENROUTER_API_KEY/);
      assert.match(contents,/secrets\.REVIEWER_B_CLOUD_POLICY_READY/);
      assert.match(contents,/secrets\.REVIEWER_B_GITHUB_APP_PRIVATE_KEY_PEM/);
      assert.match(contents,/node scripts\/protected-real-openrouter-review\.mjs/);
      assert.match(contents,/--proto '=https' --proto-redir '=https'/);
      assert.match(contents,/--max-time 45 --max-filesize 8388608/);
      assert.doesNotMatch(contents,/\b(?:pull_request|pull_request_target|workflow_run|workflow_call|push|schedule)\s*:/);
      assert.doesNotMatch(contents,/\b(?:actions\/checkout|GH_TOKEN|GITHUB_TOKEN|id-token|attestations)\b/);
      assert.doesNotMatch(contents,/\b(?:contents|pull-requests|issues|actions|checks)\s*:\s*write\b/);
      continue;
    }    assert.match(contents,/permissions:\s*\n\s*contents:\s*read\b/);
    assert.doesNotMatch(contents,/\bpull_request_target\s*:/);
    assert.doesNotMatch(contents,/\bworkflow_run\s*:/);
    assert.doesNotMatch(contents,/\bworkflow_call\s*:/);
    assert.doesNotMatch(contents,/\bsecrets\s*\./);
    assert.doesNotMatch(contents,/\bpermissions:\s*(?:write-all|\{)/);
    assert.doesNotMatch(contents,/\b(?:id-token|pull-requests|contents)\s*:\s*write\b/);
    assert.doesNotMatch(contents,/\benvironment\s*:/);
    assert.doesNotMatch(contents,/\b(?:push|schedule)\s*:/);
  }
});
