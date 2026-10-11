/**
 * Daily auto-exec for trusted campaign PHRASE negatives only.
 * Fail-closed: never touches SEO→Ads / RSA / budget paths.
 */
import { desc, eq } from "drizzle-orm";
import { buildTrustedServiceNegativeQueue } from "@shared/adsActionQueue";
import { ADS_GUARDRAILS, canAutoExecuteAdsAction } from "@shared/adsActionExecution";
import {
  TRUSTED_NEGATIVE_AUTO_ALERT_STREAK,
  TRUSTED_NEGATIVE_AUTO_DAILY_CAP,
  autoLaneHealthPct,
  buildTrustedNegativeAutoSummary,
  countConsecutiveAutoFailStreak,
  isTrustedNegativeAutoEnabled,
  isTrustedNegativeAutoRunFailed,
  nextTrustedNegativeAutoWindowHint,
  parseTrustedNegativeAutoSummary,
  shouldRunTrustedNegativeAuto,
  type TrustedNegativeAutoResultRow,
  type TrustedNegativeAutoRunSummary,
} from "@shared/trustedNegativeAuto";
import { adSyncLogs } from "../drizzle/schema";
import { notifyOwner } from "./_core/notification";
import { executeApprovedAdsAction } from "./adsActionExecutor";
import { getDb } from "./db";
import { withSchedulerLock } from "./schedulerLock";

const HUMAN_ALERT_COOLDOWN_MS = 12 * 60 * 60 * 1000;
let lastAutoFailAlertAt = 0;

async function loadExecutedTrustedIds(): Promise<Set<string>> {
  const db = await getDb();
  const done = new Set<string>();
  if (!db) return done;
  const rows = await db
    .select({ message: adSyncLogs.message })
    .from(adSyncLogs)
    .where(eq(adSyncLogs.platform, "google_ads"))
    .orderBy(desc(adSyncLogs.syncedAt))
    .limit(500);
  for (const row of rows) {
    try {
      const payload = row.message ? (JSON.parse(row.message) as { actionId?: string; state?: string }) : null;
      if (payload?.actionId?.startsWith("trusted-negative:") && payload.state === "executed") {
        done.add(payload.actionId);
      }
    } catch {
      /* legacy */
    }
  }
  return done;
}

async function loadRecentAutoRunSummaries(limit = 12): Promise<TrustedNegativeAutoRunSummary[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ message: adSyncLogs.message })
    .from(adSyncLogs)
    .where(eq(adSyncLogs.platform, "google_ads"))
    .orderBy(desc(adSyncLogs.syncedAt))
    .limit(120);
  const out: TrustedNegativeAutoRunSummary[] = [];
  for (const row of rows) {
    try {
      const payload = row.message ? JSON.parse(row.message) : null;
      const summary = parseTrustedNegativeAutoSummary(payload);
      if (summary) {
        out.push(summary);
        if (out.length >= limit) break;
      }
    } catch {
      /* legacy */
    }
  }
  return out;
}

async function loadLastAutoRunSummary(): Promise<TrustedNegativeAutoRunSummary | null> {
  const recent = await loadRecentAutoRunSummaries(1);
  return recent[0] ?? null;
}

async function persistAutoRunSummary(summary: TrustedNegativeAutoRunSummary): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(adSyncLogs).values({
    platform: "google_ads",
    status: summary.failed > 0 || summary.stoppedOn ? "error" : "success",
    message: JSON.stringify(summary),
    recordsUpdated: summary.succeeded,
  });
}

async function maybeAlertAutoFailStreak(
  summary: TrustedNegativeAutoRunSummary,
  failStreak: number
): Promise<void> {
  if (failStreak < TRUSTED_NEGATIVE_AUTO_ALERT_STREAK) return;
  if (!isTrustedNegativeAutoRunFailed(summary)) return;
  if (Date.now() - lastAutoFailAlertAt < HUMAN_ALERT_COOLDOWN_MS) {
    console.log("[TrustedNegativeAuto] human alert suppressed (cooldown)");
    return;
  }
  try {
    await notifyOwner({
      title: `Trusted negatives 自動線連續失敗 ×${failStreak}`,
      content: [
        summary.message,
        summary.stoppedOn ? `stoppedOn: ${summary.stoppedOn}` : null,
        "請到增長優先模型檢查 Ads API／權限，或手動 dry-run trusted negatives。",
        "監控台「今日唯一行動」已指向此問題。",
      ]
        .filter(Boolean)
        .join("\n"),
    });
    lastAutoFailAlertAt = Date.now();
    console.log("[TrustedNegativeAuto] human alert sent for fail streak", failStreak);
  } catch (e) {
    console.warn("[TrustedNegativeAuto] notifyOwner failed", e);
  }
}

export async function getLastTrustedNegativeAutoRun(): Promise<TrustedNegativeAutoRunSummary | null> {
  return loadLastAutoRunSummary();
}

export type TrustedNegativeAutoLaneStatus = {
  lastRun: TrustedNegativeAutoRunSummary | null;
  failStreak: number;
  autoLanePct: number | null;
  nextWindowHint: string;
};

export async function getTrustedNegativeAutoLaneStatus(
  nowMs = Date.now()
): Promise<TrustedNegativeAutoLaneStatus> {
  const recent = await loadRecentAutoRunSummaries(8);
  const lastRun = recent[0] ?? null;
  const failStreak = countConsecutiveAutoFailStreak(recent);
  return {
    lastRun,
    failStreak,
    autoLanePct: autoLaneHealthPct({ failStreak, lastRun }),
    nextWindowHint: nextTrustedNegativeAutoWindowHint(nowMs),
  };
}

export type TrustedNegativeAutoExecOutcome = {
  ran: boolean;
  skippedReason?: string;
  summary?: TrustedNegativeAutoRunSummary;
  failStreak?: number;
};

/**
 * Run pending trusted negatives (cap + fail-stop). Safe to call from scheduler.
 */
export async function runTrustedNegativeAutoExec(options?: {
  force?: boolean;
  nowMs?: number;
}): Promise<TrustedNegativeAutoExecOutcome> {
  const nowMs = options?.nowMs ?? Date.now();
  const enabled =
    ADS_GUARDRAILS.autoExecuteApprovedActions &&
    isTrustedNegativeAutoEnabled(process.env.TRUSTED_NEGATIVES_AUTO);

  if (!enabled) {
    return { ran: false, skippedReason: "auto-exec disabled (guardrail or TRUSTED_NEGATIVES_AUTO=0)" };
  }

  const last = await loadLastAutoRunSummary();
  if (
    !options?.force &&
    !shouldRunTrustedNegativeAuto({
      nowMs,
      lastAutoRunHktDate: last?.hktDate ?? null,
      enabled: true,
    })
  ) {
    return {
      ran: false,
      skippedReason: last?.hktDate
        ? `already ran HKT ${last.hktDate} or outside window`
        : "outside daily window (10:00–21:00 HKT)",
    };
  }

  const completed = await loadExecutedTrustedIds();
  const queue = buildTrustedServiceNegativeQueue().filter(
    (item) => item.id.startsWith("trusted-negative:") && canAutoExecuteAdsAction(item)
  );
  const pending = queue.filter((item) => !completed.has(item.id));
  const skippedAlreadyDone = queue.length - pending.length;
  const batch = pending.slice(0, TRUSTED_NEGATIVE_AUTO_DAILY_CAP);

  if (batch.length === 0) {
    const summary = buildTrustedNegativeAutoSummary({
      nowMs,
      attempted: [],
      results: [],
      skippedAlreadyDone,
      stoppedOn: null,
    });
    summary.message = `無待執行 trusted negatives（已完成跳過 ${skippedAlreadyDone}）`;
    await persistAutoRunSummary(summary);
    console.log("[TrustedNegativeAuto]", summary.message);
    return { ran: true, summary, failStreak: 0 };
  }

  const results: TrustedNegativeAutoResultRow[] = [];
  const attempted: string[] = [];
  let stoppedOn: string | null = null;

  for (const item of batch) {
    attempted.push(item.id);
    // Force approved status for server-side auto path (client approval is localStorage-only).
    const result = await executeApprovedAdsAction(
      { ...item, status: "approved" },
      { dryRunOnly: false }
    );
    results.push({
      actionId: result.actionId,
      state: result.state,
      mutationCount: result.mutationCount,
      message: result.message,
    });
    if (result.state === "failed" || result.state === "blocked") {
      stoppedOn = item.id;
      console.warn("[TrustedNegativeAuto] fail-stop on", item.id, result.state, result.message);
      break;
    }
  }

  const summary = buildTrustedNegativeAutoSummary({
    nowMs,
    attempted,
    results,
    skippedAlreadyDone,
    stoppedOn,
  });
  await persistAutoRunSummary(summary);

  const recent = await loadRecentAutoRunSummaries(8);
  const failStreak = countConsecutiveAutoFailStreak(recent);
  await maybeAlertAutoFailStreak(summary, failStreak);

  console.log("[TrustedNegativeAuto]", summary.message, `failStreak=${failStreak}`);
  return { ran: true, summary, failStreak };
}

/** Scheduler entry: lock + once-daily trusted negatives. */
export async function runScheduledTrustedNegatives(): Promise<void> {
  await withSchedulerLock("trusted-negatives-auto", 55 * 60 * 1000, async () => {
    await runTrustedNegativeAutoExec();
  });
}
