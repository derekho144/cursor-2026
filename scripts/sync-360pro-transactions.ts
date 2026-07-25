/**
 * Sync 360Pro individual transactions to ad_transactions table
 */
import { scrapePro360WithCookies } from "../server/scrapers/hellotoby";
import { getPro360Cookies, upsertAdTransaction, deleteAdTransactionsByPlatform, getDb } from "../server/db";

async function main() {
  console.log("[360Pro Sync] Starting transaction sync...");

  const cookiesJson = await getPro360Cookies();
  if (!cookiesJson) {
    console.error("[360Pro Sync] ❌ No PRO360 cookies found. Please set cookies first.");
    process.exit(1);
  }

  console.log("[360Pro Sync] Cookies found, starting scrape...");
  const result = await scrapePro360WithCookies(cookiesJson);

  if (!result.success) {
    console.error("[360Pro Sync] ❌ Scrape failed:", result.error);
    process.exit(1);
  }

  console.log(`[360Pro Sync] ✅ Scraped ${result.expenses.length} monthly records`);
  console.log(`[360Pro Sync] ✅ Scraped ${result.transactions?.length ?? 0} individual transactions`);

  if (result.transactions && result.transactions.length > 0) {
    console.log("[360Pro Sync] Clearing old 360pro transactions...");
    await deleteAdTransactionsByPlatform("360pro");

    console.log("[360Pro Sync] Saving new transactions...");
    let saved = 0;
    let errors = 0;
    for (const tx of result.transactions) {
      try {
        await upsertAdTransaction({
          ...tx,
          platform: "360pro",
        });
        saved++;
      } catch (e) {
        console.warn(`[360Pro Sync] Failed to save tx ${tx.transId}:`, e);
        errors++;
      }
    }
    console.log(`[360Pro Sync] ✅ Saved ${saved} transactions (${errors} errors)`);

    // Show breakdown by type
    const expenses = result.transactions.filter(t => t.type === "expense");
    const refunds = result.transactions.filter(t => t.type === "refund");
    console.log(`[360Pro Sync] Breakdown: ${expenses.length} expenses, ${refunds.length} refunds`);

    // Show total amounts
    const totalExpense = expenses.reduce((sum, t) => sum + t.hkdAmount, 0);
    const totalRefund = refunds.reduce((sum, t) => sum + t.hkdAmount, 0);
    console.log(`[360Pro Sync] Total expense: HKD ${totalExpense.toFixed(2)}`);
    console.log(`[360Pro Sync] Total refund: HKD ${totalRefund.toFixed(2)}`);
    console.log(`[360Pro Sync] Net expense: HKD ${(totalExpense - totalRefund).toFixed(2)}`);

    // Show sample transactions
    console.log("\n[360Pro Sync] Sample transactions (first 5):");
    result.transactions.slice(0, 5).forEach(tx => {
      console.log(`  ${tx.transDate} | ${tx.type} | HKD ${tx.hkdAmount} | ${tx.description}`);
    });
  } else {
    console.warn("[360Pro Sync] ⚠️ No individual transactions found in scrape result");
  }

  const db = getDb();
  await db.end?.();
  process.exit(0);
}

main().catch(e => {
  console.error("[360Pro Sync] Fatal error:", e);
  process.exit(1);
});
