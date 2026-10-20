# Reviewer B — atomic receiver challenge + shadow nonce, PostgreSQL 16

**20 octobre 2026 — preparatory only / synthetic test / NO-GO SPEND**

## Change and trust boundary

The previous migration `reviewer_b_shadow_nonce_atomic_v1.sql`
enforces a durable, unique signed-shadow nonce/digest. The offline
double-signature verifier checks shadow claim + service audience and a
receiver-supplied challenge, but neither in-memory `seenChallenges`
nor an Ed25519 verification *alone* atomically consumes a real challenge.

The additive `sql/reviewer_b_shadow_challenge_atomic_v1.sql` tests
**database atomicity only**, in a disposable PostgreSQL 16 instance:

- An operator provisioned `issued_shadow_challenges` table with
  UUID challenge primary key and unique synthetic service-envelope
  digest. Rows fix issuer, audience, exact PR+HEAD+comment+model,
  shadow-envelope SHA-256 digest, full 15 EUR synthetic ceiling,
  UTC month, server-based issuance and up-to-60-second expiry.
- The table has no direct READ, WRITE, CREATE or UPDATE privileges
  for the restricted invoker. The invoker's previous nine-argument
  `propose_exposure_once` route is revoked, leaving only
  `propose_exposure_with_challenge`.
- The new function performs `FOR UPDATE NOWAIT` on the exact challenge,
  compares every bound field, prevents expiry, replay and wrong month,
  calls the existing nonce+budget function and marks the challenge
  consumed in the same PostgreSQL transaction. A composite foreign
  key ensures a consumed challenge references the **same nonce and
  shadow digest** recorded by the proposal.
- A failed statement, challenge write error or outer transaction
  `ROLLBACK` leaves **no challenge consumption, nonce or reservation**.
  The monthly 15 EUR cap is preserved, and even a successful synthetic
  call returns `may_spend=false` and
  `provider_billing_authenticated=false`.

### Critical limitation: signatures are NOT verified by this SQL

**Nothing in this migration authenticates the operator, GitHub App,
real service issuer, receiver-generated challenge, service-envelope
SHA-256, Ed25519 signed claim, an actual OpenRouter bill, or a price.**
A database caller with function EXECUTE and knowledge of an operator
provisioned challenge can submit matching strings. The current
operator-generated rows exist **only in a disposable CI container**.

Before deployment, an independently authenticated, reviewed receiver
must use a protected keyring to verify BOTH signatures, challenge
audience, current GitHub HEAD and consent, then bind that verification
to atomic database use under a restricted principal. It must not
accept arbitrary callback `fetchImpl`, mock keys or a test switch as
proof of caller identity.

Challenge issuance and storage are not reachable by the app caller;
this is a privilege *illustration*, not a service authentication
solution. The trusted operator retains superuser capabilities in tests.

### Dedicated CI contract

The new GitHub Actions workflow uses a read-only GitHub token
**only to download the same-repo exact SHA**. It creates a disposable
`postgres:16.4` service with a synthetic password and independently
authenticated test connections. Tests cover:

- restricted role cannot call predecessor nine-argument function or
  edit challenges;
- unknown, wrongly bound, expired, tampered shadow/service hashes and
  underpriced requests deny before any proposal;
- challenge row NOWAIT contention between two independent clients;
- uncommitted writes stay invisible, and rollback erases all effects;
- a synthetic test trigger deliberately aborts the challenge update
  AFTER nonce and budget mutation, verifying statement-wide rollback;
- successful commit consumes challenge+nonce+15 EUR synthetic bound
  exactly once; duplicate challenge fails;
- a different preissued challenge cannot exceed the same-month bound.

The temporary CI database, client password, SQL and test data carry no
private source, no live provider secret and no real authorization.

### Remaining gates and governance

Protected signer and receiver identity, cryptographic attestation at
the same transaction boundary, durable key rotation/revocation,
challenge issuance/expiry cleanup, recovery from unknown-billed
provider requests, authenticated OpenRouter account-wide charges,
independent ZDR verification and vetted USD/EUR conversion remain
unimplemented. Native independent Reviewer B/security review,
HUMAN_GO, exact SHA MERGE_GO and later ZERO_CURSOR_GO are separate.

`scripts/openrouter-only-spend-gate.mjs` **must remain**
`OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED`.

**NO-GO DEPLOY / PAID OPENROUTER / MERGE / RUNNER.**

## Correction de la fenêtre d'expiration pendant l'écriture

Une contre-analyse manuelle a identifié un TOCTOU restant : un défi
pouvait être valide lors du premier `FOR UPDATE NOWAIT` puis expirer
pendant l'appel à la fonction de nonce et la mise à jour du budget.
Après la dernière mise à jour de `consumed_at`, le SQL recontrôle
désormais le mois UTC et `expires_at`, puis **lève une exception**
en cas de changement. Cette erreur annule toute la requête SQL.

Le test PostgreSQL réel crée un défi valable 2 secondes et un
déclencheur de test qui ralentit intentionnellement son écriture de
2,3 secondes, une fois que la proposition a été tentée. Il exige
`SHADOW_CHALLENGE_EXPIRED_DURING_WRITE`, puis prouve qu'aucun
montant, nonce, proposition ou défi consommé ne subsiste.
Le déclencheur n'existe que dans le conteneur PostgreSQL éphémère CI.

Ce test ne résout pas l'authentification cryptographique manquante
du futur service ni les autorisations de dépense.
