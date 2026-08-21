/**
 * Background Scheduler Service
 *
 * Runs periodic tasks without requiring an authenticated HTTP request.
 * Handles: PRO360 auto-sync every 3 days, HelloToby/Google Ads auto-sync every 7 days, Gmail scan every 30 min, FH scrape every 15 min (09:00-21:00 HKT).
 */

import { createAdSyncLog, getAdSyncLogs, getPro360Cookies, savePro360Cookies, getHelloTobyCookies, saveHelloTobyCookies, updateAdPlatformSyncStatus, upsertAdExpense, upsertAdTransaction, deleteAdTransactionsByPlatform } from "./db";
import { scrapePro360WithCookies, scrapeHelloTobyViaAPI } from "./scrapers/hellotoby";
import { fetchGoogleAdsCosts } from "./googleAds";
import { notifyOwner } from "./_core/notification";
import { runEmailScan, sendFHFollowUpEmail, sendFHFirstEmail } from "./routers/emailInquiries";
import { scrapeFreehunterBoard, fetchEmailForJob } from "./scrapers/freehunterBoard";
import { freehunterJobs, emailInquiries } from "../drizzle/schema";
import { desc, sql, eq } from "drizzle-orm";
import {
  getFHJobsPendingFollowUp,
  markFollowUpSent,
  resetFollowUpSentinel, getQuotesPendingReviewEmail, markReviewEmailSent, resetReviewEmailSentinel, getClientsForSeasonalEmail, getClientsForWinbackEmail, recordLoyaltyEmail, getClientMembership, getDb, createEmailInquiry } from "./db";
import { sendEmail } from "./resendEmail";
import { runQuoteFollowUps } from "./gmailFollowUp";
import { runWatchdog } from "./watchdog";
import { withSchedulerLock, releaseLock } from "./schedulerLock";
import { runOutreachPipeline } from "./scrapers/pitchOutreach";
import { runScheduledContentFactory, notifyDuePublishes } from "./linkedinContentFactory";
import { buildWaTrackUrl } from "./_core/waTracking";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // check every hour
const GMAIL_SCAN_INTERVAL_MS = 30 * 60 * 1000; // Gmail scan every 30 minutes

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let gmailScanTimer: ReturnType<typeof setInterval> | null = null;
let freehunterScrapeTimer: ReturnType<typeof setInterval> | null = null;
let pitchOutreachTimer: ReturnType<typeof setInterval> | null = null;

// Track last Freehunter scrape time (in-memory; also persisted — see recordFreehunterScrapeResult)
export let lastFreehunterScrapeAt: Date | null = null;
export let lastFreehunterScrapeResult: { newJobs: number; emailsFetched: number } | null = null;

const FH_SCRAPE_STATUS_KEY = "fh-scrape-status";

/** Persist last scrape attempt so health survives cold starts / restarts. */
export async function recordFreehunterScrapeResult(opts: {
  ok: boolean;
  newJobs?: number;
  emailsFetched?: number;
  error?: string;
}): Promise<void> {
  const newJobs = opts.newJobs ?? 0;
  const emailsFetched = opts.emailsFetched ?? 0;
  lastFreehunterScrapeAt = new Date();
  lastFreehunterScrapeResult = { newJobs, emailsFetched };

  const by = (
    opts.ok
      ? `ok:${newJobs}/${emailsFetched}`
      : `fail:${(opts.error || "error").replace(/\s+/g, " ").slice(0, 55)}`
  ).slice(0, 64);

  try {
    const db = await getDb();
    if (!db) return;
    await db.execute(sql`
      INSERT INTO scheduler_locks (lock_key, locked_at, locked_until, locked_by)
      VALUES (${FH_SCRAPE_STATUS_KEY}, NOW(), NOW(), ${by})
      ON DUPLICATE KEY UPDATE
        locked_at = NOW(),
        locked_until = NOW(),
        locked_by = VALUES(locked_by)
    `);
  } catch (e) {
    console.warn("[Scheduler] Failed to persist FH scrape status:", e);
  }
}

/** Read persisted scrape status (for health UI after process restart). */
export async function getPersistedFreehunterScrapeStatus(): Promise<{
  at: Date | null;
  ok: boolean | null;
  newJobs: number | null;
  emailsFetched: number | null;
  raw: string | null;
}> {
  try {
    const db = await getDb();
    if (!db) return { at: null, ok: null, newJobs: null, emailsFetched: null, raw: null };
    const { schedulerLocks } = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await db
      .select({
        at: schedulerLocks.lockedAt,
        raw: schedulerLocks.lockedBy,
      })
      .from(schedulerLocks)
      .where(eq(schedulerLocks.lockKey, FH_SCRAPE_STATUS_KEY))
      .limit(1);
    if (!row) return { at: null, ok: null, newJobs: null, emailsFetched: null, raw: null };
    const at = row.at ? new Date(row.at) : null;
    const raw = String(row.raw ?? "");
    if (raw.startsWith("ok:")) {
      const [a, b] = raw.slice(3).split("/");
      return {
        at,
        ok: true,
        newJobs: Number(a) || 0,
        emailsFetched: Number(b) || 0,
        raw,
      };
    }
    return { at, ok: false, newJobs: null, emailsFetched: null, raw };
  } catch (e) {
    console.warn("[Scheduler] Failed to read FH scrape status:", e);
    return { at: null, ok: null, newJobs: null, emailsFetched: null, raw: null };
  }
}

const FREEHUNTER_SCRAPE_INTERVAL_MS = 15 * 60 * 1000; // every 15 minutes
const PITCH_OUTREACH_INTERVAL_MS = 24 * 60 * 60 * 1000; // every 24 hours

// Track last pitch outreach run time
export let lastPitchOutreachAt: Date | null = null;
export let lastPitchOutreachResult: { scraped: number; saved?: number; emailsFound: number; sent: number; skipped: number } | null = null;

// Track last Gmail scan time for frontend display
export let lastGmailScanAt: Date | null = null;
export let lastGmailScanResult: { scanned: number; newInquiries: number } | null = null;

/**
 * Returns true if current HKT time is within active scanning hours.
 * Gmail scan: 09:00–21:00 HKT
 * FH scrape: 08:00–21:00 HKT (starts 1 hour earlier)
 */
function isWithinScanHours(startHour = 9): boolean {
  // HKT = UTC+8
  const nowHKT = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const hour = nowHKT.getUTCHours(); // 0-23 in HKT
  return hour >= startHour && hour < 21; // startHour:00 to 20:59 HKT
}

/**
 * Returns the next scheduled scan time in HKT.
 * If currently within active hours, returns lastScanAt + 15 min.
 * If outside active hours, returns today/tomorrow 09:00 HKT.
 */
function getNextScanTime(lastScanAt: Date | null): Date {
  const nowMs = Date.now();
  const nowHKT = new Date(nowMs + 8 * 60 * 60 * 1000);
  const hourHKT = nowHKT.getUTCHours();
  const minHKT = nowHKT.getUTCMinutes();

  // If within active hours and we have a last scan, next is lastScan + 15 min
  if (isWithinScanHours() && lastScanAt) {
    const candidate = new Date(lastScanAt.getTime() + GMAIL_SCAN_INTERVAL_MS);
    if (candidate.getTime() > nowMs) return candidate;
    // If already overdue, next scan is now + small buffer
    return new Date(nowMs + 60_000);
  }

  // Outside active hours: next scan is 09:00 HKT today or tomorrow
  // Calculate today's 09:00 HKT as UTC
  const todayStart = new Date(nowHKT);
  todayStart.setUTCHours(9, 0, 0, 0); // 09:00 HKT = UTC+8 → UTC 01:00
  const todayNineAM_UTC = new Date(todayStart.getTime() - 8 * 60 * 60 * 1000);

  if (todayNineAM_UTC.getTime() > nowMs) {
    return todayNineAM_UTC; // today 09:00 HKT hasn't arrived yet
  }
  // Already past 09:00 HKT today (and we're in night window), so tomorrow 09:00
  return new Date(todayNineAM_UTC.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * Run a scheduled Freehunter job board scrape.
 * Only runs during active hours (09:00-21:00 HKT) to avoid unnecessary API calls.
 */
export async function runScheduledFreehunterScrape(): Promise<void> {
  await withSchedulerLock("fh-scrape", 14 * 60 * 1000, async () => {
  if (!isWithinScanHours(8)) {
    console.log("[Scheduler] Freehunter scrape skipped (outside active hours 08:00-21:00 HKT)");
    return;
  }

  console.log("[Scheduler] Starting scheduled Freehunter job board scrape...");
  try {
    // Wrap with a 12-minute global timeout to prevent the scraper from hanging
    // and blocking the scheduler indefinitely (e.g. Playwright browser stuck on login)
    const SCRAPE_TIMEOUT_MS = 12 * 60 * 1000;
    const result = await Promise.race([
      scrapeFreehunterBoard(true, 20),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Freehunter scrape timed out after 12 minutes")), SCRAPE_TIMEOUT_MS)
      ),
    ]);
    await recordFreehunterScrapeResult({
      ok: true,
      newJobs: result.newJobs,
      emailsFetched: result.emailsFetched,
    });
    const autoSent = result.autoEmailsSent ?? 0;
    console.log(`[Scheduler] Freehunter scrape done: ${result.newJobs} new jobs, ${result.emailsFetched} emails fetched, ${autoSent} auto emails sent`);

    if (result.newJobs > 0 || autoSent > 0) {
      try {
        // Build notification content
        const parts: string[] = [];
        if (result.newJobs > 0) {
          parts.push(`💼 發現 ${result.newJobs} 個新工作`);
        }
        if (result.emailsFetched > 0) {
          parts.push(`📧 取得 ${result.emailsFetched} 個客戶電郵`);
        }
        if (autoSent > 0) {
          parts.push(`✅ AI 自動回覆 ${autoSent} 個高信心工作`);
        }

        const title = autoSent > 0
          ? `🤖 FH 自動化：已回覆 ${autoSent} 個高信心工作`
          : `🎯 FreelanceHunter 新工作 (${result.newJobs} 個)`;

        const content = [
          parts.join(", "),
          autoSent > 0 ? `AI 信心 ≥ 80% 的工作已自動取得電郵並發送第一封詢價郵件。` : "",
          `請前往「FH 工作板」頁面查看詳情。`,
        ].filter(Boolean).join("\n");

        await notifyOwner({ title, content });
      } catch (_) {
        // notification failure is non-critical
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Scheduler] Freehunter scrape error:", err);
    await recordFreehunterScrapeResult({ ok: false, error: msg });
    // Free the mutex early so the next 15-min tick (or Heartbeat) can retry
    await releaseLock("fh-scrape").catch(() => {});
  }
  }); // end withSchedulerLock("fh-scrape")
}

/**
 * Run a Gmail scan and notify owner if new inquiries are found.
 */
export async function runScheduledGmailScan(): Promise<void> {
  await withSchedulerLock("gmail-scan", 25 * 60 * 1000, async () => {
  if (!isWithinScanHours()) {
    console.log("[Scheduler] Gmail scan skipped (outside active hours 09:00-21:00 HKT)");
    return;
  }

  console.log("[Scheduler] Starting scheduled Gmail scan...");
  try {
    const result = await runEmailScan(30);
    lastGmailScanAt = new Date();
    lastGmailScanResult = { scanned: result.scanned, newInquiries: result.newInquiries };
    console.log(`[Scheduler] Gmail scan done: ${result.scanned} scanned, ${result.newInquiries} new, ${result.skipped} skipped`);

    if (result.newInquiries > 0) {
      try {
        await notifyOwner({
          title: `📧 新詢價郵件 (${result.newInquiries} 封)`,
          content: `Gmail 自動掃描發現 ${result.newInquiries} 封新詢價郵件，共掃描 ${result.scanned} 封。請前往「詢價郵件」頁面查看詳情。`,
        });
      } catch (_) {
        // notification failure is non-critical
      }
    }
  } catch (err) {
    console.error("[Scheduler] Gmail scan error:", err);
  }
  }); // end withSchedulerLock("gmail-scan")
}

/**
 * Auto-backfill: find jobs that still need first-email handling:
 * - status=new with no email → fetch email (+ auto-send if AI ≥ 80)
 * - status=email_fetched with AI ≥ 80 and email present → retry send (stuck after failed auto-send)
 * Always creates an email_inquiries row before sending so FH follow-ups can fire later.
 */
export async function runFHHighConfidenceBackfill(): Promise<void> {
  await withSchedulerLock("fh-backfill", 55 * 60 * 1000, async () => {
  if (!isWithinScanHours(8)) {
    return; // Only run during 08:00-21:00 HKT
  }

  try {
    const db = await getDb();
    if (!db) return;

    // Include stuck email_fetched high-confidence jobs so failed auto-sends get retried
    const pendingJobs = await db
      .select()
      .from(freehunterJobs)
      .where(
        sql`(
          (${freehunterJobs.status} = 'new' AND (${freehunterJobs.clientEmail} IS NULL OR ${freehunterJobs.clientEmail} = ''))
          OR (${freehunterJobs.status} = 'email_fetched' AND ${freehunterJobs.aiScore} >= 80
              AND ${freehunterJobs.clientEmail} IS NOT NULL AND ${freehunterJobs.clientEmail} != '')
        )`
      )
      .orderBy(desc(freehunterJobs.aiScore))
      .limit(10);

    if (pendingJobs.length === 0) {
      console.log("[Scheduler] FH backfill: no pending jobs without email.");
      return;
    }

    console.log(`[Scheduler] FH backfill: ${pendingJobs.length} job(s) to process.`);
    let fetched = 0;
    let sent = 0;

    for (const job of pendingJobs) {
      try {
        await new Promise((r) => setTimeout(r, 1500)); // Rate limit

        let email = job.clientEmail || "";
        if (!email) {
          const fetchedEmail = await fetchEmailForJob(job.jobId);
          if (!fetchedEmail) continue;
          email = fetchedEmail;
          fetched++;
        } else {
          fetched++;
        }

        const isHighConfidence = (job.aiScore ?? 0) >= 80;
        if (!isHighConfidence) {
          console.log(`[Scheduler] FH backfill: fetched email for job ${job.jobId} (score: ${job.aiScore}, low-confidence, manual review needed)`);
          continue;
        }

        // Create tracking inquiry so follow-ups can find this job later
        let fhInquiryId: number | undefined;
        try {
          const gmailMessageId = `fh-backfill-${job.jobId}-${Date.now()}`;
          const replyTrackingId = `fh-${job.jobId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const inquiry = await createEmailInquiry({
            gmailMessageId,
            fromEmail: email,
            fromName: job.clientName || "FreelanceHunter 客戶",
            subject: job.title,
            bodyText: job.description || "",
            receivedAt: job.postedAt || new Date(),
            aiConfidence: "high",
            externalLink: job.jobUrl,
            status: "pending_send",
            fhJobId: job.id,
            replyTrackingId,
          } as any);
          fhInquiryId = inquiry?.id;
        } catch (inquiryErr) {
          console.warn(`[Scheduler] FH backfill: failed to create inquiry for job ${job.jobId}:`, inquiryErr);
        }

        const sendResult = await sendFHFirstEmail(
          email,
          job.clientName || "",
          job.title || "",
          fhInquiryId,
          job.description || ""
        );
        if (sendResult.success) {
          sent++;
          await db
            .update(freehunterJobs)
            .set({ status: "first_email_sent", firstEmailSentAt: new Date(), updatedAt: new Date() })
            .where(eq(freehunterJobs.jobId, job.jobId));
          if (fhInquiryId) {
            await db
              .update(emailInquiries)
              .set({ status: "pending" })
              .where(eq(emailInquiries.id, fhInquiryId));
          }
          console.log(`[Scheduler] FH backfill: auto-sent email to ${email} for job ${job.jobId} (score: ${job.aiScore}, inquiryId: ${fhInquiryId})`);
        } else if (fhInquiryId) {
          // Keep job as email_fetched for retry; drop orphan tracking row
          await db.delete(emailInquiries).where(eq(emailInquiries.id, fhInquiryId));
          if (job.status === "new") {
            await db
              .update(freehunterJobs)
              .set({ status: "email_fetched", clientEmail: email, updatedAt: new Date() })
              .where(eq(freehunterJobs.jobId, job.jobId));
          }
          console.warn(`[Scheduler] FH backfill: send failed for job ${job.jobId}, left as email_fetched for retry`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[Scheduler] FH backfill: failed for job ${job.jobId}:`, msg);
        if (msg.includes('登入失敗') || msg.includes('Login') || msg.includes('session expired')) {
          break;
        }
      }
    }

    if (fetched > 0) {
      try {
        await notifyOwner({
          title: `🤖 FH 自動補跑：取得 ${fetched} 個電郵，發送 ${sent} 封郵件`,
          content: `補跑處理 ${pendingJobs.length} 個工作，成功取得／重試 ${fetched} 個電郵。其中 ${sent} 個高信心工作已自動發送第一封郵件。`,
        });
      } catch (_) {}
    }
  } catch (err) {
    console.error("[Scheduler] FH high-confidence backfill error:", err);
  }
  }); // end withSchedulerLock("fh-backfill")
}

/**
 * Check for FH jobs that need a 24-hour follow-up email and send them.
 * Runs every hour alongside the ad platform sync check.
 */
export async function runFHFollowUpEmails(): Promise<void> {
  await withSchedulerLock("fh-followup", 55 * 60 * 1000, async () => {
  try {
    const pending = await getFHJobsPendingFollowUp();
    if (pending.length === 0) {
      console.log("[Scheduler] FH follow-up check: no pending follow-ups.");
      return;
    }

    console.log(`[Scheduler] FH follow-up: ${pending.length} job(s) eligible for follow-up email.`);
    let sent = 0;
    let failed = 0;

    for (const job of pending) {
      try {
        // Send email FIRST, then mark as sent only if successful
        // (Reversed from previous logic to prevent ghost "sent" status on failure)
        const result = await sendFHFollowUpEmail(
          job.clientEmail,
          job.clientName ?? "",
          job.jobTitle ?? "Photography/Video Service",
          job.inquiryId,
          job.jobDescription ?? undefined
        );
        if (result.success) {
          // Only mark as sent AFTER confirmed delivery
          await markFollowUpSent(job.inquiryId);
          sent++;
          console.log(`[Scheduler] FH follow-up sent to ${job.clientEmail} (inquiryId: ${job.inquiryId})`);
        } else {
          failed++;
          const errMsg = `Send returned failure (no error thrown)`;
          // Reset sentinel and increment retry count so the next scheduler run can retry
          await resetFollowUpSentinel(job.inquiryId, errMsg).catch(() => {});
          console.error(`[Scheduler] FH follow-up send failed for ${job.clientEmail} (inquiryId: ${job.inquiryId})`);
        }
      } catch (err) {
        failed++;
        const errMsg = err instanceof Error ? err.message : String(err);
        // Reset sentinel and increment retry count so the next scheduler run can retry
        await resetFollowUpSentinel(job.inquiryId, errMsg).catch(() => {});
        console.error(`[Scheduler] FH follow-up failed for inquiryId ${job.inquiryId}:`, err);
      }
    }

    if (sent > 0) {
      try {
        await notifyOwner({
          title: `📬 FH 跟進郵件已自動發送 (${sent} 封)`,
          content: `系統已自動向 ${sent} 個 24 小時未回覆的 FreelanceHunter 客戶發送跟進郵件。${failed > 0 ? `\n⚠️ ${failed} 封發送失敗，請前往 FH 工作板查看。` : ""}`,
        });
      } catch (_) {
        // notification failure is non-critical
      }
    }
  } catch (err) {
    console.error("[Scheduler] FH follow-up check error:", err);
  }
  }); // end withSchedulerLock("fh-followup")
}

/**
 * Run the PRO360 sync job directly (no HTTP context required).
 */
async function runPro360Sync(): Promise<void> {
  const platform = "360pro" as const;
  console.log("[Scheduler] Starting PRO360 auto-sync...");

  try {
    const cookiesJson = await getPro360Cookies();
    if (!cookiesJson) {
      console.warn("[Scheduler] PRO360 session cookies not set, skipping auto-sync.");
      return;
    }

    await updateAdPlatformSyncStatus(platform, "syncing");

    const currentYear = new Date().getFullYear();
    const result = await scrapePro360WithCookies(cookiesJson, currentYear);

    if (!result.success) {
      await updateAdPlatformSyncStatus(platform, "error", result.error);
      await createAdSyncLog({
        platform,
        status: "error",
        message: `[自動排程] ${result.error || "同步失敗"}`,
        recordsUpdated: 0,
      });
      console.error("[Scheduler] PRO360 auto-sync failed:", result.error);

      try {
        await notifyOwner({
          title: "PRO360 自動同步失敗",
          content: `定期同步任務執行失敗：${result.error || "未知錯誤"}。請前往「平台同步」頁面手動檢查帳號設定。`,
        });
      } catch (_) {}
      return;
    }

    if (result.refreshedCookies) {
      try {
        await savePro360Cookies(result.refreshedCookies);
        console.log("[Scheduler] ✅ PRO360 session cookies auto-renewed successfully.");
      } catch (e) {
        console.warn("[Scheduler] Failed to save refreshed cookies:", e);
      }
    }

    let recordsUpdated = 0;
    for (const expense of result.expenses) {
      const [expYear, expMonth] = expense.month.split("-").map(Number);
      if (expYear && expMonth) {
        await upsertAdExpense({
          platform,
          year: expYear,
          month: expMonth,
          amount: String(expense.amount),
          refundAmount: String(expense.refundAmount ?? 0),
          currency: expense.currency,
          isAutoSynced: 1,
        });
        recordsUpdated++;
      }
    }

    // Save individual transactions
    if (result.transactions && result.transactions.length > 0) {
      try {
        await deleteAdTransactionsByPlatform(platform);
        for (const tx of result.transactions) {
          await upsertAdTransaction({ ...tx, platform: tx.platform as "hellotoby" | "360pro" | "freehunter" | "google_ads" });
        }
        console.log(`[Scheduler] ✅ Saved ${result.transactions.length} individual transactions for ${platform}`);
      } catch (e) {
        console.warn(`[Scheduler] Failed to save transactions for ${platform}:`, e);
      }
    }

    await updateAdPlatformSyncStatus(platform, "success");
    await createAdSyncLog({
      platform,
      status: "success",
      message: `[自動排程] 成功同步 ${recordsUpdated} 筆記錄`,
      recordsUpdated,
    });

    console.log(`[Scheduler] PRO360 auto-sync completed: ${recordsUpdated} records updated.`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "未知錯誤";
    await updateAdPlatformSyncStatus("360pro", "error", errMsg).catch(() => {});
    await createAdSyncLog({
      platform: "360pro",
      status: "error",
      message: `[自動排程] ${errMsg}`,
      recordsUpdated: 0,
    }).catch(() => {});
    console.error("[Scheduler] PRO360 auto-sync error:", errMsg);
  }
}

/**
 * Run the Google Ads sync job directly (no HTTP context required).
 * Syncs current year's monthly cost data.
 */
async function runGoogleAdsSync(): Promise<void> {
  const platform = "google_ads" as const;
  console.log("[Scheduler] Starting Google Ads auto-sync...");

  try {
    await updateAdPlatformSyncStatus(platform, "syncing");

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    let recordsUpdated = 0;

    for (let m = 1; m <= currentMonth; m++) {
      const startDate = `${currentYear}-${String(m).padStart(2, "0")}-01`;
      const lastDay = new Date(currentYear, m, 0).getDate();
      const endDate = `${currentYear}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      const summaries = await fetchGoogleAdsCosts(startDate, endDate);
      const totalCostHKD = summaries.reduce((sum, s) => sum + s.totalCostHKD, 0);

      if (totalCostHKD > 0) {
        await upsertAdExpense({
          platform,
          year: currentYear,
          month: m,
          amount: String(Math.round(totalCostHKD * 100) / 100),
          currency: "HKD",
          isAutoSynced: 1,
        });
        recordsUpdated++;
      }
    }

    await updateAdPlatformSyncStatus(platform, "success");
    await createAdSyncLog({
      platform,
      status: "success",
      message: `[自動排程] 成功同步 ${recordsUpdated} 個月份的 Google Ads 費用`,
      recordsUpdated,
    });

    console.log(`[Scheduler] Google Ads auto-sync completed: ${recordsUpdated} months updated.`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "未知錯誤";
    // Provide a clearer message for expired token
    const userMsg = errMsg.includes("invalid_grant") || errMsg.includes("Bad Request")
      ? "授權 Token 已過期，請前往「廣告同步」頁面點擊「立即重新授權 Google Ads」按鈕重新授權。"
      : errMsg;
    await updateAdPlatformSyncStatus("google_ads", "error", userMsg).catch(() => {});
    await createAdSyncLog({
      platform: "google_ads",
      status: "error",
      message: `[自動排程] ${userMsg}`,
      recordsUpdated: 0,
    }).catch(() => {});
    console.error("[Scheduler] Google Ads auto-sync error:", userMsg);
  }
}

/**
 * Run the HelloToby sync job directly (no HTTP context required).
 */
async function runHelloTobySync(): Promise<void> {
  const platform = "hellotoby" as const;
  console.log("[Scheduler] Starting HelloToby auto-sync...");

  try {
    const cookiesJson = await getHelloTobyCookies();
    if (!cookiesJson) {
      console.warn("[Scheduler] HelloToby session cookies not set, skipping auto-sync.");
      return;
    }

    await updateAdPlatformSyncStatus(platform, "syncing");

    const result = await scrapeHelloTobyViaAPI(cookiesJson);

    if (!result.success) {
      await updateAdPlatformSyncStatus(platform, "error", result.error);
      await createAdSyncLog({
        platform,
        status: "error",
        message: `[自動排程] ${result.error || "同步失敗"}`,
        recordsUpdated: 0,
      });
      console.error("[Scheduler] HelloToby auto-sync failed:", result.error);

      try {
        await notifyOwner({
          title: "HelloToby 自動同步失敗",
          content: `定期同步任務執行失敗：${result.error || "未知錯誤"}。請前往「平台同步」頁面手動檢查帳號設定。`,
        });
      } catch (_) {}
      return;
    }

    if (result.refreshedCookies) {
      try {
        await saveHelloTobyCookies(result.refreshedCookies);
        console.log("[Scheduler] ✅ HelloToby session cookies auto-renewed successfully.");
      } catch (e) {
        console.warn("[Scheduler] Failed to save refreshed cookies:", e);
      }
    }

    let recordsUpdated = 0;
    if (result.expenses) {
      for (const expense of result.expenses) {
        const [expYear, expMonth] = expense.month.split("-").map(Number);
        if (expYear && expMonth) {
          await upsertAdExpense({
            platform,
            year: expYear,
            month: expMonth,
            amount: String(expense.amount),
            refundAmount: String(expense.refundAmount ?? 0),
            currency: expense.currency,
            isAutoSynced: 1,
          });
          recordsUpdated++;
        }
      }
    }

    // Save individual transactions
    if (result.transactions && result.transactions.length > 0) {
      try {
        await deleteAdTransactionsByPlatform(platform);
        for (const tx of result.transactions) {
          await upsertAdTransaction({ ...tx, platform: tx.platform as "hellotoby" | "360pro" | "freehunter" | "google_ads" });
        }
        console.log(`[Scheduler] ✅ Saved ${result.transactions.length} individual transactions for ${platform}`);
      } catch (e) {
        console.warn(`[Scheduler] Failed to save transactions for ${platform}:`, e);
      }
    }

    await updateAdPlatformSyncStatus(platform, "success");
    await createAdSyncLog({
      platform,
      status: "success",
      message: `[自動排程] 成功同步 ${recordsUpdated} 筆記錄`,
      recordsUpdated,
    });

    console.log(`[Scheduler] HelloToby auto-sync completed: ${recordsUpdated} records updated.`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "未知錯誤";
    await updateAdPlatformSyncStatus("hellotoby", "error", errMsg).catch(() => {});
    await createAdSyncLog({
      platform: "hellotoby",
      status: "error",
      message: `[自動排程] ${errMsg}`,
      recordsUpdated: 0,
    }).catch(() => {});
    console.error("[Scheduler] HelloToby auto-sync error:", errMsg);
  }
}

/**
 * Send Google review invitation emails to clients 3 days after shooting.
 */
async function runReviewInviteEmails(): Promise<void> {
  await withSchedulerLock("review-invites", 55 * 60 * 1000, async () => {
  try {
    const pending = await getQuotesPendingReviewEmail();
    if (pending.length === 0) {
      console.log("[Scheduler] Review invite check: no pending review invites.");
      return;
    }
    console.log(`[Scheduler] Review invite: ${pending.length} quote(s) eligible for Google review invite.`);
    let sent = 0;
    let failed = 0;
    for (const quote of pending) {
      try {
        const clientName = quote.clientName || "您";
        const serviceTypeMap: Record<string, string> = {
          corporate_event: "企業活動攝影",
          product: "產品攝影",
          food_beverage: "飲食攝影",
          jewelry: "珠寶攝影",
          artwork: "藝術品攝影",
          interior: "室內攝影",
          video_production: "影片製作",
          graphic_design: "平面設計",
          ad_video: "廣告影片",
          web_development: "網頁開發",
          ai_photography: "AI 攝影",
          menu_design: "餐牌設計",
          other: "攝影服務",
        };
        const serviceLabel = serviceTypeMap[quote.serviceType] || "攝影服務";
        const result = await sendEmail({
          to: quote.clientEmail!,
          subject: `感謝您選擇 JD Studio — 歡迎留下您的評價 ⭐`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
              <h2 style="color: #1a1a1a;">感謝您選擇 JD Studio！</h2>
              <p>親愛的 ${clientName}，</p>
              <p>非常感謝您選擇 JD Studio 為您提供<strong>${serviceLabel}</strong>服務。希望您對我們的服務感到滿意！</p>
              <p>如果您有時間，歡迎在 Google 上留下您的評價，這對我們非常重要，也能幫助更多客戶了解我們的服務：</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="https://www.google.com/maps/place/JD+Studio/@22.3360662,114.1980294,17z/data=!4m8!3m7!1s0x34040714d8082109:0x60cb3968ea99b2e6!8m2!3d22.3360662!4d114.1980294!9m1!1b1!16s%2Fg%2F11x8hbsvg7?entry=ttu&g_ep=EgoyMDI2MDMyNC4wIKXMDSoASAFQAw%3D%3D" 
                   style="background-color: #4285F4; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: bold;">
                  ⭐ 立即留下評價
                </a>
              </div>
              <p style="color: #666; font-size: 14px;">只需 1 分鐘，您的評價對我們意義重大。感謝您的支持！</p>
              <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
              <p style="color: #999; font-size: 12px;">JD Studio | 專業攝影及影片製作</p>
            </div>
          `,
        });
        if (result.success) {
          await markReviewEmailSent(quote.id);
          sent++;
          console.log(`[Scheduler] Review invite sent to ${quote.clientEmail} (quoteId: ${quote.id})`);
        } else {
          failed++;
          await resetReviewEmailSentinel(quote.id).catch(() => {});
          console.error(`[Scheduler] Review invite failed for quoteId ${quote.id}:`, result.error);
        }
      } catch (err) {
        failed++;
        await resetReviewEmailSentinel(quote.id).catch(() => {});
        console.error(`[Scheduler] Review invite error for quoteId ${quote.id}:`, err);
      }
    }
    if (sent > 0) {
      try {
        await notifyOwner({
          title: `⭐ Google 評價邀請已自動發送 (${sent} 封)`,
          content: `系統已自動向 ${sent} 位拍攝當天晚上 8 點後的客戶發送 Google 評價邀請郵件。${failed > 0 ? `\n⚠️ ${failed} 封發送失敗。` : ""}`,
        });
      } catch (_) {}
    }
  } catch (err) {
    console.error("[Scheduler] Review invite check error:", err);
  }
  }); // end withSchedulerLock("review-invites")
}

/**
 * Run loyalty remarketing emails for B2B corporate clients.
 * Currently active: seasonal (CNY/summer/year-end) + winback (12 months idle).
 * day90/day180/anniversary helpers exist in db.ts but are not sent yet.
 */
export async function runScheduledLoyaltyRemarketing(): Promise<void> {
  await withSchedulerLock("loyalty-remarketing", 55 * 60 * 1000, async () => {
  try {
    const TIER_DISCOUNT: Record<string, number> = { silver: 5, golden: 8, diamond: 12, black_diamond: 12 };
    const tierLabel: Record<string, string> = {
      silver: "銀鏡 Silver Lens",
      golden: "金鏡 Golden Lens",
      diamond: "鑽石鏡 Diamond Lens",
      black_diamond: "黑鑽石鏡 Black Diamond Lens",
    };


    // ── 季節性業務提醒（1月/6月/11月 首週）──
    const seasonalList = await getClientsForSeasonalEmail();
    const nowDate = new Date();
    const nowMonth = nowDate.getMonth() + 1;
    const waLink = `<a href="${buildWaTrackUrl("loyalty_seasonal")}" style="color:#d4a843;text-decoration:none">WhatsApp Derek 91531976</a>`;
    const seasonSubject = nowMonth === 1
      ? `新年將至 先預留拍攝檔期`
      : nowMonth === 6
      ? `下半年計劃拍攝 現在是好時機`
      : `年底前有拍攝需要嗎`;
    if (seasonalList.length > 0) {
      console.log(`[Scheduler] Loyalty seasonal: ${seasonalList.length} client(s) in window (month=${nowMonth})`);
    }
    for (const c of seasonalList) {
      if (!c.clientEmail || !c.clientId) continue;
      const membership = await getClientMembership(c.clientId);
      const tier = membership?.tier ?? "silver";
      const discount = TIER_DISCOUNT[tier] ?? 5;
      const seasonType = nowMonth === 1 ? "seasonal_cny" : nowMonth === 6 ? "seasonal_summer" : "seasonal_yearend";
      // Build per-client body with correct client name
      const clientName = c.clientName ?? "";
      const perClientBody = nowMonth === 1
        ? `<p>${clientName} 你好</p><p>農曆新年快到 相信各公司都開始籌備新一年的宣傳物料</p><p>如有需要更新形象照 產品照或拍攝新年宣傳短片 歡迎盡早聯絡我們預留檔期 農曆新年前後的日子通常比較快滿</p>`
        : nowMonth === 6
        ? `<p>${clientName} 你好</p><p>轉眼已到年中 不少公司都在這個時候更新品牌影像 為下半年的推廣做好準備</p><p>如有形象照 產品照或影片的拍攝需求 歡迎聯絡我們安排</p>`
        : `<p>${clientName} 你好</p><p>年底將至 是時候為今年的業務成果留個記錄 或為明年的宣傳物料提早準備</p><p>無論是公司活動攝影 產品照更新 還是年終宣傳短片 我們都可以協助安排</p>`;
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333">
          <div style="background:#1a1a1a;padding:24px;text-align:center">
            <h1 style="color:#d4a843;font-family:Georgia,serif;font-weight:300;letter-spacing:4px;margin:0">JD STUDIO</h1>
          </div>
          <div style="padding:32px 24px">
            ${perClientBody}
            <div style="background:#f9f5ec;border-left:3px solid #d4a843;padding:16px;margin:20px 0">
              <p style="margin:0;font-weight:bold;color:#1a1a1a">${tierLabel[tier] ?? tier} 專屬回頭客優惠</p>
              <p style="margin:8px 0 0;color:#d4a843;font-size:20px;font-weight:bold">${discount}% 折扣</p>
              <p style="margin:4px 0 0;color:#666;font-size:12px">限期14天</p>
            </div>
            <p>作為我們的長期客戶 你可以享有以上的回頭客優惠</p>
            <p>如有任何查詢 隨時 ${waLink} 或回覆此郵件聯絡我們</p>
            <p style="color:#999;font-size:12px;margin-top:24px">JD Studio HK | 專業攝影及影片製作</p>
          </div>
        </div>
      `;
      const result = await sendEmail({ to: c.clientEmail, subject: seasonSubject, html });
      if (result.success) {
        await recordLoyaltyEmail({ clientId: c.clientId, emailType: seasonType as any, sentAt: new Date() });
        console.log(`[Scheduler] Seasonal (${seasonType}) email sent to ${c.clientEmail}`);
      }
    }

    // ── 長期未合作喚回郵件（12 個月未成交）──
    const winbackList = await getClientsForWinbackEmail();
    if (winbackList.length > 0) {
      console.log(`[Scheduler] Loyalty winback: ${winbackList.length} client(s)`);
    }
    const waLinkWinback = `<a href="${buildWaTrackUrl("loyalty_winback")}" style="color:#d4a843;text-decoration:none">WhatsApp Derek 91531976</a>`;
    for (const c of winbackList) {
      if (!c.clientEmail || !c.clientId) continue;
      const clientName = c.clientName ?? "";
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333">
          <div style="background:#1a1a1a;padding:24px;text-align:center">
            <h1 style="color:#d4a843;font-family:Georgia,serif;font-weight:300;letter-spacing:4px;margin:0">JD STUDIO</h1>
          </div>
          <div style="padding:32px 24px">
            <p>${clientName} 你好</p>
            <p>距離上次合作已超過一年 感謝你過去對 JD Studio 的支持</p>
            <p>不知貴公司近況如何 如果有任何攝影或影片製作需求 我們很樂意再次為你服務</p>
            <div style="background:#f9f5ec;border-left:3px solid #d4a843;padding:16px;margin:20px 0">
              <p style="margin:0;font-weight:bold;color:#1a1a1a">久違再合作專屬優惠</p>
              <p style="margin:8px 0 0;color:#d4a843;font-size:20px;font-weight:bold">10% 折扣</p>
              <p style="margin:4px 0 0;color:#666;font-size:12px">限期30天</p>
            </div>
            <p>期待再次與你合作</p>
            <p>如有任何查詢 隨時 ${waLinkWinback} 或回覆此郵件聯絡我們</p>
            <p style="color:#999;font-size:12px;margin-top:24px">JD Studio HK | 專業攝影及影片製作</p>
          </div>
        </div>
      `;
      const result = await sendEmail({ to: c.clientEmail, subject: `好久不見 有任何拍攝需要嗎`, html });
      if (result.success) {
        await recordLoyaltyEmail({ clientId: c.clientId, emailType: "winback" as any, sentAt: new Date() });
        console.log(`[Scheduler] Winback email sent to ${c.clientEmail}`);
      }
    }
  } catch (err) {
    console.error("[Scheduler] Loyalty remarketing email error:", err);
  }
  }); // end withSchedulerLock("loyalty-remarketing")
}

/**
 * Check if 7 days have elapsed since the last successful sync for each platform.
 */
async function checkAndSync(): Promise<void> {
  try {
    const [pro360Logs, htLogs, googleAdsLogs] = await Promise.all([
      getAdSyncLogs("360pro"),
      getAdSyncLogs("hellotoby"),
      getAdSyncLogs("google_ads"),
    ]);

    const lastPro360Sync = pro360Logs.find(
      (l) => l.status === "success" && l.message?.includes("[自動排程]")
    );
    const lastHtSync = htLogs.find(
      (l) => l.status === "success" && l.message?.includes("[自動排程]")
    );
    const lastGoogleAdsSync = googleAdsLogs.find(
      (l) => l.status === "success" && l.message?.includes("[自動排程]")
    );

    const now = Date.now();

    // PRO360: every 3 days (more frequent due to page scraping)
    const pro360LastTime = lastPro360Sync ? new Date(lastPro360Sync.syncedAt).getTime() : 0;
    const pro360Elapsed = now - pro360LastTime;
    if (pro360Elapsed >= THREE_DAYS_MS) {
      console.log(`[Scheduler] 3-day interval reached for PRO360. Running sync...`);
      await runPro360Sync();
    } else {
      const nextSyncMs = THREE_DAYS_MS - pro360Elapsed;
      const nextSyncDate = new Date(now + nextSyncMs);
      console.log(`[Scheduler] PRO360 next auto-sync in ${Math.round(nextSyncMs / 3600000)}h (${nextSyncDate.toLocaleString("zh-HK")})`);
    }

    const htLastTime = lastHtSync ? new Date(lastHtSync.syncedAt).getTime() : 0;
    const htElapsed = now - htLastTime;
    if (htElapsed >= SEVEN_DAYS_MS) {
      console.log(`[Scheduler] 7-day interval reached for HelloToby. Running sync...`);
      await runHelloTobySync();
    } else {
      const nextSyncMs = SEVEN_DAYS_MS - htElapsed;
      const nextSyncDate = new Date(now + nextSyncMs);
      console.log(`[Scheduler] HelloToby next auto-sync in ${Math.round(nextSyncMs / 3600000)}h (${nextSyncDate.toLocaleString("zh-HK")})`);
    }

    const googleAdsLastTime = lastGoogleAdsSync ? new Date(lastGoogleAdsSync.syncedAt).getTime() : 0;
    const googleAdsElapsed = now - googleAdsLastTime;
    if (googleAdsElapsed >= SEVEN_DAYS_MS) {
      console.log(`[Scheduler] 7-day interval reached for Google Ads. Running sync...`);
      await runGoogleAdsSync();
    } else {
      const nextSyncMs = SEVEN_DAYS_MS - googleAdsElapsed;
      const nextSyncDate = new Date(now + nextSyncMs);
      console.log(`[Scheduler] Google Ads next auto-sync in ${Math.round(nextSyncMs / 3600000)}h (${nextSyncDate.toLocaleString("zh-HK")})`);
    }
  } catch (err) {
    console.error("[Scheduler] checkAndSync error:", err);
  }
}

/**
 * Run a scheduled pitch outreach pipeline.
 * Only runs once per day at 10:00 HKT to avoid excessive API calls.
 */
export async function runScheduledPitchOutreach(): Promise<void> {
  await withSchedulerLock("pitch-outreach", 23 * 60 * 60 * 1000, async () => {
    // Only run during business hours (09:00-12:00 HKT)
    if (!isWithinScanHours(9)) {
      console.log("[Scheduler] Pitch outreach skipped (outside active hours 09:00-21:00 HKT)");
      return;
    }

    console.log("[Scheduler] Starting scheduled pitch outreach pipeline...");
    try {
      const result = await runOutreachPipeline(process.env.HUNTER_API_KEY);
      lastPitchOutreachAt = new Date();
      lastPitchOutreachResult = result;
      console.log(`[Scheduler] Pitch outreach done: ${result.scraped} scraped, ${result.saved ?? 0} new, ${result.skipped} expired`);

      if (result.scraped > 0 || (result.saved ?? 0) > 0 || result.skipped > 0) {
        try {
          await notifyOwner({
            title: `📡 客戶開拓：今日招聘線索已更新`,
            content: [
              `爬取職位：${result.scraped} 個`,
              `新增待跟進：${result.saved ?? 0} 個`,
              `過期已清理：${result.skipped} 個`,
              `請到「客戶開拓」用 LinkedIn 聯絡 HR／Hiring Manager（系統已停自動寄電郵）。`,
            ].join("\n"),
          });
        } catch (_) {
          // notification failure is non-critical
        }
      }
    } catch (err) {
      console.error("[Scheduler] Pitch outreach error:", err);
    }
  }); // end withSchedulerLock("pitch-outreach")
}

export async function runScheduledContentFactoryJob(): Promise<void> {
  await withSchedulerLock("linkedin-content-factory", 55 * 60 * 1000, async () => {
    await runScheduledContentFactory();
    // Daily publish nudge during business hours
    if (isWithinScanHours(9)) {
      await notifyDuePublishes();
    }
  });
}

/**
 * Start the background scheduler.
 * Call this once from server startup.
 */
export function startScheduler(): void {
  if (schedulerTimer) return; // already running

  console.log("[Scheduler] Background scheduler started. PRO360 sync every 3 days, HelloToby/Google Ads sync every 7 days, Gmail scan every 30 min, FH scrape every 15 min (09:00-21:00 HKT), Pitch Outreach daily (10:00 HKT), Loyalty remarketing hourly (seasonal + winback).");

  // On startup: reset any SENTINEL (1970-01-01) values left over from a previous server crash
  // This prevents follow-up emails from being permanently stuck if the server was killed mid-operation
  getDb().then(async (db) => {
    if (!db) return;
    try {
      // Match both string and Date forms of the SENTINEL across MySQL TZ modes
      const result = await db.execute(sql`
        UPDATE email_inquiries
        SET follow_up_sent_at = NULL,
            follow_up_retry_count = COALESCE(follow_up_retry_count, 0) + 1,
            follow_up_last_error = 'Reset on startup (server crash recovery)'
        WHERE follow_up_sent_at = ${new Date("1970-01-01T00:00:01.000Z")}
           OR follow_up_sent_at = '1970-01-01 00:00:01'
      `);
      const affected = (result as any)?.[0]?.affectedRows ?? 0;
      if (affected > 0) {
        console.log(`[Scheduler] Startup: reset ${affected} stuck SENTINEL follow-up record(s) from previous crash.`);
      }
    } catch (e) {
      console.error('[Scheduler] Startup SENTINEL cleanup failed:', e);
    }
  }).catch(console.error);

  // Initial checks after 30s startup delay
  setTimeout(() => {
    checkAndSync().catch(console.error);
    runScheduledGmailScan().catch(console.error);
    runFHFollowUpEmails().catch(console.error);
    runReviewInviteEmails().catch(console.error);
    runScheduledFreehunterScrape().catch(console.error); // also run FH scrape on startup
    runFHHighConfidenceBackfill().catch(console.error); // also run backfill on startup
    runQuoteFollowUps().catch(console.error); // check quote follow-ups on startup
    runScheduledPitchOutreach().catch(console.error); // check pitch outreach on startup
    runScheduledLoyaltyRemarketing().catch(console.error); // seasonal + winback
    runScheduledContentFactoryJob().catch(console.error); // LinkedIn content factory
  }, 30_000);

  // Ad platform sync + FH follow-up check + review invites + FH high-confidence backfill + watchdog + loyalty: every hour
  schedulerTimer = setInterval(() => {
    checkAndSync().catch(console.error);
    runFHFollowUpEmails().catch(console.error);
    runReviewInviteEmails().catch(console.error);
    runFHHighConfidenceBackfill().catch(console.error);
    runQuoteFollowUps().catch(console.error); // quote follow-up check every hour
    runWatchdog().catch(console.error); // system health watchdog every hour
    runScheduledLoyaltyRemarketing().catch(console.error); // seasonal + winback (windowed; lock + dedupe)
    runScheduledContentFactoryJob().catch(console.error);
  }, CHECK_INTERVAL_MS);

  // Gmail scan: every 30 minutes (with time-of-day guard inside)
  gmailScanTimer = setInterval(() => {
    runScheduledGmailScan().catch(console.error);
  }, GMAIL_SCAN_INTERVAL_MS);

  // Freehunter job board scrape: every 15 min (with time-of-day guard inside)
  freehunterScrapeTimer = setInterval(() => {
    runScheduledFreehunterScrape().catch(console.error);
  }, FREEHUNTER_SCRAPE_INTERVAL_MS);

  // Pitch outreach: every 24 hours (with time-of-day guard + scheduler lock inside)
  pitchOutreachTimer = setInterval(() => {
    runScheduledPitchOutreach().catch(console.error);
  }, PITCH_OUTREACH_INTERVAL_MS);
}

/**
 * Stop the background scheduler (used in tests / graceful shutdown).
 */
export function stopScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  if (gmailScanTimer) {
    clearInterval(gmailScanTimer);
    gmailScanTimer = null;
  }
  if (freehunterScrapeTimer) {
    clearInterval(freehunterScrapeTimer);
    freehunterScrapeTimer = null;
  }
  if (pitchOutreachTimer) {
    clearInterval(pitchOutreachTimer);
    pitchOutreachTimer = null;
  }
  console.log("[Scheduler] Background scheduler stopped.");
}

/**
 * Expose the next scheduled sync time for the frontend.
 */
export async function getSchedulerStatus(): Promise<{
  lastSyncAt: Date | null;
  nextSyncAt: Date | null;
  intervalDays: number;
  hellotoby?: { lastSyncAt: Date | null; nextSyncAt: Date | null };
  googleAds?: { lastSyncAt: Date | null; nextSyncAt: Date | null };
  gmail?: { lastScanAt: Date | null; nextScanAt: Date | null; withinActiveHours: boolean };
}> {
  const [pro360Logs, htLogs, googleAdsLogs] = await Promise.all([
    getAdSyncLogs("360pro"),
    getAdSyncLogs("hellotoby"),
    getAdSyncLogs("google_ads"),
  ]);

  const lastPro360Sync = pro360Logs.find(
    (l) => l.status === "success" && l.message?.includes("[自動排程]")
  );
  const lastHtSync = htLogs.find(
    (l) => l.status === "success" && l.message?.includes("[自動排程]")
  );
  const lastGoogleAdsSync = googleAdsLogs.find(
    (l) => l.status === "success" && l.message?.includes("[自動排程]")
  );

  const lastSyncAt = lastPro360Sync ? new Date(lastPro360Sync.syncedAt) : null;
  const nextSyncAt = lastSyncAt ? new Date(lastSyncAt.getTime() + SEVEN_DAYS_MS) : null;

  const htLastSyncAt = lastHtSync ? new Date(lastHtSync.syncedAt) : null;
  const htNextSyncAt = htLastSyncAt ? new Date(htLastSyncAt.getTime() + SEVEN_DAYS_MS) : null;

  const googleAdsLastSyncAt = lastGoogleAdsSync ? new Date(lastGoogleAdsSync.syncedAt) : null;
  const googleAdsNextSyncAt = googleAdsLastSyncAt ? new Date(googleAdsLastSyncAt.getTime() + SEVEN_DAYS_MS) : null;

  const gmailNextScanAt = getNextScanTime(lastGmailScanAt);

  return {
    lastSyncAt,
    nextSyncAt,
    intervalDays: 7,
    hellotoby: { lastSyncAt: htLastSyncAt, nextSyncAt: htNextSyncAt },
    googleAds: { lastSyncAt: googleAdsLastSyncAt, nextSyncAt: googleAdsNextSyncAt },
    gmail: {
      lastScanAt: lastGmailScanAt,
      nextScanAt: gmailNextScanAt,
      withinActiveHours: isWithinScanHours(),
    },
  };
}
