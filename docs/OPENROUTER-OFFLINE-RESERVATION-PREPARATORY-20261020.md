# OpenRouter Reviewer B — offline reservation journal (preparatory only)

**Scope (20 October 2026):** a secret-free, Linux/POSIX-only prototype in a
separate Publisher pull request. It is not called by the paid workflow, the
protected real-review entrypoint, or `openrouter-only-spend-gate.mjs`.
The latter must continue returning
`OPENROUTER_MONTHLY_RESERVATION_AND_IDEMPOTENCY_NOT_IMPLEMENTED`.

## Guarantees tested within one persistent trusted directory

- `O_EXCL` global reservation lock serializes all attempts in the same
  directory, including different private PRs and exact HEADs.
- Records use restrictive POSIX modes, protected directory ownership,
  filesystem sync, no symlink/hardlink aliases, pinned-descriptor checks, and
  fixed-size JSON schemas. Unknown or corrupt files deny future operations.
- A proposal for a particular `PR + HEAD` or public service request comment
  can be recorded at most once in the directory, across models, reattempts,
  and UTC calendar months. Its proposed upper-bound exposure stays reserved
  even if there is no published review, since a model POST might have billed.
- For any UTC month the sum of proposed, rounded-up integer micro-euro upper
  bounds cannot exceed **15 EUR** in the same directory. A maximum of **500
  durable records** is enforced *before* any further write; the 501st is
  rejected without corrupting subsequent inspection. Exceeding either limit
  or competing concurrently denies; no retry manager is provided.
- Unexpected process termination after taking the exclusive lock may leave
  the lock in place. This is intentionally **fail-closed** and must not be
  automatically deleted or reaped.
- Every result, including `ok:true` from an offline write, explicitly sets
  `maySpend:false`, `mayReserve:false`, `mayRetryAmbiguousRequest:false`
  and `mayMerge:false`. `recorded:true` means only *a local proposal was
  durably recorded*; it is not an authorization for a provider request.

## Blockers before ANY real billable request

1. **Multi-run persistence and protection**: GitHub-hosted ephemeral runners
   have separate local filesystems. No central cross-run, cross-workflow,
   cross-user reservation authority exists; this local journal must not be
   used to claim a global 15 EUR ceiling.
2. **Provider-authenticated billing**: neither locally supplied estimates nor
   key balances alone prove total account usage, pending charge ambiguity,
   usage lag, refunds, other keys, or billing across separate apps.
3. **Authenticated EUR conversion**: a monthly EUR ceiling cannot be
   enforced from untrusted USD exchange-rate inputs. The conversion policy,
   freshness, worst-case bound and trusted evidence source are still absent.
4. **Independent Reviewer B provenance**: this prototype is not a native
   GitHub App review, a security approval or a trusted attestation. Protected
   source access and full private diff egress still require separate
   owner-exact-HEAD consent, ZDR verification, model safeguards, and
   independent readback.
5. **Crash-safe provider finalization**: no authoritative result of a POST
   is reconciled to the ledger. Never infer that a failed/timeout request was
   free, and never auto-retry such a request. An independently verified
   receipt and independently operated accounting service are outstanding.
6. **Filesystem adversary model**: POSIX permissions and checks guard against
   ordinary unprivileged interference, not a malicious process with the
   same OS identity or control of the containing volume.

**Policy:** `NO-GO SPEND / NO-GO PUBLISH / NO-GO MERGE / NO-GO RUNNER`
without a separate protected rollout and explicit approvals. Do not introduce
API keys, management secrets, real private diff, provider calls, a scheduler,
or any workflow invoker into this preparatory module.

## Reproduce

Under Linux with Node >=20, from Publisher repository root:

```bash
node --test test/openrouter-offline-reservation-journal.test.mjs
npm test
```

All test claims are synthetic; the module contains no network call,
provider key, GitHub mutation, deploy operation or trusted expenditure proof.

[executed on device: MSI (9ce3a633-4309-4f3e-b074-f535afb4ef99)]