# DevFactory — real Runner startup blockers, dependency order and evidence contract

**2026-10-20 · Publisher PR #73 · STATUS: DRAFT / NO-GO SPEND / NO-GO MERGE / NO-GO DEPLOY / NO-GO RUNNER.**

This is an **implementation plan and audit of existing code**, not a
release plan that grants any authorization. It was prepared remotely with
the owner's MSI **OFF**. It does not read, create or validate any real
OpenRouter credential, actual invoice, approval token or persistent server.
Nothing in this document grants `HUMAN_GO`, `MERGE_GO` or `ZERO_CURSOR_GO`.

## Verified code facts versus unproven production claims

| Area | Grounded present code | Still unproven |
| --- | --- | --- |
| Actual financial stop | `scripts/openrouter-only-spend-gate.mjs` always returns `status:'BLOCKED'`, `maySpend:false`, `mayReserve:false`, `mayRetryAmbiguousRequest:false`, reason `OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED` | All real financial authorization |
| Real Publisher sequence | `scripts/protected-real-openrouter-review.mjs` checks authenticated context, owner consent and unique service-request provenance, **then** invokes real budget gate and refuses unless `budget.verified===true && budget.maySpend===true`; its paid-model call is later | A production-usable approval/identity/reconciliation path |
| Bounded budget proposal | `sql/reviewer_b_shadow_central_pg_v1.sql` uses a 15,000,000 micro-EUR UTC-month ceiling, `FOR UPDATE NOWAIT`, `READ COMMITTED` and duplicate identity checks | Authentication of billing, exact costs, real production transaction authority; SQL responses deliberately never grant spend |
| Database integration tests | Separate ephemeral PostgreSQL 16 multi-client workflow tests lock contention, rollback and counters | Multi-region failover, DB credential custody, durable production deployment or billable outcomes |
| Receiver trust boundary | `docs/OPENROUTER-SHADOW-AUTHENTICATED-RECEIVER-20261020.md` defines a NOLOGIN mock receiver and disposable PostgreSQL test; a real verifier, service and session identity are **not deployed** | Secure real identity and signature verification at COMMIT |
| Billing/coverage/FX/witness | `scripts/openrouter-shadow-*-offline.mjs` and their suites exercise illustrative failures, evidence gaps and forged data | Authenticated full OpenRouter account data, keys/workspaces, settled/pending/late charges, independent rate source and durable audit |
| Independent review | Native PR #73 history shows `gemini-code-assist` **COMMENTED**, not independent Reviewer B `APPROVED` | Authenticated, independent, exact-HEAD Reviewer B approval |
| Model scope | `scripts/openrouter-zdr-executor.mjs` currently allowlists `qwen/qwen3-coder-30b-a3b-instruct` and `qwen/qwen3.6-35b-a3b` | Explicit confirmation of current intended model set, cost and ZDR terms. Do NOT silently replace models |

A **green synthetic test** proves only the exercised test contract;
it cannot turn an unprovisioned management API, unauthenticated invoice,
untrusted fixture, NOLOGIN role or human COMMENTED review into a real
spend permit. The target private repository used in the existing
Publisher path is `deenkids7-dev/deenkids`; this Publisher PR alone
does **not** certify the end-to-end DevFactory Runner's readiness or
identify all required changes in other repositories.

## Priority-ordered P0/P1 hard blockers and acceptance criteria

### P0 — scope, identity and budget policy agreement (decision, not spend)

Before engineering changes, separately confirm the exact approved
OpenRouter-only ceiling (present protected stub: **15 EUR per UTC
month**), keys/workspaces/account coverage, allocation across
development and Reviewer B roles, approved private egress and ZDR,
specific model IDs, protected target, and single active LOT. Owner
consent authorizes a scope but **does not prove available budget**.

**Acceptance evidence:** written scope tied to operator identity, exact
target PR+HEAD+model, monthly period, key roles and explicit approval
duration; adversarial tests must reject stale scope, model mismatch,
forged identities and new HEADs. This is not `HUMAN_GO` for this LOT.

### OpenRouter management API: official read-only evidence capability survey

The official **OpenRouter API reference** documents **separate**
management-key-authorized GET operations:

| Read-only source | Officially documented scope | Critical remaining uncertainty |
| --- | --- | --- |
| `GET /api/v1/keys` ([reference](https://openrouter.ai/docs/api/api-reference/api-keys/list)) | List keys, optional `include_disabled`, `offset`, and `workspace_id` | Default response covers **default workspace**, not automatically every workspace/account. No authorization for future spend. |
| Workspace list ([SDK reference](https://openrouter.ai/docs/client-sdks/go/api-reference/workspaces)) | List workspaces with pagination for the authenticated user; management key required | Must prove inventory completeness, account/organization scope and any missing pages. A submitted workspace list is not independently authenticated by itself. |
| `GET /api/v1/activity` ([reference](https://openrouter.ai/docs/api/api-reference/analytics/get-user-activity)) | Activity grouped by endpoint over the **last 30 completed UTC days**; filter by date or API-key hash | This **does not cover today's in-progress UTC day** and must not be treated as a provider settlement ledger, unknown-request upper bound, or complete historical audit. |
| `GET /api/v1/credits` ([reference](https://openrouter.ai/docs/api/api-reference/credits/get-credits)) | Total credits purchased and used for the authenticated user | No evidence here of a synchronous pre-POST spend reservation, settled versus delayed charges, or EUR-valued monthly outstanding liability. |
| Key-limit update ([reference](https://openrouter.ai/docs/api/api-reference/api-keys/update-keys)) | A **PATCH**, not a safe read; key limits are documented in USD | Key limits and a previously observed balance do not replace a cross-key atomic **EUR 15/month** authorization. No PATCH is performed by this LOT. |

**Source versus inference distinction:** the endpoints, authentication
requirements, workspace-default behavior, 30-completed-day limitation
and USD key limits above come from the referenced provider documentation.
The assessment that these are *insufficient on their own* to prove
safe future EUR spending is a conservative DevFactory security
requirement, **not** a claim that OpenRouter's API contains no other
tools, reports, guarantees or enterprise features. A provider-supported,
audited reservation capability, webhook, official settlements feed,
multi-account reconciliation or other trusted evidence would require
separate verification before being relied upon.

The repo's existing hypothetical
`scripts/openrouter-shadow-readonly-acquisition-plan-offline.mjs`
limits itself to `/api/v1/keys` and `/api/v1/credits`.
It currently does **not** model authenticated workspace enumeration
or `/api/v1/activity`, so its coverage must not be exaggerated.
Adding a future `GET` must require explicit allowlisting,
server-enforced GET-only networking, independent credential
custody, no redirects, fixed host, bounded pages/responses,
safe event logging and separate human/security authorization.
**No management API request or real credential use was made here.**

Nine new regression cases in
`test/openrouter-startup-no-go-contract.test.mjs` pass
hypothetical management-response-shaped objects (including
completely plausible matching keys/activity/credits and fake
sign-off fields) to the **actual** real spend gate and ensure it
still returns `BLOCKED`. They check inability to infer an
authenticated monthly EUR budget from default-only coverage,
completed-day statistics, balances, late billing, currency
guesses, revocation, owner consent, or a shadow SQL proposal.
These tests are negative regressions, **not an implemented
provider reader** or a proof of budget completeness.

### P1 — authentic provider coverage and conservative EUR liability

Build a **separately authorized READ-ONLY**, fixed-endpoint
management-data acquisition path if the official OpenRouter access
model supports it. Do not expose a management credential to CI or
the PR. Independently verify all relevant active/revoked keys,
workspaces, account scopes, pagination, provider usage/charges,
late adjustments, unsettled and ambiguous attempts. A missing
page, HTTP 401/403/429/5xx, network timeout, missing provider proof
or incomplete key inventory must be **UNKNOWN/BLOCKED**, never zero.
Do not silently infer global completeness from the `default` workspace.

**Acceptance evidence:** provider-authenticated provenance tied to
UTC windows and immutable checkpoints; independent test vectors for
missing keys, newly discovered costs, revoked key with late charges,
provider outage, billing delays and duplicate/ambiguous attempts;
controlled log redaction and privileges. No actual account access
was made in this LOT.

The **financial safety inequality** must be defined and enforced
transactionally, with values in conservatively upper-rounded EUR:

```text
account-wide verified billed amounts
+ unresolved/late/ambiguous exposure upper bound
+ concurrent durable reservations
+ new request worst-case upper bound
+ conservative FX / provider-price uncertainty
<= the approved UTC-month cap
```

Unknown or unauthenticated terms **deny** a new paid request; do not
replace them with `0`. Do not retroactively release an ambiguous
liability based only on an HTTP failure or an unverified receipt.

### P1 — durable reservation, idempotency and recovery under faults

The current `reviewer_b_shadow` schema demonstrates a bounded
**proposal**, not a trusted paid reservation or authenticated usage.
A separately reviewed implementation would need one durable,
authenticated coordinator for **all keys, processes and models**,
server-side UTC time, `READ COMMITTED` / explicit locks or an
equivalent proven serializable design, unique protected request IDs,
budget holds recorded **before** egress, and an idempotency identity
usable for provider-side unknown outcomes. Do not send a second
billable request on an ambiguous/timeout outcome.

**Acceptance evidence:** real, isolated multi-session PostgreSQL
fault tests for simultaneous callers, duplicate dispatch, process
crash before/after commit, lost reply, failover/restore, month
rollover, time-of-check/time-of-use, stale snapshots, transaction
expiry checked at COMMIT, and non-release of unresolved holds.
Counter + ledger + dispatch states must reconcile after recovery;
an in-memory mutex, mock SQL result or successful proposal is
insufficient. **Never switch `maySpend` to true as a test shortcut.**

### P1 — protected receiver and signature/transport verification

Implement a separately authenticated, non-bypassable ingress
service with narrow service identity, vetted trust anchor and key
rotation, verified PR+HEAD/owner consent and anti-replay challenge.
Require a protected invoker/receiver with least privilege,
immutable audit, TLS/egress policy, bounded transaction lifetime,
and **expiry at transaction COMMIT**. The existing disposable
NOLOGIN role and in-memory `fetchImpl` are not that service.

**Acceptance evidence:** tests of unauthorized connections,
role escalation, forged signatures, key revocation, stolen/stale
challenge, wrong target HEAD, transaction replay, COMMIT after
expiry and witness/DB outage; independent security audit and
operational credential-custody approval. Do not deploy or
provision real credentials within PR #73.

### P1 — production cost and data policy

Obtain source-authenticated current model pricing, independent
USD→EUR conservative conversion (if needed), bounded
worst-case output, actual permitted ZDR/provider routing/privacy
status and charges reconciliation. Verify whether the two Qwen
IDs currently allowlisted are the intended policy; another
model must not be silently enabled without separate approval
and test scope.

**Acceptance evidence:** dated, signed or otherwise independently
authenticated FX/price/cost-source record, upper-bound tests,
unknown-cost denial, ZDR verification for the **actual provider**,
data retention review and approved private egress. No assumption
that sandbox price fixtures describe current charges.

### P1 — native Reviewer B and human gates

Do not treat a model-generated comment, a CI green check or the
Publisher's private semantic `COMMENTED` workflow as a native
independent Reviewer B `APPROVED`. Obtain a separate authorized
reviewer identity, actual final-head review and required policy
checks. At the next HEAD, redo all SHA-bound review evidence.

**Acceptance evidence:** native `APPROVED` from the authorized
independent reviewer for the **exact current SHA**, a clean set
of required CI checks, and recorded distinct owner decisions:
`HUMAN_GO` for permitted execution, **exact-SHA
`MERGE_GO`** before merge, and separately **`ZERO_CURSOR_GO`**
only after local MSI qualification. Each must be explicitly
requested/validated in its own applicable scope. An `enchaine`
instruction and this document do not grant them.

### P2 — staged Runner requalification (after upstream P1 gates)

Only after the above **independent, real-world** checks can an
authorized operator plan a non-billable canary and actual
Runner/Supervisor requalification on the MSI. Confirm one active
LOT, intended execution backend, recovery after crash, heartbeat,
real code source/branch, rollback and audit trace. Reconfirm
the source of truth at startup; passing the synthetic
`Reviewer B - Runner Smoke Test` does **not** mean the Runner
has actually been started. No MSI-dependent action is performed
while that machine remains off.

## Implementation order and ownership

1. **NOW / remote safe:** keep PR #73 DRAFT and protected gate
   BLOCKED. Preserve current 8/8 CI status only for its exact
   SHA; add non-authorizing regression coverage protecting the
   actual `openrouter-only-spend-gate.mjs` and paid entrypoint.
2. **NEXT / design plus owner policy:** settle target models,
   approved spend/role scope, source-authentication architecture
   and independent security review. No token creation or egress.
3. **THEN / separately approved implementation:** provider
   completeness and authenticated FX plus persistent atomic
   reservations/unknown-liability recovery, protected receiver
   and verified network/secret/audit boundaries. Test them
   end-to-end without paid work before requesting spend approval.
4. **THEN / explicit human verification:** independent exact-HEAD
   Reviewer B `APPROVED`, fresh CI, `HUMAN_GO` and
   `MERGE_GO` when appropriate. No automatic transitions.
5. **LAST / MSI available:** local requalification, independent
   `ZERO_CURSOR_GO`, then actual authorized Runner dry-run and
   controlled canary; no step here authorizes it in advance.

**Operational decision: NO-GO SPEND / NO-GO MERGE / NO-GO DEPLOY /
NO-GO RUNNER.** This repository alone does not prove all
end-to-end DevFactory prerequisites; rerun the readiness audit if
architecture, cost provider, target or HEAD changes.
