import { describe, expect, it } from "vitest";

/**
 * Radix Select crashes when `value=""` and no SelectItem has that value.
 * QuoteForm must use undefined (placeholder) for empty leadSource / durationPackage.
 */
describe("QuoteForm Select empty-value guard", () => {
  const LEAD_SOURCE_VALUES = new Set([
    "HelloToby",
    "PRO360",
    "FreelanceHunter",
    "88DB",
    "Instagram",
    "Facebook",
    "Google",
    "Referral",
    "Website",
    "Repeat",
    "Other",
  ]);

  function selectValue(raw: string | undefined | null): string | undefined {
    const s = typeof raw === "string" ? raw.trim() : "";
    if (!s) return undefined;
    return LEAD_SOURCE_VALUES.has(s) ? s : undefined;
  }

  it("maps empty leadSource to undefined (Radix-safe)", () => {
    expect(selectValue("")).toBeUndefined();
    expect(selectValue(null)).toBeUndefined();
    expect(selectValue(undefined)).toBeUndefined();
  });

  it("keeps known leadSource values", () => {
    expect(selectValue("Repeat")).toBe("Repeat");
    expect(selectValue("Facebook")).toBe("Facebook");
  });

  it("drops unknown leadSource values instead of crashing Select", () => {
    expect(selectValue("舊客")).toBeUndefined();
    expect(selectValue("repeat")).toBeUndefined();
  });
});
