#!/usr/bin/env bash
# Email deliverability notes for JD Studio
# Current production From: info.exposurehk@gmail.com (Gmail SMTP)
set -euo pipefail

echo "=== Current setup ==="
echo "From: JD Studio HK <info.exposurehk@gmail.com> via Gmail SMTP"
echo "App password must be set on GMAIL_USER / GMAIL_APP_PASSWORD"
echo
echo "=== Reduce Gmail → spam (practical) ==="
echo "1. Google Account → send as yourself only (no spoofed From)"
echo "2. Ask clients to Add to contacts / Not spam"
echo "3. Avoid sudden spikes of cold outreach from the same mailbox"
echo "4. Keep quote PDF attachments; avoid spammy subject lines"
echo
echo "=== Optional later: custom domain via Resend ==="
echo "If you switch to @jdstudiohk.com later:"
echo "  RESEND_FROM_EMAIL=\"JD Studio HK <info@jdstudiohk.com>\""
echo "  + Resend domain verify (DKIM/SPF on send.jdstudiohk.com)"
