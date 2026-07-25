/**
 * Freehunter Integration via Playwright Browser Automation
 *
 * Freehunter uses Firebase Authentication (IndexedDB-based session).
 * The session cannot be replicated via cookies alone from a Node.js server.
 *
 * Strategy:
 *   1. Use Playwright headless browser to log in to Freehunter
 *   2. Firebase Auth session is stored in IndexedDB within the browser
 *   3. After login, persist the full browser storageState (cookies + localStorage +
 *      IndexedDB) to the database (encrypted). On server restart, restore the
 *      storageState so no re-login is needed.
 *   4. Use page.evaluate() to call /apis/jobs/getClientEmail WITHIN the browser
 *      so it uses the Firebase session automatically
 *   5. Keep the browser page alive and reuse it across requests (session cache)
 *
 * Key API:
 *   POST /apis/jobs/getClientEmail  { job_id }  (requires Firebase session)
 *   → Returns { result: "email@example.com" } or { result: null }
 */

import { getPlatformCredential, getDb } from "./db";
import { platformCredentials } from "../drizzle/schema";
import crypto from "crypto";
import { execSync } from "child_process";
import fs from "fs";

const FREEHUNTER_BASE = "https://freehunter.hk";

// ─── Auto-install Playwright Chromium if missing ─────────────────────
async function ensurePlaywrightChromium(): Promise<void> {
  try {
    const { chromium } = await import("playwright");
    const executablePath = chromium.executablePath();
    if (!fs.existsSync(executablePath)) {
      console.log("[Freehunter] Playwright Chromium not found, installing...");
      execSync("npx playwright install chromium", {
        stdio: "inherit",
        timeout: 3 * 60 * 1000, // 3 minutes
      });
      console.log("[Freehunter] Playwright Chromium installed successfully.");
    }
  } catch (e) {
    console.warn("[Freehunter] Could not ensure Playwright Chromium:", e);
  }
}

// ─── Encryption helpers ────────────────────────────────────────────
const _rawSecret = process.env.JWT_SECRET || "jd-studio-secret-key-for-encryption";
const ENCRYPTION_KEY = crypto.createHash("sha256").update(_rawSecret).digest();
const IV_LENGTH = 16;

function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

function decrypt(text: string): string {
  const [ivHex, encryptedHex] = text.split(":");
  if (!ivHex || !encryptedHex) return "";
  const iv = Buffer.from(ivHex, "hex");
  const encryptedText = Buffer.from(encryptedHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

// ─── In-memory browser session cache ──────────────────────────────
// Keep a single Playwright browser alive to avoid repeated login overhead
interface BrowserSession {
  browser: any;
  context: any;
  page: any;
  userId: number;
  email: string;
  loginTime: number;
  isValid: boolean;
}

let _browserSession: BrowserSession | null = null;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (Firebase sessions last much longer than 24h)

// ─── Login mutex: prevent concurrent login attempts ────────────────
let _loginInProgress: Promise<BrowserSession> | null = null;

async function closeBrowserSession() {
  if (_browserSession) {
    try {
      await _browserSession.browser.close();
    } catch {}
    _browserSession = null;
  }
}

async function isBrowserSessionValid(): Promise<boolean> {
  if (!_browserSession || !_browserSession.isValid) return false;
  if (Date.now() - _browserSession.loginTime > SESSION_TTL_MS) {
    await closeBrowserSession();
    return false;
  }
  // Quick health check: verify the page is still alive and logged in
  try {
    const authData = await _browserSession.page.evaluate(() => {
      try {
        const auth = JSON.parse(localStorage.getItem("freehunterAuth") || "{}");
        return { userId: auth?.user?.id || 0 };
      } catch {
        return { userId: 0 };
      }
    });
    if (!authData.userId) {
      await closeBrowserSession();
      return false;
    }
    return true;
  } catch {
    await closeBrowserSession();
    return false;
  }
}

// ─── DB: Save & Load StorageState ─────────────────────────────────

const STORAGE_STATE_KEY = "freehunter_storage_state";

async function saveStorageStateToDB(storageStateJson: string, email: string, userId: number): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    const encryptedState = encrypt(storageStateJson);
    const encryptedPassword = encrypt(process.env.FREEHUNTER_PASSWORD || "");
    const expiresAt = Date.now() + SESSION_TTL_MS;

    await db
      .insert(platformCredentials)
      .values({
        platform: "freehunter",
        loginEmail: email,
        loginPassword: encryptedPassword,
        accessToken: encryptedState,
        refreshToken: STORAGE_STATE_KEY, // marker to identify this record type
        tokenExpiresAt: expiresAt,
        firebaseUid: String(userId),
        isActive: 1,
        lastVerifiedAt: new Date(),
      })
      .onDuplicateKeyUpdate({
        set: {
          loginEmail: email,
          loginPassword: encryptedPassword,
          accessToken: encryptedState,
          refreshToken: STORAGE_STATE_KEY,
          tokenExpiresAt: expiresAt,
          firebaseUid: String(userId),
          isActive: 1,
          lastVerifiedAt: new Date(),
          updatedAt: new Date(),
        },
      });

    console.log("[Freehunter] StorageState saved to DB (encrypted).");
  } catch (e) {
    console.warn("[Freehunter] Could not save storageState to DB:", e);
  }
}

async function loadStorageStateFromDB(): Promise<{ storageState: any; email: string; userId: number } | null> {
  try {
    const cred = await getPlatformCredential("freehunter");
    if (!cred || !cred.accessToken || cred.refreshToken !== STORAGE_STATE_KEY) {
      return null;
    }

    // Check if not expired — allow slightly expired states to be tried (Firebase session may still be valid)
    // Only skip if expired by more than 7 days (Firebase sessions last much longer than our 24h TTL)
    const now = Date.now();
    const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days grace period
    if (!cred.tokenExpiresAt || cred.tokenExpiresAt < now - GRACE_PERIOD_MS) {
      console.log("[Freehunter] Stored storageState is too old (>7 days past expiry), skipping.");
      return null;
    }
    if (cred.tokenExpiresAt < now) {
      console.log("[Freehunter] Stored storageState is past TTL but within grace period, attempting restore...");
    }

    const decrypted = decrypt(cred.accessToken);
    if (!decrypted) return null;

    const storageState = JSON.parse(decrypted);
    console.log("[Freehunter] StorageState loaded from DB.");
    return {
      storageState,
      email: cred.loginEmail || "",
      userId: parseInt(cred.firebaseUid || "0", 10),
    };
  } catch (e) {
    console.warn("[Freehunter] Could not load storageState from DB:", e);
    return null;
  }
}

// ─── Playwright Browser Login ──────────────────────────────────────
export interface FreehunterSession {
  cookies: string;       // JSON-serialized cookie array (kept for DB compatibility)
  userId: number;
  email: string;
  expiresAt: number;     // ms timestamp
}

/**
 * Create a new Playwright browser session by logging in to Freehunter.
 * After login, saves the full storageState to DB for persistence across restarts.
 */
async function createBrowserSessionByLogin(
  email: string,
  password: string
): Promise<BrowserSession> {
  // Ensure Playwright Chromium is installed (may be missing after sandbox reset)
  await ensurePlaywrightChromium();

  const { chromium } = await import("playwright");
  // Use system chromium in production (Dockerfile sets PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)
  // Fall back to Playwright's bundled chromium in development
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath();

  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  console.log("[Freehunter] Opening login page...");
  await page.goto(`${FREEHUNTER_BASE}/login/step/1`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  // Fill email using pressSequentially to trigger React onChange events
  console.log("[Freehunter] Filling email...");
  const emailInput = page.locator('input[type="email"]').first();
  await emailInput.waitFor({ state: "visible", timeout: 15000 });
  await emailInput.click();
  await emailInput.pressSequentially(email, { delay: 80 });
  await page.waitForTimeout(800);

  // Click the 繼續 button
  const continueBtn = page.locator('button:has-text("繼續")').last();
  await continueBtn.scrollIntoViewIfNeeded();
  await continueBtn.click({ force: true });

  // Wait for navigation to step 2 — with fallback: password input may appear on same page
  try {
    await page.waitForURL(/\/login\/step\/2/, { timeout: 20000 });
  } catch {
    // Fallback: check if password input already appeared on the current page
    const pwdAlreadyVisible = await page.locator('input[type="password"]').first().isVisible().catch(() => false);
    if (!pwdAlreadyVisible) {
      // Check if already redirected to main page (auto-login)
      const alreadyLoggedIn = /\/(freelancejobs|dashboard|profile|home|freelancer)/.test(page.url());
      if (!alreadyLoggedIn) {
        console.warn(`[Freehunter] Login step 2 navigation timed out. Current URL: ${page.url()}`);
        throw new Error(`登入失敗：無法導航到密碼輸入頁面。請確認 FreeHunter 帳號和密碼是否正確。`);
      }
    }
  }
  await page.waitForLoadState("networkidle");

  // Fill password (if password input is visible)
  const passwordInput = page.locator('input[type="password"]').first();
  const pwdInputVisible = await passwordInput.isVisible().catch(() => false);
  if (pwdInputVisible) {
    await passwordInput.pressSequentially(password, { delay: 50 });
    // Click login button
    const loginBtn = page.locator('button:has-text("登入")').last();
    await loginBtn.click({ force: true });
  }

  // Wait for redirect to main page after login
  try {
    await page.waitForURL(/\/(freelancejobs|dashboard|profile|home|freelancer)/, {
      timeout: 25000,
    });
  } catch {
    const currentUrl = page.url();
    console.warn(`[Freehunter] Login redirect failed. Current URL: ${currentUrl}`);
    throw new Error(`登入失敗：無法完成登入流程。目前頁面：${currentUrl}。請確認 FreeHunter 帳號和密碼是否正確。`);
  }

  // Wait for Firebase Auth to initialize and store session in IndexedDB
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000); // Give Firebase time to persist session

  console.log("[Freehunter] Login successful.");

  // Get user info from localStorage
  const authData = await page.evaluate(() => {
    try {
      const auth = JSON.parse(localStorage.getItem("freehunterAuth") || "{}");
      return {
        userId: auth?.user?.id || 0,
        email: auth?.user?.email || "",
      };
    } catch {
      return { userId: 0, email: "" };
    }
  });

  // ── Persist storageState to DB ──
  try {
    const storageState = await context.storageState();
    const storageStateJson = JSON.stringify(storageState);
    await saveStorageStateToDB(storageStateJson, authData.email || email, authData.userId);
  } catch (e) {
    console.warn("[Freehunter] Could not capture storageState:", e);
  }

  return {
    browser,
    context,
    page,
    userId: authData.userId,
    email: authData.email || email,
    loginTime: Date.now(),
    isValid: true,
  };
}

/**
 * Restore a Playwright browser session from a saved storageState (no login needed).
 * Returns null if the restored session is not actually logged in.
 */
async function restoreBrowserSessionFromState(
  storageState: any,
  email: string,
  userId: number
): Promise<BrowserSession | null> {
  try {
    // Ensure Playwright Chromium is installed (may be missing after sandbox reset)
    await ensurePlaywrightChromium();

    const { chromium } = await import("playwright");
    // Use system chromium in production (Dockerfile sets PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath();

    console.log("[Freehunter] Restoring browser session from saved storageState...");

    const browser = await chromium.launch({
      headless: true,
      executablePath,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      storageState, // ← Restore full browser state (cookies + localStorage + IndexedDB)
    });

    const page = await context.newPage();

    // Navigate to Freehunter to trigger Firebase Auth initialization
    await page.goto(`${FREEHUNTER_BASE}/freelancejobs`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(3000); // Give Firebase time to restore from IndexedDB

    // Verify session is still valid
    const authData = await page.evaluate(() => {
      try {
        const auth = JSON.parse(localStorage.getItem("freehunterAuth") || "{}");
        return { userId: auth?.user?.id || 0, email: auth?.user?.email || "" };
      } catch {
        return { userId: 0, email: "" };
      }
    });

    if (!authData.userId) {
      console.log("[Freehunter] Restored session is no longer valid (Firebase session expired).");
      await browser.close();
      return null;
    }

    console.log(`[Freehunter] Session restored successfully for user ${authData.userId} (${authData.email || email}).`);

    return {
      browser,
      context,
      page,
      userId: authData.userId || userId,
      email: authData.email || email,
      loginTime: Date.now(),
      isValid: true,
    };
  } catch (e) {
    console.warn("[Freehunter] Failed to restore session from storageState:", e);
    return null;
  }
}

/**
 * Get or create a valid browser session.
 * Priority:
 *   1. Reuse in-memory session if still valid
 *   2. Restore from DB storageState (no login needed)
 *   3. Full login via Playwright
 * Uses a mutex to prevent concurrent login attempts.
 */
async function getOrCreateBrowserSession(): Promise<BrowserSession> {
  // 1. Reuse in-memory session
  if (await isBrowserSessionValid()) {
    return _browserSession!;
  }

  // If a login is already in progress, wait for it instead of starting another
  if (_loginInProgress) {
    console.log("[Freehunter] Login already in progress, waiting...");
    return _loginInProgress;
  }

  const email = process.env.FREEHUNTER_EMAIL;
  const password = process.env.FREEHUNTER_PASSWORD;

  if (!email || !password) {
    throw new Error("FREEHUNTER_EMAIL 或 FREEHUNTER_PASSWORD 環境變數未設定");
  }

  // Create the login promise and store it as mutex
  _loginInProgress = (async () => {
    try {
      // 2. Try to restore from DB storageState
      const saved = await loadStorageStateFromDB();
      if (saved) {
        const restored = await restoreBrowserSessionFromState(saved.storageState, saved.email, saved.userId);
        if (restored) {
          _browserSession = restored;
          return _browserSession;
        }
        console.log("[Freehunter] Stored session invalid, falling back to full login...");
      }

      // 3. Full login
      console.log("[Freehunter] Creating new browser session via login...");
      _browserSession = await createBrowserSessionByLogin(email, password);
      return _browserSession;
    } finally {
      // Always clear the mutex when done (success or failure)
      _loginInProgress = null;
    }
  })();

  return _loginInProgress;
}

// ─── Legacy: loginFreehunterWithBrowser (kept for compatibility) ───
export async function loginFreehunterWithBrowser(
  email: string,
  password: string
): Promise<FreehunterSession> {
  const session = await createBrowserSessionByLogin(email, password);
  // Close the browser since this is the legacy path
  await session.browser.close();

  return {
    cookies: JSON.stringify([]),
    userId: session.userId,
    email: session.email,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
}

// ─── Legacy: saveFreehunterSession (kept for compatibility) ────────
export async function saveFreehunterSession(
  email: string,
  session: FreehunterSession
): Promise<void> {
  // No-op in new implementation; storageState is saved automatically after login
  console.log("[Freehunter] saveFreehunterSession called (no-op, storageState auto-saved).");
}

// ─── Legacy: getValidFreehunterSession (kept for compatibility) ────
export async function getValidFreehunterSession(): Promise<{
  cookies: Array<{ name: string; value: string; domain: string; path: string }>;
  userId: number;
  email: string;
} | null> {
  if (await isBrowserSessionValid()) {
    return {
      cookies: [],
      userId: _browserSession!.userId,
      email: _browserSession!.email,
    };
  }
  return null;
}

// ─── Legacy: autoLoginFreehunter (kept for compatibility) ──────────
export async function autoLoginFreehunter(): Promise<FreehunterSession> {
  const email = process.env.FREEHUNTER_EMAIL;
  const password = process.env.FREEHUNTER_PASSWORD;
  if (!email || !password) {
    throw new Error("FREEHUNTER_EMAIL 或 FREEHUNTER_PASSWORD 環境變數未設定");
  }
  return loginFreehunterWithBrowser(email, password);
}

// ─── Legacy: getOrLoginFreehunter (kept for compatibility) ─────────
export async function getOrLoginFreehunter(): Promise<{
  cookies: Array<{ name: string; value: string; domain: string; path: string }>;
  userId: number;
  email: string;
}> {
  const session = await getOrCreateBrowserSession();
  return {
    cookies: [],
    userId: session.userId,
    email: session.email,
  };
}

// ─── Extract Job ID from Freehunter URL ───────────────────────────
export function extractJobIdFromUrl(url: string): number | null {
  const match = url.match(/\/(?:freelancejobs?|job|task|work)\/(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

// ─── Fetch Customer Email from Freehunter Job ──────────────────────
export interface FreehunterJobContact {
  email: string;
  jobId: number;
  jobTitle?: string;
  clientName?: string;
}

/**
 * Fetch the client email for a Freehunter job.
 *
 * Uses Playwright to call the API WITHIN the browser context,
 * so Firebase Auth session (stored in IndexedDB) is used automatically.
 */
export async function fetchFreehunterJobContact(
  jobId: number
): Promise<FreehunterJobContact> {
  const session = await getOrCreateBrowserSession();
  const { page, context } = session;

  // Step 1: Get job title from public page (server-side fetch, no auth needed)
  let jobTitle: string | undefined;
  let clientName: string | undefined;

  try {
    const pageRes = await fetch(`${FREEHUNTER_BASE}/freelancejobs/${jobId}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "text/html",
      },
    });
    const html = await pageRes.text();
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (match) {
      const nextData = JSON.parse(match[1]);
      const result = nextData?.props?.pageProps?.result;
      if (result) {
        jobTitle = result.title;
        // user_name 是帳號用戶名（如 tangram.stephanie），不是真實姓名
        // 只使用 user_display_name 或 user_full_name（如果有的話）
        const displayName = result.user_display_name || result.user_full_name || result.display_name;
        if (displayName && !/[._\-]/.test(displayName) && displayName.includes(' ')) {
          clientName = displayName;
        }
        // 如果沒有合適的顯示名稱，不設定 clientName，後續會 fallback 到 Sir/Madam
      }
    }
  } catch (e) {
    console.warn("[Freehunter] Could not fetch job page:", e);
  }

  // Step 2: Navigate to the job page in the browser and click 立即接JOB
  console.log(`[Freehunter] Fetching email for job ${jobId} via browser...`);

  // Helper: navigate with retry (domcontentloaded + 60s timeout, retry once on failure)
  async function gotoWithRetry(targetPage: any, url: string): Promise<void> {
    try {
      await targetPage.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch (firstErr) {
      console.warn(`[Freehunter] First navigation attempt failed for ${url}, retrying in 5s...`, firstErr instanceof Error ? firstErr.message : firstErr);
      await new Promise((r) => setTimeout(r, 5000));
      await targetPage.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    }
  }

  try {
    // Navigate to the job page (with retry)
    await gotoWithRetry(page, `${FREEHUNTER_BASE}/freelancejobs/${jobId}`);

    // Wait for Firebase Auth to initialize (it needs time to load from IndexedDB)
    await page.waitForTimeout(3000);

    // First, try getClientEmail API (works if already applied)
    const emailData = await page.evaluate(async (jId: number) => {
      try {
        const resp = await fetch("/apis/jobs/getClientEmail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job_id: jId }),
          credentials: "include",
        });
        return await resp.json();
      } catch (e) {
        return { error: String(e) };
      }
    }, jobId);

    console.log("[Freehunter] getClientEmail response:", JSON.stringify(emailData));
    const emailFromApi = typeof emailData?.result === "string" ? emailData.result : "";

    if (emailFromApi) {
      // Refresh storageState after successful API call (token may have been refreshed)
      await refreshStorageState(context, session.email, session.userId);
      return { email: emailFromApi, jobId, jobTitle, clientName };
    }

    // If API returns null, click the 立即接JOB button and extract email from DOM
    console.log(`[Freehunter] getClientEmail returned null, clicking 立即接JOB button...`);

    // Look for the button (it shows 立即接JOB or 電郵已複製)
    const applyBtn = page.locator('button:has-text("立即接JOB")').first();
    const btnVisible = await applyBtn.isVisible().catch(() => false);

    if (btnVisible) {
      await applyBtn.click({ force: true });
      console.log(`[Freehunter] Clicked 立即接JOB button for job ${jobId}`);

      // Wait for the email to appear in the DOM
      await page.waitForTimeout(2000);
    } else {
      // Button might already show 電郵已複製 (already applied)
      const copiedBtn = page.locator('button:has-text("電郵已複製")').first();
      const copiedVisible = await copiedBtn.isVisible().catch(() => false);
      if (copiedVisible) {
        console.log(`[Freehunter] Button shows 電郵已複製, email already applied`);
      } else {
        console.log(`[Freehunter] No apply button found, trying to extract email from DOM`);
      }
    }

    // Extract email from DOM
    // NOTE: page.evaluate serializes the function to a string and runs it in the browser.
    // tsx (esbuild keepNames:true) injects __name() for ANY named binding (function decl OR
    // const arrow = ...). To avoid ReferenceError: __name is not defined in the browser,
    // we must NOT define any named function/variable inside page.evaluate.
    // Instead, inline all logic directly.
    const emailFromDom = await page.evaluate(() => {
      // Inline blacklist check: domains whose emails we never want
      // (freehunter.hk, freehunter.com.hk, freehunter.com)
      const allText = document.body.innerText;
      const emailMatch = allText.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g);
      if (emailMatch) {
        for (let i = 0; i < emailMatch.length; i++) {
          const lower = emailMatch[i].toLowerCase();
          if (!lower.endsWith("@freehunter.hk") && !lower.endsWith("@freehunter.com.hk") && !lower.endsWith("@freehunter.com")) {
            return emailMatch[i];
          }
        }
      }
      // Also check mailto links
      const mailtoLinks = document.querySelectorAll('a[href^="mailto:"]');
      for (let i = 0; i < mailtoLinks.length; i++) {
        const email = (mailtoLinks[i] as HTMLAnchorElement).href.replace("mailto:", "").split("?")[0].trim();
        const lower = email.toLowerCase();
        if (email && !lower.endsWith("@freehunter.hk") && !lower.endsWith("@freehunter.com.hk") && !lower.endsWith("@freehunter.com")) {
          return email;
        }
      }
      return null;
    });

    console.log(`[Freehunter] Email from DOM: ${emailFromDom}`);

    if (emailFromDom) {
      // Refresh storageState after successful operation
      await refreshStorageState(context, session.email, session.userId);
      return { email: emailFromDom, jobId, jobTitle, clientName };
    }

    // Last resort: try getClientEmail API again after clicking button
    const emailData2 = await page.evaluate(async (jId: number) => {
      try {
        const resp = await fetch("/apis/jobs/getClientEmail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job_id: jId }),
          credentials: "include",
        });
        return await resp.json();
      } catch (e) {
        return { error: String(e) };
      }
    }, jobId);

    console.log("[Freehunter] getClientEmail (after click) response:", JSON.stringify(emailData2));
    const email2 = typeof emailData2?.result === "string" ? emailData2.result : "";

    if (!email2) {
      throw new Error(`無法取得客戶電郵。請確認帳號已登入並有 Premium 權限。`);
    }

    await refreshStorageState(context, session.email, session.userId);
    return { email: email2, jobId, jobTitle, clientName };
  } catch (e) {
    // If browser session failed, invalidate it so next call will re-login
    if (_browserSession) {
      _browserSession.isValid = false;
    }
    throw e;
  }
}

/**
 * Refresh and re-save the storageState to DB.
 * Called after successful API calls to keep the persisted state up-to-date
 * (Firebase tokens are refreshed periodically).
 */
async function refreshStorageState(context: any, email: string, userId: number): Promise<void> {
  try {
    const storageState = await context.storageState();
    await saveStorageStateToDB(JSON.stringify(storageState), email, userId);
  } catch (e) {
    console.warn("[Freehunter] Could not refresh storageState:", e);
  }
}

// ─── Save Cookies Manually (from browser DevTools) ───────────────
export async function saveFreehunterCookiesManually(
  cookieString: string,
  email: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  let cookiesJson: string;
  try {
    const parsed = JSON.parse(cookieString);
    if (Array.isArray(parsed)) {
      cookiesJson = cookieString;
    } else {
      throw new Error("Not an array");
    }
  } catch {
    const cookies = cookieString
      .split(";")
      .map((c) => c.trim())
      .filter((c) => c.includes("="))
      .map((c) => {
        const idx = c.indexOf("=");
        return {
          name: c.substring(0, idx).trim(),
          value: c.substring(idx + 1).trim(),
          domain: "freehunter.hk",
          path: "/",
        };
      });
    cookiesJson = JSON.stringify(cookies);
  }

  const encryptedCookies = encrypt(cookiesJson);
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days

  await db
    .insert(platformCredentials)
    .values({
      platform: "freehunter",
      loginEmail: email,
      loginPassword: encrypt("manual-cookie"),
      accessToken: encryptedCookies,
      refreshToken: null,
      tokenExpiresAt: expiresAt,
      firebaseUid: "0",
      isActive: 1,
      lastVerifiedAt: new Date(),
    })
    .onDuplicateKeyUpdate({
      set: {
        loginEmail: email,
        accessToken: encryptedCookies,
        tokenExpiresAt: expiresAt,
        isActive: 1,
        lastVerifiedAt: new Date(),
        updatedAt: new Date(),
      },
    });

  console.log("[Freehunter] Manual cookies saved for:", email);
}

// ─── Get Freehunter Connection Status ─────────────────────────────
export async function getFreehunterStatus(): Promise<{
  connected: boolean;
  email?: string;
  lastVerifiedAt?: Date;
  expiresAt?: number;
  sessionPersisted?: boolean;
}> {
  const cred = await getPlatformCredential("freehunter");
  if (!cred || !cred.accessToken) {
    return { connected: false };
  }

  const now = Date.now();
  // Consider connected if storageState exists and is within 7-day grace period.
  // Firebase sessions last much longer than our TTL — don't show "logged out" prematurely.
  // This matches the grace period logic in loadStorageStateFromDB.
  const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
  const isValid = cred.tokenExpiresAt
    ? cred.tokenExpiresAt > now - GRACE_PERIOD_MS
    : false;
  const sessionPersisted = cred.refreshToken === STORAGE_STATE_KEY;

  return {
    connected: isValid,
    email: cred.loginEmail || undefined,
    lastVerifiedAt: cred.lastVerifiedAt || undefined,
    expiresAt: cred.tokenExpiresAt || undefined,
    sessionPersisted,
  };
}

/**
 * Renew the storageState expiry in DB after a successful scrape.
 * Call this after each successful scrape to keep the session appearing "connected"
 * without requiring a full re-login every 7 days.
 */
export async function renewFreehunterSessionExpiry(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const cred = await getPlatformCredential("freehunter");
    if (!cred || !cred.accessToken || cred.refreshToken !== STORAGE_STATE_KEY) return;
    const newExpiresAt = Date.now() + SESSION_TTL_MS; // extend by 7 more days
    const { eq } = await import("drizzle-orm");
    await db
      .update(platformCredentials)
      .set({
        tokenExpiresAt: newExpiresAt,
        lastVerifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(platformCredentials.platform, "freehunter"));
    console.log("[Freehunter] Session expiry renewed for 7 more days.");
  } catch (e) {
    console.warn("[Freehunter] Could not renew session expiry:", e);
  }
}
