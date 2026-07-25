/**
 * Test script to debug month picker navigation in Puppeteer.
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
await new Promise(r => setTimeout(r, 2000));

console.log("Page title:", await page.title());

// Step 1: Click input to open picker
const opened = await page.evaluate(() => {
  const dateInput = document.querySelector('input[value*="/20"]') as HTMLElement;
  if (dateInput) { dateInput.click(); return true; }
  return false;
});
console.log("Picker opened:", opened);
await new Promise(r => setTimeout(r, 1000));

// Step 2: Check what's in the picker
const pickerInfo = await page.evaluate(() => {
  const yearEl = document.querySelector('.sc-1772p8l-2');
  const header = document.querySelector('.sc-1772p8l-1');
  const svgs = header ? Array.from(header.querySelectorAll('svg')) : [];
  const monthBtns = Array.from(document.querySelectorAll('[role="button"]')).filter(b => {
    const text = b.textContent?.trim();
    return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].includes(text || '');
  });
  return {
    year: yearEl?.textContent,
    svgCount: svgs.length,
    monthBtnCount: monthBtns.length,
    firstMonthClass: monthBtns[0]?.className,
    firstMonthHint: monthBtns[0]?.getAttribute('hint'),
    firstMonthTitle: monthBtns[0]?.getAttribute('title'),
    firstMonthAriaLabel: monthBtns[0]?.getAttribute('aria-label'),
    firstMonthDataAttrs: monthBtns[0] ? Array.from(monthBtns[0].attributes).map(a => a.name + '=' + a.value).join(', ') : '',
  };
});
console.log("Picker info:", JSON.stringify(pickerInfo, null, 2));

// Step 3: Click left arrow to go to 2025
const leftClicked = await page.evaluate(() => {
  const header = document.querySelector('.sc-1772p8l-1');
  if (!header) return false;
  const svgs = Array.from(header.querySelectorAll('svg'));
  if (!svgs[0]) return false;
  svgs[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return true;
});
console.log("Left arrow clicked:", leftClicked);
await new Promise(r => setTimeout(r, 800));

const yearAfter = await page.evaluate(() => document.querySelector('.sc-1772p8l-2')?.textContent);
console.log("Year after left click:", yearAfter);

// Step 4: Try clicking January button
const janClicked = await page.evaluate(() => {
  const monthBtns = Array.from(document.querySelectorAll('[role="button"]')).filter(b => {
    return b.textContent?.trim() === 'Jan';
  });
  console.log('Jan buttons found:', monthBtns.length);
  if (monthBtns[0]) {
    (monthBtns[0] as HTMLElement).click();
    return true;
  }
  return false;
});
console.log("Jan clicked:", janClicked);
await new Promise(r => setTimeout(r, 2000));

// Step 5: Check rows
const rows = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('.sc-1noiqqf-1'));
  return rows.length;
});
console.log("Rows after Jan 2025:", rows);

await browser.close();
process.exit(0);
