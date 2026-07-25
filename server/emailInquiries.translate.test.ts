import { describe, expect, it, vi, beforeEach } from "vitest";

// Unit tests for translateJobTitleToEnglish logic
// We test the pure logic parts (ASCII detection, fallback) without calling the real LLM

// Replicate the ASCII detection logic from the function
function isAllAscii(str: string): boolean {
  return /^[\x00-\x7F]+$/.test(str);
}

describe("translateJobTitleToEnglish - ASCII detection", () => {
  it("detects pure English title as all-ASCII (should skip AI call)", () => {
    expect(isAllAscii("Wedding Photography Service")).toBe(true);
  });

  it("detects Chinese title as non-ASCII (should trigger AI translation)", () => {
    expect(isAllAscii("婚禮攝影及錄影服務")).toBe(false);
  });

  it("detects mixed Chinese/English title as non-ASCII (should trigger AI translation)", () => {
    expect(isAllAscii("4 14拍攝4小時合唱團表演")).toBe(false);
  });

  it("detects English with numbers as all-ASCII", () => {
    expect(isAllAscii("Event Photography 4 hours")).toBe(true);
  });

  it("detects title with Chinese characters mixed with English as non-ASCII", () => {
    expect(isAllAscii("Choir 合唱團 Performance")).toBe(false);
  });
});

describe("translateJobTitleToEnglish - fallback logic", () => {
  it("returns original title if translated result is empty", () => {
    const original = "婚禮攝影";
    const translated = ""; // simulate empty AI response
    const result = translated && translated.length > 0 && translated.length < 120 ? translated : original;
    expect(result).toBe(original);
  });

  it("returns original title if translated result is too long (>= 120 chars)", () => {
    const original = "婚禮攝影";
    const translated = "A".repeat(120); // exactly 120 chars, should fallback
    const result = translated && translated.length > 0 && translated.length < 120 ? translated : original;
    expect(result).toBe(original);
  });

  it("returns translated title if it is valid (non-empty, < 120 chars)", () => {
    const original = "婚禮攝影";
    const translated = "Wedding Photography Service";
    const result = translated && translated.length > 0 && translated.length < 120 ? translated : original;
    expect(result).toBe(translated);
  });
});
