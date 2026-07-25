/**
 * Test FH login flow with screenshots
 */
import { chromium } from "playwright";

const email = process.env.FREEHUNTER_EMAIL;
const password = process.env.FREEHUNTER_PASSWORD;

if (!email || !password) {
  console.error("Missing FREEHUNTER_EMAIL or FREEHUNTER_PASSWORD");
  process.exit(1);
}

console.log(`Testing FH login for: ${email}`);

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});

const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
});
const page = await context.newPage();

try {
  console.log("1. Navigating to login page...");
  await page.goto("https://freehunter.hk/login/step/1", {
    waitUntil: "networkidle",
    timeout: 30000,
  });
  await page.screenshot({ path: "/tmp/fh-step1.png" });
  console.log("   Screenshot saved: /tmp/fh-step1.png");
  console.log("   Current URL:", page.url());

  // Check what inputs are on the page
  const inputs = await page.locator("input").all();
  console.log(`   Found ${inputs.length} inputs`);
  for (const input of inputs) {
    const type = await input.getAttribute("type");
    const placeholder = await input.getAttribute("placeholder");
    console.log(`     input type="${type}" placeholder="${placeholder}"`);
  }

  // Check buttons
  const buttons = await page.locator("button").all();
  console.log(`   Found ${buttons.length} buttons`);
  for (const btn of buttons) {
    const text = await btn.textContent();
    console.log(`     button: "${text?.trim()}"`);
  }

  console.log("2. Filling email...");
  const emailInput = page.locator('input[type="email"]').first();
  await emailInput.waitFor({ state: "visible", timeout: 15000 });
  await emailInput.click();
  await emailInput.pressSequentially(email, { delay: 80 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "/tmp/fh-step1-filled.png" });
  console.log("   Screenshot saved: /tmp/fh-step1-filled.png");

  // Check buttons again after filling
  const buttonsAfter = await page.locator("button").all();
  console.log(`   Found ${buttonsAfter.length} buttons after filling`);
  for (const btn of buttonsAfter) {
    const text = await btn.textContent();
    const disabled = await btn.isDisabled();
    console.log(`     button: "${text?.trim()}" disabled=${disabled}`);
  }

  console.log("3. Clicking 繼續 button...");
  const continueBtn = page.locator('button:has-text("繼續")').last();
  const continueBtnExists = await continueBtn.count();
  console.log(`   '繼續' button count: ${continueBtnExists}`);
  
  if (continueBtnExists > 0) {
    await continueBtn.scrollIntoViewIfNeeded();
    await continueBtn.click({ force: true });
    console.log("   Clicked! Waiting for URL change...");
    
    try {
      await page.waitForURL(/\/login\/step\/2/, { timeout: 20000 });
      console.log("   ✓ Navigated to step 2!");
    } catch (e) {
      console.log("   ✗ Timeout waiting for step 2. Current URL:", page.url());
      await page.screenshot({ path: "/tmp/fh-after-continue.png" });
      console.log("   Screenshot saved: /tmp/fh-after-continue.png");
    }
  } else {
    console.log("   '繼續' button not found! Checking all buttons...");
    const allBtns = await page.locator("button").all();
    for (const btn of allBtns) {
      const text = await btn.textContent();
      console.log(`     button: "${text?.trim()}"`);
    }
  }
} catch (err) {
  console.error("Error:", err.message);
  await page.screenshot({ path: "/tmp/fh-error.png" }).catch(() => {});
} finally {
  await browser.close();
}
