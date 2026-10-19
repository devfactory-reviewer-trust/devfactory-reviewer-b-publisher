# R142 — Existing A6000 Pod exact owner stop (NO activation)

**Draft only; public synthetic preparation.** This work does not start GPU
billing, switch Reviewer B production, see a private GitHub diff, authorize a
review, merge a PR, change protected main, or claim a guaranteed budget.

## Why an exact stop endpoint is necessary

- Current Pod ID identified by the owner: `ao1z73um41h61i` (stopped at the
  last owner's snapshot), distinct from earlier benchmark Pod `65d120da1098`.
- The existing R138 SSH watchdog only closes an SSH tunnel. An Ollama crash,
  user disconnect, test failure or local kill does NOT ensure that the GPU Pod
  stops billing. RunPod REST v2 documents an action endpoint
  `POST /v2/pods/{id}/action` with `{"action":"stop"}`, but the actual
  result MUST be checked by an authenticated exact-Pod GET.
- GPU rate displayed in the dashboard ($0.59/h) does not establish all
  charges or prior month-to-date spend in EUR. The user's overall budget
  remains **€10/month maximum**, with only €8 operating room and a €2
  safety reserve until authenticated provider evidence is obtained.

## New zero-spend owner-local emergency capability

- `bench/runpod-provider-stop.mjs` exports `stopExactRunPod()`, which
  performs **no network calls** without a valid local credential and
  the literal confirmation `STOP ao1z73um41h61i`.
- It first obtains authenticated REST status and checks the exact ID; if
  already EXITED/STOPPED it performs GET only; if RUNNING, it sends
  **exactly one** fixed action "stop" to the fixed provider URL, with
  no variable URL or arbitrary request body.
- It then independently polls authenticated provider GET for EXITED or
  STOPPED. An uncertain status, foreign reply, network error, HTTP error,
  or still-RUNNING Pod yields a fixed denied result, NOT a fabricated stop.
  It never prints provider payload, tokens, headers, billing info, or keys.
- `bench/runpod-provider-stop-one-shot.sh` requires a real, owner-local
  terminal, hidden key entry and literal confirmation. It never saves the
  key in a file or embeds it into command-line arguments.
  Use only a **restricted key** whose scope includes reading the Pod
  and stopping it. Do not provide keys in ChatGPT/GitHub.
- No create/resume, GPU request, job or private diff access is implemented
  in this script. Running the unit tests never contacts RunPod.

## Owner-only use, if an exact running Pod ever needs to be stopped

In a trusted **local MSI terminal**:
```bash
cd /home/ismah/DevFactoryValidation/r142-runpod-exact-stop-readiness-20261015
NODE_BIN=/home/ismah/.local/opt/node-v24.19.0-linux-x64/bin/node \
  bash bench/runpod-provider-stop-one-shot.sh
```

This is **manual stop control**, NOT independent provider-side scheduled
auto-stop. It must not be represented as satisfying R135's
`independentlyEnforcedStop` admission gate.

## Next dependencies BEFORE paid benchmark

1. Owner-authorized RunPod read-only inspection via R141 local hidden
   credential; verify actual Pod status, rates, persistent storage charges,
   month-to-date usage, currency conversion and any other Pods.
2. Establish **an independent stop** that works even if ChatGPT, GitHub,
   the local MSI, or the SSH benchmark disappears (e.g. independently
   verified Pod-side self-stop, plus a second provider stop). Test stop
   on an authorized session, not by merely setting a boolean.
3. Start only existing Pod on explicit budgeted authorization; audit remote
   SSH key/fingerprint out-of-band, GPU identity, Ollama model and offline
   configuration. Never expose Ollama HTTP publicly.
4. Only PUBLIC fixed synthetic holdout cases before any private-source
   off-premise egress; require 5/5 true seeded bugs, no false alerts.
5. PRIVATE Reviewer B migration needs **separate owner authorization** of
   private diffs exiting the protected GitHub worker, independent security
   assessment, no App token/key in the Pod, code-integrity attestation
   and a separate protected Publisher review/policy integration.

## Test evidence

R142 exact stop unit tests: no token/confirmation → zero network; foreign
ID/status denial; already stopped → GET only; sole exact POST; async STOPPING
→ authenticated STOPPED; persistent RUNNING → denied; failed HTTP/timeout/
foreign ACK → denied without leaking secrets. Existing R141 and R138 GPU
preflight/budget/SSH tests remain unchanged. No live API stop was attempted.

**Release hold:** PR #42 remains DRAFT; no production switch or merge.
