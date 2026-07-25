import puppeteer from "puppeteer";
import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import * as fsLib from "fs";

// Apply stealth plugin to bypass Cloudflare bot detection
puppeteerExtra.use(StealthPlugin());

const CHROMIUM_PATHS = [
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
];

function getChromiumPath(): string {
  // 1. Try Playwright bundled Chromium first (works in both dev and production)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { chromium } = require("playwright");
    const playwrightPath = chromium.executablePath();
    if (playwrightPath && fsLib.existsSync(playwrightPath)) {
      console.log("[Chromium] Using Playwright bundled chromium:", playwrightPath);
      return playwrightPath;
    }
  } catch (_) {}
  // 2. Try hardcoded Playwright path (sandbox environment)
  const sandboxPlaywrightPath = "/home/ubuntu/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome";
  if (fsLib.existsSync(sandboxPlaywrightPath)) {
    console.log("[Chromium] Using sandbox Playwright path:", sandboxPlaywrightPath);
    return sandboxPlaywrightPath;
  }
  // 3. Try puppeteer bundled Chrome
  try {
    const puppeteerPath = puppeteer.executablePath();
    if (puppeteerPath && fsLib.existsSync(puppeteerPath)) {
      console.log("[Chromium] Using puppeteer path:", puppeteerPath);
      return puppeteerPath;
    }
  } catch (_) {}
  // 4. Fallback to system paths
  for (const p of CHROMIUM_PATHS) {
    if (fsLib.existsSync(p)) {
      console.log("[Chromium] Using system path:", p);
      return p;
    }
  }
  console.warn("[Chromium] No chromium found, using default:", CHROMIUM_PATHS[0]);
  return CHROMIUM_PATHS[0];
}

export interface ScrapedExpense {
  platform: string;
  month: string;
  amount: number;
  refundAmount?: number;
  currency: string;
  rawData?: string;
}

export interface ScrapeResult {
  success: boolean;
  expenses: ScrapedExpense[];
  error?: string;
  lastSyncAt: Date;
  refreshedCookies?: string; // Updated cookies JSON after successful session (for auto-renewal)
  transactions?: ScrapedTransaction[]; // Individual transaction records
}

export interface ScrapedTransaction {
  platform: string;
  transId: string;
  transDate: string; // "2026-03-10"
  year: number;
  month: number;
  description: string;
  coins?: number; // absolute value (only for coin-based platforms like HelloToby)
  hkdAmount: number;
  exchangeRate?: number; // only for coin-based platforms
  type: "expense" | "refund" | "topup";
}

async function getBrowser(usesStealth = false) {
  // Temporarily override PUPPETEER_EXECUTABLE_PATH to ensure our getChromiumPath() is used
  // (Puppeteer prioritizes this env var over executablePath option)
  const chromiumPath = getChromiumPath();
  const originalEnvPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  process.env.PUPPETEER_EXECUTABLE_PATH = chromiumPath;
  const launchOptions = {
    executablePath: chromiumPath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-web-security",
      "--window-size=1280,900",
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
    ],
    defaultViewport: { width: 1280, height: 900 },
    ignoreHTTPSErrors: true,
  };
  if (usesStealth) {
    return (puppeteerExtra as unknown as typeof puppeteer).launch(launchOptions);
  }
  return puppeteer.launch(launchOptions);
}

/**
 * HelloToby uses Google OAuth login.
 * googleEmail = Google account email linked to HelloToby
 * googlePassword = Google account password
 */
export async function scrapeHellotobyExpenses(
  googleEmail: string,
  googlePassword: string,
  targetYear?: number
): Promise<ScrapeResult> {
  const browser = await getBrowser();
  const expenses: ScrapedExpense[] = [];
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    console.log("[HelloToby] Navigating to login page...");
    await page.goto("https://pro.hellotoby.com/login", { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    // Click "Continue with Google" - confirmed selector: div.lapu49-0
    console.log("[HelloToby] Clicking Google login button...");
    await page.waitForSelector('div.lapu49-0, div[class*="lapu49"]', { timeout: 10000 });
    const clicked = await page.evaluate(() => {
      const divs = Array.from(document.querySelectorAll("div"));
      const googleDiv = divs.find((d) => d.textContent?.trim() === "Continue with Google");
      if (googleDiv) { (googleDiv as HTMLElement).click(); return true; }
      const byClass = document.querySelector("div.lapu49-0") as HTMLElement;
      if (byClass) { byClass.click(); return true; }
      return false;
    });
    if (!clicked) {
      await page.screenshot({ path: "/tmp/hellotoby-no-google-btn.png" });
      throw new Error("找不到 Google 登入按鈕，HelloToby 頁面結構可能已變更");
    }

    // Wait for Google OAuth popup or redirect
    await new Promise(r => setTimeout(r, 3000));
    let pages = await browser.pages();
    let googlePage = pages.find((p) => p.url().includes("accounts.google.com"));
    if (!googlePage && page.url().includes("accounts.google.com")) googlePage = page;
    if (!googlePage) {
      await new Promise(r => setTimeout(r, 3000));
      pages = await browser.pages();
      googlePage = pages.find((p) => p.url().includes("accounts.google.com"));
    }
    if (!googlePage) {
      await page.screenshot({ path: "/tmp/hellotoby-no-google-oauth.png" });
      throw new Error("Google OAuth 頁面未開啟，請確認 HelloToby 帳號已連結 Google");
    }

    // Fill Google email
    await googlePage.waitForSelector('input[type="email"]', { timeout: 15000 });
    await googlePage.type('input[type="email"]', googleEmail, { delay: 60 });
    await googlePage.keyboard.press("Enter");
    await new Promise(r => setTimeout(r, 2500));

    // Fill Google password
    await googlePage.waitForSelector('input[type="password"]', { timeout: 15000 });
    await googlePage.type('input[type="password"]', googlePassword, { delay: 60 });
    await googlePage.keyboard.press("Enter");
    await new Promise(r => setTimeout(r, 4000));

    try { await googlePage.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }); } catch {}

    const postLoginUrl = googlePage.url();
    console.log("[HelloToby] URL after Google login:", postLoginUrl);
    if (postLoginUrl.includes("accounts.google.com")) {
      await googlePage.screenshot({ path: "/tmp/hellotoby-google-failed.png" });
      throw new Error("Google 登入失敗，請確認 Google 帳號密碼正確，或帳號未啟用兩步驗證");
    }

    const activePage = (postLoginUrl.includes("hellotoby") || postLoginUrl.includes("toby")) ? googlePage : page;
    if (activePage.url().includes("/login")) throw new Error("HelloToby 登入失敗，請確認帳號已連結 Google");

    const year = targetYear || new Date().getFullYear();
    const billingPaths = [
      "https://pro.hellotoby.com/account/credits",
      "https://pro.hellotoby.com/account/billing",
      "https://pro.hellotoby.com/pro/credits",
      "https://pro.hellotoby.com/settings/billing",
    ];
    for (const path of billingPaths) {
      await activePage.goto(path, { waitUntil: "networkidle2", timeout: 15000 });
      const url = activePage.url();
      if (!url.includes("/login") && !url.includes("/404")) { console.log("[HelloToby] Billing page:", url); break; }
    }

    const monthlyTotals: Record<string, number> = {};
    const pageText = await activePage.evaluate(() => document.body.innerText);
    for (const line of pageText.split("\n")) {
      const dm = line.match(/(\d{4})[\/-](\d{2})[\/-](\d{2})/);
      const am = line.match(/HK\$\s*([\d,]+(?:\.\d{2})?)/);
      if (dm && am) {
        const ds = dm[1] + "-" + dm[2] + "-" + dm[3];
        if (ds.startsWith(String(year))) {
          const m = ds.substring(0, 7);
          const a = parseFloat(am[1].replace(",", ""));
          if (a > 0) monthlyTotals[m] = (monthlyTotals[m] || 0) + a;
        }
      }
    }

    for (const [month, amount] of Object.entries(monthlyTotals)) {
      if (amount > 0) expenses.push({ platform: "hellotoby", month, amount, currency: "HKD" });
    }
    if (expenses.length === 0) {
      await activePage.screenshot({ path: "/tmp/hellotoby-billing.png" });
      return { success: true, expenses: [], error: "登入成功但未能自動解析帳單數據，請手動輸入開支", lastSyncAt: new Date() };
    }
    return { success: true, expenses, lastSyncAt: new Date() };
  } catch (error) {
    return { success: false, expenses: [], error: error instanceof Error ? error.message : "Unknown error", lastSyncAt: new Date() };
  } finally { await browser.close(); }
}

/**
 * HelloToby Cookie-based scraper (bypasses Google OAuth).
 * Uses stored session cookies to access the credit history page directly.
 * URL: https://www.hellotoby.com/pro/credit-history
 * 
 * Data format:
 * - Date: "Mar 18, 2026" (English month format)
 * - Description: "ClientName • ServiceType" or "null • 到期日：YYYY年MM月DD日" (top-up)
 * - Amount: negative = coin spent (expense), positive = top-up/refund
 *
 * Logic:
 * - Negative amounts = coin deductions = advertising expense
 * - Positive amounts = coin top-ups (NOT expense, skip these)
 * - Coins are converted to HKD at 1:1 ratio (1 coin = HKD 1)
 * 
 * cookies = JSON string of cookie objects: [{name, value, domain}, ...]
 */
export async function scrapeHelloTobyWithCookies(
  cookiesJson: string,
  _targetYear?: number // kept for API compat; we scrape all available months
): Promise<ScrapeResult> {
  const browser = await getBrowser(true); // use stealth
  const expenses: ScrapedExpense[] = [];
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // Parse and inject cookies
    let cookies: Array<{ name: string; value: string; domain?: string }> = [];
    try {
      cookies = JSON.parse(cookiesJson);
    } catch {
      throw new Error("Cookies 格式錯誤，請重新從瀏覽器提取");
    }

    const cookiesWithDomain = cookies.map((c) => ({
      ...c,
      domain: c.domain || ".hellotoby.com",
    }));
    await page.setCookie(...cookiesWithDomain);
    console.log("[HelloToby] Cookies injected:", cookiesWithDomain.map((c) => c.name).join(", "));

    // Navigate to credit history page
    await page.goto("https://www.hellotoby.com/pro/credit-history", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });
    await new Promise((r) => setTimeout(r, 2000));

    const currentUrl = page.url();
    console.log("[HelloToby] Current URL:", currentUrl);
    
    // Check if we're redirected to login
    if (currentUrl.includes("/login") || currentUrl.includes("/zh-hk") && !currentUrl.includes("/pro")) {
      throw new Error("Session 已過期，請重新從 HelloToby 瀏覽器提取最新 Cookies");
    }
    
    // Verify we're on the credit history page
    const pageTitle = await page.title();
    console.log("[HelloToby] Page title:", pageTitle);
    if (!pageTitle.includes("金幣記錄") && !pageTitle.includes("Credit") && !pageTitle.includes("Toby")) {
      throw new Error(`未能訪問金幣記錄頁面 (title: ${pageTitle})，請確認 Cookies 正確`);
    }
    console.log("[HelloToby] ✅ Login verified via cookies");

    // Monthly aggregation
    const monthlyTotals: Record<string, number> = {};
    const monthlyRefunds: Record<string, number> = {};
    const seenRows = new Set<string>(); // dedup

    // Month names mapping (English to number)
    const monthMap: Record<string, string> = {
      Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
      Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
    };

    const scrapeCurrentMonth = async () => {
      return page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll(".sc-1noiqqf-1"));
        const result: Array<{ date: string; description: string; amount: string }> = [];
        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll(".sc-1noiqqf-3"));
          if (cells.length >= 3) {
            result.push({
              date: (cells[0] as HTMLElement).innerText.trim(),
              description: (cells[1] as HTMLElement).innerText.trim(),
              amount: (cells[2] as HTMLElement).innerText.trim(),
            });
          }
        }
        return result;
      });
    };

    const processRows = (rows: Array<{ date: string; description: string; amount: string }>) => {
      for (const row of rows) {
        const rowKey = `${row.date}|${row.description}|${row.amount}`;
        if (seenRows.has(rowKey)) continue;
        seenRows.add(rowKey);

        // Parse date: "Mar 18, 2026" -> "2026-03"
        const dm = row.date.match(/(\w{3})\s+(\d+),\s+(\d{4})/);
        if (!dm) continue;
        const monthNum = monthMap[dm[1]];
        if (!monthNum) continue;
        const monthKey = `${dm[3]}-${monthNum}`;

        // Parse amount
        const amtStr = row.amount.trim();
        const amt = parseInt(amtStr, 10);
        if (isNaN(amt)) continue;

        // Skip top-up entries (positive amounts from "null • 到期日" descriptions)
        const isTopUp = row.description.includes("到期日") || row.description.startsWith("null");
        
        if (amt < 0 && !isTopUp) {
          // Negative = coin spent = advertising expense
          const cost = Math.abs(amt);
          monthlyTotals[monthKey] = (monthlyTotals[monthKey] || 0) + cost;
        } else if (amt > 0 && !isTopUp) {
          // Positive non-top-up = refund from platform (client didn't open quote)
          monthlyRefunds[monthKey] = (monthlyRefunds[monthKey] || 0) + amt;
        }
        // Top-ups (positive with 到期日) are ignored - not advertising expense
      }
    };

    // ── Helper: open the react-datepicker and navigate to a specific month ──
    // The picker uses react-datepicker with:
    //   - Input click → opens picker
    //   - .sc-1772p8l-1 SVG[0] = left arrow (prev year), SVG[1] = right arrow (next year)
    //   - [role="button"][aria-label="Choose January 2025"] = month buttons
    //   - Clicking a month button closes picker and loads data

    const openPickerAndSelectMonth = async (targetYear: number, targetMonthNum: number): Promise<boolean> => {
      const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const targetMonthName = monthNames[targetMonthNum - 1];
      const hintText = `Choose ${targetMonthName} ${targetYear}`; // used as aria-label
      
      // Step 1: Click the date input to open picker
      const opened = await page.evaluate(() => {
        const dateInput = document.querySelector('input[value*="/20"]') as HTMLElement;
        if (dateInput) { dateInput.click(); return true; }
        return false;
      });
      if (!opened) return false;
      await new Promise(r => setTimeout(r, 800));
      
      // Step 2: Navigate year using left arrow SVG (dispatch click event)
      // Get current year shown in picker
      for (let attempt = 0; attempt < 5; attempt++) {
        const currentYear = await page.evaluate(() => {
          const yearEl = document.querySelector('.sc-1772p8l-2');
          return yearEl ? parseInt(yearEl.textContent || '0', 10) : 0;
        });
        if (currentYear === 0) break;
        if (currentYear === targetYear) break;
        
        // Click left arrow (prev year) or right arrow (next year)
        const clicked = await page.evaluate((goLeft: boolean) => {
          const header = document.querySelector('.sc-1772p8l-1');
          if (!header) return false;
          const svgs = Array.from(header.querySelectorAll('svg'));
          const arrow = goLeft ? svgs[0] : svgs[svgs.length - 1];
          if (!arrow) return false;
          arrow.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          return true;
        }, currentYear > targetYear);
        
        if (!clicked) break;
        await new Promise(r => setTimeout(r, 500));
      }
      
      // Step 3: Click the target month button (aria-label="Choose January 2025")
      const monthClicked = await page.evaluate((ariaLabel: string) => {
        const monthBtns = Array.from(document.querySelectorAll('[role="button"]'));
        const btn = monthBtns.find(b => b.getAttribute('aria-label') === ariaLabel) as HTMLElement;
        if (btn) { btn.click(); return true; }
        // Fallback: find by class (react-datepicker__month-{0-11})
        return false;
      }, hintText);
      
      if (!monthClicked) {
        // Close picker by pressing Escape
        await page.keyboard.press('Escape');
        return false;
      }
      
      // Wait for page to load new month data
      await new Promise(r => setTimeout(r, 3000));
      return true;
    };

    // ── Determine available months by checking the picker ──
    // Open picker to see which years are available
    await page.evaluate(() => {
      const dateInput = document.querySelector('input[value*="/20"]') as HTMLElement;
      if (dateInput) dateInput.click();
    });
    await new Promise(r => setTimeout(r, 1000));
    
    // Find the earliest year available (keep clicking left until year stops changing)
    let minYear = new Date().getFullYear();
    let prevYear = -1;
    for (let i = 0; i < 6; i++) {
      const currentYear = await page.evaluate(() => {
        const yearEl = document.querySelector('.sc-1772p8l-2');
        return yearEl ? parseInt(yearEl.textContent || '0', 10) : 0;
      });
      if (currentYear === 0) break;
      if (currentYear === prevYear) break; // Year didn't change = we're at the limit
      prevYear = currentYear;
      minYear = Math.min(minYear, currentYear);
      // Click left arrow to go to previous year
      const clicked = await page.evaluate(() => {
        const header = document.querySelector('.sc-1772p8l-1');
        if (!header) return false;
        const svgs = Array.from(header.querySelectorAll('svg'));
        if (svgs[0]) { svgs[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true; }
        return false;
      });
      if (!clicked) break;
      await new Promise(r => setTimeout(r, 600));
    }
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 500));
    
    console.log(`[HelloToby] Earliest year available: ${minYear}`);
    
    // ── Scrape all months from current month back to minYear ──
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-based
    
    for (let year = currentYear; year >= minYear; year--) {
      const startMonth = (year === currentYear) ? currentMonth : 12;
      const endMonth = 1;
      
      for (let month = startMonth; month >= endMonth; month--) {
        console.log(`[HelloToby] Scraping ${year}-${String(month).padStart(2,'0')}...`);
        
        const success = await openPickerAndSelectMonth(year, month);
        if (!success) {
          console.log(`[HelloToby] Could not navigate to ${year}-${month}, skipping`);
          continue;
        }
        
        const rows = await scrapeCurrentMonth();
        console.log(`[HelloToby] ${year}-${String(month).padStart(2,'0')}: ${rows.length} rows`);
        
        if (rows.length > 0) {
          processRows(rows);
        }
      }
    }

    console.log("[HelloToby] Monthly totals:", monthlyTotals);
    console.log("[HelloToby] Monthly refunds:", monthlyRefunds);

    // Extract refreshed cookies after successful session
    let refreshedCookies: string | undefined;
    try {
      const latestCookies = await page.cookies();
      const keyCookies = latestCookies
        .filter((c) => ["nftoken", "nfsession", "nfcountry", "localeId"].includes(c.name))
        .map((c) => ({ name: c.name, value: c.value, domain: c.domain }));
      if (keyCookies.length > 0) {
        refreshedCookies = JSON.stringify(keyCookies);
        console.log("[HelloToby] ✅ Refreshed cookies extracted:", keyCookies.map((c) => c.name).join(", "));
      }
    } catch (e) {
      console.warn("[HelloToby] Could not extract refreshed cookies:", e);
    }

    for (const [month, amount] of Object.entries(monthlyTotals)) {
      if (amount > 0)
        expenses.push({ platform: "hellotoby", month, amount, refundAmount: monthlyRefunds[month] || 0, currency: "HKD" });
    }
    // Also record months that only have refunds (no expenses)
    for (const [month, refund] of Object.entries(monthlyRefunds)) {
      if (!monthlyTotals[month] && refund > 0)
        expenses.push({ platform: "hellotoby", month, amount: 0, refundAmount: refund, currency: "HKD" });
    }

    if (expenses.length === 0) {
      return {
        success: true,
        expenses: [],
        error: "登入成功但未找到廣告開支記錄",
        lastSyncAt: new Date(),
        refreshedCookies,
      };
    }
    return { success: true, expenses, lastSyncAt: new Date(), refreshedCookies };
  } catch (error) {
    return {
      success: false,
      expenses: [],
      error: error instanceof Error ? error.message : "Unknown error",
      lastSyncAt: new Date(),
    };
  } finally {
    await browser.close();
  }
}

/**
 * HelloToby API-based scraper (replaces Puppeteer version).
 * Calls api.hellotoby.com/api/account/trans directly using session cookies.
 * 
 * API Response format per record:
 *   { transId, amount, comment, credit, transDate, quoteId?, paymentId?, currency?, currencyDisplay? }
 *   - amount: HKD in cents (e.g. 19900 = HKD 199.00) — only present on top-up records
 *   - credit: coins (negative = spent, positive = top-up)
 *   - comment: "ClientName • ServiceType" or "null • 到期日：YYYY年MM月DD日" (top-up)
 *
 * Auto exchange rate detection:
 *   1. Scan all records for top-ups (credit > 0, amount > 0)
 *   2. Calculate rate = amount / 100 / credit (HKD per coin)
 *   3. Build a timeline of rates; each expense uses the rate from the most recent prior top-up
 *   4. If no prior top-up found, use the earliest known rate as fallback
 */
export async function scrapeHelloTobyViaAPI(
  cookiesJson: string,
  _targetYear?: number
): Promise<ScrapeResult> {
  try {
    // Parse cookies into a cookie header string
    let cookies: Array<{ name: string; value: string; domain?: string }> = [];
    try {
      cookies = JSON.parse(cookiesJson);
    } catch {
      throw new Error("Cookies 格式錯誤，請重新從瀏覽器提取");
    }
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    type TransRecord = {
      transId: string;
      amount: number;      // HKD cents (only for top-ups)
      comment: string;
      credit: number;      // coins (negative = spent, positive = top-up)
      transDate: string;   // "2026-03-10 14:09"
      quoteId?: string;
      paymentId?: string;
      currency?: string;
    };

    // Helper: fetch one month's records from API
    const fetchMonth = async (monthStr: string): Promise<TransRecord[]> => {
      const url = `https://api.hellotoby.com/api/account/trans?limit=500&offset=0&month=${monthStr}`;
      const res = await fetch(url, {
        headers: {
          'Cookie': cookieHeader,
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.hellotoby.com/pro/credit-history',
        },
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error('Session 已過期，請重新從 HelloToby 瀏覽器提取最新 Cookies');
        }
        throw new Error(`API 請求失敗: HTTP ${res.status}`);
      }
      const data = await res.json() as { success: boolean; data: TransRecord[]; totalCount: number };
      if (!data.success) throw new Error('HelloToby API 返回失敗狀態');
      return data.data || [];
    };

    // Verify session is valid first
    const checkRes = await fetch('https://api.hellotoby.com/api/account/remaincreditamount/v2', {
      headers: { 'Cookie': cookieHeader, 'Accept': 'application/json' },
    });
    if (!checkRes.ok) throw new Error('Session 已過期，請重新從 HelloToby 瀏覽器提取最新 Cookies');

    // ── Determine date range: scan from 2021-01 to current month ──
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    // Build list of all months from 2021-01 to current month
    const allMonths: string[] = [];
    for (let y = 2021; y <= currentYear; y++) {
      const endM = (y === currentYear) ? currentMonth : 12;
      for (let m = 1; m <= endM; m++) {
        allMonths.push(`${y}-${String(m).padStart(2, '0')}`);
      }
    }

    // Fetch all months (collect all records)
    const allRecords: TransRecord[] = [];
    let emptyStreak = 0;
    for (const monthStr of allMonths) {
      const records = await fetchMonth(monthStr);
      console.log(`[HelloToby API] ${monthStr}: ${records.length} records`);
      if (records.length > 0) {
        allRecords.push(...records);
        emptyStreak = 0;
      } else {
        emptyStreak++;
        // If 12 consecutive empty months, stop (account likely started later)
        // But don't stop early — keep going to find all historical data
      }
    }

    console.log(`[HelloToby API] Total records across all months: ${allRecords.length}`);

    // ── Build exchange rate timeline ──
    // Sort all records by date ascending to build the timeline
    const sorted = [...allRecords].sort((a, b) => a.transDate.localeCompare(b.transDate));

    // Extract top-up records with their exchange rates
    const rateTimeline: Array<{ date: string; rate: number; coins: number; hkd: number }> = [];
    for (const rec of sorted) {
      if (rec.credit > 0 && rec.amount > 0) {
        // Top-up: amount is in cents, credit is coins
        const hkd = rec.amount / 100;
        const rate = hkd / rec.credit; // HKD per coin
        rateTimeline.push({ date: rec.transDate, rate, coins: rec.credit, hkd });
        console.log(`[HelloToby API] Top-up: ${rec.credit} coins = HKD ${hkd} → rate ${rate.toFixed(4)}/coin (${rec.transDate})`);
      }
    }

    // Get rate applicable at a given date (most recent top-up before or on that date)
    const getRateAtDate = (date: string): number => {
      // Default fallback: HKD 1.99/coin (cheapest web package: 100 coins = HKD 199)
      const DEFAULT_RATE = 1.99;
      if (rateTimeline.length === 0) return DEFAULT_RATE;

      // Find the most recent top-up on or before this date
      let bestRate = rateTimeline[0].rate; // earliest known rate as initial fallback
      for (const entry of rateTimeline) {
        if (entry.date <= date) {
          bestRate = entry.rate;
        } else {
          break;
        }
      }
      return bestRate;
    };

    // ── Aggregate monthly expenses + build individual transactions ──
    const monthlyTotals: Record<string, number> = {};
    const monthlyRefunds: Record<string, number> = {};
    const transactions: ScrapedTransaction[] = [];

    for (const rec of allRecords) {
      // Parse date: "2026-03-10 14:09" → "2026-03"
      const monthKey = rec.transDate.substring(0, 7);
      const dateOnly = rec.transDate.substring(0, 10); // "2026-03-10"
      const [yearNum, monthNum] = monthKey.split('-').map(Number);

      const isTopUp = rec.credit > 0 && rec.amount > 0;
      const isRefund = rec.credit > 0 && rec.amount === 0;

      if (isTopUp) {
        // Top-up: actual HKD paid = rec.amount / 100
        // This is the REAL advertising spend — accumulate into monthly totals
        const hkd = rec.amount / 100;
        const rate = hkd / rec.credit;
        monthlyTotals[monthKey] = Math.round(((monthlyTotals[monthKey] || 0) + hkd) * 100) / 100;
        transactions.push({
          platform: 'hellotoby',
          transId: rec.transId || `ht-topup-${rec.transDate}`,
          transDate: dateOnly,
          year: yearNum,
          month: monthNum,
          description: rec.comment || '增值金幣',
          coins: rec.credit,
          hkdAmount: hkd,
          exchangeRate: Math.round(rate * 10000) / 10000,
          type: 'topup',
        });
        continue;
      }

      if (rec.credit < 0) {
        // Coin consumption: record as expense transaction (for detail view only)
        // Do NOT add to monthlyTotals — we only count top-up amounts as actual spend
        const coins = Math.abs(rec.credit);
        const rate = getRateAtDate(rec.transDate);
        const hkd = Math.round(coins * rate * 100) / 100;
        transactions.push({
          platform: 'hellotoby',
          transId: rec.transId || `ht-exp-${rec.transDate}-${coins}`,
          transDate: dateOnly,
          year: yearNum,
          month: monthNum,
          description: rec.comment || '',
          coins,
          hkdAmount: hkd,
          exchangeRate: Math.round(rate * 10000) / 10000,
          type: 'expense',
        });
      } else if (isRefund) {
        // Positive non-top-up = refund (client didn't open quote within 48h)
        const coins = rec.credit;
        const rate = getRateAtDate(rec.transDate);
        const hkd = Math.round(coins * rate * 100) / 100;
        monthlyRefunds[monthKey] = Math.round(((monthlyRefunds[monthKey] || 0) + hkd) * 100) / 100;
        transactions.push({
          platform: 'hellotoby',
          transId: rec.transId || `ht-ref-${rec.transDate}-${coins}`,
          transDate: dateOnly,
          year: yearNum,
          month: monthNum,
          description: rec.comment || '退款',
          coins,
          hkdAmount: hkd,
          exchangeRate: Math.round(rate * 10000) / 10000,
          type: 'refund',
        });
      }
    }

    console.log('[HelloToby API] Monthly totals (HKD):', monthlyTotals);
    console.log('[HelloToby API] Monthly refunds (HKD):', monthlyRefunds);
    console.log(`[HelloToby API] Total individual transactions: ${transactions.length}`);

    const expenses: ScrapedExpense[] = [];
    for (const [month, amount] of Object.entries(monthlyTotals)) {
      if (amount > 0)
        expenses.push({ platform: 'hellotoby', month, amount, refundAmount: monthlyRefunds[month] || 0, currency: 'HKD' });
    }
    for (const [month, refund] of Object.entries(monthlyRefunds)) {
      if (!monthlyTotals[month] && refund > 0)
        expenses.push({ platform: 'hellotoby', month, amount: 0, refundAmount: refund, currency: 'HKD' });
    }

    if (expenses.length === 0) {
      return { success: true, expenses: [], transactions, error: '登入成功但未找到廣告開支記錄', lastSyncAt: new Date() };
    }
    return { success: true, expenses, transactions, lastSyncAt: new Date() };
  } catch (error) {
    return {
      success: false,
      expenses: [],
      error: error instanceof Error ? error.message : 'Unknown error',
      lastSyncAt: new Date(),
    };
  }
}

/**
 * PRO360 Cookie-based scraper (bypasses Google OAuth).
 * Uses stored session cookies to access the transaction page directly.
 * Scrapes ALL pages using click-based pagination (PRO360 uses JS pagination, not URL params).
 * Aggregates monthly totals across all years.
 * cookies = JSON string of cookie objects: [{name, value, domain}, ...]
 */
export async function scrapePro360WithCookies(
  cookiesJson: string,
  _targetYear?: number // kept for API compat; we now scrape all years
): Promise<ScrapeResult> {
  const browser = await getBrowser(true); // use stealth
  const expenses: ScrapedExpense[] = [];
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // Parse and inject cookies
    let cookies: Array<{ name: string; value: string; domain?: string }> = [];
    try {
      cookies = JSON.parse(cookiesJson);
    } catch {
      throw new Error("Cookies 格式錯誤，請重新從瀏覽器提取");
    }

    const cookiesWithDomain = cookies.map((c) => ({
      ...c,
      domain: c.domain || "www.pro360.com.hk",
    }));
    await page.setCookie(...cookiesWithDomain);
    console.log("[PRO360] Cookies injected:", cookiesWithDomain.map((c) => c.name).join(", "));

    await page.goto("https://www.pro360.com.hk/dashboard/settings/transaction", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    // Immediately check if redirected to login page
    const urlAfterNav = page.url();
    console.log("[PRO360] URL after navigation:", urlAfterNav);
    if (urlAfterNav.includes("/login")) {
      throw new Error("Session 已過期，請重新從 PRO360 瀏覽器提取最新 Cookies");
    }
    console.log("[PRO360] ✅ Login verified via cookies");
    // Wait for table to appear (up to 30s) - page uses JS to dynamically load data
    try {
      await page.waitForSelector("table tr td", { timeout: 30000 });
      console.log("[PRO360] Table data loaded");
    } catch (_) {
      // Table might not exist if no transactions; wait extra 5s and try again
      console.log("[PRO360] Table not found within 30s, waiting extra 5s...");
      await new Promise((r) => setTimeout(r, 5000));
      const hasTable = await page.$eval("table tr td", () => true).catch(() => false);
      console.log("[PRO360] Table after extra wait:", hasTable);
      // Log page HTML for debugging
      const pageHtml = await page.evaluate(() => document.body.innerHTML.substring(0, 2000));
      console.log("[PRO360] Page HTML sample:", pageHtml);
    }
    await new Promise((r) => setTimeout(r, 5000));

    // Monthly aggregation across all years
    const monthlyTotals: Record<string, number> = {};
    const monthlyRefunds: Record<string, number> = {};
    const seenRows = new Set<string>(); // dedup by date+desc
    const transactions: ScrapedTransaction[] = [];

    const scrapeCurrentPage = async () => {
      return page.evaluate(() => {
        const result: Array<{ date: string; payment: string; credit: string; desc: string }> = [];
        const tableRows = Array.from(document.querySelectorAll("table tr"));
        for (const row of tableRows) {
          const cells = Array.from(row.querySelectorAll("td")).map((c) => (c as HTMLElement).innerText.trim());
          if (cells.length >= 4) {
            result.push({ date: cells[0], payment: cells[1], credit: cells[2], desc: cells[3] });
          }
        }
        return result;
      });
    };

    const processRows = (rows: Array<{ date: string; payment: string; credit: string; desc: string }>) => {
      for (const row of rows) {
        const rowKey = `${row.date}|${row.desc}`;
        if (seenRows.has(rowKey)) continue;
        seenRows.add(rowKey);

        const dm = row.date.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/);
        if (!dm) continue;
        const year = parseInt(dm[1]);
        const month = parseInt(dm[2]);
        const day = parseInt(dm[3]);
        const hour = dm[4] ? parseInt(dm[4]) : 0;
        const min = dm[5] ? parseInt(dm[5]) : 0;
        const monthKey = `${dm[1]}-${String(month).padStart(2, "0")}`;
        const transDate = `${dm[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
        const transId = `360pro-${dm[1]}${String(month).padStart(2,"0")}${String(day).padStart(2,"0")}-${String(hour).padStart(2,"0")}${String(min).padStart(2,"0")}-${Buffer.from(row.desc).toString('base64').substring(0,8)}`;

        // Payment (credit card) = direct expense
        const payMatch = row.payment.replace(/,/g, "").match(/\$([\d.]+)/);
        const payment = payMatch ? parseFloat(payMatch[1]) : 0;

        // Credit: negative (-$xx) = wallet deduction = expense; positive (+$xx) = refund
        const creditStr = row.credit.trim();
        let creditCost = 0;
        let refundAmt = 0;
        if (creditStr.startsWith("-")) {
          const cm = creditStr.replace(/,/g, "").match(/\$([\d.]+)/);
          if (cm) creditCost = parseFloat(cm[1]);
        } else if (creditStr.startsWith("+") || (creditStr.includes("$") && !creditStr.startsWith("-"))) {
          const rm = creditStr.replace(/,/g, "").match(/\$([\d.]+)/);
          if (rm) refundAmt = parseFloat(rm[1]);
        }

        const cost = payment > 0 ? payment : creditCost;
        if (cost > 0) {
          monthlyTotals[monthKey] = (monthlyTotals[monthKey] || 0) + cost;
          // Build individual transaction record
          transactions.push({
            platform: "360pro",
            transId,
            transDate,
            year,
            month,
            description: row.desc,
            hkdAmount: cost,
            coins: undefined,
            exchangeRate: undefined,
            type: "expense",
          });
        }
        if (refundAmt > 0) {
          monthlyRefunds[monthKey] = (monthlyRefunds[monthKey] || 0) + refundAmt;
          transactions.push({
            platform: "360pro",
            transId: transId + "-refund",
            transDate,
            year,
            month,
            description: row.desc,
            hkdAmount: refundAmt,
            coins: undefined,
            exchangeRate: undefined,
            type: "refund",
          });
        }
      }
    };

    // Scrape page 1
    let rows = await scrapeCurrentPage();
    console.log(`[PRO360] Page 1: ${rows.length} rows`);
    processRows(rows);

    // Navigate through remaining pages by clicking › button
    let pageNum = 1;
    while (pageNum < 50) {
      const hasNext = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll("a"));
        const nextBtn = links.find((l) => l.textContent?.trim() === "›");
        return !!nextBtn;
      });
      if (!hasNext) break;

      const clicked = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll("a"));
        const nextBtn = links.find((l) => l.textContent?.trim() === "›");
        if (nextBtn) { (nextBtn as HTMLElement).click(); return true; }
        return false;
      });
      if (!clicked) break;

      await new Promise((r) => setTimeout(r, 2000));
      pageNum++;

      rows = await scrapeCurrentPage();
      const firstDate = rows[0]?.date || "";
      console.log(`[PRO360] Page ${pageNum}: ${rows.length} rows (first: ${firstDate})`);

      // Check if all rows already seen (loop detection)
      const newCount = rows.filter((r) => !seenRows.has(`${r.date}|${r.desc}`)).length;
      if (newCount === 0) {
        console.log(`[PRO360] All rows on page ${pageNum} already seen, stopping`);
        break;
      }

      processRows(rows);
    }

    console.log("[PRO360] Monthly totals:", monthlyTotals);
    console.log(`[PRO360] Total individual transactions: ${transactions.length}`);

    // Extract refreshed cookies after successful session (PRO360 auto-renews session on each visit)
    let refreshedCookies: string | undefined;
    try {
      const latestCookies = await page.cookies();
      const keyCookies = latestCookies
        .filter((c) => ["session_token", "data", "device_id", "i18next", "landing", "AWSALB", "AWSALBCORS"].includes(c.name))
        .map((c) => ({ name: c.name, value: c.value, domain: c.domain }));
      if (keyCookies.length > 0) {
        refreshedCookies = JSON.stringify(keyCookies);
        console.log("[PRO360] ✅ Refreshed cookies extracted:", keyCookies.map((c) => c.name).join(", "));
      }
    } catch (e) {
      console.warn("[PRO360] Could not extract refreshed cookies:", e);
    }

    for (const [month, amount] of Object.entries(monthlyTotals)) {
      if (amount > 0)
        expenses.push({ platform: "360pro", month, amount, refundAmount: monthlyRefunds[month] || 0, currency: "HKD" });
    }
    // Also record months that only have refunds (no expenses)
    for (const [month, refund] of Object.entries(monthlyRefunds)) {
      if (!monthlyTotals[month] && refund > 0)
        expenses.push({ platform: "360pro", month, amount: 0, refundAmount: refund, currency: "HKD" });
    }

    if (expenses.length === 0) {
      return {
        success: true,
        expenses: [],
        transactions,
        error: "登入成功但未找到廣告開支記錄",
        lastSyncAt: new Date(),
        refreshedCookies,
      };
    }
    return { success: true, expenses, transactions, lastSyncAt: new Date(), refreshedCookies };
  } catch (error) {
    return {
      success: false,
      expenses: [],
      error: error instanceof Error ? error.message : "Unknown error",
      lastSyncAt: new Date(),
    };
  } finally {
    await browser.close();
  }
}

/**
 * PRO360 uses Google OAuth login (same as HelloToby).
 * googleEmail = Google account email linked to PRO360 (e.g. Derekho1144@gmail.com)
 * googlePassword = Google account password
 * Transaction page: https://www.pro360.com.hk/dashboard/settings/transaction
 * Table columns: 日期 | 付款 | 儲值金 | 說明
 * - 付款: direct credit card charges (e.g. $99, $70)
 * - 儲值金: stored value credits (negative = deducted, positive = refunded)
 * - Expense = 付款 amounts + abs(negative 儲值金 amounts) per month
 * Date format: 2026年3月24日 05:31
 */
export async function scrapePro360Expenses(
  googleEmail: string,
  googlePassword: string,
  targetYear?: number
): Promise<ScrapeResult> {
  const browser = await getBrowser(); // Use standard puppeteer (stealth causes "main frame too early" error)
  const expenses: ScrapedExpense[] = [];
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    console.log("[PRO360] Navigating to login page...");
    await page.goto("https://www.pro360.com.hk/zh-hk/login", { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    // Click "Login with Google" button
    // Confirmed selectors from page analysis:
    // PC: .Login-module__googlePC___1Mfp3 button (contains "Google 登入")
    // Mobile: .GoogleSignInButton__btnGoogleSignIn___1p_f9
    console.log("[PRO360] Looking for Google login button...");
    
    // Wait for login form to be visible
    await page.waitForSelector('.Login-module__loginPanel___3hTpJ, .login-panel, form.login-panel', { timeout: 10000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1000));
    
    const googleClicked = await page.evaluate(() => {
      // Priority 1: Exact confirmed selectors from page analysis
      const exactSelectors = [
        '.Login-module__googlePC___1Mfp3 button',
        '.Login-module__socialAuthButtons___2wyPK button:nth-child(2)',
        '.GoogleSignInButton__btnGoogleSignIn___1p_f9',
      ];
      for (const sel of exactSelectors) {
        const el = document.querySelector(sel) as HTMLElement;
        if (el) { el.click(); return `clicked exact: ${sel}`; }
      }
      // Priority 2: Find button by text content "Google 登入"
      const allButtons = Array.from(document.querySelectorAll('button'));
      const googleBtn = allButtons.find(btn => {
        const text = btn.textContent?.trim() || '';
        return text === 'Google 登入' || text.includes('Google');
      }) as HTMLElement;
      if (googleBtn) { googleBtn.click(); return `clicked by text: ${googleBtn.textContent?.trim()}`; }
      // Priority 3: Find by span text inside button
      const allSpans = Array.from(document.querySelectorAll('button span'));
      const googleSpan = allSpans.find(s => s.textContent?.includes('Google')) as HTMLElement;
      if (googleSpan) {
        const btn = googleSpan.closest('button') as HTMLElement;
        if (btn) { btn.click(); return `clicked via span: ${googleSpan.textContent?.trim()}`; }
      }
      return null;
    });
    console.log("[PRO360] Google button click result:", googleClicked);

    if (!googleClicked) {
      // Screenshot for debugging
      await page.screenshot({ path: "/tmp/pro360-no-google-btn.png" });
      // Try navigating directly to Google OAuth URL for PRO360
      const oauthUrl = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        const googleLink = links.find(l => l.href.includes('google') || l.href.includes('oauth'));
        return googleLink?.href || null;
      });
      if (oauthUrl) {
        console.log("[PRO360] Found OAuth URL:", oauthUrl);
        await page.goto(oauthUrl, { waitUntil: "networkidle2", timeout: 20000 });
      } else {
        throw new Error("找不到 PRO360 Google 登入按鈕，頁面結構可能已變更");
      }
    }

    // Wait for Google OAuth page — PRO360 opens Google OAuth in a NEW TAB (popup)
    // Confirmed by test: display=popup in the OAuth URL
    console.log("[PRO360] Waiting for Google OAuth popup (new tab)...");
    let googlePage = page; // will be replaced by popup tab
    
    // Wait up to 15s for a new tab with accounts.google.com to appear
    let googleFound = false;
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const allPages = await browser.pages();
      const newTab = allPages.find((p) => p.url().includes("accounts.google.com"));
      if (newTab) {
        googlePage = newTab;
        googleFound = true;
        console.log("[PRO360] Google OAuth popup detected:", newTab.url());
        break;
      }
      // Also check if same-tab redirect happened (fallback)
      if (page.url().includes("accounts.google.com")) {
        googleFound = true;
        console.log("[PRO360] Same-tab Google OAuth redirect detected:", page.url());
        break;
      }
    }
    
    if (!googleFound) {
      await page.screenshot({ path: "/tmp/pro360-no-google-oauth.png" });
      const currentUrl = page.url();
      console.log("[PRO360] Current URL after click:", currentUrl);
      throw new Error(`Google OAuth 頁面未開啟 (current: ${currentUrl})，請確認 PRO360 帳號已連結 Google`);
    }

    // Fill Google email
    console.log("[PRO360] Filling Google email...");
    await googlePage.waitForSelector('input[type="email"]', { timeout: 15000 });
    await googlePage.type('input[type="email"]', googleEmail, { delay: 60 });
    await googlePage.keyboard.press("Enter");
    await new Promise(r => setTimeout(r, 2500));

    // Fill Google password
    console.log("[PRO360] Filling Google password...");
    await googlePage.waitForSelector('input[type="password"]', { timeout: 15000 });
    await googlePage.type('input[type="password"]', googlePassword, { delay: 60 });
    await googlePage.keyboard.press("Enter");
    await new Promise(r => setTimeout(r, 4000));

    try { await googlePage.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }); } catch {}

    const postLoginUrl = googlePage.url();
    console.log("[PRO360] URL after Google login:", postLoginUrl);
    if (postLoginUrl.includes("accounts.google.com")) {
      await googlePage.screenshot({ path: "/tmp/pro360-google-failed.png" });
      throw new Error("Google 登入失敗，請確認 Google 帳號密碼正確，或帳號未啟用兩步驗證");
    }

    // Determine active page after OAuth redirect
    const activePage = (postLoginUrl.includes("pro360")) ? googlePage : page;
    const activeUrl = activePage.url();
    console.log("[PRO360] Active page URL:", activeUrl);
    if (activeUrl.includes("/login")) throw new Error("PRO360 登入失敗，請確認帳號已連結 Google");

    const year = targetYear || new Date().getFullYear();
    // Confirmed transaction page URL
    await page.goto("https://www.pro360.com.hk/dashboard/settings/transaction", { waitUntil: "networkidle2", timeout: 20000 });
    await new Promise(r => setTimeout(r, 2000));
    console.log("[PRO360] Transaction page URL:", page.url());

    // Monthly totals: sum all payment rows per month
    // Table: 日期 | 付款 | 儲值金 | 說明
    // 付款 = direct charge (e.g. $99) — always positive expense
    // 儲值金 negative (e.g. -$39) = credits deducted = expense
    // 儲值金 positive (e.g. +$86) = refund — NOT an expense
    const monthlyTotals: Record<string, number> = {};

    // Scrape all pages
    let hasNextPage = true;
    let pageNum = 1;
    while (hasNextPage && pageNum <= 24) { // max 24 months of pages
      const rows = await page.evaluate((yr: number) => {
        const result: Array<{ date: string; payment: number; credit: number; desc: string }> = [];
        const tableRows = Array.from(document.querySelectorAll("table tbody tr, table tr:not(:first-child)"));
        for (const row of tableRows) {
          const cells = Array.from(row.querySelectorAll("td")).map(c => c.innerText.trim());
          if (cells.length < 3) continue;
          const dateCell = cells[0] || "";
          const paymentCell = cells[1] || "-";
          const creditCell = cells[2] || "-";
          const descCell = cells[3] || "";
          // Parse Chinese date: 2026年3月24日 05:31
          const dm = dateCell.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
          if (!dm) continue;
          const rowYear = parseInt(dm[1]);
          const rowMonth = parseInt(dm[2]);
          if (rowYear !== yr) continue;
          // Parse payment amount (direct charge)
          const payMatch = paymentCell.replace(/,/g, "").match(/\$([\d.]+)/);
          const payment = payMatch ? parseFloat(payMatch[1]) : 0;
          // Parse credit amount (negative = expense, positive = refund)
          const creditMatch = creditCell.replace(/,/g, "").match(/([+-]?)\$([\d.]+)/);
          const creditSign = creditMatch?.[1] === "+" ? 1 : -1;
          const creditAmt = creditMatch ? parseFloat(creditMatch[2]) * creditSign : 0;
          result.push({ date: `${rowYear}-${String(rowMonth).padStart(2, "0")}`, payment, credit: creditAmt, desc: descCell });
        }
        return result;
      }, year);

      for (const row of rows) {
        // Skip refunds (positive credit)
        if (row.payment === 0 && row.credit >= 0) continue;
        // Skip $0 payments (paid by stored credit, already counted as credit deduction)
        const expense = row.payment > 0 ? row.payment : (row.credit < 0 ? Math.abs(row.credit) : 0);
        if (expense > 0) {
          monthlyTotals[row.date] = (monthlyTotals[row.date] || 0) + expense;
        }
      }

      // Check if there's a next page
      const paginationLinks = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll("a"));
        const currentPage = links.find(l => l.classList.contains("active") || l.getAttribute("aria-current") === "page");
        const currentNum = currentPage ? parseInt(currentPage.textContent || "1") : 1;
        const nextLink = links.find(l => l.textContent?.trim() === "›" || l.textContent?.trim() === ">");
        return { currentNum, hasNext: !!nextLink && !nextLink.hasAttribute("disabled") };
      });

      if (!paginationLinks.hasNext) break;

      // Navigate to next page
      const clicked = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll("a"));
        const nextLink = links.find(l => l.textContent?.trim() === "›" || l.textContent?.trim() === ">");
        if (nextLink) { (nextLink as HTMLElement).click(); return true; }
        return false;
      });
      if (!clicked) break;
      await new Promise(r => setTimeout(r, 2000));
      pageNum++;
    }

    for (const [month, amount] of Object.entries(monthlyTotals)) {
      if (amount > 0) expenses.push({ platform: "360pro", month, amount, currency: "HKD", rawData: JSON.stringify(monthlyTotals) });
    }
    if (expenses.length === 0) {
      await page.screenshot({ path: "/tmp/pro360-billing.png" });
      return { success: true, expenses: [], error: "登入成功但未找到當年交易記錄，請確認帳號有廣告開支", lastSyncAt: new Date() };
    }
    return { success: true, expenses, lastSyncAt: new Date() };
  } catch (error) {
    return { success: false, expenses: [], error: error instanceof Error ? error.message : "Unknown error", lastSyncAt: new Date() };
  } finally { await browser.close(); }
}
