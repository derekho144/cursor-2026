#!/usr/bin/env bash
# After successful git push: mark pending Manus sync + remind agent in this turn.
set -euo pipefail
input=$(cat)

cmd=$(printf '%s' "$input" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("command") or "")' 2>/dev/null || true)

if ! printf '%s' "$cmd" | grep -qiE 'git push'; then
  echo '{}'
  exit 0
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SHA=$(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo "")
MSG=$(cd "$ROOT" && git log -1 --pretty=%s 2>/dev/null || echo "")
MARKER="$ROOT/.git/manus-pending-sync"

{
  printf '%s\n' "$SHA"
  printf '%s\n' "$MSG"
} > "$MARKER" 2>/dev/null || true

python3 -c '
import json, sys
sha, msg = sys.argv[1], sys.argv[2]
ctx = (
  f"Git push 已執行（HEAD {sha}: {msg}）。"
  "請在最終回覆末尾自動附上可貼去 Manus 的 Pull/Sync + Publish 指令（含此 SHA），"
  "唔使等用戶提醒。"
)
print(json.dumps({"additional_context": ctx}, ensure_ascii=False))
' "$SHA" "$MSG"
