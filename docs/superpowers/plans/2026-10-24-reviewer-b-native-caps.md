# Reviewer B OpenRouter Native Caps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Safely replace Reviewer B's non-authorizing EUR15 reservation stub with authenticated native $3 monthly key guard, while keeping protected review offline until explicit consent.

**Architecture:** Reuse preflightOpenRouterKey's module-private key proof; verify it again in a pure authorization gate. Match the same secret key and model, 120-second freshness, monthly provider cap <=$3 and an exact owner consent bearing budget13usd. Keep the existing first-attempt uniqueness and no-retry controls.

**Tech Stack:** Node.js 24, ES modules, node:test, GitHub Actions, OpenRouter GET /api/v1/key and ZDR models.

**Spec:** docs/superpowers/specs/2026-10-24-openrouter-native-cap-design.md

## Global Constraints

- Reviewer B maximum: $3 per provider-native monthly key; development key: $10; combined target: $13.
- No real paid POST in tests or until protected governance permits it.
- Protected default branch unchanged until reviewed merge; no bypass of exact SHA, owner consent, and service actor.
- OpenRouter only, no fallback, per-request ZDR, no automatic retry, no automatic APPROVE/MERGE.

## Review Focus

- Forged caller proof or mismatched key => BLOCK before inference.
- Expired preflight/incorrect month reset => BLOCK.
- Key cap >$3 or unlimited => BLOCK; cap <=$3 with enough credit allowed.
- No fresh exact owner consent or changed SHA/model/month => BLOCK.
- Ambiguous/duplicate workflow attempt => BLOCK even if valid budget.

### Task 1: Authenticate provider's native Reviewer B cap

**Files:** test/openrouter-zdr-executor.test.mjs; scripts/openrouter-zdr-executor.mjs

**Interface:** verifyAuthenticatedOpenRouterNativeCap({apiKey,preflight,model,maxMonthlyUsd:3}) -> boolean.

- [ ] Write focused failing tests: valid $3 proof, cap >$3 refused, wrong key, forged proof, expired proof, nonmonthly key.
- [ ] Run node --test test/openrouter-zdr-executor.test.mjs and observe RED.
- [ ] Implement minimal testable private WeakMap-bound cap authentication; update former $1 cap to $3.
- [ ] Run targeted tests and observe GREEN.

### Task 2: Wire native cap to Reviewer's spend gate

**Files:** test/openrouter-only-spend-gate.test.mjs; scripts/openrouter-only-spend-gate.mjs; scripts/protected-real-openrouter-review.mjs

**Interface:** assessAuthenticatedOpenRouterSpendAuthorization({apiKey,preflight,model,consentVerified,uniqueFirstAttempt,prNumber,headSha,now}) returns verified/maySpend true only on authenticated proof and verified surrounding gates.

- [ ] Write failing tests: native attestation can authorize, forged/no proof blocks.
- [ ] Observe RED.
- [ ] Require provider's read-only preflight before gate and bind it to the actual Reviewer B inference key.
- [ ] Observe GREEN.

### Task 3: Change owner consent from budget15eur to budget13usd

**Files:** test/openrouter-native-policy.test.mjs; scripts/openrouter-owner-consent.mjs; scripts/protected-real-openrouter-review.mjs

- [ ] Write failing tests for exact new consent and rejection of stale historical EUR15 consent.
- [ ] Observe RED.
- [ ] Replace message and budget field; preserve owner ID, SHA, model and 4-hour checks.
- [ ] Observe GREEN.

### Task 4: Verify and submit safely

- [ ] Run node --test for whole Publisher repository; record any pre-existing failures.
- [ ] Run git diff --check and inspect scoped diff.
- [ ] Commit to isolated branch; push branch, open unmerged PR for independent review.
- [ ] Never initiate paid review, post owner consent, flip production flags, or start Runner without real provider caps and protected approvals.
