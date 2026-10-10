import { describe, expect, it } from "vitest";
import {
  adsActionLight,
  completionRate,
  followUpLight,
  metricDelta,
  pctChange,
  rollingWeekWindows,
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

  it("maps follow-up light tones", () => {
    expect(followUpLight({ enabled: false, pending: 0 }).tone).toBe("red");
    expect(followUpLight({ enabled: true, pending: 20 }).tone).toBe("amber");
    expect(followUpLight({ enabled: true, pending: 3 }).tone).toBe("green");
  });

  it("maps ads action light tones", () => {
    expect(adsActionLight({ pendingTrusted: 2, executed7d: 0, failed7d: 0 }).tone).toBe("amber");
    expect(adsActionLight({ pendingTrusted: 0, executed7d: 3, failed7d: 0 }).tone).toBe("green");
    expect(adsActionLight({ pendingTrusted: 0, executed7d: 0, failed7d: 1 }).tone).toBe("amber");
  });

  it("computes completion rate", () => {
    expect(completionRate(3, 6)).toBe(50);
    expect(completionRate(0, 0)).toBeNull();
  });
});
