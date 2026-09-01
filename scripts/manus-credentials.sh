#!/usr/bin/env bash
# Shared check: Manus auto-deploy credentials from process env or repo .env
set -euo pipefail

manus_credentials_available() {
  local root="${1:-}"
  if [[ -n "${MANUS_API_KEY:-}" && -n "${MANUS_TASK_ID:-}" ]]; then
    return 0
  fi
  if [[ -n "$root" && -f "$root/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$root/.env" 2>/dev/null || true
    set +a
    [[ -n "${MANUS_API_KEY:-}" && -n "${MANUS_TASK_ID:-}" ]]
    return $?
  fi
  return 1
}
