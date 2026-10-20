# Signed synthetic shadow proof via a real PostgreSQL authenticated receiver

**20 October 2026 — GitHub CI ONLY — NO-GO SPEND / MERGE / DEPLOY / RUNNER**

A new receiver migration now denies access to the older 11-parameter
`propose_exposure_with_challenge` route from the generic invoker role
and accepts only `propose_exposure_authenticated_receiver` when
PostgreSQL's **session_user** matches the protected receiver login.
The earlier signed-admission prototype intentionally tested only the
older, pre-receiver synthetic schema and cannot authenticate that
receiver in a real multi-session database.

This change demonstrates the two protections *together* without
promoting the old route or changing the real Publisher:

- `scripts/openrouter-shadow-authenticated-bridge-synthetic-only.mjs`
  is a **test-only adapter**. It delegates all JSON-only Ed25519
  verification, signed-envelope hashes, current context and
  rejection of attacker-controlled costs to
  `submitSignedShadowProposalSyntheticOnly`. It permits exactly
  the prior 11-argument internal SQL statement and redirects it to
  the **new authenticated receiver function**. No arbitrary
  application-specified SQL, provider API or priced call is allowed.
- `test/openrouter-shadow-authenticated-bridge-postgres-real.test.mjs`
  generates synthetic Ed25519 keypairs and signs both the shadow
  claim and the service-to-service binding; it creates one genuine
  PostgreSQL 16.4 database in an isolated GitHub job, applies
  *all five* migrations and provisions a signed challenge only
  through the disposable PostgreSQL superuser.
- A wrong independently authenticated login, even after an
  intentionally mistaken `GRANT receiver_role` and `SET ROLE`,
  cannot submit a signed claim: PostgreSQL's `session_user`
  stays with the actual LOGIN actor. No nonce, challenge or budget
  row is consumed.
- **Only for the disposable test**, the database superuser
  temporarily changes the receiver role to LOGIN with a **fixed
  synthetic password**, then uses a separate authenticated
  connection to submit the same exact signed proof. PostgreSQL
  atomically consumes the challenge and nonce once and updates the
  synthetic 15 EUR proposal. Replay is rejected. Each response
  retains `maySpend:false` and no provider bill authority.
- The new workflow downloads only a same-repo SHA through an
  ephemeral **contents:read** GitHub token, uses an ephemeral
  postgres:16.4 service and includes no live OpenRouter secret,
  no real keypair, no stored credential and no private target
  DevFactory source.

### What is still not secured

**This is not a real authenticated application receiver.** The
`db` parameter, keyrings and trusted context are injected test
dependencies. A malicious caller with code execution can pass a
mock connection. No protected issuer key custody, authenticated
GitHub App service, TLS identity, production receiver account,
sealed evidence transport or operator provisioned trust store is
configured.

A real PostgreSQL user with receiver credentials can still invent
hashes/nonce if permitted to bypass the verifier. Thus the
receiver must exclusively host verified code, bind an actual
authenticated service identity, obtain the independent current
GitHub HEAD and owner authorization, handle real short-lived
challenges, enforce one-statement transaction/autocommit semantics,
and audit its credentials and revocations.

The SQL function checks time *during* the statement; it cannot
prove that an uncontrolled client will not wait to COMMIT after
expiry. PGlite or PostgreSQL CI is not a formal external security
review. Cross-key authenticated provider invoices and FX,
ambiguous charged attempts, OpenRouter ZDR, owner HUMAN_GO,
exact-HEAD MERGE_GO and later ZERO_CURSOR_GO all remain pending.
The protected spend gate is still
`OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED`.

**DO NOT MERGE, DEPLOY, SPEND OR START RUNNER.**
