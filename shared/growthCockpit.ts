/** Shared types + pure helpers for the Growth Cockpit (增長駕駛艙). */

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

export function adsDataLight(opts: { available: boolean; error?: string | null }): CockpitLight {
  if (!opts.available) {
    return {
      id: "ads-data",
      label: "Google Ads 數據",
      tone: "red",
      detail: opts.error ? `連線失敗：${opts.error.slice(0, 80)}` : "無法讀取 Ads 指標",
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
}): CockpitLight {
  const createdDown = opts.createdDelta.direction === "down";
  const acceptedDown = opts.acceptedDelta.direction === "down";
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

export function completionRate(done: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((done / total) * 1000) / 10;
}
