import { describe, expect, it } from "vitest";
import {
  classifyQuoteLineItem,
  resolveLearningTotal,
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
