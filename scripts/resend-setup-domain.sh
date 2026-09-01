#!/usr/bin/env bash
# Create / inspect Resend domain for JD Studio (jdstudiohk.com)
# Usage:
#   RESEND_API_KEY=re_xxx bash scripts/resend-setup-domain.sh
#   RESEND_API_KEY=re_xxx bash scripts/resend-setup-domain.sh verify
#   RESEND_API_KEY=re_xxx bash scripts/resend-setup-domain.sh status
set -euo pipefail

DOMAIN="${RESEND_DOMAIN:-jdstudiohk.com}"
REGION="${RESEND_REGION:-ap-northeast-1}"
API="https://api.resend.com"
KEY="${RESEND_API_KEY:-}"

if [[ -z "$KEY" ]]; then
  echo "Missing RESEND_API_KEY (re_...)" >&2
  exit 1
fi

cmd="${1:-setup}"

api() {
  local method="$1" path="$2" body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -sS -X "$method" "$API$path" \
      -H "Authorization: Bearer $KEY" \
      -H "Content-Type: application/json" \
      -d "$body"
  else
    curl -sS -X "$method" "$API$path" \
      -H "Authorization: Bearer $KEY" \
      -H "Content-Type: application/json"
  fi
}

print_records() {
  python3 -c '
import json, sys
data = json.load(sys.stdin)
name = data.get("name")
status = data.get("status")
did = data.get("id")
records = data.get("records") or []
print(f"Domain: {name}")
print(f"ID:     {did}")
print(f"Status: {status}")
print()
print("=== Add these DNS records at your registrar ===")
print(f"{chr(10).join([])}", end="")
hdr = f"{"TYPE":<6} {"NAME/HOST":<55} {"VALUE":<70} {"PRI":<5} STATUS"
print(hdr)
print("-" * len(hdr))
for r in records:
    typ = str(r.get("type") or "")
    host = str(r.get("name") or "")
    val = str(r.get("value") or "")
    pri = "" if r.get("priority") is None else str(r.get("priority"))
    st = str(r.get("status") or "")
    print(f"{typ:<6} {host:<55} {val:<70} {pri:<5} {st}")
print()
print("After DNS is live:")
print("  RESEND_API_KEY=… bash scripts/resend-setup-domain.sh verify")
print("Then set Manus env:")
print('  RESEND_FROM_EMAIL="JD Studio HK <info@jdstudiohk.com>"')
print('  EMAIL_REPLY_TO="info.exposurehk@gmail.com"')
'
}

list_domains() {
  api GET /domains
}

find_domain_id() {
  list_domains | DOMAIN="$DOMAIN" python3 -c '
import json, os, sys
d = json.load(sys.stdin)
items = d.get("data") or d.get("domains") or []
want = os.environ["DOMAIN"]
for x in items:
  if x.get("name") == want:
    print(x.get("id") or "")
    break
'
}

get_domain() {
  api GET "/domains/$1"
}

case "$cmd" in
  list)
    list_domains | python3 -m json.tool
    ;;
  setup)
    existing="$(find_domain_id || true)"
    if [[ -n "$existing" ]]; then
      echo "Domain already exists: $DOMAIN ($existing)"
      raw="$(get_domain "$existing")"
    else
      echo "Creating domain $DOMAIN (region=$REGION)…"
      raw="$(api POST /domains "{\"name\":\"$DOMAIN\",\"region\":\"$REGION\"}")"
      if echo "$raw" | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("id") else 1)' 2>/dev/null; then
        :
      else
        echo "$raw" | python3 -m json.tool || echo "$raw"
        existing="$(find_domain_id || true)"
        if [[ -z "$existing" ]]; then
          echo "Create failed" >&2
          exit 2
        fi
        raw="$(get_domain "$existing")"
      fi
    fi
    echo "$raw" | tee "/tmp/resend-domain-${DOMAIN}.json" | print_records
    ;;
  verify)
    id="$(find_domain_id)"
    if [[ -z "$id" ]]; then
      echo "Domain $DOMAIN not found. Run setup first." >&2
      exit 2
    fi
    echo "Triggering verify for $DOMAIN ($id)…"
    api POST "/domains/$id/verify" | python3 -m json.tool || true
    sleep 2
    get_domain "$id" | tee "/tmp/resend-domain-${DOMAIN}.json" | print_records
    ;;
  status)
    id="$(find_domain_id)"
    if [[ -z "$id" ]]; then
      echo "Domain $DOMAIN not found." >&2
      exit 2
    fi
    get_domain "$id" | tee "/tmp/resend-domain-${DOMAIN}.json" | print_records
    ;;
  *)
    echo "Usage: $0 [setup|verify|status|list]" >&2
    exit 1
    ;;
esac
