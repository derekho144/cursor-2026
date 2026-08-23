#!/usr/bin/env bash
# Email deliverability for JD Studio
# Target: From @jdstudiohk.com + Reply-To info.exposurehk@gmail.com
set -euo pipefail

cat <<'EOF'
=== Current production ===
From:     JD Studio HK <info.exposurehk@gmail.com>  (Gmail SMTP)
Reply-To: same (clients reply to the Gmail they already know)

=== Upgrade path (better inbox, same reply mailbox) ===
Goal:
  From:     JD Studio HK <info@jdstudiohk.com>   ← Resend + verified domain (chosen)
  Reply-To: info.exposurehk@gmail.com            ← clients still reply here

Steps in Resend (https://resend.com/domains):
  1. Add domain: jdstudiohk.com
  2. Add the DNS records Resend shows (usually):
       - DKIM  CNAME  (resend._domainkey…)
       - SPF   TXT or MX for send subdomain (e.g. send.jdstudiohk.com)
       - Optional DMARC TXT on _dmarc.jdstudiohk.com
  3. Wait until Resend shows domain = Verified
  4. Send a test from Resend dashboard as info@jdstudiohk.com

Then set Manus / server env:
  RESEND_FROM_EMAIL="JD Studio HK <info@jdstudiohk.com>"
  EMAIL_REPLY_TO="info.exposurehk@gmail.com"
  RESEND_API_KEY=…   (already set)
  GMAIL_USER / GMAIL_APP_PASSWORD stay for outreach + fallback

Code already:
  - Uses RESEND_FROM_EMAIL for quote/transactional when set
  - Sets Reply-To to Gmail by default
  - Keeps Freehunter / cold mail on Gmail (purpose: outreach)

After env change: Manus Pull/Sync + Publish (or manus-auto-deploy.sh).

=== While still on Gmail From ===
  - Ask clients to Add contact / Not spam
  - Avoid blasting cold outreach from the same mailbox as quotes
EOF
