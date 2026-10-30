/**
 * Re-date quote-cost-synced expenses to match quote month
 * (shootingDate → createdAt), same attribution as 收入.
 *
 *   npx tsx scripts/resync-quote-cost-expense-dates.ts
 */
import { resyncAllQuoteCostExpenseDates } from "../server/db";

async function main() {
  const result = await resyncAllQuoteCostExpenseDates();
  console.log(
    JSON.stringify(
      { ok: true, ...result, at: new Date().toISOString() },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
