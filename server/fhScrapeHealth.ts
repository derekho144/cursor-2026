/**
 * Honest FH board scrape health — never claim "正常" on failed / blind / ambiguous runs.
 */

export type FhHealthLevel =
  | "ok"
  | "caught_up"
  | "failed"
  | "stale"
  | "session_down"
  | "ambiguous"
  | "unknown";

export type FhHealthTone = "ok" | "warn" | "bad";

export type FhHealthInput = {
  sessionConnected: boolean;
  scrapeStale: boolean;
  lastScrapeOk: boolean | null;
  newJobs: number | null;
  emailsFetched: number | null;
  /** Listings seen this run; null = legacy status without discovered count */
  discovered: number | null;
  lastScrapedAt: Date | string | null;
  lastScrapeRaw?: string | null;
};

export type FhHealthView = {
  level: FhHealthLevel;
  tone: FhHealthTone;
  title: string;
};

/**
 * Derive UI health from scrape signals.
 * Priority: failed > stale > blind/ambiguous > session_down > caught_up/ok.
 */
export function computeFhScrapeHealth(input: FhHealthInput): FhHealthView {
  const hasAnySignal = input.lastScrapedAt != null || input.lastScrapeOk != null;
  if (!hasAnySignal) {
    return { level: "unknown", tone: "warn", title: "尚無爬取紀錄" };
  }

  if (input.lastScrapeOk === false) {
    return { level: "failed", tone: "bad", title: "上次爬取失敗" };
  }

  // New signal: saw zero listings — board/API path is broken
  if (input.lastScrapeOk === true && input.discovered === 0) {
    return {
      level: "failed",
      tone: "bad",
      title: "爬取異常 — 板面睇唔到任何工作",
    };
  }

  if (input.scrapeStale) {
    return {
      level: "stale",
      tone: "bad",
      title: "爬取可能已停滯 — 請檢查登入或按「立即爬取」",
    };
  }

  // Legacy ok:0/0 with no discovered — cannot tell caught-up from blind
  if (
    input.lastScrapeOk === true &&
    (input.newJobs ?? 0) === 0 &&
    input.discovered == null
  ) {
    return {
      level: "ambiguous",
      tone: "warn",
      title: "上次 +0 新工作 — 未能確認板面是否睇到",
    };
  }

  if (!input.sessionConnected) {
    return {
      level: "session_down",
      tone: "warn",
      title: "爬取有跑，但 FH 登入 session 已斷",
    };
  }

  if (input.lastScrapeOk === true && (input.newJobs ?? 0) === 0) {
    const seen =
      input.discovered != null && input.discovered > 0
        ? `（見到 ${input.discovered} 個，無新工作）`
        : "";
    return {
      level: "caught_up",
      tone: "ok",
      title: `爬取正常 — 已追上${seen}`,
    };
  }

  if (input.lastScrapeOk === true) {
    return { level: "ok", tone: "ok", title: "爬取狀態正常" };
  }

  // Have DB scrapedAt but no persisted ok/fail (e.g. only job rows)
  if (input.scrapeStale) {
    return {
      level: "stale",
      tone: "bad",
      title: "爬取可能已停滯 — 請檢查登入或按「立即爬取」",
    };
  }

  return { level: "unknown", tone: "warn", title: "爬取狀態未知" };
}
