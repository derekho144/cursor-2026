#!/usr/bin/env bash
# Manual / local uptime check for jdsys.biz (same checks as GitHub Action).
set -euo pipefail
URL="${1:-https://jdsys.biz/api/health}"
HOME_URL="${2:-https://jdsys.biz/}"

code=$(curl -sS -o /tmp/jdsys-health.json -w "%{http_code}" \
  -A "JDStudio-UptimeMonitor/1.0" \
  --connect-timeout 15 --max-time 30 \
  "$URL" || echo "000")
echo "health $URL -> $code"
cat /tmp/jdsys-health.json 2>/dev/null || true
echo

hcode=$(curl -sS -o /dev/null -w "%{http_code}" \
  -A "JDStudio-UptimeMonitor/1.0" \
  --connect-timeout 15 --max-time 30 \
  "$HOME_URL" || echo "000")
echo "home $HOME_URL -> $hcode"

[[ "$code" == "200" && "$hcode" == "200" ]] || exit 1
grep -q '"ok":true\|"ok": true' /tmp/jdsys-health.json
echo "OK"
