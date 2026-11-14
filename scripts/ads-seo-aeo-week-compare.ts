/**
 * Compare Google Ads (+ optional GSC) windows around the Oct 2026 AEO/GEO packs.
 *
 * Windows (HKT calendar dates, Ads API date segments):
 *   before  = week before AEO/GEO wave (2026-09-22 → 09-28)
 *   aeoWeek = pack publish week          (2026-10-01 → 10-07)
 *   thisWeek= most recent full week      (2026-10-08 → 10-14)
 *
 *   npx tsx scripts/ads-seo-aeo-week-compare.ts
 *   npx tsx scripts/ads-seo-aeo-week-compare.ts --with-gsc
 */
import { runGoogleAdsGaql } from "../server/googleAds";

type Bucket = {
  spendHKD: number;
  impressions: number;
  clicks: number;
  conversions: number;
  isWeightedSum: number;
  isWeight: number;
};

type WindowDef = { label: string; start: string; end: string };

const WINDOWS: WindowDef[] = [
  { label: "before_aeo", start: "2026-09-22", end: "2026-09-28" },
  { label: "aeo_pack_week", start: "2026-10-01", end: "2026-10-07" },
  { label: "this_week", start: "2026-10-08", end: "2026-10-14" },
];

function empty(): Bucket {
  return {
    spendHKD: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    isWeightedSum: 0,
    isWeight: 0,
  };
}

function finalize(b: Bucket) {
  const ctr = b.impressions > 0 ? (b.clicks / b.impressions) * 100 : 0;
  const cpc = b.clicks > 0 ? b.spendHKD / b.clicks : 0;
  const cpa = b.conversions > 0 ? b.spendHKD / b.conversions : 0;
  const searchIS =
    b.isWeight > 0 ? b.isWeightedSum / b.isWeight : null;
  return {
    spendHKD: round(b.spendHKD),
    impressions: b.impressions,
    clicks: b.clicks,
    conversions: round(b.conversions),
    ctrPct: round(ctr, 2),
    cpcHKD: round(cpc),
    cpaHKD: round(cpa),
    searchImpressionSharePct: searchIS == null ? null : round(searchIS, 1),
  };
}

function round(n: number, d = 2) {
  return Math.round(n * 10 ** d) / 10 ** d;
}

function pctDelta(cur: number, base: number): string {
  if (base === 0) return cur === 0 ? "—" : "+∞";
  const p = ((cur - base) / base) * 100;
  return `${p >= 0 ? "+" : ""}${round(p, 1)}%`;
}

async function fetchAds() {
  const start = WINDOWS[0]!.start;
  const end = WINDOWS[WINDOWS.length - 1]!.end;
  const query = `
    SELECT
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.search_impression_share
    FROM customer
    WHERE segments.date BETWEEN '${start}' AND '${end}'
  `;
  const rows = await runGoogleAdsGaql(query);
  const buckets = Object.fromEntries(WINDOWS.map((w) => [w.label, empty()])) as Record<
    string,
    Bucket
  >;

  for (const row of rows) {
    const date = String(row.segments?.date ?? "");
    if (!date) continue;
    const win = WINDOWS.find((w) => date >= w.start && date <= w.end);
    if (!win) continue;
    const b = buckets[win.label]!;
    b.spendHKD += Number(row.metrics?.costMicros ?? row.metrics?.cost_micros ?? 0) / 1_000_000;
    b.impressions += Number(row.metrics?.impressions ?? 0);
    b.clicks += Number(row.metrics?.clicks ?? 0);
    b.conversions += Number(row.metrics?.conversions ?? 0);
    const isRaw =
      row.metrics?.searchImpressionShare ?? row.metrics?.search_impression_share;
    const is = isRaw == null ? null : Number(isRaw);
    if (is != null && Number.isFinite(is) && Number(row.metrics?.impressions ?? 0) > 0) {
      const impr = Number(row.metrics?.impressions ?? 0);
      b.isWeightedSum += is * 100 * impr;
      b.isWeight += impr;
    }
  }

  return Object.fromEntries(
    WINDOWS.map((w) => [w.label, { ...w, metrics: finalize(buckets[w.label]!) }])
  );
}

async function fetchCampaignBreakdown() {
  const start = WINDOWS[0]!.start;
  const end = WINDOWS[WINDOWS.length - 1]!.end;
  const query = `
    SELECT
      campaign.name,
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions
    FROM campaign
    WHERE segments.date BETWEEN '${start}' AND '${end}'
      AND campaign.status != 'REMOVED'
  `;
  const rows = await runGoogleAdsGaql(query);
  type Agg = Record<string, Bucket>;
  const byCampaign: Record<string, Agg> = {};

  for (const row of rows) {
    const name = String(row.campaign?.name ?? "(unknown)");
    const date = String(row.segments?.date ?? "");
    const win = WINDOWS.find((w) => date >= w.start && date <= w.end);
    if (!win) continue;
    byCampaign[name] ??= Object.fromEntries(WINDOWS.map((w) => [w.label, empty()]));
    const b = byCampaign[name]![win.label]!;
    b.spendHKD += Number(row.metrics?.costMicros ?? row.metrics?.cost_micros ?? 0) / 1_000_000;
    b.impressions += Number(row.metrics?.impressions ?? 0);
    b.clicks += Number(row.metrics?.clicks ?? 0);
    b.conversions += Number(row.metrics?.conversions ?? 0);
  }

  return Object.entries(byCampaign)
    .map(([name, windows]) => ({
      name,
      windows: Object.fromEntries(
        Object.entries(windows).map(([k, v]) => [k, finalize(v)])
      ),
    }))
    .sort(
      (a, b) =>
        (b.windows.this_week?.spendHKD ?? 0) - (a.windows.this_week?.spendHKD ?? 0)
    );
}

async function maybeGsc() {
  if (!process.argv.includes("--with-gsc")) return null;
  try {
    const { queryGscSearchAnalytics } = await import("../server/googleSearchConsole");
    const siteUrl = "sc-domain:jdstudiohk.com";
    const out: Record<string, unknown> = {};
    for (const w of WINDOWS) {
      const rows = await queryGscSearchAnalytics({
        siteUrl,
        startDate: w.start,
        endDate: w.end,
      });
      let clicks = 0;
      let impressions = 0;
      let posW = 0;
      for (const r of rows) {
        clicks += r.clicks ?? 0;
        impressions += r.impressions ?? 0;
        posW += (r.position ?? 0) * (r.impressions ?? 0);
      }
      out[w.label] = {
        ...w,
        clicks,
        impressions,
        ctrPct: impressions > 0 ? round((clicks / impressions) * 100, 2) : 0,
        position: impressions > 0 ? round(posW / impressions, 1) : 0,
      };
    }
    return out;
  } catch (e) {
    return { error: String(e) };
  }
}

function printCompare(
  label: string,
  before: ReturnType<typeof finalize>,
  after: ReturnType<typeof finalize>
) {
  console.log(`\n### ${label}: this_week vs before_aeo`);
  console.log(`| Metric | before (09/22–28) | this week (10/08–14) | Δ |`);
  console.log(`|--------|-------------------:|---------------------:|---|`);
  const rows: Array<[string, number | null, number | null]> = [
    ["Spend HKD", before.spendHKD, after.spendHKD],
    ["Impressions", before.impressions, after.impressions],
    ["Clicks", before.clicks, after.clicks],
    ["Conversions", before.conversions, after.conversions],
    ["CTR %", before.ctrPct, after.ctrPct],
    ["CPC HKD", before.cpcHKD, after.cpcHKD],
    ["CPA HKD", before.cpaHKD, after.cpaHKD],
    [
      "Search IS %",
      before.searchImpressionSharePct,
      after.searchImpressionSharePct,
    ],
  ];
  for (const [name, b, a] of rows) {
    if (b == null || a == null) {
      console.log(`| ${name} | ${b ?? "—"} | ${a ?? "—"} | — |`);
    } else {
      console.log(`| ${name} | ${b} | ${a} | ${pctDelta(a, b)} |`);
    }
  }
}

async function main() {
  console.log("# Google Ads vs AEO/GEO pack timeline");
  console.log("");
  console.log("AEO/GEO wave: 2026-10-01 → 10-04 (service packs + FAQ scoring)");
  console.log("Generated:", new Date().toISOString());

  const ads = await fetchAds();
  console.log("\n## Account windows");
  for (const w of WINDOWS) {
    const m = ads[w.label]!.metrics;
    console.log(
      `- **${w.label}** (${w.start}→${w.end}): spend HK$${m.spendHKD}, impr ${m.impressions}, clicks ${m.clicks}, conv ${m.conversions}, CTR ${m.ctrPct}%, CPC HK$${m.cpcHKD}, CPA HK$${m.cpaHKD}, IS ${m.searchImpressionSharePct ?? "—"}%`
    );
  }

  printCompare("Account", ads.before_aeo!.metrics, ads.this_week!.metrics);

  console.log("\n## Top campaigns (by this-week spend)");
  const campaigns = await fetchCampaignBreakdown();
  for (const c of campaigns.slice(0, 8)) {
    const b = c.windows.before_aeo!;
    const t = c.windows.this_week!;
    console.log(
      `- **${c.name}**: clicks ${b.clicks}→${t.clicks} (${pctDelta(t.clicks, b.clicks)}), conv ${b.conversions}→${t.conversions}, spend HK$${b.spendHKD}→${t.spendHKD}, CPA HK$${b.cpaHKD}→${t.cpaHKD}`
    );
  }

  const gsc = await maybeGsc();
  if (gsc) {
    console.log("\n## GSC (organic) windows");
    console.log(JSON.stringify(gsc, null, 2));
  }

  console.log("\n## Verdict hints");
  const b = ads.before_aeo!.metrics;
  const t = ads.this_week!.metrics;
  const betterConv = t.conversions > b.conversions;
  const betterCpa = t.cpaHKD > 0 && b.cpaHKD > 0 ? t.cpaHKD < b.cpaHKD : null;
  const betterCtr = t.ctrPct > b.ctrPct;
  console.log(
    `- Conversions: ${betterConv ? "UP" : "DOWN/FLAT"} (${b.conversions} → ${t.conversions})`
  );
  console.log(
    `- CPA: ${betterCpa == null ? "n/a" : betterCpa ? "IMPROVED" : "WORSE"} (HK$${b.cpaHKD} → HK$${t.cpaHKD})`
  );
  console.log(`- CTR: ${betterCtr ? "UP" : "DOWN/FLAT"} (${b.ctrPct}% → ${t.ctrPct}%)`);
  console.log(
    "- Note: AEO/GEO mainly moves organic (GSC). Ads gains show up if QS/landing-page experience or branded/query mix improved."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
