/**
 * System Watchdog — silent self-healing
 *
 * Runs every hour. Prefer auto-repair; only notifyOwner when a human
 * reauth/credential step is required AFTER repair failed.
 * Do not spam "what's broken" status — heal quietly when possible.
 *
 * A. FH jobs stuck without email → fetch email / auto-send
 * B. FH session weak/expired → renew expiry + getOrLogin
 * C. FH scrape stale/failed → trigger scrape (retry once after session heal)
 * D. Gmail scan stale → trigger scan
 */

import { notifyOwner } from "./_core/notification";
import { getDb } from "./db";
import { freehunterJobs } from "../drizzle/schema";
import { sql, desc, eq } from "drizzle-orm";
import {
  getFreehunterStatus,
  renewFreehunterSessionExpiry,
  getOrLoginFreehunter,
  closeFreehunterBrowserSession,
} from "./freehunter";
import { fetchEmailForJob } from "./scrapers/freehunterBoard";
import { sendFHFirstEmail } from "./routers/emailInquiries";
import { lastFreehunterScrapeAt, lastGmailScanAt } from "./scheduler";
import { withSchedulerLock } from "./schedulerLock";

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const NINETY_MIN_MS = 90 * 60 * 1000;
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

let lastWatchdogRunAt: Date | null = null;
let lastHumanAlertAt: Date | null = null;
/** Per-issue cooldown so one reauth ping doesn't mute another forever. */
const humanAlertCooldown = new Map<string, number>();
const HUMAN_ALERT_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12h per issue key

function isWithinActiveHours(): boolean {
  const nowHKT = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const h = nowHKT.getUTCHours();
  return h >= 8 && h < 21;
}

async function notifyHumanOnly(issueKey: string, title: string, content: string): Promise<void> {
  const last = humanAlertCooldown.get(issueKey) ?? 0;
  if (Date.now() - last < HUMAN_ALERT_COOLDOWN_MS) {
    console.log(`[Watchdog] Human alert suppressed (${issueKey}): ${title}`);
    return;
  }
  try {
    await notifyOwner({ title, content });
    humanAlertCooldown.set(issueKey, Date.now());
    lastHumanAlertAt = new Date();
    console.log(`[Watchdog] Human alert sent (${issueKey}): ${title}`);
  } catch (e) {
    console.warn("[Watchdog] Failed to send human alert:", e);
  }
}

async function healStuckFHJobs(): Promise<number> {
  let fixed = 0;
  try {
    const db = await getDb();
    if (!db) return 0;

    const stuckJobs = await db
      .select()
      .from(freehunterJobs)
      .where(
        sql`${freehunterJobs.status} = 'new'
          AND (${freehunterJobs.clientEmail} IS NULL OR ${freehunterJobs.clientEmail} = '')
          AND ${freehunterJobs.scrapedAt} < DATE_SUB(NOW(), INTERVAL 2 HOUR)`
      )
      .orderBy(desc(freehunterJobs.aiScore))
      .limit(10);

    if (stuckJobs.length === 0) {
      console.log("[Watchdog] A: no stuck FH jobs");
      return 0;
    }

    console.log(`[Watchdog] A: repairing ${stuckJobs.length} stuck FH job(s)…`);

    for (const job of stuckJobs) {
      try {
        await new Promise((r) => setTimeout(r, 1500));
        const { email } = await fetchEmailForJob(job.jobId);
        if (!email) continue;
        fixed++;
        if ((job.aiScore ?? 0) >= 80) {
          const sendResult = await sendFHFirstEmail(email, job.clientName || "", job.title || "");
          if (sendResult.success) {
            await db
              .update(freehunterJobs)
              .set({ status: "first_email_sent", firstEmailSentAt: new Date(), updatedAt: new Date() })
              .where(eq(freehunterJobs.jobId, job.jobId));
            console.log(`[Watchdog] A: repaired+sent job ${job.jobId}`);
          }
        } else {
          console.log(`[Watchdog] A: repaired email for job ${job.jobId}`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[Watchdog] A: repair failed job ${job.jobId}:`, msg);
        if (msg.includes("登入失敗") || msg.includes("Login") || msg.includes("session expired")) {
          // Session heal runs in B; stop burning more jobs on a dead session.
          break;
        }
      }
    }
  } catch (e) {
    console.error("[Watchdog] A error:", e);
  }
  return fixed;
}

/** Returns true if FH session looks usable after heal attempts. */
async function healFHSession(): Promise<{ ok: boolean; needsHumanReauth: boolean }> {
  try {
    const status = await getFreehunterStatus();

    if (status.expiresAt) {
      const msUntilExpiry = status.expiresAt - Date.now();
      if (msUntilExpiry > 0 && msUntilExpiry < TWO_DAYS_MS) {
        try {
          await renewFreehunterSessionExpiry();
          console.log("[Watchdog] B: renewed FH session expiry");
        } catch (e) {
          console.warn("[Watchdog] B: renew expiry failed:", e);
        }
      }
    }

    if (!status.connected) {
      console.log("[Watchdog] B: session not connected — trying getOrLogin…");
      try {
        await closeFreehunterBrowserSession().catch(() => {});
        await getOrLoginFreehunter();
        const again = await getFreehunterStatus();
        if (again.connected) {
          console.log("[Watchdog] B: session restored via login");
          return { ok: true, needsHumanReauth: false };
        }
      } catch (e) {
        console.warn("[Watchdog] B: getOrLogin failed:", e);
        return { ok: false, needsHumanReauth: true };
      }
      return { ok: false, needsHumanReauth: true };
    }

    if (status.expiresAt && status.expiresAt - Date.now() <= 0) {
      console.log("[Watchdog] B: session expired — trying getOrLogin…");
      try {
        await closeFreehunterBrowserSession().catch(() => {});
        await getOrLoginFreehunter();
        const again = await getFreehunterStatus();
        if (again.connected) {
          console.log("[Watchdog] B: expired session restored");
          return { ok: true, needsHumanReauth: false };
        }
      } catch (e) {
        console.warn("[Watchdog] B: restore expired session failed:", e);
      }
      return { ok: false, needsHumanReauth: true };
    }

    return { ok: true, needsHumanReauth: false };
  } catch (e) {
    console.error("[Watchdog] B error:", e);
    return { ok: false, needsHumanReauth: true };
  }
}

async function fhScrapeIsStale(): Promise<boolean> {
  if (!isWithinActiveHours()) return false;

  if (lastFreehunterScrapeAt) {
    if (Date.now() - lastFreehunterScrapeAt.getTime() > TWO_HOURS_MS) return true;
  }

  try {
    const { getPersistedFreehunterScrapeStatus } = await import("./scheduler");
    const persisted = await getPersistedFreehunterScrapeStatus();
    if (persisted.at && Date.now() - persisted.at.getTime() > TWO_HOURS_MS) return true;
    if (persisted.ok === false) return true;
    if (!persisted.at && !lastFreehunterScrapeAt) return true;
  } catch (_) {}

  return false;
}

async function healFHScrape(): Promise<boolean> {
  if (!(await fhScrapeIsStale())) {
    console.log("[Watchdog] C: FH scrape fresh — skip");
    return true;
  }

  console.log("[Watchdog] C: FH scrape stale/failed — triggering scrape…");
  try {
    const { runScheduledFreehunterScrape } = await import("./scheduler");
    await runScheduledFreehunterScrape();
    const { getPersistedFreehunterScrapeStatus } = await import("./scheduler");
    const persisted = await getPersistedFreehunterScrapeStatus();
    if (persisted.ok === true && persisted.at && Date.now() - persisted.at.getTime() < TWO_HOURS_MS) {
      console.log("[Watchdog] C: scrape heal OK");
      return true;
    }
    // One more attempt after killing browser
    await closeFreehunterBrowserSession().catch(() => {});
    await getOrLoginFreehunter().catch(() => {});
    await runScheduledFreehunterScrape();
    const again = await getPersistedFreehunterScrapeStatus();
    const ok =
      again.ok === true && again.at != null && Date.now() - again.at.getTime() < TWO_HOURS_MS;
    console.log(`[Watchdog] C: scrape heal retry ${ok ? "OK" : "still failing"}`);
    return ok;
  } catch (e) {
    console.warn("[Watchdog] C: scrape heal error:", e);
    return false;
  }
}

async function gmailScanIsStale(): Promise<boolean> {
  if (!isWithinActiveHours()) return false;

  if (lastGmailScanAt) {
    return Date.now() - lastGmailScanAt.getTime() > NINETY_MIN_MS;
  }

  try {
    const { getPersistedGmailScanStatus } = await import("./scheduler");
    const persisted = await getPersistedGmailScanStatus();
    if (!persisted.at) return true; // no record during active hours → try scan
    return Date.now() - persisted.at.getTime() > NINETY_MIN_MS;
  } catch (_) {
    return false;
  }
}

async function healGmailScan(): Promise<boolean> {
  if (!(await gmailScanIsStale())) {
    console.log("[Watchdog] D: Gmail scan fresh — skip");
    return true;
  }

  console.log("[Watchdog] D: Gmail scan stale — triggering scan…");
  try {
    const { runScheduledGmailScan } = await import("./scheduler");
    await runScheduledGmailScan();
    const { getPersistedGmailScanStatus } = await import("./scheduler");
    const persisted = await getPersistedGmailScanStatus();
    const ok =
      persisted.ok === true &&
      persisted.at != null &&
      Date.now() - persisted.at.getTime() < NINETY_MIN_MS;
    console.log(`[Watchdog] D: gmail heal ${ok ? "OK" : "still failing"}`);
    return ok;
  } catch (e) {
    console.warn("[Watchdog] D: gmail heal error:", e);
    return false;
  }
}

/**
 * Run silent self-heal. Notify only when credentials/reauth need a human.
 */
export async function runWatchdog(): Promise<void> {
  await withSchedulerLock("watchdog", 55 * 60 * 1000, async () => {
    const now = new Date();
    console.log(`[Watchdog] Starting silent heal at ${now.toISOString()}`);
    lastWatchdogRunAt = now;

    try {
      const fixedJobs = await healStuckFHJobs();
      if (fixedJobs > 0) {
        console.log(`[Watchdog] A: fixed ${fixedJobs} job(s) (silent)`);
      }

      const session = await healFHSession();
      if (session.needsHumanReauth) {
        await notifyHumanOnly(
          "fh-reauth",
          "Freehunter 需要重新登入",
          "系統已自動嘗試恢復 FH session 但失敗。請在「平台同步／FH 工作板」重新登入一次；其餘會繼續自動修復。"
        );
      }

      if (session.ok || !session.needsHumanReauth) {
        const scrapeOk = await healFHScrape();
        if (!scrapeOk && session.needsHumanReauth === false) {
          // Scrape still failing with a "connected" session — often still auth; try login once more then stop.
          try {
            await closeFreehunterBrowserSession().catch(() => {});
            await getOrLoginFreehunter();
            const retryOk = await healFHScrape();
            if (!retryOk) {
              await notifyHumanOnly(
                "fh-scrape",
                "Freehunter 自動爬取仍失敗",
                "系統已重試登入與爬取仍失敗。請檢查 FREEHUNTER 帳密／網站是否改版後再登入一次。"
              );
            }
          } catch (_) {
            await notifyHumanOnly(
              "fh-scrape",
              "Freehunter 自動爬取仍失敗",
              "系統已重試登入與爬取仍失敗。請檢查 FREEHUNTER 帳密／網站是否改版後再登入一次。"
            );
          }
        }
      }

      const gmailOk = await healGmailScan();
      if (!gmailOk) {
        await notifyHumanOnly(
          "gmail-creds",
          "Gmail 自動掃描失敗",
          "系統已自動重試 Gmail 掃描仍失敗。請檢查 GMAIL_USER／GMAIL_APP_PASSWORD 是否有效。"
        );
      }

      console.log("[Watchdog] Silent heal pass finished.");
    } catch (e) {
      console.error("[Watchdog] Unexpected error:", e);
    }
  });
}

export function getWatchdogStatus(): {
  lastRunAt: Date | null;
  lastAlertAt: Date | null;
} {
  return {
    lastRunAt: lastWatchdogRunAt,
    lastAlertAt: lastHumanAlertAt,
  };
}
