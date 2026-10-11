/** Shared types + pure helpers for the Growth Cockpit UI（監控台）. */

export type LightTone = "green" | "amber" | "red" | "muted";

export type CockpitLight = {
  id: string;
  label: string;
  tone: LightTone;
  detail: string;
  href: string;
};

export type MetricDelta = {
  current: number;
  previous: number;
  /** Percent change; null when previous is 0 and current is also 0. */
  pct: number | null;
  direction: "up" | "down" | "flat";
};

export type WeekWindow = {
  startDate: string;
  endDate: string;
  label: string;
};

export type PrimaryAction = {
  id: string;
  title: string;
  reason: string;
  href: string;
  tone: LightTone;
};

export type WeeklyLoop = {
  score: number | null;
  label: string;
  detail: string;
  parts: {
    adsActions: number | null;
    followUp: number | null;
    acceptedTrend: number | null;
    /** SEO/GEO health 0–100 when GSC（及相關）可評估 */
    seoGeo?: number | null;
    /** 運維管道健康 0–100（同步／FH 等） */
    opsHealth?: number | null;
  };
};

export function pctChange(current: number, previous: number): number | null {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

export function metricDelta(current: number, previous: number): MetricDelta {
  const pct = pctChange(current, previous);
  let direction: MetricDelta["direction"] = "flat";
  if (pct != null && pct > 0.5) direction = "up";
  else if (pct != null && pct < -0.5) direction = "down";
  return { current, previous, pct, direction };
}

/** HKT calendar date YYYY-MM-DD for `daysAgo` (0 = today HKT). */
export function hktDateString(daysAgo = 0, nowMs = Date.now()): string {
  const hkt = new Date(nowMs + 8 * 60 * 60 * 1000 - daysAgo * 24 * 60 * 60 * 1000);
  return hkt.toISOString().slice(0, 10);
}

/**
 * Rolling 7-day windows in HKT:
 * thisWeek = last 7 complete+today days [today-6 … today]
 * lastWeek = prior 7 days [today-13 … today-7]
 */
export function rollingWeekWindows(nowMs = Date.now()): { thisWeek: WeekWindow; lastWeek: WeekWindow } {
  const thisEnd = hktDateString(0, nowMs);
  const thisStart = hktDateString(6, nowMs);
  const lastEnd = hktDateString(7, nowMs);
  const lastStart = hktDateString(13, nowMs);
  return {
    thisWeek: { startDate: thisStart, endDate: thisEnd, label: "近 7 日" },
    lastWeek: { startDate: lastStart, endDate: lastEnd, label: "前 7 日" },
  };
}

export function followUpLight(opts: {
  enabled: boolean;
  pending: number;
  oldestPendingDays?: number | null;
}): CockpitLight {
  if (!opts.enabled) {
    return {
      id: "follow-up",
      label: "報價跟進",
      tone: "red",
      detail: "自動跟進已關閉",
      href: "/follow-up",
    };
  }
  const oldest = opts.oldestPendingDays ?? null;
  if (oldest != null && oldest >= 5) {
    return {
      id: "follow-up",
      label: "報價跟進",
      tone: "red",
      detail: `最舊 pending 已 ${oldest} 日；共 ${opts.pending} 筆`,
      href: "/follow-up",
    };
  }
  if (opts.pending >= 15) {
    return {
      id: "follow-up",
      label: "報價跟進",
      tone: "amber",
      detail: `${opts.pending} 筆等待跟進`,
      href: "/follow-up",
    };
  }
  if (opts.pending > 0) {
    return {
      id: "follow-up",
      label: "報價跟進",
      tone: "green",
      detail: `${opts.pending} 筆待處理（正常）`,
      href: "/follow-up",
    };
  }
  return {
    id: "follow-up",
    label: "報價跟進",
    tone: "green",
    detail: "隊列清空",
    href: "/follow-up",
  };
}

export function adsActionLight(opts: {
  pendingTrusted: number;
  executed7d: number;
  failed7d: number;
}): CockpitLight {
  if (opts.failed7d > 0) {
    return {
      id: "ads-actions",
      label: "Ads Action Queue",
      tone: "amber",
      detail: `近 7 日 ${opts.failed7d} 次失敗／阻擋；待執行 ${opts.pendingTrusted}`,
      href: "/growth-priorities",
    };
  }
  if (opts.pendingTrusted > 0) {
    return {
      id: "ads-actions",
      label: "Ads Action Queue",
      tone: "amber",
      detail: `${opts.pendingTrusted} 項可信 Action 待審／待執行`,
      href: "/growth-priorities",
    };
  }
  if (opts.executed7d > 0) {
    return {
      id: "ads-actions",
      label: "Ads Action Queue",
      tone: "green",
      detail: `近 7 日已執行 ${opts.executed7d} 次`,
      href: "/growth-priorities",
    };
  }
  return {
    id: "ads-actions",
    label: "Ads Action Queue",
    tone: "muted",
    detail: "暫無待執行 Action",
    href: "/growth-priorities",
  };
}

export function adsDataLight(opts: {
  available: boolean;
  error?: string | null;
  stale?: boolean;
}): CockpitLight {
  if (!opts.available) {
    return {
      id: "ads-data",
      label: "Google Ads 數據",
      tone: "red",
      detail: opts.error ? `連線失敗：${opts.error.slice(0, 80)}` : "無法讀取 Ads 指標",
      href: "/google-ads-quality",
    };
  }
  if (opts.stale) {
    return {
      id: "ads-data",
      label: "Google Ads 數據",
      tone: "amber",
      detail: "顯示上次成功快取（即時連線失敗）",
      href: "/google-ads-quality",
    };
  }
  return {
    id: "ads-data",
    label: "Google Ads 數據",
    tone: "green",
    detail: "WoW 指標可用",
    href: "/google-ads-quality",
  };
}

export function quotesLight(opts: {
  createdDelta: MetricDelta;
  acceptedDelta: MetricDelta;
  adsAvailable?: boolean;
  adsCtrDelta?: MetricDelta;
  adsIsDelta?: MetricDelta;
}): CockpitLight {
  const createdDown = opts.createdDelta.direction === "down";
  const acceptedDown = opts.acceptedDelta.direction === "down";
  const adsEngagementUp =
    opts.adsAvailable &&
    (opts.adsCtrDelta?.direction === "up" || opts.adsIsDelta?.direction === "up");

  if (adsEngagementUp && createdDown) {
    return {
      id: "quotes",
      label: "報價漏斗",
      tone: "amber",
      detail: "Ads CTR／IS 上升但開單下降 — 檢查流量質素",
      href: "/email-inquiries",
    };
  }
  if (createdDown && acceptedDown) {
    return {
      id: "quotes",
      label: "報價漏斗",
      tone: "amber",
      detail: "開單與成交均較前 7 日下降",
      href: "/quotes",
    };
  }
  if (opts.acceptedDelta.direction === "up") {
    return {
      id: "quotes",
      label: "報價漏斗",
      tone: "green",
      detail: "成交較前 7 日上升",
      href: "/quotes",
    };
  }
  return {
    id: "quotes",
    label: "報價漏斗",
    tone: "green",
    detail: "漏斗穩定",
    href: "/quotes",
  };
}

/** Efficiency signal on top of raw Ads availability. */
export function adsEfficiencyLight(opts: {
  available: boolean;
  cpa: MetricDelta;
  conversions: MetricDelta;
}): CockpitLight | null {
  if (!opts.available) return null;
  if (opts.cpa.direction === "up" && opts.conversions.direction === "down") {
    return {
      id: "ads-efficiency",
      label: "Ads 效益",
      tone: "red",
      detail: "CPA 上升且轉換下降",
      href: "/google-ads-quality",
    };
  }
  if (opts.cpa.direction === "up" && (opts.cpa.pct ?? 0) >= 15) {
    return {
      id: "ads-efficiency",
      label: "Ads 效益",
      tone: "amber",
      detail: `CPA 較前 7 日升 ${opts.cpa.pct}%`,
      href: "/google-ads-quality",
    };
  }
  if (opts.conversions.direction === "up") {
    return {
      id: "ads-efficiency",
      label: "Ads 效益",
      tone: "green",
      detail: "轉換較前 7 日上升",
      href: "/google-ads-quality",
    };
  }
  return {
    id: "ads-efficiency",
    label: "Ads 效益",
    tone: "green",
    detail: "效益穩定",
    href: "/google-ads-quality",
  };
}

export function inquiriesLight(opts: { pending: number }): CockpitLight {
  if (opts.pending >= 20) {
    return {
      id: "inquiries",
      label: "詢價郵件",
      tone: "amber",
      detail: `${opts.pending} 封待處理`,
      href: "/email-inquiries",
    };
  }
  if (opts.pending > 0) {
    return {
      id: "inquiries",
      label: "詢價郵件",
      tone: "green",
      detail: `${opts.pending} 封待處理`,
      href: "/email-inquiries",
    };
  }
  return {
    id: "inquiries",
    label: "詢價郵件",
    tone: "green",
    detail: "無待處理詢價",
    href: "/email-inquiries",
  };
}

export function pricingLearningLight(opts: { accepted7d: number }): CockpitLight {
  if (opts.accepted7d >= 3) {
    return {
      id: "pricing-learning",
      label: "定價學習",
      tone: "green",
      detail: `近 7 日 ${opts.accepted7d} 筆成交可入學習`,
      href: "/pricing-learning",
    };
  }
  if (opts.accepted7d > 0) {
    return {
      id: "pricing-learning",
      label: "定價學習",
      tone: "muted",
      detail: `近 7 日 ${opts.accepted7d} 筆成交`,
      href: "/pricing-learning",
    };
  }
  return {
    id: "pricing-learning",
    label: "定價學習",
    tone: "muted",
    detail: "近 7 日無新成交樣本",
    href: "/pricing-learning",
  };
}

/** HelloToby / PRO360 session + last sync health. */
export function platformSyncLight(opts: {
  hellotobyConfigured: boolean;
  hellotobyCookieAgeDays: number | null;
  hellotobyLastStatus: "success" | "error" | "none";
  pro360Configured: boolean;
  pro360LastStatus: "success" | "error" | "none";
}): CockpitLight {
  if (!opts.hellotobyConfigured && !opts.pro360Configured) {
    return {
      id: "platform-sync",
      label: "平台同步",
      tone: "amber",
      detail: "尚未設定 HelloToby／PRO360 Session",
      href: "/ad-sync",
    };
  }
  if (opts.hellotobyLastStatus === "error" || opts.pro360LastStatus === "error") {
    const which =
      opts.hellotobyLastStatus === "error" && opts.pro360LastStatus === "error"
        ? "HelloToby 與 PRO360"
        : opts.hellotobyLastStatus === "error"
          ? "HelloToby"
          : "PRO360";
    return {
      id: "platform-sync",
      label: "平台同步",
      tone: "red",
      detail: `${which} 最近同步失敗 — 檢查 Session Cookies`,
      href: "/ad-sync",
    };
  }
  if (opts.hellotobyConfigured && (opts.hellotobyCookieAgeDays ?? 0) >= 30) {
    return {
      id: "platform-sync",
      label: "平台同步",
      tone: "red",
      detail: `HelloToby Cookies 已 ${opts.hellotobyCookieAgeDays} 日未更新，多半已過期`,
      href: "/ad-sync",
    };
  }
  if (opts.hellotobyConfigured && (opts.hellotobyCookieAgeDays ?? 0) >= 14) {
    return {
      id: "platform-sync",
      label: "平台同步",
      tone: "amber",
      detail: `HelloToby Cookies ${opts.hellotobyCookieAgeDays} 日未更新，建議盡快續期`,
      href: "/ad-sync",
    };
  }
  return {
    id: "platform-sync",
    label: "平台同步",
    tone: "green",
    detail: "HelloToby／PRO360 Session 正常",
    href: "/ad-sync",
  };
}

/** GSC / SEO·GEO signal — connection + organic clicks WoW. */
export function gscSeoLight(opts: {
  available: boolean;
  error?: string | null;
  clicksDelta?: MetricDelta | null;
}): CockpitLight {
  if (!opts.available) {
    return {
      id: "gsc-seo",
      label: "SEO · GSC",
      tone: "red",
      detail: opts.error ? `GSC 連線失敗：${opts.error.slice(0, 60)}` : "GSC 未授權或連線失敗",
      href: "/growth-priorities",
    };
  }
  if (opts.clicksDelta?.direction === "down" && (opts.clicksDelta.pct ?? 0) <= -15) {
    return {
      id: "gsc-seo",
      label: "SEO · GSC",
      tone: "amber",
      detail: `自然搜尋點擊較前 7 日跌 ${Math.abs(opts.clicksDelta.pct ?? 0)}% — 查 Growth Priorities／AEO`,
      href: "/growth-priorities",
    };
  }
  if (opts.clicksDelta?.direction === "up") {
    return {
      id: "gsc-seo",
      label: "SEO · GSC",
      tone: "green",
      detail: `自然搜尋點擊↑ ${opts.clicksDelta.pct ?? 0}%`,
      href: "/growth-priorities",
    };
  }
  return {
    id: "gsc-seo",
    label: "SEO · GSC",
    tone: "green",
    detail: "GSC 連線正常；到增長優先模型做 AEO／GEO backlog",
    href: "/growth-priorities",
  };
}

/** Search impression share pressure (rank / budget). */
export function adsReachLight(opts: {
  available: boolean;
  isDelta: MetricDelta;
}): CockpitLight | null {
  if (!opts.available) return null;
  if (opts.isDelta.direction === "down" && (opts.isDelta.pct ?? 0) <= -10) {
    return {
      id: "ads-reach",
      label: "Ads 觸達",
      tone: "amber",
      detail: `Search IS 較前 7 日跌 ${Math.abs(opts.isDelta.pct ?? 0)}% — 查出價／預算／QS`,
      href: "/google-ads-quality",
    };
  }
  if (opts.isDelta.direction === "up") {
    return {
      id: "ads-reach",
      label: "Ads 觸達",
      tone: "green",
      detail: `Search IS↑ ${opts.isDelta.pct ?? 0}%`,
      href: "/google-ads-quality",
    };
  }
  return {
    id: "ads-reach",
    label: "Ads 觸達",
    tone: "green",
    detail: "Impression Share 穩定",
    href: "/google-ads-quality",
  };
}

/** Freehunter board scrape freshness. */
export function fhBoardLight(opts: {
  ageHours: number | null;
  scrapeStale: boolean;
}): CockpitLight {
  if (opts.scrapeStale) {
    return {
      id: "fh-board",
      label: "FH 工作板",
      tone: "amber",
      detail:
        opts.ageHours == null
          ? "活躍時段內無 scrape 紀錄"
          : `上次 scrape 已 ${opts.ageHours} 小時 — 可能卡住`,
      href: "/freehunter-board",
    };
  }
  if (opts.ageHours != null) {
    return {
      id: "fh-board",
      label: "FH 工作板",
      tone: "green",
      detail: `上次 scrape ${opts.ageHours} 小時前`,
      href: "/freehunter-board",
    };
  }
  return {
    id: "fh-board",
    label: "FH 工作板",
    tone: "muted",
    detail: "尚無 scrape 數據",
    href: "/freehunter-board",
  };
}

export function completionRate(done: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((done / total) * 1000) / 10;
}

const TONE_RANK: Record<LightTone, number> = {
  red: 0,
  amber: 1,
  green: 2,
  muted: 3,
};

/** Pick one next action from lights + key signals (highest severity first). */
export function pickPrimaryAction(opts: {
  lights: CockpitLight[];
  followUpEnabled: boolean;
  followUpPending: number;
  oldestPendingDays: number | null;
  adsActionPending: number;
  adsActionFailed7d: number;
  inquiriesPending: number;
  adsAvailable: boolean;
  cpa: MetricDelta;
  conversions: MetricDelta;
  created: MetricDelta;
  adsCtr: MetricDelta;
  adsIs: MetricDelta;
  /** Platform cookie / last sync broken */
  platformSyncBroken?: boolean;
  /** GSC OAuth / query broken */
  gscBroken?: boolean;
  /** Organic clicks dropped hard WoW */
  gscClicksDropSevere?: boolean;
  /** FH scrape stale in active hours */
  fhStale?: boolean;
}): PrimaryAction {
  if (!opts.followUpEnabled) {
    return {
      id: "enable-follow-up",
      title: "重新啟用報價跟進",
      reason: "自動跟進已關閉，成交漏斗會斷",
      href: "/follow-up",
      tone: "red",
    };
  }
  if (opts.platformSyncBroken) {
    return {
      id: "fix-platform-sync",
      title: "修復平台同步 Session",
      reason: "HelloToby／PRO360 Cookies 過期或最近同步失敗",
      href: "/ad-sync",
      tone: "red",
    };
  }
  if (!opts.adsAvailable) {
    return {
      id: "fix-ads-data",
      title: "修復 Google Ads 連線",
      reason: "WoW 與效益燈號依賴 Ads 數據",
      href: "/google-ads-quality",
      tone: "red",
    };
  }
  if (opts.gscBroken) {
    return {
      id: "fix-gsc",
      title: "修復 Google Search Console 連線",
      reason: "SEO／GEO／AEO 優先模型需要 GSC 數據",
      href: "/ad-sync",
      tone: "red",
    };
  }
  if (opts.adsActionFailed7d > 0) {
    return {
      id: "review-failed-actions",
      title: "處理失敗／阻擋的 Ads Action",
      reason: `近 7 日有 ${opts.adsActionFailed7d} 次失敗或阻擋`,
      href: "/growth-priorities",
      tone: "amber",
    };
  }
  if (opts.oldestPendingDays != null && opts.oldestPendingDays >= 5) {
    return {
      id: "clear-stale-follow-up",
      title: "清理逾期報價跟進",
      reason: `最舊 pending 已 ${opts.oldestPendingDays} 日`,
      href: "/follow-up",
      tone: "red",
    };
  }
  if (opts.cpa.direction === "up" && opts.conversions.direction === "down") {
    return {
      id: "ads-cpa-spike",
      title: "檢查 Ads CPA 惡化",
      reason: "CPA 上升同時轉換下降",
      href: "/google-ads-quality",
      tone: "red",
    };
  }
  if (opts.adsIs.direction === "down" && (opts.adsIs.pct ?? 0) <= -10) {
    return {
      id: "ads-is-drop",
      title: "檢查 Ads Impression Share 下滑",
      reason: `Search IS 較前 7 日跌 ${Math.abs(opts.adsIs.pct ?? 0)}%`,
      href: "/google-ads-quality",
      tone: "amber",
    };
  }
  if (opts.gscClicksDropSevere) {
    return {
      id: "seo-clicks-drop",
      title: "檢查自然搜尋下滑（SEO／GEO）",
      reason: "GSC 點擊較前 7 日明顯下跌 — 複盤 AEO／內容／Ads 分流",
      href: "/growth-priorities",
      tone: "amber",
    };
  }
  if (
    (opts.adsCtr.direction === "up" || opts.adsIs.direction === "up") &&
    opts.created.direction === "down"
  ) {
    return {
      id: "traffic-quality",
      title: "檢查流量質素與詢價",
      reason: "Ads 曝光／CTR 改善但開單下降",
      href: "/email-inquiries",
      tone: "amber",
    };
  }
  if (opts.fhStale) {
    return {
      id: "fix-fh-scrape",
      title: "檢查 Freehunter scrape",
      reason: "活躍時段內工作板數據過舊",
      href: "/freehunter-board",
      tone: "amber",
    };
  }
  if (opts.followUpPending >= 15) {
    return {
      id: "clear-follow-up-queue",
      title: "消化報價跟進隊列",
      reason: `${opts.followUpPending} 筆等待跟進`,
      href: "/follow-up",
      tone: "amber",
    };
  }
  if (opts.adsActionPending > 0) {
    return {
      id: "run-ads-actions",
      title: "審批／執行 Ads Action Queue",
      reason: `${opts.adsActionPending} 項可信 Action 待處理`,
      href: "/growth-priorities",
      tone: "amber",
    };
  }
  if (opts.inquiriesPending >= 20) {
    return {
      id: "clear-inquiries",
      title: "處理待回詢價郵件",
      reason: `${opts.inquiriesPending} 封待處理`,
      href: "/email-inquiries",
      tone: "amber",
    };
  }

  const worst = [...opts.lights].sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone])[0];
  if (worst && (worst.tone === "red" || worst.tone === "amber")) {
    return {
      id: `light:${worst.id}`,
      title: `跟進：${worst.label}`,
      reason: worst.detail,
      href: worst.href,
      tone: worst.tone,
    };
  }

  return {
    id: "weekly-review",
    title: "本週穩定 — 可複盤 SEO／GEO／Ads",
    reason: "燈號正常；適合做增長優先模型與 AEO backlog",
    href: "/growth-priorities",
    tone: "green",
  };
}

export function weeklyLoopScore(opts: {
  adsActionCompletionPct: number | null;
  followUpCompletionPct: number | null;
  acceptedDelta: MetricDelta;
  seoGeoPct?: number | null;
  opsHealthPct?: number | null;
}): WeeklyLoop {
  const acceptedTrend =
    opts.acceptedDelta.direction === "up" ? 100 : opts.acceptedDelta.direction === "down" ? 35 : 70;

  const parts = [
    opts.adsActionCompletionPct,
    opts.followUpCompletionPct,
    acceptedTrend,
    opts.seoGeoPct ?? null,
    opts.opsHealthPct ?? null,
  ].filter((v): v is number => v != null);

  if (parts.length === 0) {
    return {
      score: null,
      label: "本週閉環",
      detail: "尚未有足夠訊號計算完成度",
      parts: {
        adsActions: opts.adsActionCompletionPct,
        followUp: opts.followUpCompletionPct,
        acceptedTrend,
        seoGeo: opts.seoGeoPct ?? null,
        opsHealth: opts.opsHealthPct ?? null,
      },
    };
  }

  const score = Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 10) / 10;
  let label = "本週閉環偏弱";
  if (score >= 75) label = "本週閉環良好";
  else if (score >= 50) label = "本週閉環尚可";

  const bits: string[] = [];
  if (opts.adsActionCompletionPct != null) bits.push(`Ads Action ${opts.adsActionCompletionPct}%`);
  if (opts.followUpCompletionPct != null) bits.push(`跟進 ${opts.followUpCompletionPct}%`);
  bits.push(
    opts.acceptedDelta.direction === "up"
      ? "成交↑"
      : opts.acceptedDelta.direction === "down"
        ? "成交↓"
        : "成交→"
  );
  if (opts.seoGeoPct != null) bits.push(`SEO/GEO ${opts.seoGeoPct}%`);
  if (opts.opsHealthPct != null) bits.push(`運維 ${opts.opsHealthPct}%`);

  return {
    score,
    label,
    detail: bits.join(" · "),
    parts: {
      adsActions: opts.adsActionCompletionPct,
      followUp: opts.followUpCompletionPct,
      acceptedTrend,
      seoGeo: opts.seoGeoPct ?? null,
      opsHealth: opts.opsHealthPct ?? null,
    },
  };
}

/** Map light tones to a 0–100 ops/seo health contribution. */
export function toneHealthPct(tone: LightTone): number {
  if (tone === "green") return 100;
  if (tone === "amber") return 45;
  if (tone === "red") return 10;
  return 60;
}
