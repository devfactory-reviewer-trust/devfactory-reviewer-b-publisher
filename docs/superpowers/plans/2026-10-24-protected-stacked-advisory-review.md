# Protected stacked advisory review — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Permit the protected local Qwen Reviewer B COMMENTED-only workflow to review a same-repository stacked PR with an exact-head-bound request, while leaving the master-only default gate intact.

**Architecture:** Explicit advisory opt-in threads from trusted workflow through the authenticated preflight to snapshot validation. Immutable base and head SHA, complete diff and repository checks stay enforced. The posted comment labels stacked scope as partial; no PASS, provider spend or production activation.

**Tech Stack:** Node ESM, node:test, GitHub Actions, Qwen/Ollama.

**Spec:** LOT #945 offline-only, Publisher issue #21 COMMENTED-only.

## Global Constraints

- Default master-only rule, exact SHA, source-identity, diff integrity and workflow approvals persist.
- No paid OpenRouter route or production Runner enablement.
- No merge without separately reviewed exact SHA and owner MERGE_GO.

## Review Focus

- Forked or moved base/head rejection.
- Malformed base refs rejection.
- No stacked exception on paid or unpinned dispatch route.
- Explicit stacked advisory limitation in COMMENTED report.
- No accidental Reviewer B PASS.

---

### Task 1: Isolated snapshot advisory opt-in

**Files:** `src/pr-snapshot-consistency.mjs`, `src/github-pr-observer.mjs`, `candidate/private-review-preflight.mjs`, focused tests.

- [ ] Write regression tests: same-repo codex stacked base denied normally, accepted only with advisory opt-in, exact SHA; malformed/forked/moved stays denied.
- [ ] Run RED.
- [ ] Implement minimal restricted opt-in threaded through observer/preflight.
- [ ] Run GREEN.

### Task 2: Trusted COMMENTED lane

**Files:** `scripts/protected-real-semantic-review.mjs`, `test/protected-real-semantic-review.test.mjs`.

- [ ] Write RED tests: exact-HEAD service comment gets stacked advisory scope, other modes stay master-only.
- [ ] Implement opt-in only from trusted protected issue comment and label the resulting native comment.
- [ ] Run focused and full tests, inspect diff, commit isolated branch, request external review.
