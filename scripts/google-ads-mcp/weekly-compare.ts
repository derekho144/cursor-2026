/**
 * Compare current Google Ads 7-day metrics vs saved baseline.
 * Run: npx tsx scripts/google-ads-mcp/weekly-compare.ts [baseline.json]
 */
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CUSTOMER_ID = "4839352747";
const MCC_ID = "9876630892";
const CAMPAIGN_ID = "24002224927";
const API_VERSION = "v23";

interface Baseline {
  label: string;
  capturedAt: string;
  compareAfter: string;
  account: MetricRow;
  searchCampaign: MetricRow;
  eventPhotoAdGroup: MetricRow;
  settings?: { targetCpaHkd: number; dailyBudgetHkd: number };
}

interface MetricRow {
  costHkd: number;
  impressions?: number;
  clicks: number;
  conversions: number;
  cpaHkd: number;
  ctrPct?: number;
}

function loadEnv() {
  const path = process.env.GOOGLE_ADS_ENV_FILE ?? join(homedir(), ".config/jd-studio/google-ads.env");
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#") || !s.includes("=")) continue;
    const i = s.indexOf("=");
    env[s.slice(0, i)] = s.slice(i + 1).trim();
  }
  return env;
}

async function token(env: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_ADS_CLIENT_ID,
      client_secret: env.GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: env.GOOGLE_ADS_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const j = (await res.json()) as { access_token?: string };
  if (!j.access_token) throw new Error("OAuth failed");
  return j.access_token;
}

async function gaql(env: Record<string, string>, access: string, query: string) {
  const res = await fetch(
    `https://googleads.googleapis.com/${API_VERSION}/customers/${CUSTOMER_ID}/googleAds:search`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access}`,
        "developer-token": env.GOOGLE_ADS_DEVELOPER_TOKEN,
        "login-customer-id": MCC_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    }
  );
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message ?? JSON.stringify(json));
  }
  return (json.results ?? []) as any[];
}

function micros(v: unknown) {
  return Number(v ?? 0) / 1_000_000;
}

function rowFromMetrics(m: any, extra?: Partial<MetricRow>): MetricRow {
  const cost = micros(m?.costMicros);
  const conv = Number(m?.conversions ?? 0);
  const clicks = Number(m?.clicks ?? 0);
  const impr = Number(m?.impressions ?? 0);
  return {
    costHkd: round(cost),
    impressions: impr,
    clicks,
    conversions: conv,
    cpaHkd: conv > 0 ? round(cost / conv) : 0,
    ctrPct: impr > 0 ? round((clicks / impr) * 100, 2) : 0,
    ...extra,
  };
}

function round(n: number, d = 2) {
  return Math.round(n * 10 ** d) / 10 ** d;
}

function delta(cur: number, base: number) {
  if (base === 0) return base === cur ? "—" : "+∞";
  const pct = ((cur - base) / base) * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${round(pct, 1)}%`;
}

function fmt(row: MetricRow) {
  return `HK$${row.costHkd} · ${row.clicks} clicks · ${row.conversions} conv · CPA HK$${row.cpaHkd}`;
}

async function main() {
  const baselinePath = process.argv[2] ?? join(process.cwd(), "scripts/google-ads-mcp/baseline-2026-07-28.json");
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline;
  const env = loadEnv();
  const access = await token(env);
  const window = "segments.date DURING LAST_7_DAYS";

  const [accRows, campRows, agRows, settingsRows] = await Promise.all([
    gaql(
      env,
      access,
      `SELECT metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.ctr FROM customer WHERE ${window}`
    ),
    gaql(
      env,
      access,
      `SELECT campaign.name, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE ${window} AND campaign.id = ${CAMPAIGN_ID}`
    ),
    gaql(
      env,
      access,
      `SELECT ad_group.name, metrics.cost_micros, metrics.clicks, metrics.conversions FROM ad_group WHERE ${window} AND campaign.id = ${CAMPAIGN_ID} AND ad_group.name = '活動攝影'`
    ),
    gaql(
      env,
      access,
      `SELECT campaign.maximize_conversions.target_cpa_micros, campaign_budget.amount_micros FROM campaign WHERE campaign.id = ${CAMPAIGN_ID}`
    ),
  ]);

  const current = {
    account: rowFromMetrics(accRows[0]?.metrics ?? {}),
    searchCampaign: rowFromMetrics(campRows[0]?.metrics ?? {}),
    eventPhotoAdGroup: rowFromMetrics(agRows[0]?.metrics ?? {}),
  };

  const tCpa = micros(settingsRows[0]?.campaign?.maximizeConversions?.targetCpaMicros);
  const budget = micros(settingsRows[0]?.campaignBudget?.amountMicros);

  const today = new Date().toISOString().slice(0, 10);
  console.log(`# Google Ads 7日對比報告`);
  console.log(`基準：${baseline.capturedAt} (${baseline.label})`);
  console.log(`今次：${today} (LAST_7_DAYS)\n`);

  console.log("## 帳戶");
  console.log(`- 基準：${fmt(baseline.account)}`);
  console.log(`- 現況：${fmt(current.account)}`);
  console.log(`- 花費 ${delta(current.account.costHkd, baseline.account.costHkd)} · CPA ${delta(current.account.cpaHkd, baseline.account.cpaHkd)} · 轉化 ${delta(current.account.conversions, baseline.account.conversions)}\n`);

  console.log("## Search #3");
  console.log(`- 基準：${fmt(baseline.searchCampaign)}`);
  console.log(`- 現況：${fmt(current.searchCampaign)}`);
  console.log(`- CPA ${delta(current.searchCampaign.cpaHkd, baseline.searchCampaign.cpaHkd)} (目標 HK$${baseline.settings?.targetCpaHkd ?? 135})\n`);

  console.log("## 活動攝影 Ad Group");
  console.log(`- 基準：${fmt(baseline.eventPhotoAdGroup)}`);
  console.log(`- 現況：${fmt(current.eventPhotoAdGroup)}`);
  const shareBase =
    baseline.searchCampaign.costHkd > 0
      ? round((baseline.eventPhotoAdGroup.costHkd / baseline.searchCampaign.costHkd) * 100, 1)
      : 0;
  const shareCur =
    current.searchCampaign.costHkd > 0
      ? round((current.eventPhotoAdGroup.costHkd / current.searchCampaign.costHkd) * 100, 1)
      : 0;
  console.log(`- 花費佔 Search #3：${shareBase}% → ${shareCur}%\n`);

  console.log("## 設定");
  console.log(`- tCPA：HK$${round(tCpa)} · 日預算：HK$${round(budget)}`);

  const cpaOk = current.searchCampaign.cpaHkd > 0 && current.searchCampaign.cpaHkd <= (baseline.settings?.targetCpaHkd ?? 135) * 1.15;
  console.log("\n## 簡評");
  if (cpaOk) console.log("- ✅ CPA 接近或低於 tCPA 目標");
  else if (current.searchCampaign.conversions === 0) console.log("- ⚠️ 7日內無轉化，樣本可能不足");
  else console.log("- ⚠️ CPA 仍高於 tCPA，建議檢查搜尋字詞報告");
  if (shareCur > shareBase) console.log("- ✅ 活動攝影花費佔比上升");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
