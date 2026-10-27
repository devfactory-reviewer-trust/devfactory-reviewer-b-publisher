#!/usr/bin/env bash
# R142: owner-local exact-Pod stop, never start. Requires a real TTY.
# Credentials stay local; this shell never logs the secret or writes it to disk.
set -euo pipefail
umask 077
if [[ ! -t 0 ]]; then
 echo GPU_STOP_OWNER_TTY_REQUIRED >&2; exit 2
fi
if [[ "${RUNPOD_API_KEY+x}" || "${RUNPOD_EXACT_STOP_CONFIRMATION+x}" ]]; then
 echo GPU_STOP_PREEXISTING_ENV_REJECTED >&2; exit 2
fi
expected='STOP ao1z73um41h61i'
echo "Only existing Pod ao1z73um41h61i will be stopped. No new Pod will start."
read -r -p "Type '$expected' to confirm: " RUNPOD_EXACT_STOP_CONFIRMATION
if [[ "$RUNPOD_EXACT_STOP_CONFIRMATION" != "$expected" ]]; then
 echo GPU_STOP_NOT_CONFIRMED >&2; exit 2
fi
read -r -s -p "RunPod restricted stop-capable key (hidden): " RUNPOD_API_KEY
echo
trap 'unset RUNPOD_API_KEY RUNPOD_EXACT_STOP_CONFIRMATION' EXIT
if [[ -z "$RUNPOD_API_KEY" ]]; then
 echo GPU_STOP_EMPTY_CREDENTIAL >&2; exit 2
fi
export RUNPOD_API_KEY RUNPOD_EXACT_STOP_CONFIRMATION
NODE_BIN="${NODE_BIN:-node}"
"$NODE_BIN" "$(dirname "$0")/runpod-provider-stop.mjs" \
  --stop-existing-pod ao1z73um41h61i