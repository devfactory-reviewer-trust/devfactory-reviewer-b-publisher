# Reviewer B — authenticated shadow claim provenance (20 October 2026)

**DRAFT / OFFLINE INTEGRATION CONTRACT / NO PAID AUTHORITY.**

This is a separate Publisher branch. It does **not** import, deploy or
reconfigure the protected real Reviewer B workflow, PostgreSQL shadow
ledger from Publisher PR #71, OpenRouter, GitHub write permissions or Runner.

## Problem solved within a read-only trust boundary

A PostgreSQL database owner/invoker policy cannot establish whether a
caller-provided PR number, SHA, Qwen model, public service-comment ID or
estimated billing amount is genuine. This module composes three existing,
independent GitHub read-only proof families **before** a future service
would even *consider* sending an untrusted claim to a shadow ledger:

1. **Private PR exact HEAD**: fetch `GET /repos/deenkids7-dev/deenkids/pulls/{pr}`
   using a scoped GitHub App read-only token from a trusted owner/operator.
   Require strict `200`, no redirect, pinned API URL and JSON content
   type, a bounded 128 KiB streaming response and parsed PR object with
   exact PR number/head, OPEN/unmerged state, same non-fork repository
   for head+base and expected `master` base.
2. **Separate owner consent**: reuse `fetchAndVerifyOwnerCloudConsent`
   to validate the actual owner's numeric GitHub identity, exact
   PR+HEAD+model+UTC-month+EUR15 consent string, within its 4-hour window.
3. **Unique service request**: reuse
   `fetchAndVerifyUniqueOpenRouterServiceRequest` to read all bounded
   pages of public Publisher issue #62 and verify one matching service
   actor's numeric identity, exact model/head and request comment ID,
   only for the first `issue_comment` run. A manual `workflow_dispatch`,
   rerun or ambiguous duplicate fails closed.

A successful result is frozen and marked
`SHADOW_GITHUB_READ_ONLY_PROVENANCE`. It contains no read token or
secrets and explicitly has
`mayReserve:false,maySpend:false,mayMerge:false,mayPublish:false`,
`estimatedEurAuthenticated:false`,
`providerBillingAuthenticated:false` and
`independentReviewVerified:false`.

## Important limitations and future blockers

- `fetchImpl` injection exists **only for offline tests**. Trusted
  execution must bind an authentic GitHub App token and the real native
  HTTPS fetch implementation. A caller with control of the code or HTTP
  mock can of course fabricate evidence; this is **not a cryptographic
  attestation** accepted by PostgreSQL.
- The PR proof is point-in-time. A mutable PR HEAD must be revalidated
  at any future reservation and before any private egress. This code
  has no paid model call, signed nonce, proof transport protocol,
  backend requester authentication or compare-and-swap with the DB.
- Owner consent is a distinct human action; no comment was created by
  this prototype, and absence of genuine owner consent is a denial.
- The quoted `budget15eur` scope in owner consent is NOT a verified
  bill, current EUR FX rate, remaining balance, cross-key reservation,
  charge audit or cancellation/retry safety. The private invoker cannot
  use the output to authorize a provider POST. A malicious caller can
  supply a forged proposed amount unless a trusted financial estimator,
  authenticator and independent reconciliation gate is added.
- Some existing owner/service GitHub API readers use bounded
  post-`text()` size checks for mocked/non-stream responses; they are
  separate legacy readers, not complete end-to-end streaming proofs.
  No real GitHub/private repo call is performed in these tests.
- The real spend gate `openrouter-only-spend-gate.mjs` remains
  **BLOCKED**. Existing `HUMAN_GO`, exact-head `MERGE_GO`, formal
  Reviewer B and later `ZERO_CURSOR_GO` are unchanged.
- The presence of owner-consent artifacts must not be inferred merely
  because test fixtures contain fake matching actors and comments.

## Verification

```bash
node --test test/openrouter-shadow-claim-provenance-readonly.test.mjs
npm test
```

The tests create only synthetic GitHub API objects, actors and read
tokens and mock the GET endpoints in memory; they do not access
private source, external provider accounts, PostgreSQL or GitHub
mutations. The new module is deliberately not referenced by the
protected paid Publisher entrypoint.

**Decision: NO-GO REAL SPEND / NO-GO RUNNER / NO-GO MERGE.**
