/**
 * Sync all HelloToby transactions to ad_transactions table
 * Run: npx tsx scripts/sync-transactions.ts
 */
import { scrapeHelloTobyViaAPI } from "../server/scrapers/hellotoby";
import { getHelloTobyCookies, deleteAdTransactionsByPlatform, upsertAdTransaction } from "../server/db";

async function main() {
  console.log("[sync-transactions] Starting...");

  const cookiesJson = await getHelloTobyCookies();
  if (!cookiesJson) {
    console.error("[sync-transactions] ❌ No HelloToby cookies found. Please set cookies first.");
    process.exit(1);
  }

  console.log("[sync-transactions] Fetching all HelloToby transactions via API...");
  const result = await scrapeHelloTobyViaAPI(cookiesJson);

  if (!result.success) {
    console.error("[sync-transactions] ❌ Scrape failed:", result.error);
    process.exit(1);
  }

  const transactions = result.transactions || [];
  console.log(`[sync-transactions] Got ${transactions.length} transactions`);

  // Show breakdown by type
  const byType = transactions.reduce((acc, tx) => {
    acc[tx.type] = (acc[tx.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log("[sync-transactions] By type:", byType);

  // Show sample records
  console.log("[sync-transactions] Sample records:");
  transactions.slice(0, 5).forEach(tx => {
    console.log(`  [${tx.type}] ${tx.transDate} | ${tx.description?.substring(0, 40)} | ${tx.coins} coins | HKD ${tx.hkdAmount} (rate: ${tx.exchangeRate})`);
  });

  // Delete existing and re-insert
  console.log("[sync-transactions] Clearing existing transactions for hellotoby...");
  await deleteAdTransactionsByPlatform("hellotoby");

  console.log("[sync-transactions] Inserting transactions...");
  let inserted = 0;
  for (const tx of transactions) {
    await upsertAdTransaction({
      ...tx,
      platform: tx.platform as "hellotoby" | "360pro" | "freehunter" | "google_ads",
    });
    inserted++;
    if (inserted % 50 === 0) {
      console.log(`  Inserted ${inserted}/${transactions.length}...`);
    }
  }

  console.log(`[sync-transactions] ✅ Done! Inserted ${inserted} transactions`);

  // Summary stats
  const expenses = transactions.filter(t => t.type === "expense");
  const refunds = transactions.filter(t => t.type === "refund");
  const topups = transactions.filter(t => t.type === "topup");
  const totalExpense = expenses.reduce((s, t) => s + t.hkdAmount, 0);
  const totalRefund = refunds.reduce((s, t) => s + t.hkdAmount, 0);
  const totalTopup = topups.reduce((s, t) => s + t.hkdAmount, 0);

  console.log("\n=== Summary ===");
  console.log(`Expenses: ${expenses.length} records, HKD ${totalExpense.toFixed(2)}`);
  console.log(`Refunds: ${refunds.length} records, HKD ${totalRefund.toFixed(2)}`);
  console.log(`Top-ups: ${topups.length} records, HKD ${totalTopup.toFixed(2)}`);
  console.log(`Net expense: HKD ${(totalExpense - totalRefund).toFixed(2)}`);

  process.exit(0);
}

main().catch(e => {
  console.error("[sync-transactions] Fatal error:", e);
  process.exit(1);
});
