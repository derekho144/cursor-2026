#!/usr/bin/env bash
# Fixed production deploy path:
#   GitHub main (SoT) → sync JD SYS project → checkpoint → Publish jdsys.biz
#
# Requires: MANUS_API_KEY, MANUS_WEBSITE_ID
# Task: MANUS_PROJECT_TASK_ID (preferred) or defaults to JD SYS 7VkPFZNKqwNQihpncANHuQ
#
# Usage:
#   bash scripts/manus-auto-deploy.sh
#   bash scripts/manus-auto-deploy.sh --dry-run
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

# shellcheck disable=SC1091
source "$(dirname "$0")/manus-credentials.sh"
manus_load_env_file "$ROOT"

if ! manus_credentials_available "$ROOT"; then
  echo "manus-auto-deploy: missing MANUS_API_KEY (set Cloud Agent secrets or .env)" >&2
  exit 1
fi

API_BASE="${MANUS_API_BASE:-https://api.manus.ai}"
KEY="${MANUS_API_KEY:-}"
TASK_ID="$(manus_resolve_project_task_id "$ROOT")"
WEBSITE_ID="$(manus_website_id "$ROOT")"
SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
FULL="$(git rev-parse HEAD 2>/dev/null || echo "")"
MSG="$(git log -1 --pretty=%s 2>/dev/null || echo "")"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"

if [[ -z "$WEBSITE_ID" ]]; then
  echo "manus-auto-deploy: missing MANUS_WEBSITE_ID" >&2
  exit 1
fi

echo "manus-auto-deploy: SoT GitHub HEAD ${SHA} (${BRANCH})"
echo "manus-auto-deploy: JD SYS task ${TASK_ID}"
echo "manus-auto-deploy: website ${WEBSITE_ID}"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "manus-auto-deploy: dry-run only (no sendMessage / publish)"
  exit 0
fi

export API_BASE KEY TASK_ID WEBSITE_ID SHA FULL MSG BRANCH

python3 <<'PY'
import json, os, subprocess, sys, time

api_base = os.environ["API_BASE"]
key = os.environ["KEY"]
task_id = os.environ["TASK_ID"]
website_id = os.environ["WEBSITE_ID"]
sha = os.environ["SHA"]
full = os.environ["FULL"]
msg = os.environ["MSG"]
branch = os.environ.get("BRANCH") or ""


def api(method: str, path: str, body=None):
    url = f"{api_base}/v2/{path}"
    cmd = [
        "curl", "-sS", "-X", method,
        "-H", f"x-manus-api-key: {key}",
        "-H", "Accept: application/json",
    ]
    if body is not None:
        cmd += [
            "-H", "Content-Type: application/json",
            "-d", json.dumps(body, ensure_ascii=False),
        ]
    raw = subprocess.check_output(cmd + [url], text=True)
    try:
        return json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {"ok": False, "error": {"message": raw}}


def task_status(detail: dict) -> str:
    task = detail.get("task") if isinstance(detail.get("task"), dict) else detail
    return str(
        (task or {}).get("status")
        or detail.get("status")
        or detail.get("agent_status")
        or ""
    ).lower()


def task_type(detail: dict) -> str:
    task = detail.get("task") if isinstance(detail.get("task"), dict) else detail
    return str((task or {}).get("task_type") or "").lower()


detail0 = api("GET", f"task.detail?task_id={task_id}")
if detail0.get("ok") is False and detail0.get("error"):
    print("manus-auto-deploy: task.detail failed:", json.dumps(detail0, ensure_ascii=False), file=sys.stderr)
    sys.exit(2)

st0 = task_status(detail0)
tt0 = task_type(detail0)
print(f"manus-auto-deploy: task precheck type={tt0 or '?'} status={st0 or '?'}")
if tt0 and tt0 != "project":
    print(
        "manus-auto-deploy: refusing non-project task for production deploy "
        f"(got task_type={tt0}). Use JD SYS project 7VkPFZNKqwNQihpncANHuQ.",
        file=sys.stderr,
    )
    sys.exit(4)
if st0 == "error":
    print(
        "manus-auto-deploy: JD SYS task is in unrecoverable error — "
        "repair/recreate the project task in Manus, then update MANUS_PROJECT_TASK_ID.",
        file=sys.stderr,
    )
    sys.exit(5)

prompt = f"""【固定 production 流程 — 已授權執行】

唯一來源：GitHub main（derekho144/cursor-2026）
目標 commit：{sha}（{full}）— {msg}
目前本地 branch 參考：{branch}

請嚴格按序執行，唔使再問確認：

1. Pull / Sync GitHub **main** 到本 JD SYS 專案，對齊上述 commit
2. 確認工作區已包含該 commit 的改動（可用 git rev-parse / git log 核對）
3. 保存 checkpoint（version）
4. Publish 到 jdsys.biz production（website_id={website_id}）
5. 完成後只回報四項：
   - synced_sha
   - checkpoint_or_version_id
   - publish_status
   - site_urls

規則：
- 唔好另開無關標準 task 做 production 發佈
- 唔好改業務代碼
- GitHub main 係唯一來源；Manus 只負責 sync → checkpoint → publish
"""

print(f"manus-auto-deploy: sendMessage sync+checkpoint on {task_id} for {sha} …")
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
print("sendMessage ok", send.get("request_id") or "")
send_marker = f"目標 commit：{sha}"
send_started = time.time()

# Avoid racing a previous "stopped" status: wait until this deploy is running,
# then wait until it finishes.
saw_running = False
confirmed = set()
deadline = time.time() + 25 * 60
last = None
terminal = None
assistant_seen_for_sha = False

while time.time() < deadline:
    detail = api("GET", f"task.detail?task_id={task_id}")
    status = task_status(detail)
    if status != last:
        print(f"task status: {status or detail}")
        last = status
    if status == "running":
        saw_running = True

    msgs = api("GET", f"task.listMessages?task_id={task_id}&limit=40&order=desc")
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

        if ev.get("type") == "assistant_message":
            content = (ev.get("assistant_message") or {}).get("content") or ""
            if isinstance(content, list):
                content = json.dumps(content, ensure_ascii=False)
            text = str(content)
            # Require this deploy's SHA (or explicit synced_sha report), not
            # generic older "checkpoint" chatter from prior turns.
            lower = text.lower()
            mentions_this_sha = (
                send_marker in text
                or sha in text
                or full[:12] in text
                or (f"synced_sha" in lower and sha in lower)
            )
            if mentions_this_sha:
                ts = ev.get("timestamp") or ev.get("created_at") or 0
                try:
                    ts_n = float(ts)
                    # Manus timestamps may be seconds or ms.
                    if ts_n > 10_000_000_000:
                        ts_n = ts_n / 1000.0
                    if ts_n >= send_started - 5:
                        assistant_seen_for_sha = True
                except (TypeError, ValueError):
                    if saw_running:
                        assistant_seen_for_sha = True

    if status == "error":
        terminal = status
        break

    # Require that we observed running (or waited briefly) before accepting stopped.
    if status in ("stopped", "completed") and (saw_running or time.time() - send_started > 45):
        if assistant_seen_for_sha or time.time() - send_started > 90:
            terminal = status
            break

    time.sleep(5)

if terminal is None:
    print("manus-auto-deploy: timed out waiting for JD SYS sync", file=sys.stderr)
    sys.exit(7)

if terminal == "error":
    print("manus-auto-deploy: JD SYS task ended in error during sync", file=sys.stderr)
    sys.exit(6)

print(f"manus-auto-deploy: JD SYS sync finished ({terminal})")

# Always publish via website API so production publish is deterministic
# even if the agent reply omitted the publish step.
print(f"manus-auto-deploy: website.publish {website_id} …")
pub = api(
    "POST",
    "website.publish",
    {"website_id": website_id, "visibility": "public"},
)
print(
    "website.publish:",
    json.dumps(
        {k: pub.get(k) for k in ("ok", "version_id", "website_id", "error", "request_id")},
        ensure_ascii=False,
    ),
)
if pub.get("ok") is False:
    print("website.publish failed", file=sys.stderr)
    sys.exit(3)

published = False
for _ in range(60):
    st = api("GET", f"website.status?website_id={website_id}")
    ps = st.get("publish_status")
    print(
        f"publish_status: {ps} version={st.get('version_id')} urls={st.get('site_urls')}"
    )
    if ps == "published":
        published = True
        break
    if ps == "failed":
        sys.exit(3)
    time.sleep(3)

if not published:
    print("manus-auto-deploy: publish did not reach published in time", file=sys.stderr)
    sys.exit(3)

print("manus-auto-deploy: done — GitHub main → JD SYS → checkpoint → published")
PY
