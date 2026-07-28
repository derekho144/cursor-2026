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
