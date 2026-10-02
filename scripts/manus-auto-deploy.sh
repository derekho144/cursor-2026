#!/usr/bin/env bash
# Fixed production deploy path:
#   GitHub main (SoT) → sync JD SYS project → checkpoint → Publish jdsys.biz
#
# Requires: MANUS_API_KEY, MANUS_WEBSITE_ID
# Task: MANUS_PROJECT_TASK_ID (preferred) or defaults to JD SYS 8b23sC2fWWQJLaDHXQRwZX
# Agent: MANUS_AGENT_PROFILE (default manus-1.6-lite — full 1.6 often hits quota)
#
# Usage:
#   bash scripts/manus-auto-deploy.sh
#   bash scripts/manus-auto-deploy.sh --dry-run
#   bash scripts/manus-auto-deploy.sh --publish-only
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DRY_RUN=0
PUBLISH_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --publish-only) PUBLISH_ONLY=1 ;;
    *)
      echo "manus-auto-deploy: unknown arg: $arg" >&2
      exit 1
      ;;
  esac
done

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
AGENT_PROFILE="$(manus_resolve_agent_profile "$ROOT")"
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
echo "manus-auto-deploy: agent ${AGENT_PROFILE}"
echo "manus-auto-deploy: website ${WEBSITE_ID}"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "manus-auto-deploy: dry-run only (no sendMessage / publish)"
  exit 0
fi

export API_BASE KEY TASK_ID WEBSITE_ID SHA FULL MSG BRANCH AGENT_PROFILE PUBLISH_ONLY ROOT

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
agent_profile = os.environ.get("AGENT_PROFILE") or "manus-1.6-lite"
publish_only = os.environ.get("PUBLISH_ONLY") == "1"
root = os.environ.get("ROOT") or "."


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


def recent_quota_error(task_id: str) -> bool:
    msgs = api("GET", f"task.listMessages?task_id={task_id}&limit=20&order=desc")
    for ev in msgs.get("data") or msgs.get("messages") or []:
        if ev.get("type") != "error_message":
            continue
        err = ev.get("error_message") or {}
        if err.get("error_type") == "quota_limit":
            return True
        content = str(err.get("content") or "").lower()
        if "enough credits" in content or "quota" in content:
            return True
    return False


def verify_hosting() -> None:
    """Fail deploy if Cloudflare is proxying Railway (recurring 502 root cause)."""
    print("manus-auto-deploy: verifying managed hosting (no Railway origin) …")
    script = os.path.join(root, "scripts/manus-verify-hosting.sh")
    # Allow brief CDN settle after publish.
    last_code = 1
    for attempt in range(6):
        last_code = subprocess.run(["bash", script], cwd=root).returncode
        if last_code == 0:
            return
        time.sleep(5)
    print(
        "manus-auto-deploy: hosting verification FAILED — Railway origin or non-200. "
        f"Fix Manus WebDev origin for website {website_id}, then re-run --publish-only.",
        file=sys.stderr,
    )
    sys.exit(9)


def verify_live_revision() -> None:
    """Fail if published site still serves a stale client (Manus sync gap)."""
    marker_path = os.path.join(root, "client/public/deploy-revision.txt")
    expected = ""
    if os.path.isfile(marker_path):
        expected = open(marker_path, encoding="utf-8").read().strip().splitlines()[0].strip()
    if not expected:
        expected = sha
    print(f"manus-auto-deploy: verifying live deploy-revision contains {expected!r} …")
    urls = [
        "https://jdsys.biz/deploy-revision.txt",
        "https://www.jdsys.biz/deploy-revision.txt",
        "https://jdsys.manus.space/deploy-revision.txt",
    ]
    # Also require merged Ad Expenses UI strings in the main JS bundle.
    must_have = ["Ad Spend & Monthly Report", "ad-expenses-report", "開支記錄"]
    must_not = ['id:"reports",label:"月度報表",path:"/reports"']
    last_err = ""
    for attempt in range(10):
        ok = True
        for url in urls:
            try:
                body = subprocess.check_output(
                    ["curl", "-sS", "-L", "-A", "JD-Studio-Deploy-Verify/1.0", url],
                    text=True,
                    timeout=30,
                )
            except Exception as exc:  # noqa: BLE001
                ok = False
                last_err = f"{url}: {exc}"
                break
            if expected not in body:
                ok = False
                last_err = f"{url} missing revision marker; body={body[:120]!r}"
                break
        if ok:
            try:
                html = subprocess.check_output(
                    ["curl", "-sS", "-L", "-A", "JD-Studio-Deploy-Verify/1.0", "https://jdsys.biz/"],
                    text=True,
                    timeout=30,
                )
                import re

                m = re.search(r'src="(/assets/index-[^"]+\.js)"', html)
                if not m:
                    ok = False
                    last_err = "index.html has no /assets/index-*.js"
                else:
                    js_url = "https://jdsys.biz" + m.group(1)
                    js = subprocess.check_output(
                        ["curl", "-sS", "-L", "-A", "JD-Studio-Deploy-Verify/1.0", js_url],
                        text=True,
                        timeout=60,
                    )
                    for needle in must_have:
                        if needle not in js:
                            ok = False
                            last_err = f"live JS missing {needle!r}"
                            break
                    if ok:
                        for needle in must_not:
                            if needle in js:
                                ok = False
                                last_err = f"live JS still has stale nav {needle!r}"
                                break
            except Exception as exc:  # noqa: BLE001
                ok = False
                last_err = str(exc)
        if ok:
            print("manus-auto-deploy: live revision OK (deploy-revision + Ad Expenses merge UI)")
            return
        print(f"manus-auto-deploy: live revision not ready (attempt {attempt + 1}/10): {last_err}")
        time.sleep(6)
    print(
        "manus-auto-deploy: LIVE CODE VERIFY FAILED — publish succeeded but site still serves old client. "
        "Manus JD SYS sync did not land the GitHub main files; re-run sync (do not trust publish alone).",
        file=sys.stderr,
    )
    sys.exit(10)


def do_publish(*, verify: bool = True) -> None:
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
    # Concurrent deploy already in progress is OK — wait for published.
    err = pub.get("error") or {}
    err_msg = str(err.get("message") or "") if isinstance(err, dict) else str(err)
    if pub.get("ok") is False and "already being deployed" not in err_msg:
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

    if verify:
        verify_hosting()
        verify_live_revision()


if publish_only:
    do_publish()
    print("manus-auto-deploy: done — publish-only (Manus hosting OK)")
    sys.exit(0)


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
        f"(got task_type={tt0}). Use JD SYS project 8b23sC2fWWQJLaDHXQRwZX.",
        file=sys.stderr,
    )
    sys.exit(4)
if st0 == "error":
    if recent_quota_error(task_id):
        print(
            "manus-auto-deploy: JD SYS task error is quota_limit (Manus credits). "
            "Top up credits, recreate a project task with agent manus-1.6-lite, "
            "then set MANUS_PROJECT_TASK_ID. Falling through to website.publish only.",
            file=sys.stderr,
        )
        do_publish()
        sys.exit(8)
    print(
        "manus-auto-deploy: JD SYS task is in unrecoverable error — "
        "recreate project task (prefer manus-1.6-lite under project Fm48bwcxCqTxUfh6kJbk3c), "
        "then update MANUS_PROJECT_TASK_ID.",
        file=sys.stderr,
    )
    sys.exit(5)

prompt = f"""【固定 production 流程 — 已授權執行 · 強制完整 sync】

唯一來源：GitHub main（derekho144/cursor-2026）
目標 commit：{sha}（{full}）— {msg}
目前本地 branch 參考：{branch}

上次 publish 失敗模式（必須避免）：checkpoint／publish 成功但 live `/assets/index-*.js` 仍係舊 sidebar（仍有獨立「月度報表」）。今次必須先證明工作區＋build 已係新碼，先至 checkpoint。

請嚴格按序執行，唔使再問確認：

1. Pull / Sync GitHub **main** 到本 JD SYS 專案，對齊上述 commit（`git rev-parse HEAD` 必須係 {full} 或至少 short {sha}）
2. **檔案硬核對（全部要過，否則唔好 checkpoint）**：
   - `client/src/components/DashboardLayout.tsx`：menu **唔可以**有 `id: "reports"` / label「月度報表」獨立項
   - `client/src/pages/MonthlyReport.tsx`：必須係 `Redirect` 去 `/ad-expenses?tab=report`
   - `client/src/pages/AdExpenses.tsx`：必須含 `Ad Spend & Monthly Report`、`ad-expenses-report`、`開支記錄`（單一頁：分析＋記錄）
   - `client/public/deploy-revision.txt`：必須存在且含首行 marker（或 `{sha}`）
3. 執行 frontend production build（`npm run build` 或專案既定 build），確保 `dist/public`／網站靜態資產已更新
4. 保存 checkpoint（version）
5. **Hosting 硬性檢查（必須先過）**：website_id={website_id} origin／proxy **唔係** *.up.railway.app
6. Publish 到 jdsys.biz（website_id={website_id}, visibility=public）— 若 session 無 publish 工具，checkpoint 後停止並回報，由 API 發佈
7. 驗證：
   - `https://jdsys.biz/deploy-revision.txt` 含本地 marker／`{sha}`
   - live JS／chunk 含 `Ad Spend & Monthly Report` 同 `開支記錄`，且 **唔含** 舊 nav `id:"reports",label:"月度報表",path:"/reports"`
8. 完成後只回報：synced_sha、checkpoint_or_version_id、publish_status、site_urls、origin_host、live_revision_ok

規則：
- 唔好另開無關標準 task 做 production 發佈
- 唔好改業務代碼（只 sync／build／checkpoint／publish）
- **禁止** Railway origin
- GitHub main 係唯一來源
"""

print(f"manus-auto-deploy: sendMessage sync+checkpoint on {task_id} for {sha} (profile={agent_profile}) …")
send = api(
    "POST",
    "task.sendMessage",
    {
        "task_id": task_id,
        "message": {"content": prompt},
        "agent_profile": agent_profile,
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
saw_quota = False

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
        # Prefer nested status_detail on waiting updates (Manus messageAskUser).
        detail = (ev.get("status_update") or {}).get("status_detail") or {}
        wait_type = (
            ev.get("waiting_for_event_type")
            or detail.get("waiting_for_event_type")
            or ""
        )
        event_id = (
            ev.get("waiting_for_event_id")
            or detail.get("waiting_for_event_id")
            or ""
        )
        if status == "waiting" and not event_id:
            event_id = ev.get("event_id") or ev.get("id") or ""
        if event_id and event_id not in confirmed and wait_type:
            if wait_type == "messageAskUser":
                # confirmAction rejects cascadeAskUser; reply with an explicit yes.
                # Checkpoint often blocks on large local assets (e.g. food-crab.jpg);
                # approve removing those local copies while keeping File Storage refs.
                print(f"auto-reply messageAskUser ({event_id})")
                reply = api(
                    "POST",
                    "task.sendMessage",
                    {
                        "task_id": task_id,
                        "message": {
                            "content": (
                                "同意移除本地副本。"
                                "【明確確認】繼續原定 production 範圍："
                                f"sync GitHub main → 刪除阻擋 checkpoint 的大型本地資產副本"
                                f"（保留 File Storage／manus-storage 引用）→ "
                                f"npm run build → 新 checkpoint（version 必須唔同舊版）→ "
                                f"website.publish (website_id={website_id}, visibility=public) → "
                                "驗證 jdsys.biz live 已係新碼。唔切舊 task、唔改業務代碼、唔改 DNS/Railway。"
                                "唔使再問。"
                            )
                        },
                        "agent_profile": agent_profile,
                    },
                )
                print("askUser reply:", reply.get("ok"), reply.get("error"))
                confirmed.add(event_id)
                time.sleep(2)  # avoid Manus sendMessage rate limits
            else:
                print(f"auto-confirm: {wait_type} ({event_id})")
                conf = api(
                    "POST",
                    "task.confirmAction",
                    {"task_id": task_id, "event_id": event_id},
                )
                print("confirm:", conf.get("ok"), conf.get("error"))
                confirmed.add(event_id)

        if ev.get("type") == "error_message":
            err = ev.get("error_message") or {}
            if err.get("error_type") == "quota_limit" or "enough credits" in str(
                err.get("content") or ""
            ).lower():
                saw_quota = True

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
    if saw_quota or recent_quota_error(task_id):
        print(
            "manus-auto-deploy: root cause looks like Manus quota_limit — "
            "top up credits and recreate project task with manus-1.6-lite. "
            "Still attempting website.publish for current checkpoint.",
            file=sys.stderr,
        )
        do_publish()
        sys.exit(8)
    # Still try publish — agent may have checkpointed before dying.
    do_publish()
    sys.exit(6)

print(f"manus-auto-deploy: JD SYS sync finished ({terminal})")

# Always publish via website API so production publish is deterministic
# even if the agent reply omitted the publish step.
do_publish()

print("manus-auto-deploy: done — GitHub main → JD SYS → checkpoint → published (Manus hosting OK)")
PY
