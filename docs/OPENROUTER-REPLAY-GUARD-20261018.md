# OpenRouter-only Reviewer B — first paid attempt / no replay

Scope: public Publisher, no paid model calls or PR #939 changes. Current
Publisher main at start: `7f121829c77aea075dc75e697682df5c9d8b4e7a`.

## One request, one first attempt

The authenticated service's issue #62 message is bound to exact PR/HEAD/model.
The protected worker now also receives the validated **comment ID** and
accepts only `issue_comment`, `GITHUB_RUN_ATTEMPT=1`. It verifies a
single exact authentic service command across the bounded public issue
comments, regardless of model ID for that PR/HEAD. A second command for
the same PR/HEAD, a `workflow_dispatch` request, rerun attempt 2, a
forged service user, missing comment ID, partial pagination, network error
or unexpected response is **DENIED BEFORE paid inference**.

No automatic retry, no recursive dispatcher, no fresh-HEAD bootstrap after a
failed payment, no new Reviewer B approval and no merge authority. Existing
global GitHub protected Reviewer B concurrency is left untouched. The
private #939 old failed request remains non-retriable automatically.

## Intentional financial hard stop

This is **idempotency preflight evidence only**. A service comment can be
deleted or history altered by someone with appropriate repository rights,
so comment enumeration is NOT equivalent to a durable, authenticated,
append-only monetary ledger or atomic reservation.

`assessAuthenticatedOpenRouterSpendAuthorization` stays always
`BLOCKED` until a second reviewed implementation proves account monthly
spending and an atomic per-operation reserve. The provider's
`GET /api/v1/key` supplies a useful <=$1/month per-key cap today,
but is not account-wide proof when multiple keys or key rotations exist.
The `GET /api/v1/activity` management API covers the last 30 completed
UTC days and cannot alone attest CURRENT-DAY pending charges. A true
single-provider EUR15 monthly budget therefore still needs authenticated
account-level/current-day evidence, a durable reservation and explicit
FX handling; never infer that a GitHub owner-consent comment is a receipt.

Future production enablement must have exact-head test fixtures, protected
checks, independent review, a separate owner authorization, current exact
PR/HEAD consent, and a manual protected environment approval. A previously
interrupted provider POST is presumed possibly billed until reconciled.

## Privacy and security

Never log private source, request/response model text, API keys, upstream
error bodies, GitHub installation tokens or model usage by private file.
Only static fail-closed status codes and public service comment identity
are used. The public Publisher contains no private PR #939 diff.

## Verification

The new offline tests cover: first unique request, rerun, wrong actor/id,
second command with same HEAD but different model, incomplete pagination,
wrong origin/content type, provider/network failure, and strict ordering
before the existing OpenRouter-only always-BLOCKED spend gate.

User instruction: permanently retire RunPod. No RunPod workflow reactivation,
new pod, pod charge, or Runner/Supervisor startup.
