#!/usr/bin/env bash
# Trigger Manus: Pull GitHub main → checkpoint → Publish jdsys.biz
# Requires .env: MANUS_API_KEY, MANUS_TASK_ID, MANUS_WEBSITE_ID
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

API_BASE="${MANUS_API_BASE:-https://api.manus.ai}"
KEY="${MANUS_API_KEY:-}"
TASK_ID="${MANUS_TASK_ID:-}"
WEBSITE_ID="${MANUS_WEBSITE_ID:-}"

if [[ -z "$KEY" || -z "$TASK_ID" ]]; then
  echo "manus-auto-deploy: missing MANUS_API_KEY or MANUS_TASK_ID" >&2
  exit 1
fi

SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
MSG=$(git log -1 --pretty=%s 2>/dev/null || echo "")
FULL=$(git rev-parse HEAD 2>/dev/null || echo "")

export API_BASE KEY TASK_ID WEBSITE_ID SHA MSG FULL

python3 <<'PY'
import json, os, subprocess, sys, time

api_base = os.environ["API_BASE"]
key = os.environ["KEY"]
task_id = os.environ["TASK_ID"]
website_id = os.environ.get("WEBSITE_ID") or ""
sha = os.environ["SHA"]
msg = os.environ["MSG"]
full = os.environ["FULL"]

prompt = f"""請立即執行（唔使再問確認）：

1. Pull / Sync GitHub main，目標 commit：{sha}（{full}）— {msg}
2. 確認工作區已包含該 commit 的改動
3. 保存 checkpoint
4. Publish 到 jdsys.biz（production）
5. 完成後只回報：SHA、checkpoint/version id、publish_status、site URLs

唔好改其他代碼。"""


def api(method: str, path: str, body=None):
    url = f"{api_base}/v2/{path}"
    cmd = [
        "curl", "-sS", "-X", method,
        "-H", f"x-manus-api-key: {key}",
        "-H", "Accept: application/json",
    ]
    if body is not None:
        cmd += ["-H", "Content-Type: application/json", "-d", json.dumps(body, ensure_ascii=False)]
    raw = subprocess.check_output(cmd + [url], text=True)
    try:
        return json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {"ok": False, "error": {"message": raw}}


print(f"manus-auto-deploy: sending sync+publish for {sha} …")
send = api(
    "POST",
    "task.sendMessage",
    {
        "task_id": task_id,
        "message": {"content": prompt},
        "agent_profile": "manus-1.6",
    },
)
if not send.get("ok"):
    print("sendMessage failed:", json.dumps(send, ensure_ascii=False), file=sys.stderr)
    sys.exit(2)
print("sendMessage ok")

confirmed = set()
deadline = time.time() + 15 * 60
last = None

while time.time() < deadline:
    detail = api("GET", f"task.detail?task_id={task_id}")
    status = (detail.get("status") or detail.get("agent_status") or "").lower()
    if status != last:
        print(f"task status: {status or detail}")
        last = status

    msgs = api("GET", f"task.listMessages?task_id={task_id}&limit=30&order=desc")
    for ev in msgs.get("data") or msgs.get("messages") or []:
        wait_type = ev.get("waiting_for_event_type") or ""
        event_id = ev.get("waiting_for_event_id") or ""
        if status == "waiting" and not event_id:
            event_id = ev.get("event_id") or ev.get("id") or ""
        if (
            event_id
            and event_id not in confirmed
            and wait_type
            and wait_type != "messageAskUser"
        ):
            print(f"auto-confirm: {wait_type} ({event_id})")
            conf = api(
                "POST",
                "task.confirmAction",
                {"task_id": task_id, "event_id": event_id},
            )
            print("confirm:", conf.get("ok"), conf.get("error"))
            confirmed.add(event_id)

    if status in ("stopped", "error"):
        break
    time.sleep(5)

if website_id:
    pub = api(
        "POST",
        "website.publish",
        {"website_id": website_id, "visibility": "public"},
    )
    print(
        "website.publish:",
        json.dumps(
            {k: pub.get(k) for k in ("ok", "version_id", "website_id", "error")},
            ensure_ascii=False,
        ),
    )
    for _ in range(60):
        st = api("GET", f"website.status?website_id={website_id}")
        ps = st.get("publish_status")
        print(
            f"publish_status: {ps} version={st.get('version_id')} urls={st.get('site_urls')}"
        )
        if ps in ("published", "failed"):
            if ps != "published":
                sys.exit(3)
            break
        time.sleep(3)

print("manus-auto-deploy: done")
PY
