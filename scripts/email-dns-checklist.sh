#!/usr/bin/env bash
# Print DNS checklist for Resend + Google on jdstudiohk.com
# Run: bash scripts/email-dns-checklist.sh
set -euo pipefail

DOMAIN="${1:-jdstudiohk.com}"

echo "=== Email deliverability DNS checklist for ${DOMAIN} ==="
echo
echo "1) Resend Dashboard → Domains → Add ${DOMAIN}"
echo "   Copy the exact records Resend shows (usually):"
echo "   - TXT  resend._domainkey.${DOMAIN}   (DKIM)"
echo "   - TXT  send.${DOMAIN}                (SPF include:amazonses.com)"
echo "   - MX   send.${DOMAIN}                (bounce / feedback)"
echo
echo "2) Apex SPF (merge carefully — only ONE v=spf1 TXT on ${DOMAIN}):"
echo "   v=spf1 include:_spf.google.com include:amazonses.com ~all"
echo
echo "3) DMARC (start monitor-only):"
echo "   TXT _dmarc.${DOMAIN}"
echo "   v=DMARC1; p=none; rua=mailto:info@${DOMAIN};"
echo
echo "4) Env after verify (Manus / production):"
echo "   RESEND_FROM_EMAIL=\"JD Studio HK <info@${DOMAIN}>\""
echo "   EMAIL_REPLY_TO=\"info@${DOMAIN}\""
echo
echo "=== Current public DNS ==="
echo "-- TXT ${DOMAIN} --"
dig +short TXT "${DOMAIN}" || true
echo "-- TXT _dmarc.${DOMAIN} --"
dig +short TXT "_dmarc.${DOMAIN}" || true
echo "-- TXT resend._domainkey.${DOMAIN} --"
dig +short TXT "resend._domainkey.${DOMAIN}" || true
echo "-- TXT send.${DOMAIN} --"
dig +short TXT "send.${DOMAIN}" || true
echo "-- MX send.${DOMAIN} --"
dig +short MX "send.${DOMAIN}" || true
