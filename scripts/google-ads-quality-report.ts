/**
 * Built-in weekly QS report (no gads-cli required).
 * Uses the same REST GAQL stack as server/googleAds.ts.
 *
 *   npx tsx scripts/google-ads-quality-report.ts
 *   npx tsx scripts/google-ads-quality-report.ts --days 14 --out reports/qs-review-test
 */
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { fetchGoogleAdsQualityDashboard } from "../server/googleAds";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

async function main() {
  const days = Math.max(7, Math.min(90, parseInt(arg("--days", "30"), 10) || 30));
  const outDir = arg("--out", join(process.cwd(), `reports/qs-review-${new Date().toISOString().slice(0, 10)}`));
  mkdirSync(outDir, { recursive: true });

  const data = await fetchGoogleAdsQualityDashboard(days);

  writeFileSync(join(outDir, "quality-dashboard.json"), JSON.stringify(data, null, 2));

  const lines: string[] = [
    `# Google Ads Quality Score Report`,
    ``,
    `- Generated: ${new Date().toISOString()}`,
    `- Window: last ${days} days`,
    `- Keywords with impressions: ${data.overview.keywordCount}`,
    `- Avg quality score: ${data.overview.avgQualityScore ?? "—"}`,
    `- Low QS (≤5) spend share: ${data.overview.lowQsSpendSharePct}%`,
    ``,
    `## QS distribution`,
    ``,
    `| Score | Keywords | Spend (HKD) |`,
    `|-------|----------|-------------|`,
  ];

  for (const row of data.distribution) {
    lines.push(`| ${row.qualityScore} | ${row.keywordCount} | ${row.spendHKD.toFixed(2)} |`);
  }

  lines.push(``, `## Top keywords by spend (low QS first)`, ``);
  lines.push(`| Keyword | Campaign | QS | CTR | LP | Cost HKD |`);
  lines.push(`|---------|----------|----|-----|----|---------|`);

  for (const kw of data.topKeywords.slice(0, 25)) {
    lines.push(
      `| ${kw.keyword} | ${kw.campaignName} | ${kw.qualityScore ?? "—"} | ${kw.expectedCtr ?? "—"} | ${kw.landingPageExperience ?? "—"} | ${kw.costHKD.toFixed(2)} |`
    );
  }

  if (data.recommendations.length) {
    lines.push(``, `## Google recommendations`, ``);
    for (const r of data.recommendations.slice(0, 10)) {
      lines.push(`- **${r.type}**: ${r.description}`);
    }
  }

  writeFileSync(join(outDir, "quality-report.md"), lines.join("\n") + "\n");
  console.log(`google-ads-quality-report: wrote ${outDir}/quality-dashboard.json`);
  console.log(`google-ads-quality-report: wrote ${outDir}/quality-report.md`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
