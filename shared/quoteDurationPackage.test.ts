import { describe, expect, it } from "vitest";
import {
  formatShootDurationDisplay,
  formatShootDurationZh,
  inferDurationPackageFromHours,
  resolveDurationPackage,
  shootValueAsLearningHours,
} from "./quoteDurationPackage";

describe("multi_day shootHours means days", () => {
  it("formats multi_day as 日 not h", () => {
    expect(formatShootDurationDisplay(2, "multi_day")).toBe("2日");
    expect(formatShootDurationZh(2, "multi_day")).toBe("2 日");
    expect(formatShootDurationDisplay(2, "hours")).toBe("2h");
    expect(formatShootDurationZh(4, "half_day")).toBe("4 小時");
  });

  it("converts multi_day days to learning hours at 8h/day", () => {
    expect(shootValueAsLearningHours(2, "multi_day")).toBe(16);
    expect(shootValueAsLearningHours(2, "hours")).toBe(2);
  });

  it("does not auto-suggest multi_day from clock hours (day-count semantics)", () => {
    expect(inferDurationPackageFromHours(2)).toBe("hours");
    expect(inferDurationPackageFromHours(14)).toBe("unknown");
  });

  it("resolve keeps explicit multi_day; unlabeled long hours still bucket multi_day", () => {
    expect(
      resolveDurationPackage({ durationPackage: "multi_day", shootHours: 2 })
    ).toBe("multi_day");
    expect(resolveDurationPackage({ shootHours: 14 })).toBe("multi_day");
  });
});
