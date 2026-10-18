# Reviewer B real RunPod + OpenRouter shared budget — security cutover

**Public Publisher candidate; NO paid calls and NO merge authority.**
Do not confuse owner consent with independent accounting.

## Finding

Previously `protected-real-openrouter-review.mjs` called the billable semantic
review with `authenticatedGlobalBudgetVerified:true` immediately after reading
a 15 EUR owner-consent comment. That comment does not authenticate the actual
monthly RunPod invoices, OpenRouter charges, foreign-exchange conversion, or
outstanding/in-flight requests. Existing `shared-review-budget-readiness.mjs`
is documented SHADOW-only and always blocked; the OpenRouter key's own $1
monthly limit does not cover RunPod.

The previous private PR #939 run #39121299576 reached real paid Qwen calls,
failed without a native independent review, and created a possible duplicate
charge risk on replay. Owner screenshots show approximately $0.02 aggregate
monthly Qwen spend, not an independently attributable per-run charge; RunPod
total remains unverified.

## Emergency fail-closed cutover

This PR introduces a pure boundary `assessAuthenticatedSharedBudgetReservation`.
It **always returns BLOCKED**, even if its caller supplies fabricated
`verified:true`, `maySpend:true` or a signed-looking record. The production
entrypoint checks it **AFTER authenticated owner consent and BEFORE entering
OpenRouter**, so no billable POST can start until a real atomic reservation
implementation replaces this stub following a separate approved PR.

The prior hardcoded `authenticatedGlobalBudgetVerified:true` is replaced
by explicit verified reserve fields from the gate. This intentionally blocks
**ALL** private paid Qwen runs while the shared ledger is unimplemented.
Protected GitHub environment approval and model ZDR remain required, but
neither can bypass the budget cutover guard.

## Required future implementation, not provided by this PR

- Authenticate both OpenRouter and RunPod costs from their authoritative
  systems for the same UTC month; prove currency conversion and provider
  billing-lag allowances.
- Implement a durable transaction / concurrency-safe ledger, keyed to exact
  PR, HEAD, model, caller identity, UTC period, and unique request nonce.
- Atomically reserve worst-case cost, account for in-flight unknown charges,
  reconcile actual billed results, and never automatically retry ambiguous
  paid POSTs.
- Prevent duplicate dispatches for the same PR HEAD across workflow attempts,
  even when a failed attempt published no native review. Recover only with
  explicit owner risk decision plus fresh and independently verified cost.
- Lock remaining EUR15 cap across OpenRouter and RunPod; verify provider
  charges and reservation state even if jobs crash.
- Require independent tests, protected review, immutable exact-HEAD evidence,
  and a **new scoped owner approval** before enabling this pathway.

## Existing invariants

No new LOT, no second scheduler, no merge bypass, no code egress to public
Publisher, no change to consent syntax or data-privacy routing. Protected
main remains authoritative. Private PR #939 has not been reviewed successfully
and is not allowed to merge. Runner/Supervisor remain stopped.

This candidate is an explicit **NO-GO on paid reviewer** until the ledger and
duplicate-cost controls are implemented and verified.
