# DevFactory Reviewer B — offline OpenRouter liability stress test

**20 October 2026 — PR #73 — SYNTHETIC ONLY / DRAFT / NO SPEND.**

## Scope and immutable safety boundary

This work adds a **standalone mock-only exposure calculator**,
`scripts/openrouter-shadow-billing-reconciliation-offline.mjs`, and
`test/openrouter-shadow-billing-reconciliation-offline.test.mjs`.
It does not call OpenRouter or GitHub, read a secret, connect to a database,
persist a reservation, compute a trusted FX rate, or grant spend rights.
The real `openrouter-only-spend-gate.mjs` remains **BLOCKED**. Reviewer B
does not obtain a real provider invoice or an independent service identity.

The sole input is a bounded serialized JSON document with exact keys:
`month_utc`, `coverage:"illustrative-only"`,
`currency:"EUR"`, and `records` (1–500 records). Each mock record has
exactly `request_id`, `key_role` (`development` or `reviewer_b`),
`state` (`settled`, `pending` or `ambiguous`),
`already_billed_micro_eur` and `unsettled_upper_micro_eur`.
All amounts are **hypothetical micro-euros**, never authenticated
provider charges. The synthetic test switch must be explicitly enabled.

## Conservative scenario algorithm

- Every unique request ID is counted once across both mock key roles.
  Duplicate IDs, unknown roles, injected extra fields, malformed JSON,
  negative/noninteger money and invalid state combinations fail closed.
- For every record, hypothetical exposure is
  **already billed + still-held maximum liability**. This can
  deliberately overcount overlapping invoice/hold exposures. A timeout,
  HTTP 5xx or disconnection means **ambiguous**, not `settled` or
  `no charge`; the unreconciled hold remains.
- `pending` / `ambiguous` require a positive held amount and always
  return `mayRetryAmbiguousRequest:false`. A `settled` request
  must have no hold. The model never releases money or retries anything.
- The **15,000,000 micro-EUR ceiling** exists only to detect hypothetical
  overexposure. Even a simulation under cap returns
  `status:"BLOCKED"`, `maySpend:false`, `mayReserve:false`,
  `verified:false`, `providerBillingAuthenticated:false`,
  `accountCoverageAuthenticated:false` and `fxAuthenticated:false`.

This model aggregates two named roles, but that is **not proof of
coverage of all real OpenRouter keys, workspaces, account charges,
other services or unsettled invoice adjustments**. A maliciously
crafted mock `settled` entry cannot become genuine evidence.
The EUR denomination is illustrative; real provider spend may
be USD, must use an independently trusted FX quote, time bounds,
conservative rounding, and durable reconciliation.

## Additional offline USD/EUR FX stress simulation

The separate `scripts/openrouter-shadow-fx-reconciliation-offline.mjs`
takes **serialized synthetic JSON only**, under the same test-only switch.
Its paired test file is
`test/openrouter-shadow-fx-reconciliation-offline.test.mjs`.
It is deliberately **not imported by the real Publisher or spend gate**.
The GitHub synthetic admission workflow runs the negative cases.

A mock document requires the exact top-level keys `coverage`,
`month_utc`, `observed_at`, `fx_quote`, `entries`. The quote has
`source:"synthetic-fixture"`, `pair:"USD/EUR"`, decimal **integer
strings** `numerator` and `denominator`, `issued_at` and
`expires_at`. Each record has a unique `request_id`, the
`development` or `reviewer_b` mock key role, a `charge_month_utc`
matching the scenario month, one of `settled`/`pending`/`ambiguous`,
and integer-string `billed_micro_usd` and `held_micro_usd`.

For each record and **each** billed/held component independently, the
simulated conversion is:

```text
micro_eur = ceil(micro_usd * numerator / denominator)
total_micro_eur = sum(converted_billed + converted_held)
```

The calculator uses arbitrary-precision integers, prevents duplicate
request IDs across key roles, rejects inconsistent settlement states
and caps what it exposes as a safe numeric diagnostic. An ambiguous or
pending charge keeps its *entire* mock liability on hold (plus partial
invoicing) and **cannot be retried**. Missing, future or expired mock
quotes and windows greater than 5 minutes fail closed. The code compares
**fixture-supplied** timestamps only; it makes **no claim of actual
current quote freshness**, source identity or authenticity. Modelled
month mismatch is refused rather than auto-releasing earlier holds.

This is **not FX hedging**, no guarantee that the numerator/denominator
is a valid economic rate, and no trusted authenticated rate source. An
attacker can fabricate a quote, the entries, their billed state, and
the list of all keys. Therefore an apparently low converted liability
must **never** unlock paid OpenRouter. Across-period liabilities,
real provider billing delays, charge reversals, the source of
provider request IDs, and a durable idempotency ledger remain unproven.
Every result is still `BLOCKED / maySpend:false /
mayReserve:false / mayRetryAmbiguousRequest:false` and does not
create a reservation or merge/Runner permission.

## Cross-month mock provider reconciliation (no real invoices)

A further **offline-only, deterministic fixture** is implemented in
**scripts/openrouter-shadow-provider-reconciliation-offline.mjs** and tested in
**test/openrouter-shadow-provider-reconciliation-offline.test.mjs**.
The existing synthetic GitHub Actions workflow exercises this module.
It is not imported into any billable path.

The fixture has one uniquely identified intention per request, its declared
key role (development or reviewer_b), initiation UTC month, simulated state
(settled, pending, ambiguous) and positive held micro-USD for unresolved
outcomes. Separate mock invoice lines carry globally unique line IDs,
request IDs, billing UTC months and unsigned integer-string micro-USD
amounts. All inputs are **unverified fixture data**, not authenticated
evidence about OpenRouter invoices, credits, provider identity or account
coverage.

The review model does not discard potential liability:
- An ambiguous **September** request continues to hold its full upper
  bound in **October**, until an independently established final result.
- A partial invoice received the next month is **added to** the held
  upper-bound amount. A timeout or missing provider record is not
  permission to retry or release that hold.
- An invoice without a matching request is an orphan and blocks the
  simulated reconciliation instead of being ignored.
- Duplicate request IDs across both key roles, duplicate invoice IDs,
  invoice months before request creation, future billing periods,
  invalid monetary strings, overflow and contradictory states are denied.
- A supposedly settled mock request without invoice evidence is denied,
  rather than treated as free. This is a conservative fixture rule,
  **not a factual claim about all genuinely zero-cost requests**.
- Even a matching mock ledger remains BLOCKED with all spend, reserve,
  retry, provider verification and account-completeness permissions false.

The sums remain in hypothetical **USD micro-units**. They are NOT
converted into real EUR liabilities or compared with the proposed
EUR 15 synthetic ceiling. They prove neither all-key coverage nor
provider authenticity. Charge reversals, refunds, adjustments,
zero-cost settlements, partial invoice delivery, clock skew, retention,
across-account enumeration, provider request identity, real FX,
provider credit expiry and post-timeout settlement remain unresolved.
A trusted billing evidence source, durable idempotency and a separately
approved reconciliation protocol are mandatory before real spending.


## Offline attempt-lifecycle and no-retry contract

The preparatory module `scripts/openrouter-shadow-attempt-lifecycle-offline.mjs`
and its dedicated test file model a **hypothetical event sequence only**.
They are run in the isolated synthetic GitHub Actions workflow. Inputs
are bounded serialized JSON fixtures with strictly sequential event
numbers and exact role, request, attempted dispatch, HEAD and UTC-month
identity. This is neither a service nor a trusted durable event store.

For every fixture request, the permitted illustrative phases are:

1. `reserved` — a local *simulation* of a planned attempt.
2. `dispatch_recorded` — **one hypothetical** dispatch-intent event;
   this code does **not** send any request.
3. `outcome_unknown` after dispatch — preserve uncertainty, do not
   re-dispatch or refund any hold.
4. `settled_fixture` only after recorded dispatch, possibly from unknown
   status, but with no authentic provider receipt.
5. `cancelled_before_dispatch` only from reserved; cancellation after a
   possible dispatch is forbidden.

Second dispatches (including after simulated settlement), duplicate
request or attempt IDs across roles, resurrecting a cancellation, stale
event sequence, forged HEAD/role/attempt identifiers and a backwards
UTC-month transition are all denied. Every result is **BLOCKED** with
`maySpend:false`, `mayReserve:false`, `verified:false`,
`mayRetryAmbiguousRequest:false`, and
`durableIdempotencyVerified:false`.

**Critical limit:** strict parsing and replay of caller-supplied fixtures
does not establish authentic persistence, atomicity, crash durability or
cross-machine serialization. A malicious caller can fabricate or omit
the entire event history. A future authorized production component
would require a centrally provisioned durable database with a UNIQUE
provider-account/request-id pair, write-before-send intent, atomic
CAS transitions, protected credentials, reliable acknowledgement
provenance and explicit recovery for ambiguous attempts. It must be
impossible for two dispatchers to act on different stale copies.
Even a unique database request ID cannot guarantee provider-side
idempotency unless the provider documents and enforces compatible
semantics; do not automatically retry requests whose charge is unknown.

This PR deliberately neither deploys this coordinator nor calls a
provider API, and does not lift any financial, deployment, merge or
Runner gate.

## Real PostgreSQL16 *synthetic* dispatch-risk tombstones

The additive file `sql/reviewer_b_attempt_tombstone_synthetic_v1.sql`
defines a **separate**, inactive-by-default schema
`reviewer_b_attempt_shadow`. It is executed in an **ephemeral
PostgreSQL 16.4 CI service only**, not on a real Publisher database.
Two NOLOGIN principals isolate a privileged definer and a restricted
test invoker. No account key, network credential or production login
is provisioned. Public execution privileges and invoker table access
are revoked; all state changes must use reviewed functions.

The immutable identities `request_id` and `attempt_id` are both
globally unique across UTC months and across mock key roles. Database
constraints enforce a four-state monotonic record:

- `registered`: an intent exists; no outbound request has happened.
- `dispatch_may_have_occurred`: one atomic, committed **risk
  tombstone** should precede *any* hypothetical network send.
- `outcome_unknown`: a potential dispatch has uncertain billing;
  no replay, cancellation or automatic financial release.
- `cancelled_before_dispatch`: cancellation while no dispatch
  marker exists; request ID cannot be recreated.

`record_dispatch_risk` uses a PostgreSQL row lock
`FOR UPDATE NOWAIT` and a state-checked CAS. One independent
connection cannot create another dispatch marker once the first has
committed. Failed/ambiguous database writes are never an invitation
to send the request. `register_synthetic_attempt` refuses reused
request/attempt IDs even when callers change roles or calendar months.

The separate test `test/openrouter-shadow-attempt-postgres-real.test.mjs`
runs inside the existing restricted PostgreSQL 16.4 multi-client
workflow. It verifies real connection-level privilege isolation,
database lock contention, rollback visibility, reconnect/restart
persistence within the *ephemeral* CI instance, duplicate/reforged
identity rejection, invalid repeat dispatches, denial after unknown
outcomes, and cancellation strictly before a dispatch marker.
The tested entrypoints always return `may_spend=false` and
`may_dispatch=false`; the test creates **no actual paid request**.

**Important transactional limit:** a hypothetical external send after
a successful SQL function response but **before COMMIT** would still
be unsafe; rollback would remove the marker. In real use, the caller
would have to prove that the marker committed durably **before egress**,
handle lost COMMIT acknowledgements as permanently uncertain, and
never retry an unknown billing outcome. Database-only uniqueness does
not establish upstream provider idempotency or exactly-once execution.
A separate protected dispatcher, authenticated invoice reconciliation
and independent threat review are mandatory. The schema is deliberately
**not linked** to the Publisher, actual budget coordinator, paid API,
secret-bearing receiver, Runner or deployment scripts.

## Recovery observation after a lost COMMIT acknowledgment (synthetic)

The same test-only PostgreSQL tombstone migration now includes the
SECURITY DEFINER function
`reviewer_b_attempt_shadow.observe_attempt_after_uncertain_commit`.
It requires immutable request ID, attempt ID and HEAD; runs only with
READ COMMITTED isolation; reads status using `FOR SHARE NOWAIT` to
reject conflicting in-flight updates; exposes no raw table permissions
to the restricted test invoker; and returns `may_spend=false`,
`may_dispatch=false`, `may_retry=false` for **every** outcome,
including matching, REGISTERED, missing, cancelled or ambiguous.
A wrong ID/HEAD and invalid isolation produce fail-closed observations.

The PostgreSQL 16 multi-client integration test models two cases:
- A COMMIT is successfully acknowledged by PostgreSQL, then the test
  deliberately discards that response at the application boundary
  (synthetic lost acknowledgment). An independent newly authenticated
  session reads the persisted `dispatch_may_have_occurred` marker
  and cannot create a second marker or a new attempt under that ID.
- A transaction is rolled back before its dispatch marker commits.
  The read-only recovery function sees `registered`, but **still**
  grants neither dispatch nor retry: without trusted evidence,
  the caller cannot infer whether an external action occurred.
  An in-flight UPDATE lock causes the recovery read to fail immediately
  instead of silently trusting stale data.

**Boundaries:** This does NOT simulate a real dropped TCP COMMIT reply,
database restart/failover, lost durable writes, operator/superuser
modification, network egress to OpenRouter, actual invoice identity,
or provider-supported idempotency. In particular a client must **not**
use the underlying synthetic registration/dispatch function as a
"retry" after a lost acknowledgment: the recovery function alone
does not enforce a production dispatcher protocol. Real deployment
requires durable COMMIT verification, independent provider billing,
authentic identity, full-key coverage, lost-ACK incident controls and
a separately reviewed protected dispatch service.

## Isolated PostgreSQL backend-loss regression (synthetic, no provider)

The existing PostgreSQL 16 multi-connection test also terminates a
**separate disposable test backend** with `pg_terminate_backend` while
the backend holds an UNCOMMITTED dispatch-risk marker. The database
should roll back that connection's transaction. An independent
authenticated recovery session then observes the preexisting
`registered` row, but receives `may_retry=false`,
`may_dispatch=false`, and `may_spend=false`.

This directly tests a server-side session termination in an
**ephemeral GitHub Actions PostgreSQL service**. It is not a test
of production database failover, persistent-volume loss, WAL durability,
network egress timing, actual OpenRouter billing, or
provider-side idempotency. A `registered` row or a missing row is
not evidence that no external call occurred. Future recovery must
quarantine uncertain attempts pending authenticated reconciliation
and explicit policy, never issue a duplicate paid request.

## Isolated PostgreSQL quarantine for unresolved mock provider charges

The additive, **synthetic-only** migration
`sql/reviewer_b_attempt_quarantine_synthetic_v1.sql` extends the
existing `reviewer_b_attempt_shadow` schema in the **disposable**
PostgreSQL 16 GitHub Actions database. It requires the pre-existing
tombstone migration and does **not** create a competing ledger or
connect to the actual Publisher, OpenRouter, Runner or paid service.

The `quarantines` table contains exactly one immutable quarantine
entry per synthetic request ID, linked by a database foreign key to
the original attempt. The protected
`quarantine_synthetic_attempt` function binds the request,
attempt ID and exact HEAD, locks the existing risk row with
`FOR UPDATE NOWAIT`, and only accepts requests already in
`dispatch_may_have_occurred` or `outcome_unknown`.
`registered` and `cancelled_before_dispatch` cannot fabricate a
provider-risk quarantine entry. A second quarantine for the same
request is refused. This does not confer any right to send again,
resume a request, or release money.

The `unverified_evidence` table stores **untrusted test fixtures**
under quarantined request IDs, with globally unique evidence IDs
and SHA-256-format digests. The single
`record_unverified_evidence_fixture` function only accepts
`mock_invoice`, `mock_timeout`, `mock_adjustment` or
`mock_absence` and labels the provenance
`unverified-fixture`. A duplicate ID/digest or a proposed
`provider-authenticated` category is rejected. No claim is
validated against an OpenRouter signature, API, billing statement,
actual key or provider accounting ledger. A fixture saying
`mock_absence` must **never** imply a zero-dollar outcome.

These tables have no release, refund, DELETE, promote-to-verified or
dispatch entrypoint for the restricted test role. Both functions
are `SECURITY DEFINER`, owned by a NOLOGIN test principal;
PUBLIC EXECUTE and direct table permissions are revoked.
Every return value keeps `may_spend=false`,
`may_dispatch=false`, `may_retry=false`,
`may_release_hold=false`, and evidence additionally reports
`provider_authenticated=false`.

The existing multi-connection PostgreSQL16 integration test now
checks denied direct access, conflicting quarantines under
`NOWAIT`, rollback of uncommitted quarantine, unique identity
and digest behavior, spoofed fixture authentication, negative
amounts, absent/mismatched requests, and the continuing prohibition
on dispatch from the underlying read-only recovery observer.

**Known limits:** This is an isolation/coordination test, not
authenticated billing reconciliation or a production-approved
incident workflow. The untrusted mock evidence can be fabricated,
omitted or incomplete. It does not establish ZDR, invoice completeness
across all keys, trusted FX, real refund behavior, end-to-end
exactly-once provider semantics, durable database failover,
operator/superuser trust, or account-wide cost authorization.
Actual holds must remain unresolved unless a future independently
audited billing/authorization workflow explicitly proves and
permits changes; this PR does not implement that future release.

## Composite PostgreSQL identity binding in quarantine (synthetic)

An additional defense-in-depth constraint now binds each quarantine
record to the **same (request_id, attempt_id, exact head_sha)** as the
underlying synthetic attempt. The test-only quarantine migration adds
a PostgreSQL UNIQUE triplet constraint to the pre-existing attempts
table, then uses an explicit **composite foreign key** from
`reviewer_b_attempt_shadow.quarantines` to that triplet.

This protects against a future function implementation error that
could otherwise record a correct request ID alongside an incorrect
attempt ID or HEAD. Unlike a procedural equality check, the relation
is checked by PostgreSQL on direct INSERT/UPDATE as well. Foreign-key
checks are **not** proof against a privileged database owner who
can alter schema or disable constraints; operator and superuser trust
remain outside this fixture's security guarantees.

The existing PostgreSQL 16 integration test uses isolated
administrator permissions to deliberately attempt invalid direct
quarantine INSERTs and UPDATEs and mutation of the referenced
parent attempt identity. Mismatches must fail with SQLSTATE
`23503`; a legitimate quarantine with matching identifiers
still succeeds, and all recovery outputs continue to deny
spend/dispatch/retry. The synthetic test does not contact
OpenRouter or validate provider invoices.

A cryptographic-looking digest or a successful relational join
does **not** authenticate an invoice, demonstrate full account/key
coverage, establish exact provider-side idempotency, or justify
releasing a held amount. All production financial and human
approval gates remain unchanged.

## Mock OpenRouter billing evidence coverage and provenance stress test

The standalone `scripts/openrouter-shadow-evidence-coverage-offline.mjs`
and `test/openrouter-shadow-evidence-coverage-offline.test.mjs`
run under the existing synthetic admission GitHub Actions workflow.
They **never** access OpenRouter or private API keys, contact
providers, authenticate invoices, create SQL reservations or
authorize financial or Runner operations.

An explicitly `illustrative-only` JSON input enumerates fictitious
`development` and `reviewer_b` key IDs; key active/retired
UTC-month periods; simulated request IDs and initiation months; and
statement-like fixtures labeled `unverified-fixture` with
SHA256-*format* digests and request IDs. The tool checks strict
bounded schemas, unique IDs/digests, key lifecycle bounds, a
maximum 12-calendar-month simulated window, missing key-month
entries, mismatched key/attempt identities, orphan invoice
references, monthly duplicates and charges appearing before
requests. Partial or delayed billing across UTC months does not
automatically clear an ambiguous request.

The diagnostic reason is one of:
- `SHADOW_COVERAGE_MISSING_KEY_MONTH_FIXTURES` when a declared
  key-month fixture is absent;
- `SHADOW_COVERAGE_UNMATCHED_REQUEST_FIXTURES` when a declared
  synthetic request has no matching fixture;
- `SHADOW_COVERAGE_ALL_FIXTURES_STILL_UNVERIFIED` when every
  **supplied** illustrative key-month and request lines up.

All three outcomes remain **BLOCKED**:
`verified=false`, `maySpend=false`, `mayReserve=false`,
`mayRetryAmbiguousRequest=false`, `mayReleaseHold=false`,
`providerBillingAuthenticated=false`,
`accountCoverageAuthenticated=false`,
`keyInventoryAuthenticated=false`,
`statementProvenanceAuthenticated=false` and
`fxAuthenticated=false`. Malformed, duplicate, forged-authority
and out-of-window fixtures fail closed without usable exposure
summaries. The dedicated synthetic suite currently contains
**14 negative/positive test cases**. A result that looks internally
complete is *not* provider-backed reconciliation.

**Fundamental source limitation:** the inventory is supplied by
the fixture itself. A malicious or incomplete source could omit a
whole key, expired/rotated key, organization, client, invoice,
adjustment, refund, pending charge or month. This model **cannot
discover omitted provider accounts** or independently know that
a statement is signed, issued by OpenRouter or complete. SHA256
syntax is not signature verification. A statement naming zero
requests cannot prove zero financial liability. Even perfectly
consistent mock monthly statements are not a trustworthy billing
watermark, nor a valid basis for releasing any hold.

A *future* separately approved implementation would require an
authenticated provider-side account/organization inventory
including rotated/retired keys, independent receipt provenance,
provider request correlation, bounded late invoice delivery,
immutable audited completeness watermarks, trusted FX and
durable treatment of missing or ambiguous charges. No such
production verification or payment authority is implemented here.

## Longitudinal synthetic billing evidence continuity

The existing `scripts/openrouter-shadow-evidence-coverage-offline.mjs`
now also exports `assessSyntheticEvidenceContinuityOffline(previousJson,
currentJson)`, with tests in its existing isolated suite. Both inputs
are strictly validated with the original bounded coverage parser before
comparison. This is **not** a provider API integration and produces no
network traffic, private credentials or billing authorization.

A later fixture must keep the same start month and not retract the
observation window; preserve all previously declared key IDs, key
roles and creation months; preserve earlier request identities and
unverified states; and preserve all previous statement IDs, digests,
periods and request references. Discovery of a supposedly preexisting
key, previously omitted request or previously missing statement is
flagged explicitly as a retrospective coverage problem. A newly
documented retirement is allowed only if it does not rewrite the
already-observed prior window.

An apparently continuous inventory returns
`SHADOW_CONTINUITY_STABLE_BUT_UNVERIFIED`, **never VERIFIED**.
Retractions, silent reclassification from `ambiguous` to
`settled_fixture`, missing records and replaced digests are
fail-closed. This only detects inconsistencies between *supplied*
fixtures; two equally fabricated, consistently incomplete snapshots
still appear internally consistent. No automatic hold release, paid
retry or spending follows any outcome.

## Official OpenRouter billing evidence — read-only design preflight

The following are **public documented API capabilities**, not data
actually obtained from the user's OpenRouter account. The future
production design MUST remain blocked until independent, authenticated
scope, provenance and financial completeness have been demonstrated.

1. `GET /api/v1/keys` can list API keys using a **management key**.
   Its documented list has an `offset` pagination parameter and an
   `include_disabled` option. A `workspace_id` filter exists; the
   default is only the **default workspace**. A caller MUST account
   for paging, disabled/rotated keys and every relevant workspace,
   not silently equate one default-workspace page with a complete
   account inventory.
   Source: https://openrouter.ai/docs/api/api-reference/api-keys/list
2. `GET /api/v1/keys/:hash` returns details about a particular
   identified key; `GET /api/v1/key` describes only the **current
   authenticated key**. Neither call alone enumerates all historical
   keys and workspaces.
   Sources: https://openrouter.ai/docs/api/api-reference/api-keys/get-key
   and https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key
3. `GET /api/v1/credits` exposes `total_credits` and
   `total_usage` for an authenticated user and requires a management
   key. These aggregate amounts are **not** a signed, complete
   per-request invoice, an authenticated EUR exchange rate or a
   proof of absence of delayed charges.
   Source: https://openrouter.ai/docs/api/api-reference/credits/get-credits
4. `GET /api/v1/generation?id=...` provides metadata and cost for
   a **known generation ID**, including example `request_id` and
   `total_cost` fields. This does not prove that every failed,
   timed-out or never-acknowledged request is enumerable. A failed
   lookup or HTTP timeout must not establish zero liability.
   Source: https://openrouter.ai/docs/api/api-reference/generations/get-generation
5. OpenRouter documents spending guardrails at key/member scope,
   including USD budget limits. The described enforcement is
   per-key and per-user, **not** a single transactional DevFactory
   budget across arbitrary independent keys, accounts and roles.
   Source: https://openrouter.ai/docs/guides/features/guardrails/overview

**Future authenticated reconciliation prerequisites (NOT implemented):**
identify the authorized provider account and all relevant workspaces;
obtain an independently approved management identity through a
protected secret store; enumerate and paginate all entitled key
inventories including disabled keys; securely bind each known
request/generation to its issuing key and original immutable HEAD;
record independently authenticated billing and adjustments with
time-bounded completeness/late-arrival semantics; never treat
missing generation records as unbilled; reconcile unsettled holds,
global USD exposure and trusted USD/EUR FX with conservative rounding;
separately verify privacy/ZDR and actual provider-side idempotency.

**No public documentation examined here establishes that the
above combination is already complete, atomic or sufficient
for a real global spend gate.** The present preparatory work
does not create a management key, call any private endpoint, view
actual balances, assume supported paid-request retries, or grant
HUMAN_GO / MERGE_GO / deployment / Runner privileges.

## Read-only OpenRouter acquisition preflight — explicitly non-executable

`scripts/openrouter-shadow-readonly-acquisition-plan-offline.mjs`
and `test/openrouter-shadow-readonly-acquisition-plan-offline.test.mjs`
extend the **existing PR #73** and existing synthetic admission CI.
They validate an illustrative, strictly bounded **JSON design
manifest**, not a real OpenRouter response and **not an HTTP client**.
A valid manifest still returns `BLOCKED` and cannot authorize
network access, money, deployment, retries, hold release, or Reviewer B.

The mock manifest has `transport:"no-network"`,
`scope:"illustrative-only"` and a credential marked
`management-key-capability / not-provisioned / none`, with no secret.
Its only recognized hypothetical GET operations are:
- exact path `/api/v1/keys`, separate illustrative workspace,
  explicit `include_disabled:true`, monotonic page offsets
  starting at zero;
- exactly one exact-path `/api/v1/credits` aggregate read.

All other operations, methods, paths, dynamic URLs, headers, tokens,
request bodies, omitted workspaces, duplicate/unsorted pagination,
false `include_disabled`, fabricated credentials or authority
claims are rejected. The output does **not** contain a runnable URL,
request payload, bearer token, or provider credential. Even complete
fixture pagination returns
`SHADOW_READONLY_STRUCTURAL_PLAN_ONLY` with
`managementCredentialPresent=false`,
`providerDataFetched=false`,
`readOnlyEnforcedInProduction=false`,
`accountCoverageAuthenticated=false`,
`mayReadProviderData=false`, `maySpend=false`,
`mayReserve=false`, `mayRetryAmbiguousRequest=false`,
`mayReleaseHold=false`, `mayMutateProvider=false`, and
`mayDeploy=false`.

**Critical distinction:** OpenRouter documents a management key
for the `GET /api/v1/keys` and `GET /api/v1/credits`
endpoints. A management key must **not** be treated as an
intrinsically read-only credential: OpenRouter also documents
management-key operations that can update or delete keys.
A future design would require a protected, audited **GET-only
egress boundary** and a separately approved secret store. Neither
exists in this PR; no management key is created, activated, requested,
injected into CI, or used here.

Official references (public schema descriptions only):
- https://openrouter.ai/docs/api/api-reference/api-keys/list
- https://openrouter.ai/docs/api/api-reference/credits/get-credits
- https://openrouter.ai/docs/api/api-reference/api-keys/update-keys

Before real access, separately establish user authorization,
trusted account and workspace ownership, all-workspace and
disabled/retired-key inventory, bounded pagination exhaustion,
provider identity/authenticity, response signing or an appropriate
trusted channel, redaction and zero-secret logging, rate-limit
handling (including 401/403/429/5xx), a strictly outbound
GET-only allowlist, testable revoke/rotation behavior, consistent
UTC accounting windows and independently reliable completion
watermarks for late charges or refunds. **An inaccessible page,
incomplete inventory, unknown generation or API failure is not
evidence of zero cost.** No real provider balance or expenditure
is claimed verified.

This synthetic manifest is **not** a deployable service, a
substitute for invoice authentication, or permission to start
paid traffic. The real spend gate stays BLOCKED, as do the
human MERGE_GO/HUMAN_GO and Runner gates.

## Threat model for a future isolated management-key GET proxy (synthetic)

The same **non-executable** offline module,
`scripts/openrouter-shadow-readonly-acquisition-plan-offline.mjs`,
now has a pure `assessSyntheticProxyBoundaryOffline` validator,
with **14 additional adversarial tests** in the existing test file
(28 total for that suite). It does **not** instantiate an HTTP
client, fetch account data, store keys, validate real TLS or modify
the protected real Publisher, Runner or spend gate.

### Trust boundaries and attack paths

1. **Caller -> narrow read capability.** A caller may select only
   the symbolic `keys` or `credits` read operation. The
   validator rejects verbs other than GET, arbitrary paths, host,
   query, port, URL, headers, request body, dynamic endpoints,
   workspace injection and unsafe key-list offsets. This is a
   *structural fixture test*, not authorization of an actual GET.
2. **Proxy -> provider network.** A real design must use a fixed
   upstream endpoint, strict TLS validation and an independently
   enforced network egress policy. Disable redirects and ambient
   HTTP proxy settings, and defend against DNS rebinding,
   host/SNI disagreement, IP literal/private subnet destinations,
   redirect credential forwarding, request smuggling and arbitrary
   resolver/proxy configuration. The fixture only rejects symbolic
   deviations: it does **not** pin DNS, verify certificates, inspect
   sockets or demonstrate real SSRF prevention.
3. **Proxy -> management credential.** A management key has
   administrative capability and cannot safely be regarded as
   read-only on its own. A future service requires a separately
   authorized secret store, narrow process identity, no caller
   access to the secret, a nonbypassable GET-only egress boundary,
   revocation/rotation procedure and zero secret propagation to
   logs, errors, traces, telemetry or downstream clients. The
   fixture requires **no provisioned token or vault connection**.
4. **Provider -> proxy response.** Test fixtures refuse 3xx
   redirects, secret markers, non-JSON success payloads,
   empty success payloads, oversized/invalid response metadata,
   malformed fields and untrusted extra headers/body declarations.
   HTTP 401/403/404/408/409/429/5xx and unknown responses all
   mean **unresolved**, never a zero-cost or complete invoice.
   Production must add actual response body/schema validation,
   maximum response decompression limits, trusted provenance,
   robust throttling and a conservative failure circuit.
5. **Proxy -> audit, billing and dispatch.** Raw authorization
   headers, sensitive response bodies, unredacted provider
   identifiers and automated replay are forbidden in the
   synthetic audit contract. A future operator must enforce
   append-only redacted audit records and reconcile historical
   provider usage with all workspaces, revoked keys, late charges
   and independent financial holds. No error, absence, apparent
   GET success or forged test fixture permits paid dispatch,
   retry of an ambiguous request or release of held funds.

### Observed mock results and unproven obligations

GitHub's disposable synthetic admission workflow now exercises
**28/28** acquisition-plan plus proxy-boundary tests, including
the 14 new attack cases. Even a structurally matching fixture
returns `BLOCKED`, with
`managementCredentialPresent=false`,
`providerDataFetched=false`,
`readOnlyEnforcedInProduction=false`,
`accountCoverageAuthenticated=false`,
`mayReadProviderData=false`,
`mayMutateProvider=false`, `maySpend=false`,
`mayReserve=false`, `mayRetryAmbiguousRequest=false`,
`mayReleaseHold=false`, `mayDeploy=false`, plus
`proxyDeployed=false`, `actualEgressRestricted=false`,
`secretRedactionVerified=false` and
`providerResponseAuthenticated=false`.

A JSON manifest cannot prove real firewall egress restrictions,
secret-store isolation, actual authentication, billing correctness,
network-level TLS/redirect/DNS behavior, rate-limit responses,
privacy guarantees or tamper-evident operations. Those require
independent real-world testing, explicit approvals, and a later
separately scoped implementation. **This PR is not an operational
proxy, and no key should be introduced into this synthetic CI.**

## Mock GET-proxy incident decision table — NO AUTOMATIC RETRY

A third, pure `assessSyntheticProxyIncidentOffline` function
in the **existing** synthetic read-only plan module classifies
strictly bounded JSON fixtures. The test file now exercises
**42 tests total (14 new incident cases)** inside the existing
synthetic admission workflow. These observations are
**not live OpenRouter HTTP responses** and do not grant
network, deployment, payment or spending authority.

| Untrusted fixture scenario | Simulation-only incident classification | Required future handling |
| --- | --- | --- |
| 401 | `AUTHENTICATION_REVIEW` | Human credential/rotation investigation, no automatic retry |
| 403 | `AUTHORIZATION_REVIEW` | Human scope/permission investigation, no privilege escalation |
| 429, any `retryAfterSeconds` | `RATE_LIMIT_MANUAL_REVIEW` | Do not schedule another call solely from untrusted Retry-After |
| 500/502/503 or other 5xx | `PROVIDER_FAILURE_UNKNOWN` | Preserve uncertainty; don't mark charges as absent |
| DNS, TLS, timeout, reset | `NETWORK_UNKNOWN_NO_RETRY` | Treat connection/response as unconfirmed |
| 3xx or redirect | `REDIRECT_FORBIDDEN` | Never forward management credentials to redirect |
| Truncated payload, invalid JSON, incomplete response | `RESPONSE_INCOMPLETE` | Preserve missing/incomplete evidence rather than 'zero use' |
| Unexpected secret marker | `SECRET_EXPOSURE_REVIEW` | Investigate exposure and rotate/revoke through separately approved channel |
| Unexpected raw logs, auto retry, automatic held-fund release, Runner auto resume | `AUDIT_OR_AUTOMATION_FORBIDDEN` | Deny direct action and require independent review |
| HTTP 200 / JSON shape and complete fixture | `200_UNVERIFIED_NOT_SETTLED` | Still cannot authenticate source or prove financial completeness |
| 204/404/408/409 and other non-200 | `OTHER_STATUS_UNRESOLVED` | Do not assume unbilled, missing key or settled outcome |
| Untrusted fields, event/status mismatch, oversized input | `FIXTURE_UNTRUSTED` / `EVENT_STATUS_CONTRADICTORY` | Reject the simulated incident without silently normalizing it |

All branches return `BLOCKED` with
`mayReadProviderData=false`, `mayMutateProvider=false`,
`maySpend=false`, `mayReserve=false`,
`mayRetryAmbiguousRequest=false`, `mayReleaseHold=false`,
`mayDeploy=false`, `simulatedBillIsSettled=false`,
`automaticRetryScheduled=false` and
`simulatedProviderEvidenceVerified=false`.
The classifier is not imported by the paid protected Publisher
or its real spend gate.

**Explicit limits and future requirements:** This is a design
table tested against hypothetical status codes, not proof of
a safe production retry scheduler, trustworthy Retry-After,
provider-side idempotency, response authentication,
secret-redacted telemetry, immutable incident audit, token
revocation, billing completeness, incident notification or
all-account reconciliation. A real GET may be technically
retryable, but only a separately authorized and tested
production policy could decide so; no mock result here
permits *any* automatic repeat. Any ambiguity related to
billable upstream work must remain in financial quarantine.
No management token, provider connection or alerting
integration is deployed in this PR.

## Synthetic redacted incident audit proposals and human resolution dependencies

`assessSyntheticIncidentAuditOffline` and
`assessSyntheticIncidentAuditContinuityOffline` extend the existing
**offline-only** read-only-proxy design module, with adversarial tests
in the same synthetic suite. **They do not create or persist a real
audit log.** No provider GET, paid inference, cryptographic signature,
database transaction, secret store, review submission, notification,
automatic release or privileged service is involved.

The bounded illustrative schema binds each incident to a mock
`incident_id`, exact 40-character hexadecimal Git `head_sha`,
64-character mock request digest and `development` or `reviewer_b`
key role. It allows only predeclared redacted event fields:
- a 1-based contiguous `sequence`, unique mock `event_id`,
  canonical UTC-second timestamp and type;
- `detected` first, then one `triaged`, optionally
  `evidence_noted` carrying unique SHA256-*format* digest(s),
  optionally a terminal `manual_review_requested`;
- a fixed `review` object with only `status:"pending"`
  and explicit `providerEvidenceAuthenticated:false`,
  `independentReviewerApproved:false`,
  `humanGoGranted:false`, `holdReleaseApproved:false`.

The strict mock validator rejects credentials, Authorization headers,
raw HTTP bodies, raw provider IDs, personal data and freeform comments
as unknown input fields. Duplicate event IDs/evidence digests,
noncontiguous sequence, malformed calendar times, time regressions,
invalid state transitions, forged human approvals and excessive input
all fail closed. Digest syntax is not evidence authentication and
does not prove that the underlying incident has actually been logged.

Comparing two fully validated mock snapshots detects removed or
rewritten event prefixes and changed incident/request/HEAD identity.
It can label newly appended events, but an apparently immutable
comparison remains **unverified**: if both inputs are forged in the
same way or durable logs are lost, this pure function cannot detect it.
The proposed terminal review-request event is deliberately not
treated as a close/approval event.

### Requirements for eventual human handling (not yet implemented)

The actual incident procedure would need (1) an independently
authenticated operator identity and separation of duties,
(2) tamper-evident durable append-only records including an
independently trusted clock, (3) minimum necessary, secret-redacted
request linkage and restricted evidence access, (4) accurate
provider-authenticated incident and charge reconciliation with
all relevant keys/workspaces, (5) documented independent Reviewer B
review and explicit scoped HUMAN_GO for any sensitive real action,
and (6) an entirely separate authorization mechanism for any
budget/hold release or production deployment. A native COMMENTED
review, synthetic digest, manual-review request, or operator's
unverified note does not satisfy those controls.

**Every simulation response remains BLOCKED:** `maySpend=false`,
`mayReserve=false`, `mayRetryAmbiguousRequest=false`,
`mayReleaseHold=false`, `mayDeploy=false`,
`incidentMayBeClosed=false`,
`actualAppendOnlyAuditVerified=false`,
`actualHumanApprovalVerified=false`,
`actualProviderEvidenceVerified=false`,
`automaticIncidentResolution=false`,
`automaticRetryScheduled=false`.
The real spend gate and real protected Publisher remain untouched.
This preparation MUST NOT be described as a deployed "secure audit
journal" or an authorized incident resolution workflow.

## Offline SHA-256 audit self-anchor: internal consistency, NOT authenticity

The new **test-only** `scripts/openrouter-shadow-audit-anchor-offline.mjs`
and `test/openrouter-shadow-audit-anchor-offline.test.mjs`
extend the SAME PR #73 and existing synthetic admission workflow.
The offline `assessSyntheticAuditAnchorOffline` function parses
a bounded, strictly redacted incident and checks an ordered hash chain
over the original incident identity, exact SHA, role, event sequence,
event type, canonical UTC timestamp, evidence digest and predecessor
hash. The hash uses Node's SHA-256 over a domain-separated,
positional JSON array. The first predecessor is fixed to 64 zeroes.

The mock checkpoint merely repeats the final chain digest and must
declare `kind:"self-declared-fixture"`,
`witness:"unverified-fixture"`,
`externalProofAuthenticated:false`, and
`durableStoreVerified:false`. Strict validation of events reuses
the existing redacted incident-audit schema, preserving an incident
identity, constrained event progression and pending-only human review.

An unchanged root with an edited event, broken predecessor or
mismatched checkpoint is rejected. The separate suite includes
**13 passing cases** on chain links, event history, confidential
field injection, forged credentials/witness and protected-runtime
non-import. A deliberately **forged-and-fully-rehashed** incident
also passes internal consistency, but *still returns BLOCKED*.
Similarly, dropping the final event and constructing a new root
cannot be distinguished without an independently authenticated
external checkpoint. That counterexample is an explicit assertion
in CI, NOT a security capability or permission to proceed.

All outcomes retain `verified:false`,
`externalWitnessAuthenticated:false`,
`durableJournalVerified:false`,
`independentReviewerApproved:false`,
`actualHumanGo:false`, `actualMergeGo:false`,
`maySpend:false`, `mayReserve:false`,
`mayRetryAmbiguousRequest:false`,
`mayReleaseHold:false`, `mayDeploy:false`,
`mayStartRunner:false` and `mayCloseIncident:false`.

### External witness and anti-tamper requirements (future, NOT implemented)

A credible real incident audit would require an independently
controlled append-only sink or external trusted witness **outside
the same mutable PR, test runner and database administrator trust
domain**, with an authenticated, revocable signer/witness identity;
a trusted timestamp; an auditable retention/restore policy; and
a non-equivocating checkpoint binding exactly the incident,
request identity, key scope, HEAD, event count and final digest.
Tests must cover forks, missing checkpoints, rewritten prefixes,
partial durable writes, delayed replication, key rotation/revocation,
witness unavailability, tampered clocks and reader permission
isolation. Existence of a matching SHA-256 string in GitHub is not
an external checkpoint, and the current CI is not such a witness.
None of these prerequisites is delivered or assumed operational.

## Reviewer B — independent approval evidence checklist (NO-GO until all verified)

Before any change in readiness or human gates, an independently
authorized reviewer must see and verify **all applicable evidence**:

1. **Exact immutable scope:** open PR #73, branch identity,
   SHA of the exact last HEAD, all changed files and the explicit
   single-LOT scope. Any subsequent HEAD change invalidates any
   old SHA-bound attestations.
2. **Native independent Reviewer B approval:** an authenticated,
   reviewer-authorized GitHub identity, isolated from the developer
   or any untrusted model comment, submits a native review with
   state `APPROVED` bound to the exact last HEAD and appropriate
   required checks/branch policy. A `COMMENTED` advisory from
   `gemini-code-assist` is **not** this approval. No synthetic
   manifest can impersonate it.
3. **Exact-HEAD CI:** all required workflows complete SUCCESS
   at the very same SHA, including PostgreSQL16 concurrency tests.
   The synthetic `Reviewer B - Runner Smoke Test` is **not**
   evidence that a production Runner was started or validated.
4. **Actual security isolation:** separately reviewed and tested
   service identity, management-key vault, protected GET-only
   egress, TLS/DNS/redirect protections, ZDR/privacy assessment,
   redacted and independently witnessed audit records, and
   nonbypassable durable transaction boundaries. All of these
   remain unproven by the offline fixtures.
5. **Real provider billing and idempotency:** authenticated,
   complete multi-key/workspace inventory and provider charges,
   late adjustments, cross-run atomic reservations, settled
   and unknown liabilities, protected per-request identities and
   real trusted FX, with an independently reviewed maximum
   monthly exposure. **Real spend gate must remain BLOCKED**
   until an actually implemented and authorized policy exists.
6. **Separate owner/human decisions:** explicit `HUMAN_GO`
   before a real execution, **exact SHA `MERGE_GO`** before
   any merge, and later `ZERO_CURSOR_GO` after local MSI
   requalification. No comment, offline test or shorthand
   `enchaine` replaces these permissions.

**Observed on this PR as of this preparatory LOT:** the native
independent Reviewer B `APPROVED` review is still missing, the
live spend gate is still BLOCKED, and no real network, paid service,
production witness, Runner or MSI check occurred. Some checklist items, such as the exact-HEAD synthetic CI, can be independently verified; **critical production prerequisites remain unmet**. This document is not a reviewer sign-off.
A genuinely authenticated read-only evidence service is a future
separately scoped decision; this PR never provisions its secrets.

## Witness outage, key rotation and fork incident drills (OFFLINE ONLY)

The existing `scripts/openrouter-shadow-audit-anchor-offline.mjs`
now includes `assessSyntheticWitnessIncidentOffline`. The
existing `test/openrouter-shadow-audit-anchor-offline.test.mjs`
includes 20 additive adversarial scenarios; the existing synthetic
admission workflow executes the tests on the PR's exact HEAD.
**This is a pure classifier of attacker-controlled fixture JSON**,
not a deployed witness, not a signing service, not durable storage,
not an authenticated external trust anchor and not a notification
or recovery executor.

### Mock checkpoints and fail-closed outcomes

An illustrative incident contains the strictly validated
SHA-256-chained incident audit fixture, a self-declared witness
identifier/source/availability, and earlier/candidate checkpoints
with claimed chain sequence, root hash, key epoch, key ID and
`active`/`revoked` status. The only permitted review fields
must explicitly declare that an independent signature, witness
isolation, operator approval and hold-release approval **have NOT
been verified**. The existing local audit-anchor validator first
rejects any malformed, unlinked or rewritten mock chain.

| Synthetic failure case | Offline diagnostic | Future human/escalation dependency |
| --- | --- | --- |
| No witness response | `SHADOW_WITNESS_OUTAGE_MANUAL_ESCALATION` | Record unresolved case, use separately authorized incident channel |
| Witness timed out | `SHADOW_WITNESS_TIMEOUT_NO_AUTO_RETRY` | Never infer missing charge or schedule automatic replay |
| Claimed outage with concurrent candidate proof | `SHADOW_WITNESS_AVAILABILITY_CONTRADICTORY` | Reject inconsistent incident report |
| Previous checkpoint disagrees with local entry | `SHADOW_WITNESS_PRIOR_FORK_SUSPECTED` | Investigate fork or rewritten local evidence |
| Candidate root diverges at a known height | `SHADOW_WITNESS_DIVERGENT_ROOT_FORK` | Independent operator examines conflicting roots and witness attestations |
| Candidate height decreases | `SHADOW_WITNESS_CHECKPOINT_REPLAY` | Treat replay/downgrade as unresolved |
| Candidate checkpoint is beyond local chain | `SHADOW_WITNESS_FUTURE_CHECKPOINT_UNBOUND` | Require verifiable log synchronization and external proof |
| Candidate is behind current log | `SHADOW_WITNESS_STALE_CHECKPOINT` | Do not assume newer events or liabilities have been witnessed |
| Previous/current signer revoked | `SHADOW_WITNESS_REVOKED_PRIOR_KEY` / `SHADOW_WITNESS_REVOKED_CURRENT_KEY` | Verify authenticated revocation and checkpoint validity periods externally |
| Epoch regresses or key changes at unchanged epoch | `SHADOW_WITNESS_KEY_EPOCH_REGRESSION` / `SHADOW_WITNESS_UNEXPLAINED_KEY_CHANGE` | Review signer rollback or substitution |
| Key epoch advances | `SHADOW_WITNESS_ROTATION_UNAUTHENTICATED` | Independently verify signed key-rotation chain and revocations |
| All mock checkpoints and local roots agree | `SHADOW_WITNESS_MATCHING_FIXTURES_NOT_AUTHENTIC` | Consistency alone is **not** independent witness authentication |

**Explicit negative demonstration:** the test deliberately
rewrites an event, rebuilds the full SHA-256 chain and updates
both supposed witness checkpoints. The internally matching
objects are still classified **NOT AUTHENTIC**. The caller
can forge every fixture including signer IDs and epochs,
or omit a compromised witness entirely. SHA-256 shape and
self-consistency are not a witness signature, a public
transparency log or non-equivocation proof.

Every result keeps `status:BLOCKED`,
`externalWitnessAuthenticated:false`,
`providerEvidenceAuthenticated:false`,
`durableJournalVerified:false`,
`independentReviewerApproved:false`,
`maySpend:false`, `mayReserve:false`,
`mayRetryAmbiguousRequest:false`,
`mayReleaseHold:false`, `mayDeploy:false`,
`mayStartRunner:false`, `mayCloseIncident:false`.
It also reports `checkpointSignatureVerified:false`,
`trustedWitnessKeyEpochVerified:false`,
`independentWitnessReachableVerified:false`,
`realIncidentEscalated:false` and
`automaticReplayScheduled:false`.
No simulated incident opens a GitHub PR, writes a persistent
event, sends a notice or authorizes an action.

### Still needed before any real witness could be trusted

A separately authorized design must place the witness outside
the original operator/database/runner trust domain; use genuine
cryptographic signatures with independently pinned signer
identity and secure rotation/revocation history; authenticate
timestamp and key epoch at the actual event date; reject replayed,
missing, forked or non-monotonic checkpoints; preserve an
append-only, independently retained history; and define outage
handling, quorum/non-equivocation, durable retransmission
policies, incident escalation with human identity and audit access.
All of that requires independent threat review and real integration
tests—not the currently isolated, self-declared mock objects.

Any real paid OpenRouter attempt with ambiguous billing
**remains in quarantine** independently of this hypothetical
witness's availability or apparent health. Neither a perfectly
matching witness fixture nor an approved source-code review
alone can release exposure, enable spending or start the Runner.

## Offline multi-witness cross-check — quorum spoofing and disagreement

`scripts/openrouter-shadow-audit-multiwitness-offline.mjs`
now exposes `assessSyntheticMultiWitnessOffline` for
strictly controlled **mock-only** cross-checks of a redacted local
incident SHA-256 chain against two to six *self-declared* witness
identifiers and mock observations. Its own 19-case adversarial test
suite is run by the existing synthetic GitHub workflow at exact PR HEAD.
No provider data is fetched; there are no actual independent witnesses,
cryptographic signatures, external logs, servers, payments or privileged
operations.

The schema demands an illustrative-only, no-network scope; distinct
declared mock witness IDs; each untrusted observation's fixed
allowlisted fields (claimed custodian, fake origin, availability,
and, when available, checkpoint sequence, SHA-256-format root, signer
ID, key epoch, key status, signature status `not-verified`).
The mock human-review fields explicitly deny authenticated signatures,
custody and approvals. The strict existing incident hash-chain fixture
must validate before any comparison.

| Simulated observation | Conservative result |
| --- | --- |
| Two witnesses give different roots at the same event height | `SHADOW_MULTI_WITNESS_SAME_HEIGHT_FORK` |
| A witness's checkpoint differs from the local journal at its own height | `SHADOW_MULTI_WITNESS_LOCAL_ROOT_DIVERGENCE` |
| Claimed witnesses share a declared custodian | `SHADOW_MULTI_WITNESS_CUSTODY_COLLISION` |
| A member is omitted from the declared mock set or reports outage/timeout | `SHADOW_MULTI_WITNESS_DECLARED_MEMBER_MISSING` / `SHADOW_MULTI_WITNESS_OUTAGE_NO_QUORUM` |
| Invalid/synthetic signer status, unverified rotation | `SHADOW_MULTI_WITNESS_REVOKED_SIGNER` / `SHADOW_MULTI_WITNESS_ROTATION_UNAUTHENTICATED` |
| An event height is beyond the local log, or a checkpoint is stale | `SHADOW_MULTI_WITNESS_FUTURE_CHECKPOINT` / `SHADOW_MULTI_WITNESS_STALE_CHECKPOINT` |
| All invented witness records and roots match | `SHADOW_MULTI_WITNESS_MATCH_ONLY_NO_AUTHORITY` |

**Critical negative test:** an attacker may forge the original incident,
fully recompute its SHA-256 chain and supply matching fictitious roots
from all three invented witnesses. Such an internally consistent set
still returns `BLOCKED`, with
`independentWitnessesAuthenticated:false`,
`independentCustodyVerified:false`,
`externalSignaturesAuthenticated:false`,
`checkpointQuorumAuthenticated:false`,
`providerEvidenceAuthenticated:false`, `maySpend:false`,
`mayReserve:false`, `mayRetryAmbiguousRequest:false`,
`mayReleaseHold:false`, `mayDeploy:false`,
`mayStartRunner:false`, `mayCloseIncident:false`.
Distinct *claimed* custodians are NOT proof of genuine separation
or non-equivocation, and matching SHA-256 values are not receipts.

Actual independent cross-witness assurance would require an externally
authenticated and fixed witness membership roster, independently
controlled signing and storage, authenticated key epochs and revocation,
signed checkpoints bound to a trusted time and incident identity, a
non-equivocation/consistency protocol and a provable quorum model.
A real out-of-domain incident alert and controlled remediation process
would also be separately approved and verified. **None of these is
implemented here**, nor do these tests unblock HUMAN_GO, Reviewer B
native APPROVED, exact-SHA MERGE_GO, ZERO_CURSOR_GO, paid spending or
the real Runner.

## Witness roster identity, revocation and delayed replication (synthetic only)

This LOT adds **pure, bounded, offline** `assessSyntheticWitnessRosterOffline`
in `scripts/openrouter-shadow-witness-roster-offline.mjs`, plus
`test/openrouter-shadow-witness-roster-offline.test.mjs` (26 tests)
and a test invocation in the existing synthetic admission workflow.
The module accepts only a strict illustrative JSON description of
two consecutive roster versions, two to six declared replica IDs,
and untrusted observations, all bound to a SHA-format mock HEAD.
It does not contact GitHub, OpenRouter or any witness, write keys,
perform signatures, verify actual membership or grant authority.

**Structural comparison only:**

- Roster entries contain only fixture-format member ID, claimed
  custodian, claimed signer ID, integer key epoch and
  `active`/`revoked` status. Sorted, bounded member arrays are
  required. Member addition/removal or a roster-epoch jump is not
  silently assumed authorized.
- Duplicate claimed current custodians or signer IDs are treated
  as collisions. Changes in a custodian, hidden substitution of a
  signer, signer rotation with a higher epoch but no externally
  authenticated authority, unexplained key-epoch change, and
  revoked-to-active rollback remain blocked.
- Replica identity is **self-declared** and completeness cannot be
  established from the source itself. A replica may offer a
  mock SHA-256 digest of the previous or current version, or
  declare outage/timeout with no digest. Digest construction is
  deterministic, domain-separated and binds the mock HEAD,
  roster epoch, sorted members, custodians, signer IDs and status.
- A prior-epoch replica matching the previous roster signifies
  **delayed propagation**, with a stronger
  `SHADOW_ROSTER_REVOCATION_PROPAGATION_DELAY` signal if a key
  was newly revoked. Contradictory same-epoch digests,
  rollback/future epochs, missing observations, duplicate IDs,
  offline replica with an invented successful receipt and shared
  replica custodians are rejected.
- Even if all replicas report exactly the current digest and
  all claimed member/replica owners are distinct, the result
  remains `SHADOW_ROSTER_MATCHING_FIXTURES_NOT_TRUSTED`.
  Matching mock digests do not prove actual witness identity,
  independent custody, authorization, signer revocation or
  real anti-equivocation.

All results are `BLOCKED` and keep
`rosterAuthorityAuthenticated:false`,
`replicaIdentityAuthenticated:false`,
`independentCustodyVerified:false`,
`externalSignaturesAuthenticated:false`,
`revocationReceiptAuthenticated:false`,
`providerEvidenceAuthenticated:false`,
`mayReadProviderData:false`, `maySpend:false`,
`mayReserve:false`, `mayRetryAmbiguousRequest:false`,
`mayReleaseHold:false`, `mayDeploy:false`,
`mayStartRunner:false`, `mayCloseIncident:false`
and `automaticRetryScheduled:false`.
Tests cover forced approvals and injection of tokens, URLs,
headers, actor details and unsorted/oversized records.

**Requirements this mock cannot satisfy:** Independently
authenticated fixed roster membership, protected key custody,
cryptographic signer rotation and revocation proofs with
effective dates, secure epoch and trusted-clock provenance,
signer key compromise handling, external witness independence,
signed non-equivocating checkpoints, resilient quorum/failure
policies, and durable replica propagation/monitoring.
A production resolution of these requirements must be
separately scoped, reviewed and human-approved. The real
OpenRouter spend gate is **NOT** consulted by this mock and
remains independently BLOCKED. An apparent roster match is
not permission to clear ambiguous liability, pay for tokens,
merge PR #73 or enable the Runner.

## Production blockers still missing

1. Trusted, authenticated billing ledger covering all relevant keys
   and pending/settled charges, with uncertainty bounds and audit trail.
2. Durable cross-process idempotency / reservation coordinator and
   a provider request identity that cannot be silently retried.
3. Protected receiver service with authentic transport identity,
   pinned/revocable verification keys and nonbypassable SQL transaction
   boundaries, including expiry at COMMIT.
4. Authenticated USD/EUR rate source and documented upper-bound rounding.
5. Independently verified data privacy / ZDR, cost permission for exact
   model and HEAD, official Reviewer B assessment, HUMAN_GO,
   exact-SHA MERGE_GO, and later ZERO_CURSOR_GO after local MSI requalification.

**NO-GO SPEND / NO-GO MERGE / NO-GO DEPLOY / NO-GO RUNNER.**
