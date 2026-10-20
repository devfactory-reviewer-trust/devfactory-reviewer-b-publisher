# Reviewer B — synthetic shadow admission composition (20 October 2026)

**DRAFT, TEST-ONLY, NON-DEPLOYED. NOT a production admission service.**

This integration consolidates two separately reviewed preparatory branches:
- Publisher PR #71: PostgreSQL 16 shadow proposal schema with
  restricted NOLOGIN owner and `SECURITY DEFINER` budget invoker.
- Publisher PR #72: read-only live GitHub PR HEAD, owner-consent and
  unique first service-command provenance checks.

The new module `scripts/openrouter-shadow-admission-synthetic-only.mjs`
executes these pieces sequentially ONLY when a synthetic process test switch
is explicitly enabled. Its dependencies `fetchImpl` and `db` are injectable
for offline tests, **not authenticated production connectors**.

## Fail-closed composition contract

1. Ordinary execution refuses immediately if
   `REVIEWER_B_SYNTHETIC_SHADOW_ONLY` is not exactly `1`.
2. Unknown caller fields are rejected before GitHub or DB access.
   This includes price/quote, currency, accounting month, caller-selected
   `runId`, repository, signed proof, provider outcome, and fake maySpend.
   The current UTC clock is obtained by the module itself.
3. The GitHub reader verifies current private PR same-repository HEAD,
   unmerged state, owner exact-HEAD/model/month/4-hour consent, and the
   unique first-attempt public service command. If any part fails, the
   synthetic database is never queried.
4. The shadow proposal derives repo, PR number, exact head, model and service
   comment ID **only from verified Github response fields**; it generates a
   synthetic run ID using the verified service comment ID. No data from a
   caller's quote or spoofed month is forwarded to PostgreSQL.
5. The proposed bound is fixed at the *entire shadow budget* of
   **15,000,000 micro-EUR**, not a model cost estimate. Thus this
   conservative integration can record at most one proposed claim in
   one month's synthetic shadow ledger. It does NOT prove that a provider
   call could never exceed 15 EUR; there is no actual provider call.
6. All results have `maySpend:false`, `mayReserve:false`,
   `mayPublish:false`, `mayMerge:false`; no result means a real
   service can spend or publish. Any changed/malformed DB response or
   exception fails closed. Once a row is recorded, replay is rejected
   by PostgreSQL. There is **no retry loop**, no queue, and no paid code.

## Verification and trust limits

The synthetic integration test uses memory-only Github GET responses and
a temporary PostgreSQL-compatible PGlite database, exercising the real
shadow SQL function under the NOLOGIN restricted invoker role. It verifies
that unverified GitHub claims make zero DB calls, that fake claims and
prices are rejected, that a fixed 15 EUR row is inserted only once,
and that caller-supplied clock/month cannot alter accounting.

- This module is **not wired** to protected Reviewer B Publisher and
  cannot authenticate a web requester. Anyone with code execution can
  inject mocked GitHub/DB functions; therefore this test result MUST NOT
  be used as a trusted server-to-server credential or signed evidence.
- The trusted protected service, network identity, transport replay
  prevention, binding a GitHub HEAD to the moment of an actual provider
  request, provider-authenticated billing, US/EUR FX conversion, pending
  and ambiguous charges, and a global multi-key reservation authority
  remain **unimplemented**.
- The production spend gate still returns
  `OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED`.
  Its intentionally always-blocking policy MUST remain unchanged.
- Both predecessor PRs remain independent, unmerged. This integration
  branch contains an explicit composition copy of their commits; it is
  **not a decision to merge their production behavior**.
- The integrated workflow **does** use GitHub's ephemeral repository
  token with **contents:read** to download the exact trusted source commit.
  It must not be described as having only synthetic credentials. That
  token is limited to the download step and is not passed to the test.
  Only the test fixtures' GitHub actors/tokens are synthetic. The test
  uses a disposable database; it has no OpenRouter API key, no runtime
  access to the private DevFactory target source and no owner approval.

**NO-GO SPEND / NO-GO DEPLOY / NO-GO MERGE / NO-GO RUNNER.**
