import { describe, expect, it } from "vitest";
import { formatAdsConversionDateTime } from "./googleAds";

describe("formatAdsConversionDateTime", () => {
  it("formats as yyyy-mm-dd HH:mm:ss+08:00 in Asia/Hong_Kong", () => {
    // 04:00 UTC = 12:00 HKT
    const s = formatAdsConversionDateTime(new Date("2026-10-24T04:00:00.000Z"));
    expect(s).toBe("2026-10-24 12:00:00+08:00");
  });
});
