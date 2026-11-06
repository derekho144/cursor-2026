import { describe, expect, it } from "vitest";
import { hasOrphanedQuoteLink } from "./inquiryQuoteRepair";

describe("inquiry quote repair", () => {
  it("recognizes a non-null quote id with no linked quote", () => {
    expect(hasOrphanedQuoteLink(13620001, null)).toBe(true);
    expect(hasOrphanedQuoteLink(13620001, undefined)).toBe(true);
  });

  it("does not treat an existing quote as orphaned", () => {
    expect(hasOrphanedQuoteLink(13620001, { id: 13620001 })).toBe(false);
  });

  it("does not treat an inquiry without a quote id as orphaned", () => {
    expect(hasOrphanedQuoteLink(null, null)).toBe(false);
    expect(hasOrphanedQuoteLink(undefined, undefined)).toBe(false);
  });
});
