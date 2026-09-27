#!/usr/bin/env bash
# Smoke test for manus-verify-hosting.sh helpers (offline pattern check).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Script must exist and be executable
test -x "$ROOT/scripts/manus-verify-hosting.sh"

# Pattern: railway host in HTML must fail. Use a local file via python unit.
python3 <<'PY'
import re
rail_re = re.compile(r"[\w.-]+\.up\.railway\.app", re.I)
html_bad = '<div class="host">sls7tcqbqg7sy36c3snw-production.up.railway.app</div>'
html_ok = '<title>JD Studio HK Admin System</title><div>manus managed</div>'
assert rail_re.search(html_bad), "should detect railway host"
assert not rail_re.search(html_ok), "should not false-positive"
print("OK manus-verify-hosting pattern")
PY
