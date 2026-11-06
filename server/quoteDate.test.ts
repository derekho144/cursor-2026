import { describe, expect, it } from "vitest";
import { formatQuoteDateRange, isValidQuoteDateRange } from "../shared/quoteDate";

describe("quote date range", () => {
  it("formats a single-day quote without a duplicate range", () => {
    expect(formatQuoteDateRange("2026-12-05", "2026-12-05")).toBe("2026-12-05");
  });
  it("formats a multi-day quote as start through end", () => {
    expect(formatQuoteDateRange("2026-12-05", "2026-12-06")).toBe("2026-12-05 - 2026-12-06");
  });
  it("accepts blank end date for legacy single-day quotes", () => {
    expect(formatQuoteDateRange("2026-12-05", "")).toBe("2026-12-05");
    expect(isValidQuoteDateRange("2026-12-05", "")).toBe(true);
  });
  it("rejects an end date before the start date", () => {
    expect(isValidQuoteDateRange("2026-12-06", "2026-12-05")).toBe(false);
  });
});
