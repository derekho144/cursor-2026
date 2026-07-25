/**
 * Manual trigger script for Freehunter job board scrape
 * Usage: npx tsx scripts/trigger-fh-scrape.ts
 */
import { scrapeFreehunterBoard } from '../server/scrapers/freehunterBoard.js';

async function main() {
  console.log('[Manual Trigger] Starting FH scrape...');
  try {
    const result = await scrapeFreehunterBoard(true, 20);
    console.log('[Manual Trigger] Done:');
    console.log(`  - New jobs: ${result.newJobs}`);
    console.log(`  - Emails fetched: ${result.emailsFetched}`);
    console.log(`  - Auto emails sent: ${result.autoEmailsSent ?? 0}`);
    console.log(`  - Success: ${result.success}`);
    if (result.error) console.log(`  - Error: ${result.error}`);
  } catch (e) {
    console.error('[Manual Trigger] Error:', e);
  }
  process.exit(0);
}

main();
