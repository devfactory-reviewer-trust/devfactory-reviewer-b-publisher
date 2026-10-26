# Reviewer B — one-time pre-payment recovery for DevFactory #955

**Scope:** strictly `deenkids7-dev/deenkids` PR #955 at SHA
`dd8bcdfebbfed5e2193c9328930499801ae916b5`,
model `qwen/qwen3-coder-30b-a3b-instruct`.
No other PR/head/model may use this exception.

## Why the first request is not reusable

The original service comment on Publisher #62 is
`6420110835`; Actions run `40350809327`, job `121670017999`,
Publisher main HEAD `20f6d9dcf6acea8bd3ac5436fbde4a5a8e9ff2f8`.
The run completed **FAILURE** with the protected stage
`OPENROUTER_PROTECTED_PREFLIGHT_FAILED_CLOSED`, before the
private provider-budget check or a model POST. The target PR was still
DRAFT, while the reviewer snapshot policy demands a non-draft PR.
The owner explicitly consented to the existing exact-head/month/model
OpenRouter review in target PR comment `6420081409` ($13 monthly
global ceiling, $3 key ceiling for Reviewer B).

The normal command cannot be repeated. Even when a provider request
fails after billing, a transport error might hide charges. **Never
retry the old workflow run and never post a second ordinary command.**

## Proposed protected recovery protocol

1. Obtain independent review and merge of this Publisher change into
   **protected main**, preserving all CI and reviewer gates. The candidate
   code MUST NOT be executed from a PR branch.
2. Only when the protected recovery path is ready, move the target PR
   from DRAFT to READY without changing its head SHA. This removes
   the **real** non-draft preflight blocker; it does not grant merge.
3. Verify no existing native Reviewer B review for the exact head,
   no prior recovery request, and the original protected run
   `40350809327` and job `121670017999` finished at the historic
   immutable Publisher head in the declared PREPAY failure stage.
   The verifier reads GitHub Actions metadata and job logs with
   **Actions:read only** and never logs or exports auth credentials.
4. Allow precisely one new **different** authenticated Reviewer B
   service request on Publisher issue #62:
   `/review-b-openrouter-recover 955 dd8bcdfebbfed5e2193c9328930499801ae916b5 qwen/qwen3-coder-30b-a3b-instruct 40350809327`
   The request is only admissible if **one original service request
   and one recovery** exist for this PR/HEAD, in that order. Additional
   matches are denied. A workflow **run_attempt != 1** is denied.
5. Require fresh, same-head owner private-source egress consent,
   the original protected environment owner approval, the real
   OpenRouter key's monthly 3 USD ceiling, the ZDR catalogue, and
   the existing native provider spend gate **before any private POST**.
   No synthetic payment credit or provider charge suppression is granted.
6. Read back the resulting actual COMMENTED review. A COMMENTED
   finding is advisory, **not** PASS/APPROVE or authority to merge.
   Review findings and the merge decision remain separately gated.

## Fail-closed design

- Immutable original run identity, Publisher code SHA, first request
  ID, job ID, preflight step and exact logged constants are pinned.
- Both the REST Actions run/jobs and the signed GitHub Actions log
  must match. The log redirect is accepted only to tightly scoped
  GitHub-owned/Azure blob hosts, without forwarding the GitHub token.
- If any proof is missing, tampered, unreachable, expired, inconsistent,
  or the provider's current cap/ZDR check fails, stop before spending.
- No repeat after an ambiguous or already-provider-executed run.
- No automatic dispatch, no RunPod/Ollama, no fallback models,
  no enabling DevFactory Runner, no Finance change, no master bypass.

**Current status:** this document describes a change candidate, not
an authority to start the second review. DO NOT submit the recovery
request before the Publisher implementation is reviewed and active on
protected main, and the target PR is legitimately ready-for-review.
