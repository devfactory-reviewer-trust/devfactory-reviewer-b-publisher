# R139 — exact-current-RunPod-Pod public GPU synthetic readiness

**Isolated preparation only: NO GPU charges, no Pod resume, no private PR review.**

## Observed owner screenshot, 2026-10-15 09:07–09:08 Europe/Paris

- The **current** RunPod Pod ID visible in owner screenshots is
  `ao1z73um41h61i` and it is **stopped**.
- Advertised 1 × NVIDIA RTX A6000, 48 GB VRAM, 9 vCPU, 50 GB RAM,
  100 GB **container disk** (not an authenticated persistent-volume proof).
- Advertised restart button: `Start for $0.59/hr`.
  The stopped screenshot shows `$0.00/hr`, container storage `Not running`.
  This does **not** establish month-to-date spend or any other volume charge.
- Region is `EU-SE-1`, Secure Cloud, template CUDA 12.8.1/Ubuntu 24.04.
  Screenshots establish an advertised offer, not an audit of installed
  Ollama/Qwen, currently allocated GPU capacity, storage, or host fingerprint.

**CRITICAL: historical benchmark Pod `65d120da1098` is a DIFFERENT identity.**
Its previous 3/3 short synthetic completions with
`qwen3.6:35b-a3b-coding`, 56–73 tok/s on RTX A6000, do not prove that
the model, SSH host, keys or volume are installed on the current Pod.
R139 binds the draft SSH/Euro budget preflight **only** to
`ao1z73um41h61i` and intentionally rejects the historical Pod identity.
Historical R135/R138 reports are retained unchanged as past evidence.

## Work already implemented and validated

- Reuse the existing R138 **PUBLIC synthetic-only** local SSH port tunnel
  for `127.0.0.1:11434`, strict pinned host key and dedicated SSH identity.
- Reuse 12 fixed synthetic, no real PR diff, no repo checkout, no App
  credentials sent to Pod, no Ollama public port.
- Reuse budget planner which requires independently verified **current**
  month-to-date balance, provider GPU+storage Euro rate, and provider-
  controlled auto-stop with a two-euro reserve. Synthetic planning returns
  `mayResumePod:false` and `chargeAuthorized:false`, EVEN if all
  checks pass: this is not a cloud controller.
- GPU identity in web screenshots is NOT sufficient to authorize a paid
  Pod start, much less access to private GitHub source.

## Remaining live data before a 10–20 minute synthetic test

1. Verify exact Pod `ao1z73um41h61i` in RunPod console, its **running**
   billing rate including storage, balance and prior monthly spend.
   No API key is currently connected to the MSI.
2. Establish a **provider-side** stop mechanism that independently stops
   the exact current Pod after the deadline; a local SSH watchdog alone
   does NOT stop provider billing. RunPod GraphQL has `podStop`, but
   the owner must first set up access, validate and audit a real stop
   mechanism; no unattended use is authorized from these screenshots.
3. Only AFTER the provider cost/stop guard is established, resume the
   Pod and verify it actually has an A6000, a trusted known-host
   fingerprint, a valid outbound SSH endpoint and loopback Ollama.
   If `qwen3.6:35b-a3b-coding` is missing, STOP this trial. Model setup
   must be priced and separately approved; do not assume persistence.
4. On the MSI, save a privately secured config with the **current Pod ID**
   and provider-verified data; do not paste API/SSH private keys in chat,
   GitHub or logs. Run `node bench/runpod-gpu-synthetic-ssh.mjs --dry-run <file>`.
5. Run `--run-public-synthetic` only once under external stop guard.
   Confirm `ollama ps` reports the model 100% GPU and quality detects
   all five semantic defects with no clean false positives. If the
   benchmark fails or exceeds the budget, stop without a production rollout.

**Do not modify production Publisher workflows before an independent
security review of PRIVATE diff egress to this external GPU.**
The current protected GitHub-hosted Qwen 7B Reviewer B and native
`COMMENTED`/HUMAN_GO/MERGE_GO controls remain unchanged.
