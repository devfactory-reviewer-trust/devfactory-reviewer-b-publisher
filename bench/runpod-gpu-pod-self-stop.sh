#!/usr/bin/env bash
# R143: owner-operated fixed 20-minute SELF-STOP on the exact RunPod Pod.
# PUBLIC synthetic only. Does not authorize GPU start or private-code egress.
# Does not guarantee stop/billing if the Pod/container/OS fails.
set -euo pipefail
readonly EXPECTED_POD='ao1z73um41h61i'
readonly SELF_STOP_SECONDS='1200'
if [[ "${RUNPOD_POD_ID:-}" != "$EXPECTED_POD" ]]; then
  echo 'GPU_SELF_STOP_FOREIGN_OR_UNKNOWN_POD' >&2
  exit 2
fi
if [[ $# -eq 1 && "$1" == '--check' ]]; then
  if ! command -v runpodctl >/dev/null 2>&1; then
    echo 'GPU_SELF_STOP_RUNPODCTL_UNAVAILABLE' >&2
    exit 2
  fi
  echo 'GPU_SELF_STOP_EXACT_POD_AND_CLI_READY_NO_ARM'
  exit 0
fi
if [[ $# -ne 2 || "$1" != 'ARM-20M' || "$2" != "$EXPECTED_POD" ]]; then
  echo 'GPU_SELF_STOP_EXACT_CONFIRMATION_REQUIRED' >&2
  exit 2
fi
for command in runpodctl nohup bash sleep; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo 'GPU_SELF_STOP_REQUIRED_COMMAND_MISSING' >&2
    exit 2
  fi
done
# The Pod itself has no RunPod API key. Fixed delay and fixed Pod ID:
# no caller-controlled command strings, no shell eval, no private source.
# nohup keeps the timer across SSH disconnects; container failure may kill it.
nohup bash -c 'sleep 1200; exec runpodctl stop pod ao1z73um41h61i' \
  </dev/null >/dev/null 2>&1 &
echo 'GPU_SELF_STOP_TIMER_LAUNCHED_UNVERIFIED'
echo 'GPU_SELF_STOP_NOT_PROVIDER_STOP_PROOF'
