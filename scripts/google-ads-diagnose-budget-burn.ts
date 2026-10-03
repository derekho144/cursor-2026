/**
 * Diagnose early daily-budget burn (spend concentrated in morning → ads stop → no inquiries).
 *
 * Read-only. Never mutates Ads.
 *
 *   npx tsx scripts/google-ads-diagnose-budget-burn.ts
 *   npx tsx scripts/google-ads-diagnose-budget-burn.ts --days 3
 */
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CUSTOMER_ID = (process.env.GOOGLE_ADS_AD_ACCOUNT_ID ?? "4839352747").replace(/-/g, "");
const MCC_ID = (
  process.env.GOOGLE_ADS_CUSTOMER_ID ??
  process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ??
  "9876630892"
).replace(/-/g, "");
const CAMPAIGN_ID = process.env.GOOGLE_ADS_CAMPAIGN_ID ?? "24002224927";
const API_VERSION = "v23";

function argDays(): number {
  const i = process.argv.indexOf("--days");
  if (i >= 0 && process.argv[i + 1]) {
    const n = Number(process.argv[i + 1]);
    if (Number.isFinite(n) && n >= 1 && n <= 30) return Math.floor(n);
  }
  return 1;
}

async function loadEnv() {
  const keys = [
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_REFRESH_TOKEN",
  ] as const;
  const env: Record<string, string> = {};
  for (const k of keys) {
    const v = process.env[k]?.trim();
    if (v) env[k] = v;
  }
  const path = process.env.GOOGLE_ADS_ENV_FILE ?? join(homedir(), ".config/jd-studio/google-ads.env");
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const s = line.trim();
      if (!s || s.startsWith("#") || !s.includes("=")) continue;
      const i = s.indexOf("=");
      const k = s.slice(0, i).trim();
      const v = s.slice(i + 1).trim();
      if (v && !env[k]) env[k] = v;
    }
  } catch {
    /* optional */
  }
  if (process.env.SKIP_DB !== "1") {
    try {
      const { getPlatformCredential } = await import("../server/db");
      const cred = await Promise.race([
        getPlatformCredential("google_ads"),
        new Promise<null>((_, rej) => setTimeout(() => rej(new Error("DB timeout")), 8_000)),
      ]);
      if (cred?.refreshToken) {
        env.GOOGLE_ADS_REFRESH_TOKEN = cred.refreshToken;
        console.log("Using refresh token from DB");
      }
    } catch (e) {
      console.warn(`[diagnose-budget-burn] DB refresh skip: ${String(e)}`);
    }
  }
  for (const k of keys) {
    if (!env[k]) throw new Error(`Missing credential: ${k}`);
  }
  return env;
}

async function getAccessToken(env: Record<string, string>) {
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
  const json = (await res.json()) as { access_token?: string; error?: string };
  if (!json.access_token) throw new Error(`OAuth failed: ${JSON.stringify(json)}`);
  return json.access_token;
}

async function search(env: Record<string, string>, token: string, query: string) {
  const url = `https://googleads.googleapis.com/${API_VERSION}/customers/${CUSTOMER_ID}/googleAds:searchStream`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "developer-token": env.GOOGLE_ADS_DEVELOPER_TOKEN,
      "login-customer-id": MCC_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GAQL ${res.status}: ${text.slice(0, 800)}`);
  const batches = JSON.parse(text) as Array<{ results?: unknown[] }>;
  const rows: unknown[] = [];
  for (const b of batches) {
    if (Array.isArray(b.results)) rows.push(...b.results);
  }
  return rows as Array<Record<string, any>>;
}

function microsToHkd(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Math.round((n / 1_000_000) * 100) / 100;
}

function pct(part: number, whole: number): string {
  if (!whole) return "0%";
  return `${Math.round((part / whole) * 1000) / 10}%`;
}

async function main() {
  const days = argDays();
  const env = await loadEnv();
  const token = await getAccessToken(env);
  console.log(`# Google Ads budget-burn diagnose`);
  console.log(`account=${CUSTOMER_ID} campaign=${CAMPAIGN_ID} days=${days}`);
  console.log("");

  const settings = await search(
    env,
    token,
    `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.primary_status,
      campaign.primary_status_reasons,
      campaign.serving_status,
      campaign.advertising_channel_type,
      campaign_budget.amount_micros,
      campaign_budget.delivery_method,
      campaign.maximize_conversions.target_cpa_micros,
      campaign.bidding_strategy_type
    FROM campaign
    WHERE campaign.id = ${CAMPAIGN_ID}
    `,
  );
  const s = settings[0];
  if (!s) throw new Error(`Campaign ${CAMPAIGN_ID} not found`);
  const budget = microsToHkd(s.campaignBudget?.amountMicros);
  const tcpa = microsToHkd(s.campaign?.maximizeConversions?.targetCpaMicros);
  console.log("## Campaign settings");
  console.log(`- name: ${s.campaign?.name}`);
  console.log(`- status: ${s.campaign?.status}`);
  console.log(`- primary_status: ${s.campaign?.primary_status}`);
  console.log(`- primary_status_reasons: ${(s.campaign?.primaryStatusReasons ?? []).join(", ") || "(none)"}`);
  console.log(`- serving_status: ${s.campaign?.servingStatus}`);
  console.log(`- bidding: ${s.campaign?.biddingStrategyType}`);
  console.log(`- daily_budget_hkd: ${budget}`);
  console.log(`- budget_delivery_method: ${s.campaignBudget?.deliveryMethod ?? "(n/a)"}`);
  console.log(`- target_cpa_hkd: ${tcpa || "(n/a)"}`);
  console.log("");

  const dateClause =
    days <= 1 ? "segments.date DURING TODAY" : `segments.date DURING LAST_${days}_DAYS`;

  const hourly = await search(
    env,
    token,
    `
    SELECT
      segments.date,
      segments.hour,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions
    FROM campaign
    WHERE campaign.id = ${CAMPAIGN_ID}
      AND ${dateClause}
    ORDER BY segments.date, segments.hour
    `,
  );

  console.log("## Spend by hour (account timezone)");
  let totalCost = 0;
  let totalClicks = 0;
  let totalImpr = 0;
  let totalConv = 0;
  const byDate = new Map<string, Array<{ hour: number; cost: number; clicks: number; impr: number; conv: number }>>();
  for (const row of hourly) {
    const date = row.segments?.date as string;
    const hour = Number(row.segments?.hour ?? 0);
    const cost = microsToHkd(row.metrics?.costMicros);
    const clicks = Number(row.metrics?.clicks ?? 0);
    const impr = Number(row.metrics?.impressions ?? 0);
    const conv = Number(row.metrics?.conversions ?? 0);
    totalCost += cost;
    totalClicks += clicks;
    totalImpr += impr;
    totalConv += conv;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push({ hour, cost, clicks, impr, conv });
  }

  for (const [date, rows] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const dayCost = rows.reduce((a, r) => a + r.cost, 0);
    console.log(`### ${date} · day_cost=HK$${dayCost.toFixed(2)} · budget=HK$${budget}`);
    let cum = 0;
    let firstExhaustHour: number | null = null;
    for (const r of rows.sort((a, b) => a.hour - b.hour)) {
      cum += r.cost;
      const line = `  h${String(r.hour).padStart(2, "0")}: cost=${r.cost.toFixed(2)} clicks=${r.clicks} impr=${r.impr} conv=${r.conv} cum=${cum.toFixed(2)} (${pct(cum, budget)} of budget)`;
      console.log(line);
      if (firstExhaustHour === null && budget > 0 && cum >= budget * 0.95) {
        firstExhaustHour = r.hour;
      }
    }
    if (firstExhaustHour !== null) {
      console.log(
        `  → ~95% of daily budget reached by hour ${String(firstExhaustHour).padStart(2, "0")} (early burn if before 14:00)`,
      );
    } else if (dayCost > 0 && dayCost < budget * 0.5) {
      console.log(`  → spent only ${pct(dayCost, budget)} of budget (under-delivery / limited inventory)`);
    }
    console.log("");
  }

  const kwStatus = await search(
    env,
    token,
    `
    SELECT
      ad_group_criterion.status,
      ad_group_criterion.keyword.text
    FROM keyword_view
    WHERE campaign.id = ${CAMPAIGN_ID}
      AND ad_group_criterion.type = 'KEYWORD'
      AND ad_group_criterion.status != 'REMOVED'
    `,
  );
  const counts: Record<string, number> = {};
  for (const row of kwStatus) {
    const st = row.adGroupCriterion?.status ?? "UNKNOWN";
    counts[st] = (counts[st] ?? 0) + 1;
  }
  console.log("## Keyword status counts");
  for (const [st, n] of Object.entries(counts).sort()) {
    console.log(`- ${st}: ${n}`);
  }
  console.log("");

  const watch = [
    "product photography",
    "香港攝影師",
    "餐牌設計",
    "餐單設計",
    "菜單設計",
    "restaurant menu design",
  ];
  console.log("## Pause-list keyword status (QS remediation targets)");
  for (const text of watch) {
    const hits = kwStatus.filter(
      (r) => (r.adGroupCriterion?.keyword?.text ?? "").trim().toLowerCase() === text.toLowerCase(),
    );
    if (!hits.length) {
      console.log(`- ${text}: (not found)`);
      continue;
    }
    for (const h of hits) {
      console.log(`- ${text}: ${h.adGroupCriterion?.status}`);
    }
  }
  console.log("");

  console.log("## Summary");
  console.log(`- window_cost_hkd: ${totalCost.toFixed(2)}`);
  console.log(`- clicks: ${totalClicks}`);
  console.log(`- impressions: ${totalImpr}`);
  console.log(`- conversions: ${totalConv}`);
  console.log(
    `- avg_cpc_hkd: ${totalClicks ? (totalCost / totalClicks).toFixed(2) : "n/a"}`,
  );
  if (budget > 0 && totalCost >= budget * 0.9 && days === 1) {
    console.log(
      "- likely_cause: daily budget largely consumed; Search stops/limits serving → afternoon inquiry drought",
    );
  }
  console.log(
    "- next_levers (manual): raise daily budget, lower tCPA/bids, add ad schedule for business hours, or pause high-CPC waste — do NOT auto-apply from this script",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
