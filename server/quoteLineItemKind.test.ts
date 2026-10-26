import { describe, expect, it } from "vitest";
import {
  classifyQuoteLineItem,
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

  it("treats priced Retouch product lines as photographer_crew, not included_meta", () => {
    expect(
      classifyQuoteLineItem(
        "Retouch (Post image editing included fine retouch of lighting, colour, sharpen, dust)"
      )
    ).toBe("photographer_crew");
    expect(classifyQuoteLineItem("Retouching included")).toBe("included_meta");
  });
});

describe("WF3J-style money split", () => {
  it("adds priced retouch into photographer subtotal so UI adds up to grand total", () => {
    const split = splitQuoteLineItemMoney([
      {
        description: "Architecture & Interior Photography (4 hour)",
        quantity: 4,
        unitPrice: 1000,
        amount: 4000,
      },
      {
        description: "extra hours",
        quantity: 0,
        unitPrice: 1000,
        amount: 0,
      },
      {
        description:
          "Retouch (Post image editing included fine retouch of lighting, colour, sharpen, dust)",
        quantity: 10,
        unitPrice: 250,
        amount: 2500,
      },
      {
        description: "extra photos",
        quantity: 20,
        unitPrice: 200,
        amount: 4000,
      },
      {
        description: "Transportation Fee",
        quantity: 1,
        unitPrice: 320,
        amount: 320,
      },
    ]);
    expect(split.photographerCrewSubtotal).toBe(10500);
    expect(split.transportSubtotal).toBe(320);
    expect(split.includedMetaSubtotal).toBe(0);
    expect(split.itemsTotal).toBe(10820);
    expect(
      split.photographerCrewSubtotal + split.transportSubtotal
    ).toBe(split.itemsTotal);
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
