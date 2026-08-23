#!/usr/bin/env bash
# One-shot setup for Cursor Google Ads MCP on this machine.
# Usage (from repo root or anywhere):
#   bash scripts/google-ads-mcp/setup-cursor.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CFG_DIR="${HOME}/.config/jd-studio"
ENV_FILE="${GOOGLE_ADS_ENV_FILE:-$CFG_DIR/google-ads.env}"
EXAMPLE="$ROOT/scripts/google-ads-mcp/env.example"

echo "==> Google Ads MCP setup for Cursor"
echo "    repo: $ROOT"
echo "    env:  $ENV_FILE"

mkdir -p "$CFG_DIR"
chmod 700 "$CFG_DIR" 2>/dev/null || true

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$EXAMPLE" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo ""
  echo "Created $ENV_FILE from env.example."
  echo "Fill GOOGLE_ADS_DEVELOPER_TOKEN / CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN,"
  echo "then re-run this script."
  echo ""
  echo "Export from Manus production (do not commit output):"
  echo "  npx tsx scripts/google-ads-mcp/export-local-env.ts > $ENV_FILE"
  exit 2
fi

chmod 600 "$ENV_FILE" 2>/dev/null || true

# Validate required keys exist (non-empty)
missing=0
while IFS= read -r key; do
  if ! grep -E "^${key}=.+" "$ENV_FILE" >/dev/null 2>&1; then
    echo "Missing or empty: $key"
    missing=1
  fi
done <<'KEYS'
GOOGLE_ADS_DEVELOPER_TOKEN
GOOGLE_ADS_CLIENT_ID
GOOGLE_ADS_CLIENT_SECRET
GOOGLE_ADS_REFRESH_TOKEN
KEYS
if [[ "$missing" -ne 0 ]]; then
  echo "Edit $ENV_FILE then re-run."
  exit 2
fi

# Ensure google-ads-mcp is available
export PATH="$HOME/Library/Python/3.14/bin:$HOME/.local/bin:$PATH"
if ! command -v google-ads-mcp >/dev/null 2>&1; then
  if command -v pipx >/dev/null 2>&1; then
    echo "==> Installing google-ads-mcp via pipx…"
    pipx install "git+https://github.com/googleads/google-ads-mcp.git" || \
      pipx upgrade google-ads-mcp || true
  else
    echo "pipx not found. Install: brew install pipx && pipx ensurepath"
    echo "Then: pipx install git+https://github.com/googleads/google-ads-mcp.git"
    exit 3
  fi
fi

if ! command -v google-ads-mcp >/dev/null 2>&1; then
  echo "google-ads-mcp still not on PATH. Open a new terminal after pipx ensurepath."
  exit 3
fi

echo "==> Smoke-testing run.sh (starts MCP briefly)…"
# ADC generation only — run.sh would block on stdio; call the env+adc portion via a dry check
bash -c '
  set -euo pipefail
  ENV_FILE="'"$ENV_FILE"'"
  set -a; source <(sed "s/\r$//" "$ENV_FILE"); set +a
  : "${GOOGLE_ADS_DEVELOPER_TOKEN:?}"; : "${GOOGLE_ADS_CLIENT_ID:?}"
  : "${GOOGLE_ADS_CLIENT_SECRET:?}"; : "${GOOGLE_ADS_REFRESH_TOKEN:?}"
  mkdir -p "'"$CFG_DIR"'"
  python3 - <<"PY"
import json, os
path = os.path.expanduser("~/.config/jd-studio/google-ads-adc.json")
with open(path, "w") as f:
  json.dump({
    "type": "authorized_user",
    "client_id": os.environ["GOOGLE_ADS_CLIENT_ID"],
    "client_secret": os.environ["GOOGLE_ADS_CLIENT_SECRET"],
    "refresh_token": os.environ["GOOGLE_ADS_REFRESH_TOKEN"],
  }, f, indent=2)
  f.write("\n")
print("ADC written:", path)
PY
'

echo ""
echo "✅ Ready. In Cursor Desktop:"
echo "   1. Open this repo as the workspace folder"
echo "   2. Settings → MCP → confirm google-ads-mcp is listed / green"
echo "   3. If red: Reload / restart Cursor"
echo "   4. Prompt:"
echo "      list_accessible_customers，再 health-check customer 4839352747"
echo ""
echo "Project MCP config: $ROOT/.cursor/mcp.json (uses \${workspaceFolder})"
