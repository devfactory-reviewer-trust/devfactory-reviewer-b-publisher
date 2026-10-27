# R141 — Current-RunPod-Pod API read-only preflight

**DRAFT / NO GPU ACTIVATION.** This only identifies the owner Pod.
No source diff, private key, GitHub App credential, and no paid action.

## What changed

- `bench/runpod-provider-readonly.mjs`: only `GET
  https://api.runpod.io/v2/pods/ao1z73um41h61i` using a local, short-lived
  bearer key. It rejects any unexpected Pod ID/status and never returns the
  API token, raw provider response, SSH host, or cost details.
- `bench/runpod-provider-one-shot.sh`: a TTY-only hidden prompt on the
  owner's own machine, using an in-memory environment variable for **one**
  read-only query. No plaintext token file, shell-history token, or remote
  ChatGPT transport. Do NOT provide the token to the assistant or paste
  it into GitHub comments.
- Tests prove no write method, foreign Pod fail-closed, no key → no network,
  HTTP-denied fail-closed, result redaction and zero review/merge permission.

## Exact provider boundary

The owner's screenshot shows an API key called
`DevFactory-ReviewerB-GPU`, but does not expose its full value or scope.
The owner MSI did NOT have `RUNPOD_API_KEY` configured when checked.
Creating a key in the RunPod browser does **not** connect it to MSI or
Publisher.

In a trusted local terminal on the owner MSI only, with a restricted key
readable by its owner:

```bash
cd /home/ismah/DevFactoryValidation/r141-pr42-provider-readonly-20261015
NODE_BIN=/home/ismah/.local/opt/node-v24.19.0-linux-x64/bin/node \
  bash bench/runpod-provider-one-shot.sh
```

Paste the API key **only into that hidden local prompt**. Never into the
ChatGPT conversation or GitHub. The output is Pod identity and state ONLY,
even if the provider returns other account-specific details. This query
does not verify full running rate in EUR, storage, account spend, the
owner's GPU allocation, SSH identity or provider-side auto-stop.

The owner RunPod Pod currently identified in prior console screenshots:
`ao1z73um41h61i`, stopped, advertised A6000 48 GB at $0.59/hr. The
historical benchmark Pod `65d120da1098` is **different**.

**Do not start the Pod based on this preflight.** The overall
€10/month cap still requires authenticated accumulated spend, GPU +
storage rates in EUR, available prepaid balance and independent
provider-side stop enforcement. Even a valid Pod read remains
`mayStartPod:false`, `mayReviewPrivateCode:false` and
`mayPublishReview:false`.

Production Reviewer B remains GitHub-hosted CPU (7B). A production
switch to GPU additionally requires an independent security approval
for PRIVATE diff bytes leaving the protected GitHub worker, and
verified Qwen 35B model quality and request wall-time benchmarking.
PR #42 remains draft, not merge authorized.
