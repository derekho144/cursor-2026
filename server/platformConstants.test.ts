/**
 * platformConstants.test.ts
 * Unit tests for the shared platform constants utility (client/src/lib/platformConstants.ts)
 * Tests are run from server context but test pure logic in the shared lib.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// Read and evaluate the platformConstants module manually to avoid ESM client path issues
const src = readFileSync(
  resolve(process.cwd(), "client/src/lib/platformConstants.ts"),
  "utf-8"
);

// Extract AD_PLATFORMS and ALL_PLATFORMS arrays from the source
function extractArray(name: string, src: string): Array<{ value: string; label: string; color: string; hasAd?: boolean }> {
  const match = src.match(new RegExp(`export const ${name} = (\\[.*?\\]) as const`, "s"));
  if (!match) return [];
  // eslint-disable-next-line no-eval
  return eval(match[1]);
}

const AD_PLATFORMS = extractArray("AD_PLATFORMS", src);
const ALL_PLATFORMS = extractArray("ALL_PLATFORMS", src);

describe("AD_PLATFORMS", () => {
  it("should have exactly 4 paid platforms", () => {
    expect(AD_PLATFORMS).toHaveLength(4);
  });

  it("should contain hellotoby, 360pro, freehunter, google_ads", () => {
    const values = AD_PLATFORMS.map(p => p.value);
    expect(values).toContain("hellotoby");
    expect(values).toContain("360pro");
    expect(values).toContain("freehunter");
    expect(values).toContain("google_ads");
  });

  it("should have non-empty labels and colors", () => {
    for (const p of AD_PLATFORMS) {
      expect(p.label).toBeTruthy();
      expect(p.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

describe("ALL_PLATFORMS", () => {
  it("should have at least 11 platforms", () => {
    expect(ALL_PLATFORMS.length).toBeGreaterThanOrEqual(11);
  });

  it("should include all 4 ad platforms", () => {
    const values = ALL_PLATFORMS.map(p => p.value);
    expect(values).toContain("hellotoby");
    expect(values).toContain("360pro");
    expect(values).toContain("freehunter");
    expect(values).toContain("google_ads");
  });

  it("should include organic platforms", () => {
    const values = ALL_PLATFORMS.map(p => p.value);
    expect(values).toContain("instagram");
    expect(values).toContain("facebook");
    expect(values).toContain("88db");
    expect(values).toContain("referral");
    expect(values).toContain("website");
    expect(values).toContain("repeat");
    expect(values).toContain("other");
  });

  it("should have unique values", () => {
    const values = ALL_PLATFORMS.map(p => p.value);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it("should have non-empty labels and valid hex colors", () => {
    for (const p of ALL_PLATFORMS) {
      expect(p.label).toBeTruthy();
      expect(p.color).toMatch(/^#[0-9A-Fa-f]{3,8}$/);
    }
  });

  it("should have hasAd=true for ad platforms and false for organic", () => {
    const adValues = new Set(["hellotoby", "360pro", "freehunter", "google_ads"]);
    for (const p of ALL_PLATFORMS) {
      if (adValues.has(p.value)) {
        expect(p.hasAd).toBe(true);
      } else {
        expect(p.hasAd).toBe(false);
      }
    }
  });
});
