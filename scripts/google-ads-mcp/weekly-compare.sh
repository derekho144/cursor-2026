#!/usr/bin/env bash
# 7-day Google Ads comparison report (uses MCP env + GAQL via export script pattern).
# Usage:
#   bash scripts/google-ads-mcp/weekly-compare.sh
#   bash scripts/google-ads-mcp/weekly-compare.sh scripts/google-ads-mcp/baseline-2026-07-28.json
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASELINE="${1:-$ROOT/scripts/google-ads-mcp/baseline-2026-07-28.json}"
exec npx tsx "$ROOT/scripts/google-ads-mcp/weekly-compare.ts" "$BASELINE"
