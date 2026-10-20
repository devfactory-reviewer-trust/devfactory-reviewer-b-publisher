# Authenticated OpenRouter financial-evidence → atomic-reservation handoff contract (DESIGN ONLY)

**20 October 2026 · Reviewer B Publisher PR #73 · no production service · NO-GO SPEND / MERGE / DEPLOY / RUNNER.**

This is a proposed, falsifiable engineering interface, **not** an implemented OpenRouter management client, a provider guarantee, a key provisioning procedure, a spend permit, or a deployed ledger. The user's MSI remains OFF. No real OpenRouter request, account data, credential, independent attestation or budget reservation was accessed. Keep the existing `scripts/openrouter-only-spend-gate.mjs` permanently **BLOCKED** for this PR.

## 1. Boundary and role separation

There are **four distinct trust domains**, not a single trusted JSON blob.

1. **Read-only evidence collector** (future): a separately authorized, server-enforced GET-only service with its *own* non-spending management credential in a secret store; fixed OpenRouter hostname, TLS peer validation, redirects refused, bounded streaming bodies, endpoint allowlist, audited pagination and scope. Its credential must not be exported to CI, PR code, review comments, Publisher env or logs. Each unsupported endpoint/permission must deny; a management key's wider native capabilities must be restricted by an independent GET-only egress enforcement layer.
2. **Independent financial reconciler** (future): consumes collector output, authoritative operator/account/key membership, provider-confirmed unsettled/billed amounts and an authenticated conservative USD→EUR risk bound. Links bills to all relevant request identities, including retired keys, cross-month late adjustments, unknown outcomes and prior reservations. It must distinguish **known zero** from **not observed**; missing evidence stays an unknown obligation, **not** a free amount.
3. **Authenticated reservation coordinator** (future): on a separately approved persistent PostgreSQL service, handles the *combined* budget shared between development and Reviewer B roles, all keys and parallel callers. A request may only become dispatchable after a durable, exact-ID, upper-bound reservation, account-wide exposure reconciliation and atomic transaction completion. The current `reviewer_b_shadow` SQL is a synthetic proposal that intentionally always returns `may_spend=false`; it is **not** the implementation of this domain.
4. **Protected Publisher/paid dispatch** (existing but intentionally dormant): verifies owner exact HEAD + model scope, unique service request and distinct human gates; before any paid model POST it consults the existing **real** `assessAuthenticatedOpenRouterSpendAuthorization` gate. The gate is not to be replaced or relaxed in PR #73. Any future protected handoff requires independently approved end-to-end credentials, verified exact scope and a security review.

All authority must be established in a trusted receiver from authenticated external sources, **never** from a caller-selected `verified`, `maySpend`, `APPROVED`, or `budgetRemaining` field. A matching SHA-256 digest is an integrity hint, not a signature or provider authenticity.

## 2. Proposed versioned inter-service envelopes (not yet code)

A design reviewer should first authorize **v0** with an exact allowlist of serialized fields; descriptions below are requirements, **not** active parsers, API credentials or provider-backed statements.

### 2.1 Evidence batch, produced only by authenticated collector/reconciler

| Field | Proposed contract / rule |
| --- | --- |
| `schema` | `devfactory.financial-evidence.v0`; parsed with strict unknown-field rejection and bounded bytes/pages/rows |
| `producer`, `provenance` | Authenticated mTLS/service identity and externally verified provider account scope; no caller-selected trust label |
| `account_scope_digest` | Scope binds organization/account + complete workspaces + development and reviewer_b keys (including disabled/revoked) and their membership effective intervals; independent inventory source and pagination-exhaustion proof required |
| `request_coverage` | Unique protected request IDs, relevant model, origin key/account and exact UTC-month linkage; unknown request/ambiguous timeout remains unresolved with nonzero conservative worst-case liability, or blocks the entire grant |
| `provider_observations` | Raw provider proof (isolated storage), endpoint/version, HTTP status, scope, cursor, authenticated acquisition time, provider timestamp/settlement watermark and non-redirected host. Zero shown by a dashboard is not a completeness guarantee |
| `billing_bounds` | Upper-rounded booked + pending + delayed/unknown liability by UTC month, inclusive of prior open reservations. Charges crossing months must be attributed by explicit approved accounting policy |
| `fx_and_pricing` | Trusted provider/model price ID, source timestamp and conservative **upper EUR conversion**, not client-supplied floats or unauthenticated pricing assumptions |
| `freshness`, `expires_at` | Independently trusted clock, bounded service-specific expiry and explicit max billing lag; source gaps or past-due expiry invalidate admission |
| `audit_anchor` | Independently witnessed/signed reference to evidence bytes and redacted event log; digest format alone does not authenticate |
| `capability` | **Evidence only.** Batch must never contain spend authority or a raw management token |

Provider endpoints previously surveyed: `GET /api/v1/keys`, workspace enumeration, `GET /api/v1/activity`, `GET /api/v1/credits`. Documentation describes *historical* activity over the last 30 **completed** UTC days, so those views alone cannot authenticate current unbilled work or a complete account-wide pending liability. **The existence and availability of a sufficient official provider evidence/settlement capability is itself an unresolved design dependency.** A rollout must not claim this proposed envelope is presently obtainable.

### 2.2 Reservation request: authenticated source and atomic identity

| Field | Proposed contract / rule |
| --- | --- |
| `schema` | `devfactory.financial-reservation.v0` |
| `request_identity` | Trusted protected service actor, exact `deenkids7-dev/deenkids` repo, PR ID, 40-hex HEAD, approved model ID, role, *one* GitHub service command ID and globally unique paid attempt ID; all revalidated server side |
| `consent_reference` | Independently read **owner** consent for exact PR+HEAD+model+UTC month and third-party private egress. Not a spend grant |
| `evidence_reference` | Pinned authenticated batch digest, source/account coverage, UTC period, expiry and reconciliation watermark; must not permit selective omission of keys or recent costs |
| `quote_upper_micro_eur` | **Positive integer** upper bound calculated by trusted coordinator from current model/token/FX policy, never by an untrusted caller. Must include worst-case usage and risk buffers, cap policy **15,000,000 micro-EUR / UTC month** |
| `idempotency_identity` | Single unique attempt/account/PR+HEAD key used for reservation and dispatch intent; duplicated, retried and cross-month attempts must never create another paid request |
| `client_supplied_authority` | Not accepted. Unknown keys, `approved`, `maySpend`, self-declared signed invoice, stale SHA or competing approval must fail closed |

### 2.3 Reservation / dispatch state machine (future only)

```text
NOT_REQUESTED
  -> VERIFYING (exact HEAD / scope / provider provenance / billing / FX)
  -> DENIED (any unknown, time drift, missing key, stale evidence)
  -> RESERVED_DURABLE (only AFTER atomic transaction + verified evidence)
  -> DISPATCH_INTENT_DURABLE (single fenced token, transactionally linked)
  -> ONE_PAID_ATTEMPT (exactly one, no blind retry)
  -> SETTLED (authenticated provider reconciliation; keep historical audit)

Crash/timeout/unknown provider result -> AMBIGUOUS_HOLD
AMBIGUOUS_HOLD -> NO AUTOMATIC RETRY OR HOLD RELEASE
AMBIGUOUS_HOLD -> operator case + independently authenticated resolution
```

The state machine is **not implemented**. A locally written `RESERVED_DURABLE` record without a trustworthy reconciled budget, provider identity and atomic dispatch fence is not permission to run; the service must be verified as a whole. Reserve **before** any outbound paid request, without a separate process crossing an unfenced TOCTOU gap. Do not automatically "refund" an ambiguous HTTP outcome, even if an eventual provider dashboard shows zero.

## 3. Transactional safety invariant

For the approved UTC accounting period, use conservatively upper-rounded integers in micro-EUR:

```text
authenticated, complete booked exposure
+ conservative unresolved/late billing bound
+ all unconsumed and ambiguous cross-key durable holds
+ new request maximum potential exposure
+ FX / price uncertainty upper buffer
<= 15_000_000 micro-EUR (only if exact owner policy agrees)
```

All terms must have authenticated lineage; an *unknown* bound is a **DENIAL**, never zero. Expiry, identity uniqueness, and the same real provider evidence must be verified at the **transaction's COMMIT** boundary. Enforce an authoritative UTC clock, explicit lock/transaction isolation semantics, cross-run and cross-key uniqueness, no month-boundary loophole, safe recovery after lost commit replies, and a globally fenced dispatch intent. A failed lock should deny, not auto-retry a billable attempt.

A single consumer's fake currency conversion, locally cached balance or successful `reviewer_b_shadow.propose_exposure` result does not establish the inequality. Any real external management key/credentials must remain out of this repository, not merely redacted before commit.

## 4. Mandatory failure matrix (acceptance tests not yet satisfied)

| Failure injection | REQUIRED protected outcome |
| --- | --- |
| Account/workspace/key page omitted or incomplete, including retired key | **DENY**, do not infer zero |
| Management GET timeout/401/403/429/500, redirect, malformed response, oversized page | **DENY**, no privileged retry loop |
| `/activity` has no current-day usage or provider's delayed invoice missing | **DENY** unless an independently authenticated complete upper bound exists |
| Unknown request after 504, connection reset or lost reply | **AMBIGUOUS_HOLD**, never repeat paid POST automatically |
| Two parallel keys / two processes try to reserve same final cents | Only one **transactionally fenced** reservation can succeed at/below cap |
| Credit or FX estimate changes after evidence collection but before COMMIT | **DENY**, recompute from authenticated fresh source in same guarded admission |
| PR HEAD changes, model differs, consent expired, wrong reviewer role | **DENY**, invalidate old SHA-bound evidence |
| Two attempts share a comment ID or protected request identity | **DENY** duplicate; no retry after ambiguous dispatch |
| PostgreSQL restart, lost COMMIT response, failover, restored backup | **DENY until durable state reconciled**, never assume rollback/unbilled |
| UTC period changes mid-reservation, unresolved prior-month charge arrives late | **DENY** until both months' relevant liabilities reconciled |
| Receiver credential compromised, signer revoked, clock drift, witness fork | **DENY**, quarantine and separate human response |
| A test fixture says `verified:true` / `maySpend:true` / `APPROVED` | **DENY** unless independent authenticated real-world proofs and human gates exist |
| Reviewer B's native review is only `COMMENTED` | **NO-GO MERGE**, regardless of green test suite |

The acceptance matrix is a **development backlog**, not a test report. A real fault-injection test must prove its corresponding row *after* an independently authorized receiver and ledger are implemented.

## 5. Release-proof package and human checkpoints

Required external evidence, kept separate from this PR:

1. **Security review:** trust-boundary diagram, threat model, read-only credential isolation and strict network enforcement; signed key/witness revocation plan.
2. **Coverage report:** signed/otherwise independently authenticated provider inventory, historical keys and workspaces, billing settled/pending/unknown and FX provenance; explicit completeness/lag windows.
3. **Database & dispatcher tests:** real multi-process PostgreSQL 16+, atomic reservation+dispatch, failover/crash, COMMIT expiry and unknown-result recovery under bounded concurrency; signed immutable audit.
4. **Exact-HEAD CI + native Reviewer B:** independent authorized Reviewer B `APPROVED` for final immutable SHA, not GitHub `COMMENTED`.
5. **Owner/human:** `HUMAN_GO`, exact-SHA `MERGE_GO`, independently confirmed expense/ZDR/private egress policy, and later `ZERO_CURSOR_GO` only after MSI requalification.

**This design alone cannot satisfy any of these proofs, and it must not be wired to the paid path without a new explicit reviewed LOT.** Current gate: `OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED`; `maySpend:false`; `mayReserve:false`; `mayRetryAmbiguousRequest:false`.

**Final position: NO-GO SPEND / NO-GO MERGE / NO-GO DEPLOY / NO-GO RUNNER.**
