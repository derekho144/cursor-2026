import { describe, expect, it } from "vitest";
import {
  buildInquiryQuoteItems,
  INCLUDED_RETOUCH_DESCRIPTION,
  normalizeInquiryQuoteItems,
} from "./inquiryQuoteItems";

describe("inquiry quote item normalization", () => {
  it("keeps explicit four-hour event pricing and shows included retouching", () => {
    const items = normalizeInquiryQuoteItems(
      [{ description: "Event Photography", quantity: 1, unitPrice: 1000 }],
      "corporate_event",
      4,
    );

    expect(items).toEqual([
      {
        description: "Event Photography (4 hours)",
        quantity: 4,
        unitPrice: 1000,
        amount: 4000,
        sortOrder: 0,
      },
      {
        description: INCLUDED_RETOUCH_DESCRIPTION,
        quantity: 1,
        unitPrice: 0,
        amount: 0,
        category: "included_meta",
        sortOrder: 1,
      },
      {
        description: "Transportation Fee",
        quantity: 1,
        unitPrice: 320,
        amount: 320,
        category: "transport",
        sortOrder: 2,
      },
    ]);
  });

  it("does not multiply a flat package by the stated hours", () => {
    const items = normalizeInquiryQuoteItems(
      [{ description: "Event Photography (4 hours)", quantity: 4, unitPrice: 5000 }],
      "corporate_event",
      4,
    );

    expect(items[0]).toMatchObject({ quantity: 1, unitPrice: 5000, amount: 5000 });
    expect(items.some((item) => item.description === INCLUDED_RETOUCH_DESCRIPTION)).toBe(true);
    expect(items.some((item) => item.description === "Transportation Fee")).toBe(true);
  });

  it("uses the same standard rows for the manual approval path", () => {
    const items = buildInquiryQuoteItems({
      serviceType: "party_family_event",
      shootHours: 3,
      suggestedItems: [{ description: "Event Photography", quantity: 3, unitPrice: 700 }],
    });

    expect(items.find((item) => /Event Photography/.test(item.description))).toMatchObject({
      quantity: 3,
      unitPrice: 700,
      amount: 2100,
    });
    expect(items.some((item) => item.category === "included_meta")).toBe(true);
    expect(items.some((item) => item.category === "transport" && item.amount === 320)).toBe(true);
  });
});
