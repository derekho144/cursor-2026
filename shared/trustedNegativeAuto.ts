/** Pure helpers for scheduled trusted-negative auto-execution. */

export const TRUSTED_NEGATIVE_AUTO_KIND = "trusted_negative_auto_run" as const;
export const TRUSTED_NEGATIVE_AUTO_DAILY_CAP = 3;

export type TrustedNegativeAutoResultRow = {
  actionId: string;
  state: string;
  mutationCount: number;
  message: string;
};

export type TrustedNegativeAutoRunSummary = {
  kind: typeof TRUSTED_NEGATIVE_AUTO_KIND;
  at: string;
  hktDate: string;
  attempted: string[];
  results: TrustedNegativeAutoResultRow[];
  succeeded: number;
  failed: number;
  skippedAlreadyDone: number;
  stoppedOn: string | null;
  cap: number;
  message: string;
};

export function hktDateStringFromMs(ms = Date.now()): string {
  return new Date(ms + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** HKT hour 10–20 inclusive start → once-daily window after 10:00. */
export function isTrustedNegativeAutoWindow(nowMs = Date.now()): boolean {
  const hour = new Date(nowMs + 8 * 60 * 60 * 1000).getUTCHours();
  return hour >= 10 && hour < 21;
}

export function isTrustedNegativeAutoEnabled(envValue?: string | null): boolean {
  const raw = (envValue ?? "").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
}

export function shouldRunTrustedNegativeAuto(opts: {
  nowMs?: number;
  lastAutoRunHktDate: string | null;
  enabled: boolean;
}): boolean {
  if (!opts.enabled) return false;
  const nowMs = opts.nowMs ?? Date.now();
  if (!isTrustedNegativeAutoWindow(nowMs)) return false;
  const today = hktDateStringFromMs(nowMs);
  if (opts.lastAutoRunHktDate && opts.lastAutoRunHktDate === today) return false;
  return true;
}

export function parseTrustedNegativeAutoSummary(raw: unknown): TrustedNegativeAutoRunSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Partial<TrustedNegativeAutoRunSummary>;
  if (row.kind !== TRUSTED_NEGATIVE_AUTO_KIND) return null;
  if (typeof row.at !== "string" || typeof row.hktDate !== "string") return null;
  return {
    kind: TRUSTED_NEGATIVE_AUTO_KIND,
    at: row.at,
    hktDate: row.hktDate,
    attempted: Array.isArray(row.attempted) ? row.attempted.map(String) : [],
    results: Array.isArray(row.results)
      ? row.results.map((r) => ({
          actionId: String((r as TrustedNegativeAutoResultRow).actionId ?? ""),
          state: String((r as TrustedNegativeAutoResultRow).state ?? ""),
          mutationCount: Number((r as TrustedNegativeAutoResultRow).mutationCount ?? 0),
          message: String((r as TrustedNegativeAutoResultRow).message ?? "").slice(0, 500),
        }))
      : [],
    succeeded: Number(row.succeeded ?? 0),
    failed: Number(row.failed ?? 0),
    skippedAlreadyDone: Number(row.skippedAlreadyDone ?? 0),
    stoppedOn: row.stoppedOn == null ? null : String(row.stoppedOn),
    cap: Number(row.cap ?? TRUSTED_NEGATIVE_AUTO_DAILY_CAP),
    message: String(row.message ?? "").slice(0, 500),
  };
}

export function buildTrustedNegativeAutoSummary(input: {
  at?: string;
  nowMs?: number;
  attempted: string[];
  results: TrustedNegativeAutoResultRow[];
  skippedAlreadyDone: number;
  stoppedOn: string | null;
  cap?: number;
}): TrustedNegativeAutoRunSummary {
  const nowMs = input.nowMs ?? Date.now();
  const succeeded = input.results.filter((r) => r.state === "executed").length;
  const failed = input.results.filter((r) => r.state === "failed" || r.state === "blocked").length;
  const bits: string[] = [];
  bits.push(`嘗試 ${input.attempted.length}`);
  bits.push(`成功 ${succeeded}`);
  if (failed) bits.push(`失敗 ${failed}`);
  if (input.skippedAlreadyDone) bits.push(`已完成跳過 ${input.skippedAlreadyDone}`);
  if (input.stoppedOn) bits.push(`停於 ${input.stoppedOn}`);
  return {
    kind: TRUSTED_NEGATIVE_AUTO_KIND,
    at: input.at ?? new Date(nowMs).toISOString(),
    hktDate: hktDateStringFromMs(nowMs),
    attempted: input.attempted,
    results: input.results,
    succeeded,
    failed,
    skippedAlreadyDone: input.skippedAlreadyDone,
    stoppedOn: input.stoppedOn,
    cap: input.cap ?? TRUSTED_NEGATIVE_AUTO_DAILY_CAP,
    message: bits.join(" · "),
  };
}

/** A run counts as failed when it fail-stopped or had failed/blocked rows. */
export function isTrustedNegativeAutoRunFailed(
  summary: Pick<TrustedNegativeAutoRunSummary, "failed" | "stoppedOn">
): boolean {
  return Boolean(summary.stoppedOn) || summary.failed > 0;
}

/**
 * Count consecutive failed auto-runs from newest → oldest.
 * Success (or empty no-op with no failures) breaks the streak.
 */
export function countConsecutiveAutoFailStreak(
  summariesNewestFirst: Array<Pick<TrustedNegativeAutoRunSummary, "failed" | "stoppedOn" | "succeeded" | "attempted">>
): number {
  let streak = 0;
  for (const row of summariesNewestFirst) {
    if (isTrustedNegativeAutoRunFailed(row)) streak += 1;
    else break;
  }
  return streak;
}

/** 0–100 health for weekly loop: green when recent auto lane is healthy. */
export function autoLaneHealthPct(opts: {
  failStreak: number;
  lastRun: Pick<TrustedNegativeAutoRunSummary, "failed" | "stoppedOn" | "succeeded" | "attempted"> | null;
}): number | null {
  if (!opts.lastRun) return null;
  if (opts.failStreak >= 2) return 10;
  if (opts.failStreak === 1 || isTrustedNegativeAutoRunFailed(opts.lastRun)) return 35;
  if (opts.lastRun.succeeded > 0 || opts.lastRun.attempted.length === 0) return 100;
  return 70;
}

/** Human-readable next auto window hint (HKT). */
export function nextTrustedNegativeAutoWindowHint(nowMs = Date.now()): string {
  const hkt = new Date(nowMs + 8 * 60 * 60 * 1000);
  const hour = hkt.getUTCHours();
  const today = hkt.toISOString().slice(0, 10);
  if (hour < 10) return `今日 HKT 10:00 起可跑（${today}）`;
  if (hour < 21) return `而家窗口內（HKT 10:00–21:00，${today}）`;
  // next day 10:00
  const next = new Date(hkt.getTime() + 24 * 60 * 60 * 1000);
  const nextDate = next.toISOString().slice(0, 10);
  return `明日 HKT 10:00（${nextDate}）`;
}

/** Escalate after this many consecutive failed auto-runs. */
export const TRUSTED_NEGATIVE_AUTO_ALERT_STREAK = 2;
