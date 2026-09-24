#!/usr/bin/env bash
# Shared Manus deploy credentials + JD SYS project task resolution.
#
# Fixed production path (single source of truth):
#   GitHub main → sync JD SYS project → checkpoint → website.publish
#
# Canonical JD SYS project task id (override with MANUS_PROJECT_TASK_ID):
#   8b23sC2fWWQJLaDHXQRwZX
# Prefer agent profile manus-1.6-lite (full manus-1.6 often hits quota_limit).
# Retired unrecoverable-error project tasks (do not reuse):
#   PTxdA5w7AUDNxF2XREC0dk, 7VkPFZNKqwNQihpncANHuQ, FxpSrXi9Z2L6CzDzBRaDD4,
#   HLMT4bchyenkY57VUNT7qP, FMJFXPho2ucYUeSJLwgtvq, YquNqAt4M68E82XM5ayER9,
#   U3kVWtJndrSu6TUFzogUH9
set -euo pipefail

# Canonical production project task on Manus (JD SYS v2 project Fm48bwcxCqTxUfh6kJbk3c).
MANUS_JD_SYS_PROJECT_TASK_ID_DEFAULT="8b23sC2fWWQJLaDHXQRwZX"
MANUS_JD_SYS_AGENT_PROFILE_DEFAULT="manus-1.6-lite"

# Space-separated list of project tasks that hit unrecoverable error.
MANUS_JD_SYS_RETIRED_TASK_IDS="PTxdA5w7AUDNxF2XREC0dk 7VkPFZNKqwNQihpncANHuQ FxpSrXi9Z2L6CzDzBRaDD4 HLMT4bchyenkY57VUNT7qP FMJFXPho2ucYUeSJLwgtvq YquNqAt4M68E82XM5ayER9 U3kVWtJndrSu6TUFzogUH9"

manus_load_env_file() {
  local root="${1:-}"
  if [[ -n "$root" && -f "$root/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$root/.env" 2>/dev/null || true
    set +a
  fi
}

manus_credentials_available() {
  local root="${1:-}"
  if [[ -n "${MANUS_API_KEY:-}" ]]; then
    return 0
  fi
  manus_load_env_file "$root"
  [[ -n "${MANUS_API_KEY:-}" ]]
}

manus_is_retired_task_id() {
  local tid="${1:-}"
  local r
  for r in $MANUS_JD_SYS_RETIRED_TASK_IDS; do
    if [[ "$tid" == "$r" ]]; then
      return 0
    fi
  done
  return 1
}

# Resolve the Manus *project* task used for production sync/publish.
# Prefer MANUS_PROJECT_TASK_ID, then a project-looking MANUS_TASK_ID, else JD SYS default.
# Never silently keep a broken standard Ads task as the deploy target.
# Never keep retired error project tasks.
manus_resolve_project_task_id() {
  local root="${1:-}"
  manus_load_env_file "$root"

  if [[ -n "${MANUS_PROJECT_TASK_ID:-}" ]] && ! manus_is_retired_task_id "${MANUS_PROJECT_TASK_ID}"; then
    printf '%s\n' "$MANUS_PROJECT_TASK_ID"
    return 0
  fi

  # If MANUS_TASK_ID is explicitly the current JD SYS project, keep it.
  local tid="${MANUS_TASK_ID:-}"
  if [[ "$tid" == "$MANUS_JD_SYS_PROJECT_TASK_ID_DEFAULT" ]]; then
    printf '%s\n' "$tid"
    return 0
  fi

  # Legacy/wrong secret often points at a one-off standard Ads task or a
  # retired error project task. Always prefer current JD SYS for production.
  printf '%s\n' "${MANUS_JD_SYS_PROJECT_TASK_ID_DEFAULT}"
}

manus_resolve_agent_profile() {
  local root="${1:-}"
  manus_load_env_file "$root"
  printf '%s\n' "${MANUS_AGENT_PROFILE:-$MANUS_JD_SYS_AGENT_PROFILE_DEFAULT}"
}

manus_website_id() {
  local root="${1:-}"
  manus_load_env_file "$root"
  printf '%s\n' "${MANUS_WEBSITE_ID:-}"
}
