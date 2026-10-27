# R138 — Pinned RunPod SSH bridge for PUBLIC synthetic GPU benchmark

**DRAFT ONLY. NOT ACTIVE. NO PRIVATE PR DIFF. NO REVIEW/BILLING AUTHORITY.**

## Status and identities

- Current RunPod Pod: `ao1z73um41h61i`, identified in the owner's
  15 October dashboard: stopped RTX A6000 48 GB, $0.59/hour compute
  upon start. The earlier RTX A6000 GPU / Ollama 0.40.4 / 35B benchmark
  (56–73 output tokens/s) concerned Pod ID `65d120da1098`.
  **It does not prove the current Pod contains the same Ollama model,
  installed dependencies, endpoint or benchmark performance.**
- Existing R135 synthetic quality and Euro cost planner are reused.
- As of the R138 owner MSI read-only inventory, there is no
  `RUNPOD_API_KEY`, live GPU quote/billing snapshot, current provider TCP
  SSH endpoint or independently enforced provider stop proof available.
  The Pod must NOT be resumed or bought on this basis.
- The GitHub Publisher main protected workflow still runs the production
  `qwen2.5-coder:7b` private review on GitHub `ubuntu-24.04`
  (CPU). R138 touches **only draft benchmark files**. It does not
  start or cancel Reviewer B and never transfers a private diff.

## What was implemented

`bench/runpod-gpu-ssh-plan.mjs` constructs one very narrow OpenSSH
`-N -L 127.0.0.1:11434:127.0.0.1:11434` plan, strict known-host
pinning, no password or agent forwarding, a dedicated owner key and
an exact RunPod Pod/model identity. Every uncertainty fails closed.
No public Ollama HTTP exposure is authorized. It reuses the R135
budget planner, which always returns `mayResumePod:false` and
`chargeAuthorized:false`.

`bench/runpod-gpu-synthetic-ssh.mjs` has an operator-only `--dry-run`
preflight and `--run-public-synthetic` mode for an **already running**
independently budgeted Pod. It rejects a port already in use, validates
local SSH key file permissions, checks the model at the tunnel loopback,
runs ONLY the fixed public 35B holdout fixtures, sanitizes aggregate
metrics and tears down its local SSH tunnel on completion, failure,
interrupt, or a max 30-minute local watchdog. **The watchdog stops the
local tunnel, not the GPU Pod and not provider billing.** RunPod Pod stop
must be independently enforced; a boolean in a local config is an
operator claim, never provider-signed proof.

## Configuration for a *future* owner-authorized synthetic run

Keep this JSON in an owner-private local file, never in GitHub:

```json
{
  "podId": "ao1z73um41h61i",
  "host": "YOUR_VERIFIED_PROVIDER_TCP_HOST",
  "port": 22222,
  "sshPrivateKeyPath": "/home/owner/.ssh/devfactory_runpod_reviewer_b_20261014",
  "knownHostsPath": "/home/owner/.ssh/known_hosts_runpod_pinned",
  "model": "qwen3.6:35b-a3b-coding",
  "externalProviderStopProof": false,
  "providerPortExposureVerified": false,
  "budgetQuote": {
    "spentToDateEur": null,
    "providerGpuEurPerHour": null,
    "providerStorageEurPerHour": null,
    "extraEur": 0,
    "standbyEur": 0,
    "proposedMinutes": 20,
    "quoteVerified": false,
    "availableEuroBalanceVerified": false,
    "independentlyEnforcedStop": false
  }
}
```

The false/null defaults intentionally deny execution. Populate them
only from independently verified RunPod cost/volume/Pod state,
provider watchdog, provider port-exposure settings, and the verified
SSH server fingerprint. Never trust `ssh-keyscan` alone without
authenticating its fingerprint out of band. SSH identity file mode
must be 0600 (no group/world privileges). **Do not paste API keys or
private SSH key material into chat, PRs, logs or this config.**

With a separately running Pod, a valid *owner-side* config and
Node.js 24 on the owner MSI:

```bash
node bench/runpod-gpu-synthetic-ssh.mjs --dry-run /secure/path/config.json
node bench/runpod-gpu-synthetic-ssh.mjs --run-public-synthetic /secure/path/config.json
```

Observe `ollama ps` **inside the GPU Pod** and independently verify
`100% GPU`. Save only scrubbed performance/quality counters. A full
PASS requires all 5 seeded semantic defects and no false alerts on
safe diffs, including the holdout. A FAIL is a real FAIL; no threshold
relaxation or false review acceptance is allowed.

## Explicit production security boundary

The GPU SSH bridge must **not** be used for `scripts/protected-real-semantic-review.mjs`
until separate owner and independent security authorization of private
diff egress, GitHub App credential separation, auditable pod image,
run context, host key/fingerprint chain, validated zero-log model
operation, per-run economics and independently proven provider stop.

Recommended eventual design: protected GitHub runner retains
read-only App credentials and exact SHA checks. The GPU Pod receives
**only model prompt/diff bytes through a host-key-pinned SSH tunnel**
after owner-protected environment approval; **no GitHub token/key,
no repository checkout, no public Ollama endpoint, no model cloud
fallback**. The Pod cannot sign native reviews. Protected Publisher
verifies all returned findings and creates the native GitHub review.
Preserve `COMMENTED` provisional status and the separate HUMAN_GO
and MERGE_GO gates. Do not claim that a synthetic-only SSH preflight
implements this production design.

## Tests and blockers

`node --test test/runpod-gpu-ssh-plan.test.mjs
test/runpod-gpu-synthetic-ssh.test.mjs test/runpod-gpu-budget.test.mjs`

Negative tests cover foreign Pod/model, unpinned/invalid host, shell
injection, bad SSH-key permissions, missing quote, missing provider
stop and open port audit, conflicting local port, forged native review
authority and teardown.

**Remaining external blockers:** verified Pod cost to date, price/
storage and Euro conversion; verifiable provider auto-stop and API
credentials held outside code; verified live Pod SSH TCP host/port and
pinned host key; authorized GPU quality benchmark; independent review
of private-source egress. Do not merge experimental PR #42 based on
these synthetic tests alone.
