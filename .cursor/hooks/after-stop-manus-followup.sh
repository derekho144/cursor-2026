#!/usr/bin/env bash
# After agent stop: only follow up with Manus paste if API auto-deploy is NOT configured.
set -euo pipefail
input=$(cat)

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MARKER="$ROOT/.git/manus-pending-sync"

loop_count=$(printf '%s' "$input" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(int(d.get("loop_count") or 0))' 2>/dev/null || echo "0")
if [[ "$loop_count" != "0" ]]; then
  echo '{}'
  exit 0
fi

# API auto-deploy configured → no paste follow-up
if [[ -f "$ROOT/.env" ]] && grep -q '^MANUS_API_KEY=' "$ROOT/.env" 2>/dev/null; then
  rm -f "$MARKER" 2>/dev/null || true
  echo '{}'
  exit 0
fi

if [[ ! -f "$MARKER" ]]; then
  echo '{}'
  exit 0
fi

SHA=$(head -1 "$MARKER" 2>/dev/null || true)
MSG=$(sed -n '2p' "$MARKER" 2>/dev/null || true)
rm -f "$MARKER"

if [[ -z "$SHA" ]]; then
  echo '{}'
  exit 0
fi

python3 -c '
import json, sys
sha, msg = sys.argv[1], sys.argv[2]
followup = (
  f"自動跟進：剛 push 咗 {sha}"
  + (f"（{msg}）" if msg else "")
  + "。請確認已上 GitHub，並喺回覆末尾輸出可貼去 Manus 嘅 Pull/Sync + Publish 指令（含 commit SHA，目標 jdsys.biz）。唔使再問用戶。"
)
print(json.dumps({"followup_message": followup}, ensure_ascii=False))
' "$SHA" "$MSG"
