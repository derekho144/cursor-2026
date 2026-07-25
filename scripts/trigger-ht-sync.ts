/**
 * One-time script to trigger HelloToby sync using stored cookies.
 * Run: npx tsx scripts/trigger-ht-sync.ts
 */
import { getHelloTobyCookies, saveHelloTobyCookies, upsertAdExpense, createAdSyncLog, updateAdPlatformSyncStatus } from "../server/db";
import { scrapeHelloTobyWithCookies } from "../server/scrapers/hellotoby";

console.log("🔄 Starting HelloToby sync...");

const cookiesJson = await getHelloTobyCookies();
if (!cookiesJson) {
  console.error("❌ HelloToby cookies not found in database!");
  process.exit(1);
}

console.log("✅ Cookies found, starting scrape...");
const result = await scrapeHelloTobyWithCookies(cookiesJson);

if (!result.success) {
  console.error("❌ Sync failed:", result.error);
  await createAdSyncLog({
    platform: "hellotoby",
    status: "failed",
    errorMessage: result.error,
    recordsCount: 0,
  });
  process.exit(1);
}

console.log(`✅ Scraped ${result.expenses.length} monthly records`);
for (const expense of result.expenses) {
  console.log(`  ${expense.month}: HKD ${expense.amount} (refund: ${expense.refundAmount || 0})`);
  const [yearStr, monthStr] = expense.month.split("-");
  await upsertAdExpense({
    platform: expense.platform,
    year: parseInt(yearStr),
    month: parseInt(monthStr),
    amount: expense.amount,
    refundAmount: expense.refundAmount || 0,
    currency: expense.currency || "HKD",
  });
}

await createAdSyncLog({
  platform: "hellotoby",
  status: "success",
  recordsCount: result.expenses.length,
});

await updateAdPlatformSyncStatus("hellotoby", "success");

// Auto-update cookies if refreshed
if (result.refreshedCookies) {
  console.log("🔄 Updating refreshed cookies...");
  await saveHelloTobyCookies(result.refreshedCookies, "derekho1155@gmail.com");
  console.log("✅ Cookies refreshed!");
}

console.log("🎉 HelloToby sync completed successfully!");
process.exit(0);
