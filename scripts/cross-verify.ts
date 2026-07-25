/**
 * Cross-verification: Compare HelloToby API data vs database records
 * API fields: credit (negative=expense, positive=topup), amount (HKD cents for topups)
 */
import { getHelloTobyCookies, getAdExpenses } from "../server/db";

const HT_API_BASE = "https://api.hellotoby.com";

async function fetchMonthData(cookieStr: string, month: string): Promise<any[]> {
  const res = await fetch(`${HT_API_BASE}/api/account/trans?month=${month}&limit=200`, {
    headers: {
      "Cookie": cookieStr,
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  });
  if (!res.ok) return [];
  const data = await res.json() as any;
  return data.data || [];
}

async function main() {
  console.log("=== HelloToby 數據交叉對比 ===\n");

  const cookiesJson = await getHelloTobyCookies();
  if (!cookiesJson) { console.error("❌ 無法讀取 HelloToby Cookies"); process.exit(1); }

  const cookiesArr = JSON.parse(cookiesJson);
  const cookieStr = cookiesArr.map((c: any) => `${c.name}=${c.value}`).join("; ");

  // Get all HelloToby records from DB
  const dbRecords = await getAdExpenses({ platform: "hellotoby" });
  const dbMap = new Map<string, { amount: number; refundAmount: number }>();
  for (const r of dbRecords) {
    const key = `${r.year}-${String(r.month).padStart(2, "0")}`;
    dbMap.set(key, {
      amount: parseFloat(r.amount || "0"),
      refundAmount: parseFloat(r.refundAmount || "0"),
    });
  }
  console.log(`資料庫共有 ${dbRecords.length} 筆 HelloToby 記錄\n`);

  // Build month list
  const allMonths: string[] = [];
  const now = new Date();
  for (let y = 2021; y <= now.getFullYear(); y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === now.getFullYear() && m > now.getMonth() + 1) break;
      allMonths.push(`${y}-${String(m).padStart(2, "0")}`);
    }
  }

  // First pass: collect all transactions and build rate timeline
  console.log("正在從 API 抓取所有月份數據...");
  const allTxByMonth = new Map<string, any[]>();
  // rate timeline: sorted by date, each entry = { date, rate }
  const rateTimeline: Array<{ date: string; rate: number; coins: number; hkd: number }> = [];

  for (const month of allMonths) {
    const txs = await fetchMonthData(cookieStr, month);
    if (txs.length > 0) {
      allTxByMonth.set(month, txs);
      for (const tx of txs) {
        const credit = parseFloat(tx.credit || "0");
        const amount = parseFloat(tx.amount || "0"); // HKD cents
        // Top-up: credit > 0 AND amount > 0
        if (credit > 0 && amount > 0) {
          const rate = (amount / 100) / credit;
          rateTimeline.push({ date: tx.transDate || `${month}-15`, rate, coins: credit, hkd: amount / 100 });
        }
      }
    }
    process.stdout.write(".");
  }
  console.log("\n");

  rateTimeline.sort((a, b) => a.date.localeCompare(b.date));
  console.log(`找到 ${rateTimeline.length} 筆增值記錄`);
  console.log("最近 5 筆換算率：");
  for (const r of rateTimeline.slice(-5)) {
    console.log(`  ${r.date.substring(0, 10)}: ${r.coins} 金幣 = HKD ${r.hkd} → HKD ${r.rate.toFixed(4)}/金幣`);
  }
  console.log();

  // Get rate at a given date (use most recent top-up before this date)
  function getRateAtDate(dateStr: string): number {
    let rate = 1.99; // fallback: web rate for 100 coins
    for (const r of rateTimeline) {
      if (r.date <= dateStr) rate = r.rate;
      else break;
    }
    return rate;
  }

  // Second pass: recalculate each month from API and compare with DB
  let totalMatched = 0;
  let totalMismatch = 0;
  const mismatches: string[] = [];

  for (const month of allMonths) {
    const txs = allTxByMonth.get(month);
    if (!txs || txs.length === 0) continue;

    let apiExpense = 0;
    let apiRefund = 0;

    for (const tx of txs) {
      const credit = parseFloat(tx.credit || "0");
      const amount = parseFloat(tx.amount || "0"); // HKD cents (only for top-ups)
      const dateStr = tx.transDate || `${month}-15`;

      if (credit > 0 && amount > 0) {
        // Top-up: not an expense, skip
        continue;
      } else if (credit > 0 && amount === 0) {
        // Refund: positive credit without payment
        const rate = getRateAtDate(dateStr);
        apiRefund += credit * rate;
      } else if (credit < 0) {
        // Expense: negative credit
        const rate = getRateAtDate(dateStr);
        apiExpense += Math.abs(credit) * rate;
      }
    }

    const dbRecord = dbMap.get(month);
    if (!dbRecord) {
      if (apiExpense > 0.5) {
        console.log(`❓ ${month}: API 有數據 (HKD ${apiExpense.toFixed(2)}) 但資料庫無記錄`);
      }
      continue;
    }

    const expenseDiff = Math.abs(dbRecord.amount - apiExpense);
    const refundDiff = Math.abs(dbRecord.refundAmount - apiRefund);
    const tolerance = 0.5; // HKD 0.50 tolerance

    if (expenseDiff <= tolerance && refundDiff <= tolerance) {
      totalMatched++;
    } else {
      totalMismatch++;
      const msg = `⚠️  ${month}: DB=${dbRecord.amount.toFixed(2)} API=${apiExpense.toFixed(2)} (差 ${expenseDiff.toFixed(2)})${refundDiff > tolerance ? ` | 退款 DB=${dbRecord.refundAmount.toFixed(2)} API=${apiRefund.toFixed(2)} (差 ${refundDiff.toFixed(2)})` : ""}`;
      mismatches.push(msg);
      console.log(msg);
    }
  }

  console.log("\n=== 對比結果摘要 ===");
  console.log(`✅ 吻合: ${totalMatched} 個月份`);
  console.log(`⚠️  差異: ${totalMismatch} 個月份`);

  if (mismatches.length === 0) {
    console.log("\n🎉 所有月份數據完全吻合！資料庫記錄準確。");
  }

  // Show all DB records
  console.log("\n=== 資料庫所有 HelloToby 記錄 ===");
  let totalExpense = 0;
  let totalRefund = 0;
  for (const month of allMonths) {
    const r = dbMap.get(month);
    if (r && r.amount > 0) {
      const net = r.amount - r.refundAmount;
      totalExpense += r.amount;
      totalRefund += r.refundAmount;
      console.log(`  ${month}: HKD ${r.amount.toFixed(2)}${r.refundAmount > 0 ? ` (退款 ${r.refundAmount.toFixed(2)}, 淨 ${net.toFixed(2)})` : ""}`);
    }
  }
  console.log(`\n  總開支: HKD ${totalExpense.toFixed(2)}`);
  console.log(`  總退款: HKD ${totalRefund.toFixed(2)}`);
  console.log(`  淨開支: HKD ${(totalExpense - totalRefund).toFixed(2)}`);
}

main().catch(console.error).finally(() => process.exit(0));
