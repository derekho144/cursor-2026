import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

const db = await createConnection(process.env.DATABASE_URL);

// 查詢所有有 aiParsed 的詢價記錄
const [rows] = await db.execute(
  "SELECT id, ai_parsed FROM email_inquiries WHERE ai_parsed IS NOT NULL"
);

let updated = 0;
let skipped = 0;

for (const row of rows) {
  try {
    const parsed = JSON.parse(row.ai_parsed);
    if (!Array.isArray(parsed.suggestedItems) || parsed.suggestedItems.length === 0) {
      skipped++;
      continue;
    }

    // 計算 suggestedItems 總計
    const itemsTotal = parsed.suggestedItems.reduce(
      (sum, item) => sum + (item.quantity ?? 1) * (item.unitPrice ?? 0),
      0
    );

    if (itemsTotal <= 0) {
      skipped++;
      continue;
    }

    const newMid = itemsTotal;
    const newLow = Math.round(itemsTotal * 0.7 / 100) * 100;
    const newHigh = Math.round(itemsTotal * 1.35 / 100) * 100;

    // 只在數值有變化時才更新
    if (parsed.pricingMid === newMid && parsed.pricingLow === newLow && parsed.pricingHigh === newHigh) {
      skipped++;
      continue;
    }

    console.log(`ID ${row.id}: items total=${itemsTotal}, old mid=${parsed.pricingMid} → new mid=${newMid}, low=${newLow}, high=${newHigh}`);

    parsed.pricingMid = newMid;
    parsed.pricingLow = newLow;
    parsed.pricingHigh = newHigh;

    await db.execute(
      "UPDATE email_inquiries SET ai_parsed = ? WHERE id = ?",
      [JSON.stringify(parsed), row.id]
    );
    updated++;
  } catch (e) {
    console.error(`ID ${row.id} error:`, e.message);
  }
}

console.log(`\nDone: updated=${updated}, skipped=${skipped}`);
await db.end();
