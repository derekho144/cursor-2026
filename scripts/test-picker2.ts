/**
 * Test script to debug month picker navigation and data loading in Puppeteer.
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

const browser = await puppeteer.launch({
  executablePath: getChromiumPath(),
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  defaultViewport: { width: 1280, height: 900 },
});

const page = await browser.newPage();
await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36");

const cookies = JSON.parse(cookiesJson).map((c: any) => ({ ...c, domain: c.domain || ".hellotoby.com" }));
await page.setCookie(...cookies);

await page.goto("https://www.hellotoby.com/pro/credit-history", { waitUntil: "networkidle2", timeout: 30000 });
await new Promise(r => setTimeout(r, 3000));

console.log("Page title:", await page.title());

// Check initial state
const initialRows = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('.sc-1noiqqf-1'));
  return rows.length;
});
console.log("Initial rows (current month):", initialRows);

// Check the input value
const inputValue = await page.evaluate(() => {
  const input = document.querySelector('input[value*="/20"]') as HTMLInputElement;
  return input?.value;
});
console.log("Input value:", inputValue);

// Step 1: Click input to open picker
await page.evaluate(() => {
  const dateInput = document.querySelector('input[value*="/20"]') as HTMLElement;
  if (dateInput) dateInput.click();
});
await new Promise(r => setTimeout(r, 1000));

// Step 2: Click left arrow to go to 2025
await page.evaluate(() => {
  const header = document.querySelector('.sc-1772p8l-1');
  if (!header) return;
  const svgs = Array.from(header.querySelectorAll('svg'));
  if (svgs[0]) svgs[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
});
await new Promise(r => setTimeout(r, 600));

const yearAfter = await page.evaluate(() => document.querySelector('.sc-1772p8l-2')?.textContent);
console.log("Year after left click:", yearAfter);

// Step 3: Click March 2025
const marClicked = await page.evaluate(() => {
  const monthBtns = Array.from(document.querySelectorAll('[role="button"]'));
  const btn = monthBtns.find(b => b.getAttribute('aria-label') === 'Choose March 2025') as HTMLElement;
  if (btn) { btn.click(); return true; }
  return false;
});
console.log("Mar 2025 clicked:", marClicked);

// Wait and check rows
for (let i = 0; i < 10; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const rows = await page.evaluate(() => document.querySelectorAll('.sc-1noiqqf-1').length);
  const inputVal = await page.evaluate(() => (document.querySelector('input[value*="/20"]') as HTMLInputElement)?.value);
  console.log(`After ${i+1}s: rows=${rows}, input=${inputVal}`);
  if (rows > 0) break;
}

// Check if the page content changed at all
const pageContent = await page.evaluate(() => {
  // Check if there's any loading indicator
  const loading = document.querySelector('[class*="loading"], [class*="spinner"], [class*="skeleton"]');
  const rows = document.querySelectorAll('.sc-1noiqqf-1');
  const emptyMsg = document.querySelector('[class*="empty"], [class*="no-data"]');
  return {
    loadingEl: loading ? loading.className : null,
    rowCount: rows.length,
    emptyMsg: emptyMsg ? emptyMsg.textContent?.substring(0, 50) : null,
    bodyText: document.body.innerText.substring(0, 200),
  };
});
console.log("Page content:", JSON.stringify(pageContent, null, 2));

await browser.close();
process.exit(0);
