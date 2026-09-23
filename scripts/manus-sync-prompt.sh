#!/usr/bin/env bash
# Print a ready-to-paste Manus prompt when API deploy credentials are unavailable.
# Fixed flow: GitHub main (SoT) → JD SYS sync → checkpoint → publish.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SHA="$(git rev-parse --short HEAD)"
FULL="$(git rev-parse HEAD)"
MSG="$(git log -1 --pretty=%s)"

cat <<EOF
【JD SYS production 發佈 — 固定流程】

唯一來源：GitHub main（derekho144/cursor-2026）
目標 commit：${SHA}（${FULL}）— ${MSG}

請在 **JD SYS 專案**（7VkPFZNKqwNQihpncANHuQ）執行：
1. Pull / Sync GitHub main 到上述 commit
2. 保存 checkpoint
3. Publish 到 jdsys.biz
4. 回報：synced_sha、checkpoint/version id、publish_status、site URLs

唔好另開標準 task 做 production；唔好改業務代碼。
EOF
