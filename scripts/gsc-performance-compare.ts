/**
 * Compare GSC Search Analytics windows for jdstudiohk.com (AEO/GEO check).
 *
 * Requires production OAuth: platform google_search_console refresh token
 * (or GOOGLE_GSC_REFRESH_TOKEN) + GOOGLE_ADS_CLIENT_ID/SECRET.
 *
 *   npx tsx scripts/gsc-performance-compare.ts
 *   npx tsx scripts/gsc-performance-compare.ts --before 2026-09-14:2026-09-20 --after 2026-09-23:2026-09-29
 */
import {
  DEFAULT_GSC_SITE_URL,
  listGscSites,
  queryGscSearchAnalytics,
  type GscSearchAnalyticsRow,
} from "../server/googleSearchConsole";

function parseWindow(spec: string | undefined, fallback: [string, string]): [string, string] {
  if (!spec) return fallback;
  const [a, b] = spec.split(":");
  if (!a || !b) throw new Error(`Bad window ${spec} (expect YYYY-MM-DD:YYYY-MM-DD)`);
  return [a, b];
}

function sumRows(rows: GscSearchAnalyticsRow[]) {
  let clicks = 0;
  let impressions = 0;
  let posWeighted = 0;
  for (const r of rows) {
    const c = r.clicks ?? 0;
    const i = r.impressions ?? 0;
    clicks += c;
    impressions += i;
    posWeighted += (r.position ?? 0) * i;
  }
  const ctr = impressions > 0 ? clicks / impressions : 0;
  const position = impressions > 0 ? posWeighted / impressions : 0;
  return { clicks, impressions, ctr, position };
}

function fmt(n: number, digits = 0) {
  return n.toLocaleString("en-HK", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

async function windowReport(label: string, start: string, end: string, siteUrl: string) {
  const siteRows = await queryGscSearchAnalytics({
    siteUrl,
    startDate: start,
    endDate: end,
  });
  const site = sumRows(siteRows);

  const pageRows = await queryGscSearchAnalytics({
    siteUrl,
    startDate: start,
    endDate: end,
    dimensions: ["page"],
    rowLimit: 50,
  });
  const pick = (path: string) =>
    pageRows.find((r) => (r.keys?.[0] ?? "").includes(path));

  const interior = pick("/services/interior-photography");
  const product = pick("/services/product-photography");

  const queryRows = await queryGscSearchAnalytics({
    siteUrl,
    startDate: start,
    endDate: end,
    dimensions: ["query"],
    rowLimit: 15,
  });

  console.log(`\n## ${label} (${start} → ${end})`);
  console.log(
    `| Site | clicks ${fmt(site.clicks)} | impr ${fmt(site.impressions)} | CTR ${(site.ctr * 100).toFixed(2)}% | pos ${site.position.toFixed(1)} |`
  );
  for (const [name, row] of [
    ["interior", interior],
    ["product", product],
  ] as const) {
    if (!row) {
      console.log(`| ${name} | (no row in top pages)`);
      continue;
    }
    console.log(
      `| ${name} | clicks ${fmt(row.clicks ?? 0)} | impr ${fmt(row.impressions ?? 0)} | CTR ${(((row.ctr ?? 0) * 100)).toFixed(2)}% | pos ${(row.position ?? 0).toFixed(1)} |`
    );
  }
  console.log("Top queries:");
  for (const r of queryRows.slice(0, 10)) {
    console.log(
      `- ${r.keys?.[0]} · c=${r.clicks ?? 0} i=${r.impressions ?? 0} ctr=${(((r.ctr ?? 0) * 100)).toFixed(1)}% pos=${(r.position ?? 0).toFixed(1)}`
    );
  }
  return { site, interior, product };
}

async function main() {
  const args = process.argv.slice(2);
  const beforeSpec = args.includes("--before")
    ? args[args.indexOf("--before") + 1]
    : undefined;
  const afterSpec = args.includes("--after")
    ? args[args.indexOf("--after") + 1]
    : undefined;
  const before = parseWindow(beforeSpec, ["2026-09-14", "2026-09-20"]);
  const after = parseWindow(afterSpec, ["2026-09-23", "2026-09-29"]);

  const sites = await listGscSites();
  console.log("# GSC sites");
  for (const s of sites) console.log(`- ${s.siteUrl} (${s.permissionLevel ?? "?"})`);

  let siteUrl = DEFAULT_GSC_SITE_URL;
  const preferred =
    sites.find((s) => s.siteUrl === "sc-domain:jdstudiohk.com") ||
    sites.find((s) => s.siteUrl.includes("www.jdstudiohk.com")) ||
    sites.find((s) => s.siteUrl.includes("jdstudiohk.com"));
  if (preferred?.siteUrl) siteUrl = preferred.siteUrl;
  console.log(`\nUsing siteUrl: ${siteUrl}`);

  const a = await windowReport("A before AEO window", before[0], before[1], siteUrl);
  const b = await windowReport("B after AEO window", after[0], after[1], siteUrl);

  const dClick = b.site.clicks - a.site.clicks;
  const dImpr = b.site.impressions - a.site.impressions;
  console.log("\n## Delta (B − A)");
  console.log(`clicks ${dClick >= 0 ? "+" : ""}${dClick} · impressions ${dImpr >= 0 ? "+" : ""}${dImpr}`);
  console.log(
    dClick > 0 || dImpr > 0
      ? "結論傾向：自然搜尋指標有升（仍需結合查詢／頁面質素解讀）"
      : dClick < 0 || dImpr < 0
        ? "結論傾向：自然搜尋指標下跌或持平偏弱"
        : "結論：兩窗差異很小／數據不足"
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
