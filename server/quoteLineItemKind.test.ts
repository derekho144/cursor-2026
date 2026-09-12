import { describe, expect, it } from "vitest";
import {
  classifyQuoteLineItem,
  computeDiscountableSubtotal,
  computeQuoteDiscountAmount,
  resolveLearningTotal,
  resolveQuoteLineItemKind,
  splitQuoteLineItemMoney,
} from "../shared/quoteLineItemKind";

describe("classifyQuoteLineItem", () => {
  it("separates photobooth from photographer lines", () => {
    expect(classifyQuoteLineItem("Event Photoshoot (3 hours)")).toBe(
      "photographer_crew"
    );
    expect(classifyQuoteLineItem("extra photographer")).toBe(
      "photographer_crew"
    );
    expect(classifyQuoteLineItem("Photobooth (3 hours)")).toBe("photobooth");
    expect(classifyQuoteLineItem("Transportation Fee")).toBe("transport");
    expect(classifyQuoteLineItem("Team 2P")).toBe("included_meta");
  });
});

describe("resolveQuoteLineItemKind", () => {
  it("prefers explicit category over keyword inference", () => {
    expect(
      resolveQuoteLineItemKind({
        description: "Photobooth (3 hours)",
        category: "photographer_crew",
      })
    ).toBe("photographer_crew");
    expect(
      resolveQuoteLineItemKind({
        description: "Event Photoshoot",
        category: "other",
      })
    ).toBe("other");
  });

  it("falls back to keywords when category empty", () => {
    expect(
      resolveQuoteLineItemKind({
        description: "Transportation Fee",
        category: null,
      })
    ).toBe("transport");
    expect(
      resolveQuoteLineItemKind({
        description: "extra hour",
        category: "",
      })
    ).toBe("photographer_crew");
  });
});

describe("C3YV-style split", () => {
  const items = [
    {
      description: "Event Photoshoot (3 hours)",
      quantity: 1,
      unitPrice: 3000,
      amount: 3000,
    },
    {
      description: "extra photographer",
      quantity: 1,
      unitPrice: 2000,
      amount: 2000,
    },
    {
      description:
        "Retouch (Post image editing included fine retouch of lighting, colour, sharpen, dust)",
      quantity: 1,
      unitPrice: 0,
      amount: 0,
    },
    {
      description: "Photobooth (3 hours)",
      quantity: 1,
      unitPrice: 6300,
      amount: 6300,
    },
    {
      description: "Transportation Fee",
      quantity: 1,
      unitPrice: 320,
      amount: 320,
    },
    { description: "Team 2P", quantity: 1, unitPrice: 0, amount: 0 },
  ];

  it("photographer crew = 5000, not mixed with photobooth", () => {
    const split = splitQuoteLineItemMoney(items);
    expect(split.photographerCrewSubtotal).toBe(5000);
    expect(split.photoboothSubtotal).toBe(6300);
    expect(split.transportSubtotal).toBe(320);
    expect(split.learningTotal).toBe(5000);
    expect(split.learningTotalSource).toBe("photographer_crew");
    expect(split.itemsTotal).toBe(11620);
  });

  it("resolveLearningTotal prefers crew subtotal over quote total", () => {
    const r = resolveLearningTotal({ items, quoteTotal: 11620 });
    expect(r.learningTotal).toBe(5000);
    expect(r.quoteTotal).toBe(11620);
  });
});

describe("computeQuoteDiscountAmount excludes transport", () => {
  const items = [
    {
      description: "Event Photoshoot (3 hours)",
      quantity: 1,
      unitPrice: 3000,
      amount: 3000,
    },
    {
      description: "Transportation Fee",
      quantity: 1,
      unitPrice: 320,
      amount: 320,
    },
    {
      description: "Expedited delivery 加急",
      quantity: 1,
      unitPrice: 500,
      amount: 500,
    },
  ];

  it("classifies 交通 as transport", () => {
    expect(classifyQuoteLineItem("交通")).toBe("transport");
    expect(classifyQuoteLineItem("車費")).toBe("transport");
  });

  it("discountable subtotal excludes transport and expedited", () => {
    expect(computeDiscountableSubtotal(items)).toBe(3000);
  });

  it("5% discount does not include transport fee", () => {
    // buggy: (3000+320+500)*5% = 191; correct: 3000*5% = 150
    expect(computeQuoteDiscountAmount(items, 5)).toBe(150);
  });

  it("respects explicit category=transport even without keywords", () => {
    expect(
      computeQuoteDiscountAmount(
        [
          { description: "現場支援", amount: 1000, category: "other" },
          { description: "現場支援", amount: 200, category: "transport" },
        ],
        10
      )
    ).toBe(100);
  });
});
