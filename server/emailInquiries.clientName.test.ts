import { describe, expect, it } from "vitest";

// Unit test for the clientName cleaning logic in sendFHFirstEmail
// Updated logic: strip leading CJK chars first, then handle English prefix words
function cleanClientName(clientName: string): string {
  if (!clientName || !clientName.trim()) return "Sir/Madam";
  let cleaned = clientName.trim();
  // Strip any leading CJK (Chinese/Japanese/Korean) characters
  cleaned = cleaned.replace(/^[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef\u3010-\u301f\u3040-\u309f\u30a0-\u30ff]+/, "").trim();
  if (!cleaned) {
    // Nothing left after stripping CJK — fall back to last 2 words of original
    const parts = clientName.trim().split(/\s+/);
    cleaned = parts.slice(-2).join(" ");
  }
  // If still more than 3 English words, likely has an English job-title prefix — take last 2 words
  const parts = cleaned.split(/\s+/);
  return parts.length > 3 ? parts.slice(-2).join(" ") : cleaned;
}

describe("sendFHFirstEmail - clientName cleaning", () => {
  it("keeps short names (2 words) as-is", () => {
    expect(cleanClientName("Scarlett Cheng")).toBe("Scarlett Cheng");
  });

  it("keeps 3-word names as-is", () => {
    expect(cleanClientName("Chan Siu Ming")).toBe("Chan Siu Ming");
  });

  it("extracts last 2 words from long FH user_name with English job prefix", () => {
    expect(cleanClientName("upgrade and maintenance Eve Bai")).toBe("Eve Bai");
  });

  it("extracts last 2 words from another long English prefix name", () => {
    expect(cleanClientName("App development project John Smith")).toBe("John Smith");
  });

  it("strips leading CJK characters concatenated before English name", () => {
    expect(cleanClientName("歷史建築活動紀錄片Iris N")).toBe("Iris N");
  });

  it("strips leading CJK characters (another example)", () => {
    expect(cleanClientName("小時合唱團表演Scarlett Cheng")).toBe("Scarlett Cheng");
  });

  it("strips leading CJK characters (short CJK prefix)", () => {
    expect(cleanClientName("活動Eve Bai")).toBe("Eve Bai");
  });

  it("falls back to last 2 words of original when all CJK (no English name)", () => {
    // e.g. "陳小明" → strip CJK → empty → fallback last 2 words of original (just 1 word) → "陳小明"
    expect(cleanClientName("陳小明")).toBe("陳小明");
  });

  it("returns Sir/Madam for empty string", () => {
    expect(cleanClientName("")).toBe("Sir/Madam");
  });

  it("returns Sir/Madam for whitespace-only string", () => {
    expect(cleanClientName("   ")).toBe("Sir/Madam");
  });

  it("handles single word name", () => {
    expect(cleanClientName("Derek")).toBe("Derek");
  });
});
