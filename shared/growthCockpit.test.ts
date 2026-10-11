import { describe, expect, it } from "vitest";
import {
  adsActionLight,
  adsEfficiencyLight,
  adsReachLight,
  completionRate,
  followUpLight,
  gscSeoLight,
  metricDelta,
  pctChange,
  pickPrimaryAction,
  platformSyncLight,
  quotesLight,
  rollingWeekWindows,
  weeklyLoopScore,
} from "./growthCockpit";

describe("growthCockpit helpers", () => {
  it("computes percent change and direction", () => {
    expect(pctChange(12, 10)).toBe(20);
    expect(pctChange(0, 0)).toBeNull();
    expect(metricDelta(12, 10).direction).toBe("up");
    expect(metricDelta(8, 10).direction).toBe("down");
    expect(metricDelta(10, 10).direction).toBe("flat");
  });

  it("builds rolling week windows in HKT", () => {
    // 2026-10-10 15:00 UTC = 2026-10-10 23:00 HKT
    const windows = rollingWeekWindows(Date.parse("2026-10-10T15:00:00.000Z"));
    expect(windows.thisWeek.endDate).toBe("2026-10-10");
    expect(windows.thisWeek.startDate).toBe("2026-10-04");
    expect(windows.lastWeek.endDate).toBe("2026-10-03");
    expect(windows.lastWeek.startDate).toBe("2026-09-27");
  });

  it("maps follow-up light tones including stale pending", () => {
    expect(followUpLight({ enabled: false, pending: 0 }).tone).toBe("red");
    expect(followUpLight({ enabled: true, pending: 20 }).tone).toBe("amber");
    expect(followUpLight({ enabled: true, pending: 3 }).tone).toBe("green");
    expect(followUpLight({ enabled: true, pending: 2, oldestPendingDays: 6 }).tone).toBe("red");
  });

  it("maps ads action light tones", () => {
    expect(adsActionLight({ pendingTrusted: 2, executed7d: 0, failed7d: 0 }).tone).toBe("amber");
    expect(adsActionLight({ pendingTrusted: 0, executed7d: 3, failed7d: 0 }).tone).toBe("green");
    expect(adsActionLight({ pendingTrusted: 0, executed7d: 0, failed7d: 1 }).tone).toBe("amber");
    expect(
      adsActionLight({ pendingTrusted: 1, executed7d: 0, failed7d: 0, autoRunFailed: true }).detail
    ).toMatch(/自動執行失敗/);
  });

  it("flags traffic-quality when Ads engagement rises but quotes fall", () => {
    const light = quotesLight({
      createdDelta: metricDelta(5, 10),
      acceptedDelta: metricDelta(2, 2),
      adsAvailable: true,
      adsCtrDelta: metricDelta(3, 2),
      adsIsDelta: metricDelta(40, 30),
    });
    expect(light.tone).toBe("amber");
    expect(light.detail).toMatch(/流量質素/);
  });

  it("flags CPA spike with conversion drop", () => {
    const light = adsEfficiencyLight({
      available: true,
      cpa: metricDelta(120, 80),
      conversions: metricDelta(2, 5),
    });
    expect(light?.tone).toBe("red");
  });

  it("picks primary action by severity", () => {
    const flat = metricDelta(1, 1);
    const action = pickPrimaryAction({
      lights: [],
      followUpEnabled: true,
      followUpPending: 2,
      oldestPendingDays: null,
      adsActionPending: 3,
      adsActionFailed7d: 0,
      inquiriesPending: 0,
      adsAvailable: true,
      cpa: flat,
      conversions: flat,
      created: flat,
      adsCtr: flat,
      adsIs: flat,
    });
    expect(action.id).toBe("run-ads-actions");
  });

  it("computes weekly loop score", () => {
    const loop = weeklyLoopScore({
      adsActionCompletionPct: 100,
      followUpCompletionPct: 50,
      acceptedDelta: metricDelta(3, 2),
    });
    expect(loop.score).toBe(83.3);
    expect(loop.label).toMatch(/良好/);
  });

  it("includes seo/ops parts in weekly loop when provided", () => {
    const loop = weeklyLoopScore({
      adsActionCompletionPct: 100,
      followUpCompletionPct: 100,
      acceptedDelta: metricDelta(3, 2),
      seoGeoPct: 100,
      opsHealthPct: 100,
    });
    expect(loop.score).toBe(100);
    expect(loop.detail).toMatch(/SEO\/GEO/);
    expect(loop.parts.seoGeo).toBe(100);
  });

  it("flags platform sync and GSC failures", () => {
    expect(
      platformSyncLight({
        hellotobyConfigured: true,
        hellotobyCookieAgeDays: 40,
        hellotobyLastStatus: "none",
        pro360Configured: true,
        pro360LastStatus: "success",
      }).tone
    ).toBe("red");
    expect(gscSeoLight({ available: false, error: "token expired" }).tone).toBe("red");
    expect(
      gscSeoLight({
        available: true,
        clicksDelta: metricDelta(70, 100),
      }).tone
    ).toBe("amber");
  });

  it("flags Ads IS drop as reach pressure", () => {
    const light = adsReachLight({
      available: true,
      isDelta: metricDelta(30, 40),
    });
    expect(light?.tone).toBe("amber");
  });

  it("prioritises platform sync repair in primary action", () => {
    const flat = metricDelta(1, 1);
    const action = pickPrimaryAction({
      lights: [],
      followUpEnabled: true,
      followUpPending: 0,
      oldestPendingDays: null,
      adsActionPending: 0,
      adsActionFailed7d: 0,
      inquiriesPending: 0,
      adsAvailable: true,
      cpa: flat,
      conversions: flat,
      created: flat,
      adsCtr: flat,
      adsIs: flat,
      platformSyncBroken: true,
    });
    expect(action.id).toBe("fix-platform-sync");
  });

  it("computes completion rate", () => {
    expect(completionRate(3, 6)).toBe(50);
    expect(completionRate(0, 0)).toBeNull();
  });
});
