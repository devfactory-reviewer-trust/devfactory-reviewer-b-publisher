# R213 — Owner Reviewer B delegation/revocation, shadow only

**Status: DRAFT / NO SPEND / NO EGRESS / NO RUNNER AUTHORITY.** This is a separate non-active policy preparation in the Publisher, not a new canonical LOT, actual grant, or change to production consent.

## Why this exists

The existing OpenRouter Reviewer B workflow requires an explicit fresh owner `/devfactory-openrouter-consent <PR> <HEAD> <model> <YYYY-MM> budget15eur` on every target PR and human approval of protected `reviewer-b-publish`. R212 fixed the private DevFactory provenance mismatch and prepared a shadow idempotency key. The Publisher PR #64 added read-only *arithmetic* for the RunPod+OpenRouter EUR 15 common budget; it does **not** establish independent actual charges or atomic cross-provider reservations.

## Proposed future owner commands (DO NOT POST/ACTIVATE YET)

Sample syntax below is test data, **not** a command to issue or permission to execute:

```text
/devfactory-openrouter-grant-v2 2026-10 epoch=1 repo=deenkids7-dev/deenkids model=qwen/qwen3-coder-30b-a3b-instruct scope=diff-only zdr=true fallback=false budget=15eur
/devfactory-openrouter-revoke-v2 2026-10 epoch=1
```

A real owner would need to authorize the delegation and any future revocation via an independently authenticated readback from a chosen protected canonical GitHub location. The sample October 2026 month is **not** a grant. The command does not broaden the current €15 aggregate limit, does not authorize DeepSeek, and does not silently renew after the month.

## Current implementation

`scripts/owner-review-delegation-shadow.mjs` implements a pure bounded shape checker, using the proposed command grammar, GitHub-owner identity literals, UTC month, positive generation, exact model/repository, diff-only export, strict ZDR, no fallback, and revoked epoch denial. It ignores untrusted non-owner claims and rejects duplicates, malformed comments, incomplete arrays and mismatched periods.

**Importantly:** a caller-supplied `githubComments` array can be forged, can omit revocations, and cannot authenticate a live owner. **EVERY** response therefore sets `status=BLOCKED`, `privateCodeEgressAuthorized=false`, `cloudReviewRequestAuthorized=false`, `budgetAuthorized=false`, `environmentApprovalAuthorized=false`, `mergeAuthorized=false`, and `mayStartRunner=false`. All caller-supplied booleans or alleged receipts are ignored.

This is a **separate policy parser only**: it creates no new scheduler, Reviewer B, RunPod/GPU worker, merge executor, privileged GitHub App, repo secret, workflow or spending limit.

## Promotion gates (NOT IMPLEMENTED OR AUTHORIZED BY THIS PR)

1. Canonical owner permission and scope: choose a protected, independently fetched immutable comment source; enforce unique active delegation, highest generation, live revocation readback, missing-pagination denial and bounded expiry.
2. Independently authenticate current PR/head and canonical LOT/claim/CI. The private R212 request shadow is not a scheduler or verified trust root.
3. Enforce actual monthly RunPod + OpenRouter charges, bill completeness, FX provenance, reserved cost upper bound, exclusive transactional ledger and reconciliation; stop on any unknown receipt. Source €15 budget cannot be expanded by local grant text.
4. Protect user secrets in the separate Publisher; preserve immutable selected model and ZDR/no-fallback. Do not export private diffs until the real owner's egress delegation, provider billing, and deployment authorities are all verified.
5. Introduce separately reviewed GitHub App deployment protection; test approve/deny in a safe environment, then seek explicit administrative approval before replacing the existing human review.
6. Only after 1–5 are proven, consider a versioned policy extending the existing Factory Merge Executor for low-risk LOTs. No local shadow report is a `PASS`, `HUMAN_GO`, `MERGE_GO` or ClaimBinding.

## Validation and rollback

`node --test test/owner-review-delegation-shadow.test.mjs test/shared-review-budget-readiness.test.mjs` → 17 PASS, 0 FAIL. Additional CI on the exact PR HEAD must pass before review. No production workflow files are changed; rollback is simply not merging this preparatory PR. No provider calls were made.

This shadow cannot unblock private PR #939 Reviewer B. That still needs a distinct exact-head consent under today's rules and independently verified real shared budget.
