/**
 * Test script: HelloToby API-based scraper
 * Verifies exchange rate auto-detection and HKD conversion
 */
import { scrapeHelloTobyViaAPI } from "../server/scrapers/hellotoby";
import { getHelloTobyCookies } from "../server/db";

async function main() {
  console.log("[Test] Loading HelloToby cookies from DB...");
  const cookiesJson = await getHelloTobyCookies();
  if (!cookiesJson) {
    console.error("[Test] ❌ No HelloToby cookies found in DB. Please save cookies first.");
    process.exit(1);
  }
  console.log("[Test] ✅ Cookies loaded.");

  console.log("[Test] Running scrapeHelloTobyViaAPI...");
  const result = await scrapeHelloTobyViaAPI(cookiesJson);

  if (!result.success) {
    console.error("[Test] ❌ Scrape failed:", result.error);
    process.exit(1);
  }

  console.log(`\n[Test] ✅ Success! Found ${result.expenses.length} monthly records:\n`);
  
  // Sort by month
  const sorted = [...result.expenses].sort((a, b) => a.month.localeCompare(b.month));
  
  let totalHKD = 0;
  let totalRefund = 0;
  for (const exp of sorted) {
    const refundStr = exp.refundAmount && exp.refundAmount > 0 ? ` (退款: HKD ${exp.refundAmount.toFixed(2)})` : "";
    console.log(`  ${exp.month}: HKD ${exp.amount.toFixed(2)}${refundStr}`);
    totalHKD += exp.amount;
    totalRefund += exp.refundAmount ?? 0;
  }
  
  console.log(`\n  Total: HKD ${totalHKD.toFixed(2)} (退款: HKD ${totalRefund.toFixed(2)})`);
  console.log(`  Net:   HKD ${(totalHKD - totalRefund).toFixed(2)}`);
}

main().catch(console.error).finally(() => process.exit(0));
