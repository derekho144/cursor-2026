#!/usr/bin/env bash
# Verify JD SYS production URLs are on Manus managed hosting (not Railway).
#
# Fails if any URL returns non-200 (after redirects) or the response body
# mentions *.up.railway.app (Cloudflare 502 Host label or page text).
#
# Usage:
#   bash scripts/manus-verify-hosting.sh
#   bash scripts/manus-verify-hosting.sh --urls "https://jdsys.biz,https://www.jdsys.biz"
set -euo pipefail

URLS_DEFAULT="https://jdsys.biz,https://www.jdsys.biz,https://jdsys.manus.space,https://jdstudiohub-vbnwsjv6.manus.space"
URLS="${MANUS_VERIFY_URLS:-$URLS_DEFAULT}"

if [[ "${1:-}" == "--urls" ]]; then
  URLS="${2:-$URLS}"
fi

python3 - "$URLS" <<'PY'
import re, subprocess, sys

urls = [u.strip() for u in sys.argv[1].split(",") if u.strip()]
rail_re = re.compile(r"[\w.-]+\.up\.railway\.app", re.I)
fail = 0

for url in urls:
    proc = subprocess.run(
        [
            "curl", "-sS", "--max-time", "25", "-L",
            "-o", "/tmp/manus-verify-body.html",
            "-w", "%{http_code}",
            url,
        ],
        capture_output=True,
        text=True,
    )
    code = (proc.stdout or "").strip()
    body = ""
    try:
        body = open("/tmp/manus-verify-body.html", "r", errors="replace").read()
    except OSError:
        pass
    rails = sorted(set(rail_re.findall(body)))
    title_m = re.search(r"<title>([^<]+)</title>", body, re.I)
    title = (title_m.group(1) if title_m else "")[:80]
    ok = code == "200" and not rails and "502" not in title
    status = "OK" if ok else "FAIL"
    print(f"{status} {url} http={code} railway={rails or '-'} title={title!r}")
    if not ok:
        fail = 1

if fail:
    print(
        "manus-verify-hosting: production is NOT on clean Manus managed hosting. "
        "Remove Railway origin in Manus WebDev (website_id=VbnWSJV6UQ79sGuykqPPae) "
        "and republish.",
        file=sys.stderr,
    )
    sys.exit(2)
print("manus-verify-hosting: all URLs healthy (no Railway origin)")
PY
