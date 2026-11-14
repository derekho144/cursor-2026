import { describe, expect, it } from "vitest";
import {
  FIXED_TRANSPORTATION_FEE_HKD,
  buildItemPriceSuggestions,
} from "./itemPriceSuggestions";

describe("buildItemPriceSuggestions", () => {
  it("returns fixed transport rule and omits insufficient-data rows", () => {
    const result = buildItemPriceSuggestions({
      items: [
        { description: "Event Photoshoot", quantity: 1 },
        { description: "Transportation Fee", quantity: 1 },
        {
          description:
            "Retouch (Post image editing included fine retouch of lighting, colour, sharpen, dust)",
          quantity: 0,
        },
        { description: "SECTION B · OPTIONAL · 活動攝影與線上直播", quantity: 0 },
      ],
      history: [
        {
          status: "accepted",
          items: [{ description: "Transportation Fee", quantity: 1, unitPrice: 320 }],
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      description: "Transportation Fee",
      suggestedUnitPrice: FIXED_TRANSPORTATION_FEE_HKD,
      matchedBy: "固定營運規則",
      confidence: "high",
      sampleCount: 0,
    });
    expect(result.every((r) => r.suggestedUnitPrice != null)).toBe(true);
  });

  it("suggests median unit price when enough same-name accepted samples exist", () => {
    const result = buildItemPriceSuggestions({
      items: [{ description: "Event Photoshoot", quantity: 4 }],
      history: [
        {
          status: "accepted",
          items: [{ description: "Event Photoshoot", quantity: 4, unitPrice: 1000 }],
        },
        {
          status: "accepted",
          items: [{ description: "Event Photoshoot", quantity: 4, unitPrice: 1200 }],
        },
        {
          status: "rejected",
          items: [{ description: "Event Photoshoot", quantity: 4, unitPrice: 900 }],
        },
        {
          status: "accepted",
          items: [{ description: "Event Photoshoot", quantity: 4, unitPrice: 1100 }],
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.suggestedUnitPrice).toBe(1100);
    expect(result[0]!.sampleCount).toBe(3);
    expect(result[0]!.matchedBy).toBe("同名同數量成交");
  });

  it("does not emit placeholder rows when samples are below threshold", () => {
    const result = buildItemPriceSuggestions({
      items: [{ description: "Event Photoshoot", quantity: 1 }],
      history: [
        {
          status: "accepted",
          items: [{ description: "Event Photoshoot", quantity: 1, unitPrice: 1000 }],
        },
      ],
    });
    expect(result).toEqual([]);
  });
});
