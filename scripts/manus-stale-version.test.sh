#!/usr/bin/env bash
# Lightweight checks for stale-version deploy helpers (no live Manus calls).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

python3 <<'PY'
import re, pathlib

text = pathlib.Path("scripts/manus-auto-deploy.sh").read_text()
assert "StalePublish" in text
assert "max_attempts = 3" in text
assert "forbid_vid" in text
assert "deploy_revision_markers" in text
assert "Will retry JD SYS sync+checkpoint" in text
assert "set -o pipefail" in text.split("python3", 1)[0] or "pipefail" in text[:800]
# Ensure we no longer hard-exit on first stale without retry in the main path
# (publish-only still REFUSING exit 11).
assert "exhausted retries without a new website version" in text
print("manus-stale-version.test.sh OK")
PY
