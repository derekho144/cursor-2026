#!/usr/bin/env bash
# Launch official Google Ads MCP using existing OAuth refresh-token credentials.
# Reads: ~/.config/jd-studio/google-ads.env  (or GOOGLE_ADS_ENV_FILE)
set -euo pipefail

ENV_FILE="${GOOGLE_ADS_ENV_FILE:-$HOME/.config/jd-studio/google-ads.env}"
CFG_DIR="$HOME/.config/jd-studio"
ADC_FILE="$CFG_DIR/google-ads-adc.json"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing credentials file: $ENV_FILE" >&2
  echo "Copy scripts/google-ads-mcp/env.example → $ENV_FILE and fill values." >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
# strip Windows CR if any
source <(sed 's/\r$//' "$ENV_FILE")
set +a

: "${GOOGLE_ADS_DEVELOPER_TOKEN:?Set GOOGLE_ADS_DEVELOPER_TOKEN in $ENV_FILE}"
: "${GOOGLE_ADS_CLIENT_ID:?Set GOOGLE_ADS_CLIENT_ID in $ENV_FILE}"
: "${GOOGLE_ADS_CLIENT_SECRET:?Set GOOGLE_ADS_CLIENT_SECRET in $ENV_FILE}"
: "${GOOGLE_ADS_REFRESH_TOKEN:?Set GOOGLE_ADS_REFRESH_TOKEN in $ENV_FILE}"
: "${GOOGLE_PROJECT_ID:?Set GOOGLE_PROJECT_ID (GCP project id) in $ENV_FILE}"

LOGIN_CID="${GOOGLE_ADS_LOGIN_CUSTOMER_ID:-${GOOGLE_ADS_CUSTOMER_ID:-}}"
LOGIN_CID="${LOGIN_CID//-/}"

mkdir -p "$CFG_DIR"
umask 077
python3 - <<'PY'
import json, os
data = {
  "type": "authorized_user",
  "client_id": os.environ["GOOGLE_ADS_CLIENT_ID"],
  "client_secret": os.environ["GOOGLE_ADS_CLIENT_SECRET"],
  "refresh_token": os.environ["GOOGLE_ADS_REFRESH_TOKEN"],
}
path = os.path.expanduser("~/.config/jd-studio/google-ads-adc.json")
with open(path, "w") as f:
  json.dump(data, f, indent=2)
  f.write("\n")
PY

export GOOGLE_APPLICATION_CREDENTIALS="$ADC_FILE"
export GOOGLE_PROJECT_ID
export GOOGLE_CLOUD_PROJECT="$GOOGLE_PROJECT_ID"
export GOOGLE_ADS_DEVELOPER_TOKEN
if [[ -n "$LOGIN_CID" ]]; then
  export GOOGLE_ADS_LOGIN_CUSTOMER_ID="$LOGIN_CID"
fi

PIPX_BIN="${PIPX_BIN:-}"
if [[ -z "$PIPX_BIN" ]]; then
  for c in \
    "$HOME/.local/bin/google-ads-mcp" \
    "$HOME/Library/Python/3.14/bin/google-ads-mcp" \
    "$(command -v google-ads-mcp 2>/dev/null || true)"
  do
    if [[ -n "$c" && -x "$c" ]]; then PIPX_BIN="$c"; break; fi
  done
fi

if [[ -z "${PIPX_BIN:-}" ]]; then
  export PATH="$HOME/Library/Python/3.14/bin:$HOME/.local/bin:$PATH"
  if command -v pipx >/dev/null 2>&1; then
    exec pipx run --spec "git+https://github.com/googleads/google-ads-mcp.git" google-ads-mcp
  fi
  echo "google-ads-mcp not found. Run: pipx install git+https://github.com/googleads/google-ads-mcp.git" >&2
  exit 1
fi

exec "$PIPX_BIN"
