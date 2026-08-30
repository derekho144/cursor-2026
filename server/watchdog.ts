/**
 * System Watchdog & Self-Healing Module
 *
 * Runs every hour (triggered by Heartbeat fh-followup task) to:
 * 1. Detect common failure scenarios
 * 2. Auto-repair what it can
 * 3. Alert the owner when manual intervention is needed
 *
 * Failure scenarios covered:
 * A. FH jobs stuck in 'new' with no email > 2 hours → auto-backfill
 * B. FH session expired / invalid → alert owner to re-login
 * C. FH scrape stalled (no scrape in > 2 hours during active hours) → alert
 * D. Gmail scan stalled (no scan in > 90 min during active hours) → alert
 * E. Freehunter session expiry approaching (< 2 days) → auto-renew or alert
 */

import { notifyOwner } from "./_core/notification";
import { getDb } from "./db";
import { freehunterJobs } from "../drizzle/schema";
import { sql, desc } from "drizzle-orm";
import { getFreehunterStatus, renewFreehunterSessionExpiry } from "./freehunter";
import { scrapeFreehunterBoard, fetchEmailForJob } from "./scrapers/freehunterBoard";
import { sendFHFirstEmail } from "./routers/emailInquiries";
import { lastFreehunterScrapeAt, lastGmailScanAt } from "./scheduler";
import { withSchedulerLock } from "./schedulerLock";

// ─── Constants ────────────────────────────────────────────────────────────────

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const NINETY_MIN_MS = 90 * 60 * 1000;
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

// Track last watchdog run to avoid duplicate alerts within same hour
let lastWatchdogRunAt: Date | null = null;
let lastAlertSentAt: Date | null = null;
const ALERT_COOLDOWN_MS = 4 * 60 * 60 * 1000; // Don't re-alert same issue within 4 hours

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isWithinActiveHours(): boolean {
  const nowHKT = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const h = nowHKT.getUTCHours();
  return h >= 8 && h < 21;
}

function canSendAlert(): boolean {
  if (!lastAlertSentAt) return true;
  return Date.now() - lastAlertSentAt.getTime() > ALERT_COOLDOWN_MS;
}

async function sendAlert(title: string, content: string): Promise<void> {
  if (!canSendAlert()) {
    console.log(`[Watchdog] Alert suppressed (cooldown): ${title}`);
    return;
  }
  try {
    await notifyOwner({ title, content });
    lastAlertSentAt = new Date();
    console.log(`[Watchdog] Alert sent: ${title}`);
  } catch (e) {
    console.warn("[Watchdog] Failed to send alert:", e);
  }
}

// ─── Check A: FH jobs stuck without email ─────────────────────────────────────

async function checkAndRepairStuckFHJobs(): Promise<{ fixed: number; alerts: string[] }> {
  const alerts: string[] = [];
  let fixed = 0;

  try {
    const db = await getDb();
    if (!db) return { fixed, alerts };

    // Find jobs stuck in 'new' with no email for more than 2 hours
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
      console.log("[Watchdog] Check A: No stuck FH jobs found.");
      return { fixed, alerts };
    }

    console.log(`[Watchdog] Check A: ${stuckJobs.length} FH job(s) stuck without email. Attempting repair...`);

    for (const job of stuckJobs) {
      try {
        await new Promise((r) => setTimeout(r, 1500));
        const { email } = await fetchEmailForJob(job.jobId);
        if (email) {
          fixed++;
          const isHighConfidence = (job.aiScore ?? 0) >= 80;
          if (isHighConfidence) {
            const sendResult = await sendFHFirstEmail(email, job.clientName || "", job.title || "");
            if (sendResult.success) {
              const { eq } = await import("drizzle-orm");
              await db.update(freehunterJobs)
                .set({ status: "first_email_sent", firstEmailSentAt: new Date(), updatedAt: new Date() })
                .where(eq(freehunterJobs.jobId, job.jobId));
              console.log(`[Watchdog] Repaired + auto-sent: job ${job.jobId} (score: ${job.aiScore})`);
            }
          } else {
            console.log(`[Watchdog] Repaired email for job ${job.jobId} (score: ${job.aiScore}, awaiting manual review)`);
          }
        } else {
          alerts.push(`工作 #${job.jobId}「${(job.title || "").slice(0, 30)}」仍無法取得電郵`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[Watchdog] Repair failed for job ${job.jobId}:`, msg);
        if (msg.includes("登入失敗") || msg.includes("Login") || msg.includes("session expired")) {
          alerts.push("FH 登入失敗，session 可能已過期，請重新登入");
          break;
        }
        alerts.push(`工作 #${job.jobId} 修復失敗: ${msg.slice(0, 60)}`);
      }
    }
  } catch (e) {
    console.error("[Watchdog] Check A error:", e);
  }

  return { fixed, alerts };
}

// ─── Check B: FH session health ───────────────────────────────────────────────

async function checkFHSessionHealth(): Promise<{ ok: boolean; alerts: string[] }> {
  const alerts: string[] = [];

  try {
    const status = await getFreehunterStatus();

    if (!status.connected) {
      alerts.push("⚠️ Freehunter session 未連接，請前往系統設定重新登入");
      return { ok: false, alerts };
    }

    // Check if session is expiring soon (< 2 days)
    if (status.expiresAt) {
      const msUntilExpiry = status.expiresAt - Date.now();
      if (msUntilExpiry < TWO_DAYS_MS && msUntilExpiry > 0) {
        console.log("[Watchdog] Check B: FH session expiring soon, attempting renewal...");
        try {
          await renewFreehunterSessionExpiry();
          console.log("[Watchdog] FH session expiry renewed successfully.");
        } catch (e) {
          alerts.push(`⚠️ FH session 即將在 ${Math.round(msUntilExpiry / 3600000)} 小時後過期，自動更新失敗，請手動重新登入`);
        }
      } else if (msUntilExpiry <= 0) {
        alerts.push("❌ Freehunter session 已過期，請重新登入");
        return { ok: false, alerts };
      }
    }

    return { ok: true, alerts };
  } catch (e) {
    console.error("[Watchdog] Check B error:", e);
    return { ok: false, alerts: ["FH session 狀態檢查失敗"] };
  }
}

// ─── Check C: FH scrape staleness ─────────────────────────────────────────────

function checkFHScrapeStaleness(): { stale: boolean; alerts: string[] } {
  // Async persistence is checked in runWatchdog via getPersistedFreehunterScrapeStatus
  const alerts: string[] = [];

  if (!isWithinActiveHours()) return { stale: false, alerts };

  if (!lastFreehunterScrapeAt) {
    // Server just started — do not treat as stale yet (persisted check runs separately)
    return { stale: false, alerts };
  }

  const elapsed = Date.now() - lastFreehunterScrapeAt.getTime();
  if (elapsed > TWO_HOURS_MS) {
    const elapsedMin = Math.round(elapsed / 60000);
    alerts.push(`⚠️ FH 工作板已 ${elapsedMin} 分鐘未更新（正常應每 15–30 分鐘一次）`);
    return { stale: true, alerts };
  }

  return { stale: false, alerts };
}

// ─── Check D: Gmail scan staleness ────────────────────────────────────────────

function checkGmailScanStaleness(): { stale: boolean; alerts: string[] } {
  const alerts: string[] = [];

  if (!isWithinActiveHours()) return { stale: false, alerts };

  if (!lastGmailScanAt) {
    return { stale: false, alerts };
  }

  const elapsed = Date.now() - lastGmailScanAt.getTime();
  if (elapsed > NINETY_MIN_MS) {
    const elapsedMin = Math.round(elapsed / 60000);
    alerts.push(`⚠️ Gmail 掃描已 ${elapsedMin} 分鐘未執行（正常應每 30 分鐘一次）`);
    return { stale: true, alerts };
  }

  return { stale: false, alerts };
}

// ─── Main Watchdog Runner ─────────────────────────────────────────────────────

/**
 * Run all watchdog checks and self-repair routines.
 * Called every hour from the Heartbeat fh-followup endpoint.
 */
export async function runWatchdog(): Promise<void> {
  await withSchedulerLock("watchdog", 55 * 60 * 1000, async () => {
  const now = new Date();
  console.log(`[Watchdog] Starting health check at ${now.toISOString()}`);
  lastWatchdogRunAt = now;

  const allAlerts: string[] = [];
  let totalFixed = 0;

  try {
    // Check A: Stuck FH jobs
    const { fixed, alerts: stuckAlerts } = await checkAndRepairStuckFHJobs();
    totalFixed += fixed;
    allAlerts.push(...stuckAlerts);

    // Check B: FH session health
    const { ok: sessionOk, alerts: sessionAlerts } = await checkFHSessionHealth();
    allAlerts.push(...sessionAlerts);

    // Check C: FH scrape staleness (only alert if session is OK — stale scrape with bad session is expected)
    if (sessionOk) {
      const { alerts: scrapeAlerts } = checkFHScrapeStaleness();
      allAlerts.push(...scrapeAlerts);

      // Also check persisted status (survives cold start when in-memory stamp is null)
      try {
        const { getPersistedFreehunterScrapeStatus } = await import("./scheduler");
        const persisted = await getPersistedFreehunterScrapeStatus();
        if (persisted.at) {
          const age = Date.now() - persisted.at.getTime();
          if (age > TWO_HOURS_MS) {
            const elapsedMin = Math.round(age / 60000);
            allAlerts.push(
              `⚠️ FH 持久化狀態顯示已 ${elapsedMin} 分鐘未成功爬取${persisted.raw ? `（${persisted.raw}）` : ""}`
            );
          } else if (persisted.ok === false) {
            allAlerts.push(`⚠️ FH 最近一次爬取失敗：${persisted.raw || "unknown"}`);
          }
        } else if (!lastFreehunterScrapeAt) {
          allAlerts.push("⚠️ FH 尚無成功爬取紀錄（Heartbeat / 排程可能未運行）");
        }
      } catch (_) {}
    }

    // Check D: Gmail scan staleness
    const { alerts: gmailAlerts } = checkGmailScanStaleness();
    allAlerts.push(...gmailAlerts);

    // Report results
    const parts: string[] = [];
    if (totalFixed > 0) parts.push(`✅ 自動修復 ${totalFixed} 個工作的電郵`);
    if (allAlerts.length > 0) parts.push(`⚠️ 發現 ${allAlerts.length} 個問題需要注意`);

    if (totalFixed > 0 || allAlerts.length > 0) {
      const title = allAlerts.length > 0
        ? `🔧 系統 Watchdog 警報 (${allAlerts.length} 個問題)`
        : `✅ Watchdog 自動修復完成 (${totalFixed} 個工作)`;

      const content = [
        parts.join("，"),
        "",
        ...(allAlerts.length > 0 ? ["**需要注意：**", ...allAlerts.map((a) => `• ${a}`)] : []),
        ...(totalFixed > 0 ? [`\n已自動補抓 ${totalFixed} 個工作的客戶電郵。`] : []),
        "\n請前往「FH 工作板」確認狀態。",
      ].join("\n");

      await sendAlert(title, content);
    } else {
      console.log("[Watchdog] All checks passed. System is healthy.");
    }
  } catch (e) {
    console.error("[Watchdog] Unexpected error:", e);
  }
  }); // end withSchedulerLock("watchdog")
}

/**
 * Expose watchdog status for frontend/admin display.
 */
export function getWatchdogStatus(): {
  lastRunAt: Date | null;
  lastAlertAt: Date | null;
} {
  return {
    lastRunAt: lastWatchdogRunAt,
    lastAlertAt: lastAlertSentAt,
  };
}
