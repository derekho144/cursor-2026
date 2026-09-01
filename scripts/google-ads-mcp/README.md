# Google Ads MCP（Cursor / Claude Code）

把官方 [google-ads-mcp](https://github.com/googleads/google-ads-mcp) 接到 Cursor，用 AI 讀 live 帳況（**只讀**，唔會自動改 campaign）。

## Cursor 一鍵接線（本機）

```bash
cd ~/Desktop/jd-studio-admin   # 或你嘅 repo 路徑
bash scripts/google-ads-mcp/setup-cursor.sh
```

腳本會：
1. 建立 `~/.config/jd-studio/google-ads.env`（若未有）
2. 檢查必填 key
3. 用 pipx 安裝 `google-ads-mcp`
4. 產生 ADC JSON

然後喺 **Cursor Desktop**：
1. 開呢個 repo 做 workspace
2. **Settings → MCP** → `google-ads-mcp` 應係綠色
3. 紅色就 Reload MCP / 重開 Cursor

試用 prompt：
```
list_accessible_customers，再 health-check customer 4839352747
（campaigns、近 7/30 日 spend、CPA、Search #3 tCPA／預算、政策問題）
```

## 憑證（唔好 commit）

| Key | 來源 |
|-----|------|
| `GOOGLE_ADS_DEVELOPER_TOKEN` | [Ads API Center](https://ads.google.com/aw/apicenter) |
| `GOOGLE_ADS_CLIENT_ID` / `SECRET` | GCP OAuth client |
| `GOOGLE_ADS_REFRESH_TOKEN` | jdsys「廣告同步」重新授權；或 Manus export |

**Manus production 匯出：**
```bash
npx tsx scripts/google-ads-mcp/export-local-env.ts --check
npx tsx scripts/google-ads-mcp/export-local-env.ts > ~/.config/jd-studio/google-ads.env
chmod 600 ~/.config/jd-studio/google-ads.env
```

## Account IDs（JD Studio）

- MCC / login-customer-id: `9876630892`
- Ad account: `4839352747`

## 專案 MCP 設定

`.cursor/mcp.json` 用 `${workspaceFolder}`，唔綁死本機絕對路徑：

```json
{
  "mcpServers": {
    "google-ads-mcp": {
      "type": "stdio",
      "command": "bash",
      "args": ["${workspaceFolder}/scripts/google-ads-mcp/run.sh"],
      "env": {
        "GOOGLE_ADS_ENV_FILE": "${userHome}/.config/jd-studio/google-ads.env"
      }
    }
  }
}
```

## 相關腳本

| 檔案 | 用途 |
|------|------|
| `run.sh` | Cursor MCP 啟動器 |
| `setup-cursor.sh` | 本機安裝／檢查 |
| `export-local-env.ts` | 由 production 匯出 env |
| `weekly-compare.sh` | 對比 `baseline-2026-07-28.json` |
| `../google-ads-credentials.sh` | 共用憑證（gads-cli / ARBA / MCP） |
| `../weekly-qs-review.sh` | 每週 QS audit（gads-cli 或內建 TS fallback） |
| `../google-ads-quality-report.ts` | 內建 QS 報告（唔使裝 gads-cli） |
| `google-ads.yaml.example` | ARBA `google-ads.yaml` 範本 |

```bash
# 共用憑證（一次設定，全部工具共用）
mkdir -p ~/.config/jd-studio
cp scripts/google-ads-mcp/env.example ~/.config/jd-studio/google-ads.env
# 填好後：
source scripts/google-ads-credentials.sh && google_ads_write_arba_yaml

# 每週 QS 報告（輸出到 reports/qs-review-YYYY-MM-DD/）
bash scripts/weekly-qs-review.sh

# 對比 baseline
bash scripts/google-ads-mcp/weekly-compare.sh
```
