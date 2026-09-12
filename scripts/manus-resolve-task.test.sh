#!/usr/bin/env bash
# Smoke-test task resolution: wrong Ads task id must not win over JD SYS.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/manus-credentials.sh"

export MANUS_API_KEY="test-key"
unset MANUS_PROJECT_TASK_ID || true
export MANUS_TASK_ID="gizF3phPFVB9M74wTTbBdS" # broken Ads standard task
got="$(manus_resolve_project_task_id "$ROOT")"
want="PTxdA5w7AUDNxF2XREC0dk"
if [[ "$got" != "$want" ]]; then
  echo "FAIL: expected $want got $got" >&2
  exit 1
fi

export MANUS_PROJECT_TASK_ID="PTxdA5w7AUDNxF2XREC0dk"
got2="$(manus_resolve_project_task_id "$ROOT")"
if [[ "$got2" != "$want" ]]; then
  echo "FAIL override: expected $want got $got2" >&2
  exit 1
fi

echo "OK manus_resolve_project_task_id → $got"
