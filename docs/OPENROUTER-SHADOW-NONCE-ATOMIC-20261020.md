# Reviewer B — atomic synthetic nonce consumption (20 October 2026)

**PREPARATORY / NO LIVE CREDENTIALS / DO NOT DEPLOY OR MERGE.**

The earlier Ed25519 verifier (`openrouter-shadow-signed-claim-offline.mjs`)
can inspect a **previously seen nonce snapshot**, but cannot atomically
consume a nonce when competing clients try to write. The additive SQL
migration `sql/reviewer_b_shadow_nonce_atomic_v1.sql` addresses the
**database transaction mechanics only**, not signature authenticity.

## Synthetic contract

- Apply in order in an **isolated test PostgreSQL database**:
  `reviewer_b_shadow_central_pg_v1.sql`,
  `reviewer_b_shadow_protected_roles_v1.sql`,
  `reviewer_b_shadow_nonce_atomic_v1.sql`.
- The new `reviewer_b_shadow.consumed_shadow_proofs` table persists a
  globally unique UUID nonce **and** unique lowercase SHA-256 signed
  envelope fingerprint; the nonce row has a foreign key to the exact
  `repo + PR + HEAD` of a durable shadow exposure proposal.
  These constraints span all months.
- `propose_exposure_once(...,p_nonce,p_claim_digest)` is a new restricted
  `SECURITY DEFINER` function with the protected NOLOGIN owner and
  pinned search path. It performs the old budget admission and consumes
  nonce + fingerprint **within one PostgreSQL transaction**. A unique
  violation rolls back its nested subtransaction, including the
  exposure/counters, rather than leaving a partial reservation.
  Other errors are NOT silently retried.
- The **old seven-argument** `propose_exposure` is no longer invocable
  by the restricted application role or PUBLIC. The new function
  retains `may_spend=false` and
  `provider_billing_authenticated=false` on every result.
- Denied claims do not consume nonces. A rolled-back test transaction
  also erases both proposal and nonce. **In the event of an actual
  billable HTTP timeout, that retry behavior would NOT be safe**;
  no such HTTP calls can occur in this module.
- The issuer's signed `nonce` and envelope digest must be derived
  by a FUTURE **trusted external verifier**, never copied from
  untrusted JSON or assumed genuine merely because a database row exists.

## Tests and deployment limitations

`test/openrouter-shadow-nonce-atomic.test.mjs` checks SQL contracts,
restricted role behavior, replay, duplicate nonce, duplicate signed
digest, partial/denied claims and an exact 15 EUR synthetic proposed cap
using disposable PGlite.

`test/openrouter-shadow-nonce-atomic-postgres-real.test.mjs` uses real
PostgreSQL 16.4 and distinct authenticated client connections. It
holds a transaction before a second client requests the same nonce,
requires NOWAIT lock denial, checks visibility before COMMIT, simulates
ROLLBACK and server-terminated client failure, tests replay across
different PRs/digests, and verifies that an old unprotected SQL function
is not executable by the restricted login. The dedicated GitHub
workflow downloads only the **exact same-repository SHA** using
GitHub's real ephemeral contents:read token and runs with **synthetic**
PostgreSQL passwords, no OpenRouter key, no private DevFactory source,
and no persistent database.

**IMPORTANT UNSOLVED**: PostgreSQL cannot distinguish a nonce invented
by a caller from a real signed nonce in this schema. These primitives
do NOT yet cryptographically bind the external Ed25519 verification
to the DB transaction through a trusted service identity. The
`REVIEWER_B_SYNTHETIC_SHADOW_ONLY` test guard is likewise **not**
strong authentication. The actual Publisher spend gate remains blocked.

Nor does this migration authenticate provider charges, actual provider
usage, account/key-wide budget exposure, USD/EUR FX, ZDR, final invoice
receipts or billable timeout reconciliation. There is no deployment,
no DB key provisioning, no expensive model inference, no native review,
no owner HUMAN_GO/MERGE_GO or Runner ZERO_CURSOR_GO.

**Decision: NO-GO SPEND / NO-GO MERGE / NO-GO DEPLOY / NO-GO RUNNER.**

## Adversarial rollback-path validation

The second-model advisory review identified a **coverage gap**: existing
replay tests exited early at `EXISTS` and NOWAIT contention, so they never
reached the `WHEN unique_violation` rollback handler after a successful
reservation write. The real PostgreSQL test now installs a **throwaway
operator-created AFTER INSERT trigger** which inserts the same nonce
and signed-envelope digest **between the proposal and the wrapper's
proof insertion**. The wrapper must return duplicate denial and rollback
ALL of its writes, including the trigger-created record, exposure row
and month counter. An independent synthetic marker INSERT in the
surrounding transaction must still commit, proving the nested
subtransaction handled the collision without poisoning its caller.
This trigger is dropped inside the disposable CI database. It is
**never** part of the published migration or a production path.

This hardening demonstrates rollback semantics but still **does not**
authenticate the Ed25519 signature or a real provider charge.
