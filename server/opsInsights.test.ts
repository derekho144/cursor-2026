import { describe, expect, it } from "vitest";
import { followUpDaysForSource, FOLLOW_UP_DAYS_BY_SOURCE } from "./followUpPolicy";

describe("followUpDaysForSource", () => {
  it("uses channel-specific days for paid ads", () => {
    expect(followUpDaysForSource("Google", 3)).toBe(2);
    expect(followUpDaysForSource("HelloToby", 3)).toBe(2);
    expect(followUpDaysForSource("PRO360", 3)).toBe(2);
  });

  it("slows down for repeat / referral", () => {
    expect(followUpDaysForSource("Repeat", 3)).toBe(5);
    expect(followUpDaysForSource("Referral", 3)).toBe(4);
  });

  it("falls back to default for unknown / null", () => {
    expect(followUpDaysForSource(null, 3)).toBe(3);
    expect(followUpDaysForSource("UnknownChannel", 7)).toBe(7);
  });

  it("exports a map covering main lead sources", () => {
    expect(FOLLOW_UP_DAYS_BY_SOURCE.FreelanceHunter).toBe(3);
    expect(FOLLOW_UP_DAYS_BY_SOURCE.Website).toBe(3);
  });
});
