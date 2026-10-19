#!/usr/bin/env bash
# Owner-terminal only. Never paste RunPod API keys into chat, GitHub comments,
# logs, shell history or the process command line. Probe only the exact Pod.
set -euo pipefail
umask 077
if [[ ! -t 0 ]]; then
  printf '%s\n' 'GPU_RUNPOD_OWNER_TTY_REQUIRED' >&2
  exit 2
fi
if [[ ${RUNPOD_API_KEY+x} ]]; then
  printf '%s\n' 'GPU_RUNPOD_EXISTING_ENV_CREDENTIAL_REJECTED' >&2
  exit 2
fi
read -r -s -p 'RunPod restricted API key (input hidden): ' RUNPOD_API_KEY
printf '\n'
trap 'unset RUNPOD_API_KEY' EXIT
if [[ -z "$RUNPOD_API_KEY" ]]; then
  printf '%s\n' 'GPU_RUNPOD_EMPTY_CREDENTIAL' >&2
  exit 2
fi
export RUNPOD_API_KEY
NODE_BIN="${NODE_BIN:-node}"
"$NODE_BIN" "$(dirname "$0")/runpod-provider-readonly.mjs" --read-only
