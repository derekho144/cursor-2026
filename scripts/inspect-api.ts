/**
 * Inspect HelloToby API response field structure
 */
import { getHelloTobyCookies } from "../server/db";

async function main() {
  const cookiesJson = await getHelloTobyCookies();
  if (!cookiesJson) { console.error("No cookies"); process.exit(1); }
  
  const cookiesArr = JSON.parse(cookiesJson);
  const cookieStr = cookiesArr.map((c: any) => `${c.name}=${c.value}`).join("; ");

  // Fetch 2026-03 (current month with known data)
  const res = await fetch("https://api.hellotoby.com/api/account/trans?month=2026-03&limit=20", {
    headers: {
      "Cookie": cookieStr,
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  });
  
  const data = await res.json() as any;
  console.log("Top-level keys:", Object.keys(data));
  console.log("Total count:", data.totalCount || data.total || data.count || "N/A");
  
  const items = data.data || data.transactions || data.items || [];
  console.log(`\nTotal items: ${items.length}`);
  
  if (items.length > 0) {
    console.log("\n=== First record (all fields) ===");
    console.log(JSON.stringify(items[0], null, 2));
    
    console.log("\n=== All records (key fields) ===");
    for (const item of items) {
      const keys = Object.keys(item);
      // Show all numeric/string fields
      const summary: any = {};
      for (const k of keys) {
        if (typeof item[k] !== 'object') summary[k] = item[k];
      }
      console.log(JSON.stringify(summary));
    }
  }
}

main().catch(console.error).finally(() => process.exit(0));
