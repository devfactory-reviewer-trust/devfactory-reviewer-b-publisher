# DevFactory Reviewer B — OpenRouter only, security cutover

**Owner choice 2026-10-18:** OpenRouter is the sole future paid
inference provider. No further RunPod starts, reads or charges are intended.
Budget ceiling remains **EUR 15 / UTC month**, exclusively for OpenRouter.

## Present status
The old PR #68 compared two provider budgets and had a permanent BLOCKED
stub. This revised candidate removes that multi-provider architecture and
separates the provider-only spend decision. It does NOT grant paid authority
yet: `assessAuthenticatedOpenRouterSpendAuthorization` returns
`BLOCKED` until a later independently reviewed budget implementation exists.
This avoids silently treating owner consent as spend evidence.

No inference, Pod launch, paid workflow release, private code export,
protected main merge or Runner start is part of this PR.

## Prevent repeated charges and loops
1. No automatic retry for an ambiguous OpenRouter POST. A failed request
   can still be billed, even when no native GitHub review was published.
2. Owner consent must be fresh, scoped to exact PR HEAD, model and month.
3. Before a future paid start, verify OpenRouter key spend/cap and account
   charges, including pending or ambiguous requests; currency conversion
   must be authenticated, and **one globally durable idempotency key**
   must bind the operation to the exact PR/HEAD/UTC month.
4. Enforce a single-flight atomic reservation and release/reconcile it
   only after charges are known; fail closed on billing lag.
5. A rejected spend gate ends the job once; no recursive dispatch or
   repost of issue #62; no unattended retry.
6. Review remediation is bounded: do not rerun Gemini for stylistic
   suggestions endlessly. Require a final exact-head review and owner
   merge decision before another protected release.

## RunPod retirement
Disabled four public Publisher GitHub Actions jobs used to start/inspect
RunPod. Their jobs have literal GitHub `if: ${{ false }}` conditions,
including the previously issue-comment-triggerable GPU start path.
The **emergency STOP/watchdog job remains available temporarily** in case
an older Pod still exists. Old implementation modules and historical
documents remain for traceability and offline tests; they are not an
active inference provider or spending input. Deleting account credentials
and confirming zero running Pods requires an owner check in RunPod.

## Risks honestly remaining
- This PR intentionally blocks all new paid Qwen until real verified
  single-provider reservation is built. This is a **hard stop**, not a
  repeated loop; an owner approval alone does not unblock it.
- The current workflow can still create GitHub runs on service comments;
  they are skipped unless the authenticated exact trigger matches.
  Recurring user commands can still launch separate billable operations
  **after** future budget authorization. Idempotency must be enforced
  before that permission is ever enabled.
- OpenRouter's current key-specific monthly $1 cap helps, but does not
  prove an EUR15 account-level ceiling across future key rotations.
- The historical private PR #939 is OPEN without a successful Qwen review.
  The previous billing and finish_reason cause remain unproven.

## Release
Node24 offline tests, Publisher exact-head protected CI and independent
review required. This candidate changes earlier #68 exact HEAD, so the
earlier scoped squash authorization cannot be reused. A **new explicit
owner approval** is needed to merge the updated PR.
