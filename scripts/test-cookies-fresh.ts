/**
 * Test if fresh cookies allow Puppeteer to load data properly.
 */
import { getHelloTobyCookies } from "../server/db";
import puppeteer from "puppeteer-core";
import * as fsLib from "fs";

const CHROMIUM_PATHS = ["/usr/bin/chromium-browser", "/usr/bin/chromium", "/usr/bin/google-chrome"];
function getChromiumPath(): string {
  for (const p of CHROMIUM_PATHS) { if (fsLib.existsSync(p)) return p; }
  return CHROMIUM_PATHS[0];
}

const cookiesJson = await getHelloTobyCookies();
if (!cookiesJson) { console.error("No cookies!"); process.exit(1); }

console.log("Cookies from DB:", JSON.parse(cookiesJson).map((c: any) => c.name).join(', '));

const browser = await puppeteer.launch({
  executablePath: getChromiumPath(),
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-blink-features=AutomationControlled",
    "--window-size=1280,900",
  ],
  defaultViewport: { width: 1280, height: 900 },
});

const page = await browser.newPage();

// Remove automation indicators
await page.evaluateOnNewDocument(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
});

await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

const cookies = JSON.parse(cookiesJson).map((c: any) => ({ ...c, domain: c.domain || ".hellotoby.com" }));
await page.setCookie(...cookies);

console.log("Navigating to credit history page...");
await page.goto("https://www.hellotoby.com/pro/credit-history", { waitUntil: "networkidle2", timeout: 30000 });

// Wait longer for React to render
await new Promise(r => setTimeout(r, 5000));

const pageInfo = await page.evaluate(() => {
  const rows = document.querySelectorAll('.sc-1noiqqf-1');
  const balance = document.querySelector('[class*="balance"], [class*="Balance"]');
  const balanceText = document.body.innerHTML.match(/(\d+)金幣/)?.[1];
  const inputEl = document.querySelector('input[value*="/20"]') as HTMLInputElement;
  return {
    rowCount: rows.length,
    balanceText,
    inputValue: inputEl?.value,
    bodyTextStart: document.body.innerText.substring(0, 300),
  };
});

console.log("Page info:", JSON.stringify(pageInfo, null, 2));

if (pageInfo.rowCount > 0) {
  const firstRow = await page.evaluate(() => {
    const row = document.querySelector('.sc-1noiqqf-1');
    const cells = Array.from(row?.querySelectorAll('.sc-1noiqqf-3') || []);
    return cells.map(c => (c as HTMLElement).innerText.trim());
  });
  console.log("First row:", firstRow);
}

await browser.close();
process.exit(0);
