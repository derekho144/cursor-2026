#!/usr/bin/env bash
# After git push: trigger Manus auto-deploy (no user paste needed).
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

# Fire-and-forget deploy if credentials exist
if [[ -f "$ROOT/.env" ]] && grep -q '^MANUS_API_KEY=' "$ROOT/.env" 2>/dev/null; then
  (
    cd "$ROOT"
    nohup bash scripts/manus-auto-deploy.sh >"$ROOT/.git/manus-auto-deploy.log" 2>&1 &
  ) || true
  ctx=$(python3 -c '
import json,sys
sha,msg=sys.argv[1],sys.argv[2]
print(json.dumps({
  "additional_context": (
    f"Git push 已執行（HEAD {sha}: {msg}）。"
    "已自動觸發 Manus Pull/Sync + Publish（scripts/manus-auto-deploy.sh）。"
    "唔使叫用戶通知 Manus；回覆報告部署已觸發／結果即可。"
  )
}, ensure_ascii=False))
' "$SHA" "$MSG")
  echo "$ctx"
  exit 0
fi

python3 -c '
import json,sys
sha,msg=sys.argv[1],sys.argv[2]
print(json.dumps({
  "additional_context": (
    f"Git push 已執行（HEAD {sha}: {msg}）。"
    "未設定 MANUS_API_KEY，請在回覆末尾附 Manus paste block。"
  )
}, ensure_ascii=False))
' "$SHA" "$MSG"
