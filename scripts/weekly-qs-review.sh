#!/usr/bin/env bash
# Weekly Google Ads Quality Score review.
# Uses gads-cli when installed; falls back to built-in TS report (same credentials).
#
# Usage:
#   bash scripts/weekly-qs-review.sh
#   DAYS=14 OUT_DIR=/tmp/qs bash scripts/weekly-qs-review.sh
#
# Cron (Monday 08:00 HKT = 00:00 UTC):
#   0 0 * * 1 cd /path/to/repo && bash scripts/weekly-qs-review.sh >> /var/log/jd-qs-review.log 2>&1

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
source "$ROOT/scripts/google-ads-credentials.sh"

DAYS="${DAYS:-30}"
STAMP="$(date +%Y-%m-%d)"
OUT_DIR="${OUT_DIR:-$ROOT/reports/qs-review-$STAMP}"
mkdir -p "$OUT_DIR"

if ! google_ads_credentials_available; then
  echo "weekly-qs-review: missing Google Ads credentials." >&2
  echo "  Set Cloud Agent secrets or ~/.config/jd-studio/google-ads.env" >&2
  echo "  Template: scripts/google-ads-mcp/env.example" >&2
  exit 1
fi

google_ads_write_arba_yaml >/dev/null

echo "weekly-qs-review: output → $OUT_DIR (last ${DAYS} days)"

_run_gads() {
  local name="$1"
  shift
  echo "  → gads $*"
  if "$@" >"$OUT_DIR/$name" 2>"$OUT_DIR/$name.err"; then
    rm -f "$OUT_DIR/$name.err"
  else
    echo "    warn: gads failed (see $OUT_DIR/$name.err)" >&2
  fi
}

if command -v gads >/dev/null 2>&1; then
  echo "weekly-qs-review: using gads-cli"
  _run_gads doctor.json gads doctor --json
  _run_gads audit.md gads audit --days "$DAYS" --format md
  _run_gads qs-distribution.json gads analyze qs-distribution --json
  _run_gads landing-page.json gads analyze landing-page --json
  _run_gads wasted-spend.json gads analyze wasted-spend --json
  _run_gads ad-copy.json gads analyze ad-copy --json
  _run_gads budget-is.json gads analyze budget-is --json
  _run_gads competition.json gads analyze competition --json
else
  echo "weekly-qs-review: gads-cli not found — using built-in TS report"
  npx tsx "$ROOT/scripts/google-ads-quality-report.ts" --days "$DAYS" --out "$OUT_DIR"
fi

# Metadata for ARBA / ops
cat >"$OUT_DIR/meta.json" <<META
{
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "days": ${DAYS},
  "adAccountId": "${GOOGLE_ADS_AD_ACCOUNT_ID}",
  "loginCustomerId": "${GOOGLE_ADS_LOGIN_CUSTOMER_ID}",
  "arbaYaml": "${GOOGLE_ADS_YAML_FILE}",
  "tool": "$(command -v gads >/dev/null 2>&1 && echo gads-cli || echo jd-studio-ts)"
}
META

echo "weekly-qs-review: done → $OUT_DIR"
ls -la "$OUT_DIR"
