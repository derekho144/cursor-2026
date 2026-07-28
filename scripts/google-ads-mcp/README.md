# Google Ads MCP (Claude Code / Cursor)
#
# 1. Fill credentials:
#    mkdir -p ~/.config/jd-studio
#    cp scripts/google-ads-mcp/env.example ~/.config/jd-studio/google-ads.env
#    # edit google-ads.env with production values
#
# 2. Reload MCP in Cursor (Settings → MCP) or Claude Code (`claude mcp list`).
#
# 3. Prompt example:
#    List accessible Google Ads customers, then health-check account 4839352747
#    (campaigns, spend last 30 days, conversion tracking, policy issues).

## Setup
- Official server: https://github.com/googleads/google-ads-mcp (read-only)
- Runner: `scripts/google-ads-mcp/run.sh`
- Secrets: `~/.config/jd-studio/google-ads.env` (not in git)
- ADC file generated at runtime: `~/.config/jd-studio/google-ads-adc.json`

## Account IDs (JD Studio)
- MCC / login-customer-id: `9876630892`
- Ad account: `4839352747`

## Where to get secrets (production)

**jdsys.biz 冇 Settings → Secrets UI。** 憑證喺 Manus deployment 環境變數 + DB `platform_credentials`（refresh token）。

### 方法 A（推薦）：Manus 匯出

喺 Manus production 跑：

```bash
npx tsx scripts/google-ads-mcp/export-local-env.ts --check   # 只睇有/無
npx tsx scripts/google-ads-mcp/export-local-env.ts > google-ads.env
```

將輸出 paste 入本機 `~/.config/jd-studio/google-ads.env`（唔好 commit）。

### 方法 B：Manus 專案環境變數

[manus.im](https://manus.im/app) → JD SYS 專案 → Environment / Variables，搵 `GOOGLE_ADS_*`。

### 方法 C：手動來源

| Key | 來源 |
|-----|------|
| `GOOGLE_ADS_DEVELOPER_TOKEN` | [Google Ads API Center](https://ads.google.com/aw/apicenter) |
| `GOOGLE_ADS_CLIENT_ID` / `SECRET` | [GCP Console](https://console.cloud.google.com/) → APIs → Credentials |
| `GOOGLE_ADS_REFRESH_TOKEN` | jdsys **廣告同步** →「重新授權 Google Ads」（存 DB）；或 Manus export script |

`GOOGLE_PROJECT_ID` 可留空；填好 `GOOGLE_ADS_CLIENT_ID` 後 `run.sh` 會用 numeric prefix（例如 `4821341680`）。

After filling `~/.config/jd-studio/google-ads.env`: **Cursor → Settings → MCP → Reload**, then prompt:
`list_accessible_customers，再 health-check customer 4839352747`
