import { describe, expect, it } from "vitest";
import {
  inferDurationPackageFromHours,
  resolveDurationPackage,
} from "../shared/quoteDurationPackage";
import { rejectReasonByLabel } from "../shared/quoteRejectReasons";

describe("duration package", () => {
  it("infers from hours", () => {
    expect(inferDurationPackageFromHours(2)).toBe("hours");
    expect(inferDurationPackageFromHours(4)).toBe("half_day");
    expect(inferDurationPackageFromHours(8)).toBe("full_day");
    expect(inferDurationPackageFromHours(14)).toBe("multi_day");
  });

  it("prefers explicit package", () => {
    expect(
      resolveDurationPackage({ durationPackage: "full_day", shootHours: 2 })
    ).toBe("full_day");
  });
});

describe("reject reasons", () => {
  it("maps legacy labels", () => {
    expect(rejectReasonByLabel("價格太高")?.id).toBe("price_budget");
    expect(rejectReasonByLabel("找到其他攝影師")?.id).toBe("competitor_cheaper");
    expect(rejectReasonByLabel("價格太高（半日／全日／多日總價）")?.id).toBe(
      "price_package_total"
    );
  });

  it("flags price-related", () => {
    expect(rejectReasonByLabel("價格太高")?.priceRelated).toBe(true);
    expect(rejectReasonByLabel("項目取消")?.priceRelated).toBe(false);
  });
});
