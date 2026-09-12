#!/usr/bin/env bash
# Shared Manus deploy credentials + JD SYS project task resolution.
#
# Fixed production path (single source of truth):
#   GitHub main → sync JD SYS project → checkpoint → website.publish
#
# Canonical JD SYS project task id (override with MANUS_PROJECT_TASK_ID):
#   PTxdA5w7AUDNxF2XREC0dk
set -euo pipefail

# Canonical production project on Manus (JD SYS).
MANUS_JD_SYS_PROJECT_TASK_ID_DEFAULT="PTxdA5w7AUDNxF2XREC0dk"

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

# Resolve the Manus *project* task used for production sync/publish.
# Prefer MANUS_PROJECT_TASK_ID, then a project-looking MANUS_TASK_ID, else JD SYS default.
# Never silently keep a broken standard Ads task as the deploy target.
manus_resolve_project_task_id() {
  local root="${1:-}"
  manus_load_env_file "$root"

  if [[ -n "${MANUS_PROJECT_TASK_ID:-}" ]]; then
    printf '%s\n' "$MANUS_PROJECT_TASK_ID"
    return 0
  fi

  # If MANUS_TASK_ID is explicitly the JD SYS project (or another project id
  # the operator set), keep it. Otherwise fall back to the canonical JD SYS id.
  local tid="${MANUS_TASK_ID:-}"
  if [[ "$tid" == "$MANUS_JD_SYS_PROJECT_TASK_ID_DEFAULT" ]]; then
    printf '%s\n' "$tid"
    return 0
  fi

  # Legacy/wrong secret often points at a one-off standard Ads task.
  # Always prefer JD SYS for production deploys.
  printf '%s\n' "${MANUS_JD_SYS_PROJECT_TASK_ID_DEFAULT}"
}

manus_website_id() {
  local root="${1:-}"
  manus_load_env_file "$root"
  printf '%s\n' "${MANUS_WEBSITE_ID:-}"
}
