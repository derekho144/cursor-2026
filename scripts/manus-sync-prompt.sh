#!/usr/bin/env bash
# Print a Manus sync/publish prompt for the current HEAD.
set -euo pipefail
cd "$(dirname "$0")/.."
SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
MSG=$(git log -1 --pretty=%s 2>/dev/null || echo "")
cat <<EOF
請立即從 GitHub 同步並發佈：

1. Pull / Sync GitHub main（commit: ${SHA} — ${MSG}）
2. 確認工作區已包含該 commit 的改動
3. 保存 checkpoint 並 Publish 到 jdsys.biz
4. 完成後回報：SHA、checkpoint id、publish 狀態
EOF
