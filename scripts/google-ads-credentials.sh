#!/usr/bin/env bash
# Shared Google Ads credentials for JD Studio, gads-cli, ARBA, MCP, and weekly QS review.
#
# Resolution order (first match wins for each key):
#   1. Already-exported process env (Cloud Agent secrets / production)
#   2. GOOGLE_ADS_ENV_FILE (default ~/.config/jd-studio/google-ads.env)
#   3. Repo .env (if present)
#
# Usage:
#   source scripts/google-ads-credentials.sh
#   google_ads_credentials_available && echo ok
#   google_ads_write_arba_yaml   # writes ~/.config/jd-studio/google-ads.yaml for ARBA

set -euo pipefail

_GOOGLE_ADS_CRED_ROOT="${GOOGLE_ADS_CRED_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
GOOGLE_ADS_ENV_FILE="${GOOGLE_ADS_ENV_FILE:-$HOME/.config/jd-studio/google-ads.env}"
GOOGLE_ADS_YAML_FILE="${GOOGLE_ADS_YAML_FILE:-$HOME/.config/jd-studio/google-ads.yaml}"

_google_ads_load_env_file() {
  local file="$1"
  [[ -f "$file" ]] || return 1
  set -a
  # shellcheck disable=SC1090
  source "$file"
  set +a
  return 0
}

google_ads_load_credentials() {
  if [[ -n "${GOOGLE_ADS_DEVELOPER_TOKEN:-}" && -n "${GOOGLE_ADS_CLIENT_ID:-}" && -n "${GOOGLE_ADS_CLIENT_SECRET:-}" ]]; then
    :
  elif _google_ads_load_env_file "$GOOGLE_ADS_ENV_FILE"; then
    :
  elif [[ -f "$_GOOGLE_ADS_CRED_ROOT/.env" ]]; then
    _google_ads_load_env_file "$_GOOGLE_ADS_CRED_ROOT/.env"
  fi

  # Normalize IDs (strip dashes)
  if [[ -n "${GOOGLE_ADS_CUSTOMER_ID:-}" ]]; then
    export GOOGLE_ADS_CUSTOMER_ID="${GOOGLE_ADS_CUSTOMER_ID//-/}"
  fi
  if [[ -n "${GOOGLE_ADS_LOGIN_CUSTOMER_ID:-}" ]]; then
    export GOOGLE_ADS_LOGIN_CUSTOMER_ID="${GOOGLE_ADS_LOGIN_CUSTOMER_ID//-/}"
  fi
  if [[ -n "${GOOGLE_ADS_AD_ACCOUNT_ID:-}" ]]; then
    export GOOGLE_ADS_AD_ACCOUNT_ID="${GOOGLE_ADS_AD_ACCOUNT_ID//-/}"
  fi

  # Aliases used by gads-cli / ARBA
  export GOOGLE_ADS_LOGIN_CUSTOMER_ID="${GOOGLE_ADS_LOGIN_CUSTOMER_ID:-${GOOGLE_ADS_CUSTOMER_ID:-}}"
  export GOOGLE_ADS_AD_ACCOUNT_ID="${GOOGLE_ADS_AD_ACCOUNT_ID:-4839352747}"

  # ARBA workflow-config expects ADS_CONFIG path
  export ADS_CONFIG="${ADS_CONFIG:-$GOOGLE_ADS_YAML_FILE}"
}

google_ads_credentials_available() {
  google_ads_load_credentials
  [[ -n "${GOOGLE_ADS_DEVELOPER_TOKEN:-}" \
    && -n "${GOOGLE_ADS_CLIENT_ID:-}" \
    && -n "${GOOGLE_ADS_CLIENT_SECRET:-}" \
    && -n "${GOOGLE_ADS_REFRESH_TOKEN:-}" \
    && -n "${GOOGLE_ADS_CUSTOMER_ID:-}" ]]
}

google_ads_write_arba_yaml() {
  google_ads_load_credentials
  if ! google_ads_credentials_available; then
    echo "google-ads-credentials: missing required vars for ARBA yaml" >&2
    return 1
  fi
  mkdir -p "$(dirname "$GOOGLE_ADS_YAML_FILE")"
  cat >"$GOOGLE_ADS_YAML_FILE" <<YAML
developer_token: ${GOOGLE_ADS_DEVELOPER_TOKEN}
client_id: ${GOOGLE_ADS_CLIENT_ID}
client_secret: ${GOOGLE_ADS_CLIENT_SECRET}
refresh_token: ${GOOGLE_ADS_REFRESH_TOKEN}
login_customer_id: ${GOOGLE_ADS_LOGIN_CUSTOMER_ID}
use_proto_plus: True
YAML
  echo "google-ads-credentials: wrote ARBA config → $GOOGLE_ADS_YAML_FILE"
}

# Auto-load when sourced
google_ads_load_credentials
