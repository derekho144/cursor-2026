/**
 * HelloToby Session UI status — live probe beats age/sync heuristics.
 * Heuristics alone must never claim hard "連線失效" while a live probe can still pass.
 */

export type HelloTobyLiveProbe = boolean | null;

export type HelloTobyConnBadgeKind = "none" | "ok" | "dead" | "warn";

export type HelloTobyConnBadge = {
  kind: HelloTobyConnBadgeKind;
  /** Short chip label next to Session Cookies 認證 */
  label: string | null;
};

export const HT_COOKIE_STALE_MS = 30 * 24 * 3600 * 1000;

export function isHelloTobyCookiesStale(
  updatedAt: Date | string | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (updatedAt == null || String(updatedAt).trim() === "") return false;
  const ms = new Date(updatedAt).getTime();
  if (!Number.isFinite(ms)) return false;
  return nowMs - ms > HT_COOKIE_STALE_MS;
}

/**
 * Resolve badge for HelloToby cookie auth block.
 * - liveOk true → 連線正常 (even if cookies look old or last sync failed)
 * - liveOk false → 連線失效
 * - no live result yet + stale/lastFail → 需留意 (heuristic only)
 * - otherwise with cred → 已設定
 */
export function resolveHelloTobyConnBadge(input: {
  hasCred: boolean;
  liveOk: HelloTobyLiveProbe;
  cookiesStale: boolean;
  lastSyncFailed: boolean;
}): HelloTobyConnBadge {
  if (!input.hasCred) return { kind: "none", label: null };

  if (input.liveOk === true) return { kind: "ok", label: "連線正常" };
  if (input.liveOk === false) return { kind: "dead", label: "連線失效" };

  if (input.cookiesStale || input.lastSyncFailed) {
    return { kind: "warn", label: "需留意" };
  }
  return { kind: "ok", label: "已設定" };
}
