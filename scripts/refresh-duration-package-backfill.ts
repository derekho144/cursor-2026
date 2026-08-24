/**
 * Re-run durationPackage backfill after duration rule changes.
 *
 *   npx tsx scripts/refresh-duration-package-backfill.ts --dry-run
 *   npx tsx scripts/refresh-duration-package-backfill.ts --apply
 */
import "dotenv/config";
import { writeFileSync } from "fs";
import { refreshDurationPackageBackfill } from "../server/pricingLearning";

async function main() {
  const apply = process.argv.includes("--apply");
  const dryRun = !apply;

  console.log(
    `# durationPackage refresh (${dryRun ? "DRY-RUN" : "APPLY"}) — 半日 4–5h / 全日 6–10h`
  );

  const result = await refreshDurationPackageBackfill({
    limit: 3000,
    dryRun,
    alsoBackfill: true,
  });

  console.log(`Scanned: ${result.scanned}`);
  console.log(`Hours updated: ${result.hoursUpdated}`);
  console.log(`Duration package updated: ${result.durationUpdated}`);
  if (result.backfill) {
    console.log(
      `Structured backfill: updated=${result.backfill.updated} scanned=${result.backfill.scanned} skippedNoSignal=${result.backfill.skippedNoSignal}`
    );
  }

  if (result.changes.length > 0) {
    console.log("\nSample changes:");
    for (const c of result.changes.slice(0, 20)) {
      console.log(
        `  ${c.quoteNumber} [${c.fields.join(",")}] ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`
      );
    }
  }

  const outPath = `/tmp/duration-package-refresh-${Date.now()}.json`;
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`\nFull report: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
