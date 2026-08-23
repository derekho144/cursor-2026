/**
 * CLI: audit / repair quote leadSource on production.
 *
 *   npx tsx scripts/audit-quote-lead-sources.ts --dry-run
 *   npx tsx scripts/audit-quote-lead-sources.ts --apply
 *   npx tsx scripts/audit-quote-lead-sources.ts --apply --include-medium
 */
import "dotenv/config";
import { writeFileSync } from "fs";
import { auditQuoteLeadSources } from "../server/leadSourceAudit";

async function main() {
  const apply = process.argv.includes("--apply");
  const includeMedium = process.argv.includes("--include-medium");
  const overrideProtected = process.argv.includes("--override-protected");

  console.log(`# Quote leadSource audit (${apply ? "APPLY" : "DRY-RUN"})`);
  const result = await auditQuoteLeadSources({ apply, overrideProtected });

  let rows = result.rows;
  if (apply && !includeMedium) {
    // apply path already only writes high; still show medium in report
  }

  const high = rows.filter((r) => r.confidence === "high");
  const medium = rows.filter((r) => r.confidence === "medium");

  console.log(`Scanned: ${result.scanned}`);
  console.log(`Would change: ${result.wouldChange} (high=${high.length}, medium=${medium.length})`);
  console.log(`Applied: ${result.applied}`);
  console.log(`Protected skipped: ${result.protectedSkipped}`);
  console.log("By suggested:", JSON.stringify(result.bySuggested));

  const report = {
    mode: apply ? "apply" : "dry-run",
    ...result,
    highConfidence: high,
    mediumConfidence: medium,
  };
  const outPath = `/tmp/lead-source-audit-${Date.now()}.json`;
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`Full report: ${outPath}`);

  console.log("\n## Sample high-confidence (max 30)");
  for (const r of high.slice(0, 30)) {
    console.log(
      `#${r.quoteId} ${r.quoteNumber} [${r.status}] ${r.clientName}: ${r.current} → ${r.suggested} | ${r.reason}`
    );
  }
  if (medium.length) {
    console.log("\n## Sample medium (max 15) — not applied unless --include-medium later");
    for (const r of medium.slice(0, 15)) {
      console.log(
        `#${r.quoteId} ${r.quoteNumber} ${r.clientName}: ${r.current} → ${r.suggested} | ${r.reason}`
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
