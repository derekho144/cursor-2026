/**
 * adExpenses.validation.test.ts
 * Unit tests for ad expense data validation and calculation logic
 */
import { describe, it, expect } from "vitest";

// ─── Pure helper functions (mirrored from router logic) ─────────────────────

function calcCPC(spend: number, clicks: number): number | null {
  if (!clicks || clicks <= 0) return null;
  return Math.round((spend / clicks) * 100) / 100;
}

function calcCTR(clicks: number, impressions: number): number | null {
  if (!impressions || impressions <= 0) return null;
  return Math.round((clicks / impressions) * 10000) / 100; // percentage with 2dp
}

function calcROAS(revenue: number, spend: number): number | null {
  if (!spend || spend <= 0) return null;
  return Math.round((revenue / spend) * 100) / 100;
}

function isValidPlatform(platform: string): boolean {
  const VALID_PLATFORMS = ["hellotoby", "360pro", "freehunter", "google_ads"];
  return VALID_PLATFORMS.includes(platform);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("calcCPC (Cost Per Click)", () => {
  it("should return null when clicks is zero", () => {
    expect(calcCPC(500, 0)).toBeNull();
  });

  it("should return null when clicks is undefined/falsy", () => {
    expect(calcCPC(500, 0)).toBeNull();
  });

  it("should calculate CPC correctly", () => {
    expect(calcCPC(1000, 100)).toBe(10);
    expect(calcCPC(500, 3)).toBe(166.67);
  });

  it("should round to 2 decimal places", () => {
    expect(calcCPC(100, 3)).toBe(33.33);
  });
});

describe("calcCTR (Click-Through Rate)", () => {
  it("should return null when impressions is zero", () => {
    expect(calcCTR(50, 0)).toBeNull();
  });

  it("should calculate CTR as percentage", () => {
    expect(calcCTR(10, 1000)).toBe(1); // 1%
    expect(calcCTR(50, 1000)).toBe(5); // 5%
  });

  it("should round to 2 decimal places", () => {
    expect(calcCTR(1, 3)).toBe(33.33);
  });
});

describe("calcROAS (Return on Ad Spend)", () => {
  it("should return null when spend is zero", () => {
    expect(calcROAS(5000, 0)).toBeNull();
  });

  it("should calculate ROAS correctly", () => {
    expect(calcROAS(10000, 1000)).toBe(10); // 10x return
    expect(calcROAS(500, 1000)).toBe(0.5); // 0.5x (loss)
  });

  it("should round to 2 decimal places", () => {
    expect(calcROAS(1000, 3)).toBe(333.33);
  });
});

describe("isValidPlatform", () => {
  it("should accept valid ad platforms", () => {
    expect(isValidPlatform("hellotoby")).toBe(true);
    expect(isValidPlatform("360pro")).toBe(true);
    expect(isValidPlatform("freehunter")).toBe(true);
    expect(isValidPlatform("google_ads")).toBe(true);
  });

  it("should reject invalid platforms", () => {
    expect(isValidPlatform("instagram")).toBe(false);
    expect(isValidPlatform("facebook")).toBe(false);
    expect(isValidPlatform("unknown")).toBe(false);
    expect(isValidPlatform("")).toBe(false);
  });
});

describe("Ad expense month/year validation", () => {
  it("should validate month range 1-12", () => {
    const isValidMonth = (m: number) => m >= 1 && m <= 12 && Number.isInteger(m);
    expect(isValidMonth(1)).toBe(true);
    expect(isValidMonth(12)).toBe(true);
    expect(isValidMonth(0)).toBe(false);
    expect(isValidMonth(13)).toBe(false);
    expect(isValidMonth(6.5)).toBe(false);
  });

  it("should validate year range (reasonable years)", () => {
    const isValidYear = (y: number) => y >= 2020 && y <= 2100 && Number.isInteger(y);
    expect(isValidYear(2024)).toBe(true);
    expect(isValidYear(2026)).toBe(true);
    expect(isValidYear(2019)).toBe(false);
    expect(isValidYear(2101)).toBe(false);
  });

  it("should validate non-negative spend amounts", () => {
    const isValidSpend = (s: number) => s >= 0 && Number.isFinite(s);
    expect(isValidSpend(0)).toBe(true);
    expect(isValidSpend(1500.50)).toBe(true);
    expect(isValidSpend(-100)).toBe(false);
    expect(isValidSpend(Infinity)).toBe(false);
  });
});
