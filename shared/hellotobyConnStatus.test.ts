import { describe, expect, it } from "vitest";
import {
  HT_COOKIE_STALE_MS,
  isHelloTobyCookiesStale,
  resolveHelloTobyConnBadge,
} from "./hellotobyConnStatus";

describe("isHelloTobyCookiesStale", () => {
  const now = Date.parse("2026-11-13T00:00:00.000Z");

  it("false when updated within 30 days", () => {
    expect(isHelloTobyCookiesStale(new Date(now - 10 * 24 * 3600 * 1000).toISOString(), now)).toBe(
      false
    );
  });

  it("true when older than 30 days", () => {
    expect(
      isHelloTobyCookiesStale(new Date(now - HT_COOKIE_STALE_MS - 1000).toISOString(), now)
    ).toBe(true);
  });

  it("false when missing", () => {
    expect(isHelloTobyCookiesStale(null, now)).toBe(false);
  });
});

describe("resolveHelloTobyConnBadge", () => {
  it("none without credentials", () => {
    expect(
      resolveHelloTobyConnBadge({
        hasCred: false,
        liveOk: null,
        cookiesStale: true,
        lastSyncFailed: true,
      })
    ).toEqual({ kind: "none", label: null });
  });

  it("live ok wins over stale and last sync fail", () => {
    expect(
      resolveHelloTobyConnBadge({
        hasCred: true,
        liveOk: true,
        cookiesStale: true,
        lastSyncFailed: true,
      })
    ).toEqual({ kind: "ok", label: "連線正常" });
  });

  it("live fail is hard 連線失效", () => {
    expect(
      resolveHelloTobyConnBadge({
        hasCred: true,
        liveOk: false,
        cookiesStale: false,
        lastSyncFailed: false,
      })
    ).toEqual({ kind: "dead", label: "連線失效" });
  });

  it("heuristic only shows 需留意 not 連線失效", () => {
    expect(
      resolveHelloTobyConnBadge({
        hasCred: true,
        liveOk: null,
        cookiesStale: true,
        lastSyncFailed: false,
      })
    ).toEqual({ kind: "warn", label: "需留意" });

    expect(
      resolveHelloTobyConnBadge({
        hasCred: true,
        liveOk: null,
        cookiesStale: false,
        lastSyncFailed: true,
      })
    ).toEqual({ kind: "warn", label: "需留意" });
  });

  it("fresh cred without probe is 已設定", () => {
    expect(
      resolveHelloTobyConnBadge({
        hasCred: true,
        liveOk: null,
        cookiesStale: false,
        lastSyncFailed: false,
      })
    ).toEqual({ kind: "ok", label: "已設定" });
  });
});
