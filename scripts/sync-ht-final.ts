/**
 * Final sync script: HelloToby via API with auto exchange rate detection
 * Saves correct HKD amounts to database
 */
import { scrapeHelloTobyViaAPI } from "../server/scrapers/hellotoby";
import { getHelloTobyCookies, upsertAdExpense, updateAdPlatformSyncStatus, createAdSyncLog } from "../server/db";

async function main() {
  console.log("[Sync] Loading HelloToby cookies from DB...");
  const cookiesJson = await getHelloTobyCookies();
  if (!cookiesJson) {
    console.error("[Sync] ❌ No HelloToby cookies found in DB.");
    process.exit(1);
  }
  console.log("[Sync] ✅ Cookies loaded. Starting full sync...");

  await updateAdPlatformSyncStatus("hellotoby", "syncing");

  const result = await scrapeHelloTobyViaAPI(cookiesJson);

  if (!result.success) {
    console.error("[Sync] ❌ Scrape failed:", result.error);
    await updateAdPlatformSyncStatus("hellotoby", "error", result.error);
    await createAdSyncLog({ platform: "hellotoby", status: "error", message: result.error || "同步失敗", recordsUpdated: 0 });
    process.exit(1);
  }

  console.log(`\n[Sync] ✅ Scraped ${result.expenses.length} monthly records. Saving to DB...\n`);

  let recordsUpdated = 0;
  for (const expense of result.expenses) {
    const [expYear, expMonth] = expense.month.split("-").map(Number);
    if (expYear && expMonth) {
      await upsertAdExpense({
        platform: "hellotoby",
        year: expYear,
        month: expMonth,
        amount: String(expense.amount),
        refundAmount: String(expense.refundAmount ?? 0),
        currency: expense.currency,
        isAutoSynced: 1,
      });
      const refundStr = expense.refundAmount && expense.refundAmount > 0 ? ` (退款: HKD ${expense.refundAmount.toFixed(2)})` : "";
      console.log(`  ✅ ${expense.month}: HKD ${expense.amount.toFixed(2)}${refundStr}`);
      recordsUpdated++;
    }
  }

  await updateAdPlatformSyncStatus("hellotoby", "success");
  await createAdSyncLog({
    platform: "hellotoby",
    status: "success",
    message: `成功同步 ${recordsUpdated} 筆記錄（API 自動換算率）`,
    recordsUpdated,
  });

  console.log(`\n[Sync] ✅ Done! ${recordsUpdated} records saved to database.`);
}

main().catch(console.error).finally(() => process.exit(0));
