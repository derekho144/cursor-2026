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
want="8b23sC2fWWQJLaDHXQRwZX"
if [[ "$got" != "$want" ]]; then
  echo "FAIL: expected $want got $got" >&2
  exit 1
fi

export MANUS_PROJECT_TASK_ID="8b23sC2fWWQJLaDHXQRwZX"
got2="$(manus_resolve_project_task_id "$ROOT")"
if [[ "$got2" != "$want" ]]; then
  echo "FAIL override: expected $want got $got2" >&2
  exit 1
fi

# Retired error tasks must not stick even if still present in secrets
for retired in PTxdA5w7AUDNxF2XREC0dk 7VkPFZNKqwNQihpncANHuQ FxpSrXi9Z2L6CzDzBRaDD4; do
  export MANUS_PROJECT_TASK_ID="$retired"
  got3="$(manus_resolve_project_task_id "$ROOT")"
  if [[ "$got3" != "$want" ]]; then
    echo "FAIL retired $retired: expected fallback $want got $got3" >&2
    exit 1
  fi
done

profile="$(manus_resolve_agent_profile "$ROOT")"
if [[ "$profile" != "manus-1.6-lite" ]]; then
  echo "FAIL profile: expected manus-1.6-lite got $profile" >&2
  exit 1
fi

echo "OK manus_resolve_project_task_id → $got (agent=$profile)"
