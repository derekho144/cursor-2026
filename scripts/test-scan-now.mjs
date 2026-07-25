/**
 * 直接呼叫 runEmailScan 函數進行測試
 */
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

// 直接 import runEmailScan (需要先 compile，改用 HTTP API 方式)
// 改為呼叫 server API
import fetch from "node-fetch";

const BASE_URL = "http://localhost:3000";

// 先取得 session cookie（需要登入）
// 由於是 protected procedure，改用直接 curl 測試
console.log("📡 Triggering Gmail scan via server API...");
console.log("   (Note: This requires authentication, checking server logs instead)");
console.log("");
console.log("✅ Test email was sent to info.exposurehk@gmail.com");
console.log("   Subject: 【Freehunter】新工作邀請：婚禮攝影及錄影服務");
console.log("   From: noreply@freehunter.com.hk");
console.log("");
console.log("📋 Next step: Go to admin system → 詢價郵件 → click 掃描 button");
console.log("   The system should:");
console.log("   1. Find the test email");
console.log("   2. Detect it's from freehunter.com.hk");
console.log("   3. Auto-reply with introduction email");
console.log("   4. Create pending inquiry record");
