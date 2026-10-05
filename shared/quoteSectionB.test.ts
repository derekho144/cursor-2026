import { describe, expect, it } from "vitest";
import {
  EVENT_RUSH_FEE_HKD,
  SECTION_B_OPTION_LABEL,
  applySectionBForServiceType,
  buildEventSectionBLines,
  buildFoodSectionBLines,
  canToggleQuoteWaive,
  hasConditionalSectionB,
  isEventRushFeeItem,
  isManagedSectionBItem,
  isQuoteSectionBOptionItem,
  isQuoteSectionHeader,
  isQuoteTbdPrice,
  isQuoteWaivedPrice,
  parseQuoteItemCode,
  resolveQuotePriceDisplay,
  toggleEventRushWaived,
  toggleQuoteItemWaived,
} from "./quoteSectionB";

describe("quoteSectionB", () => {
  it("exposes food and event service gates", () => {
    expect(hasConditionalSectionB("food_beverage")).toBe(true);
    expect(hasConditionalSectionB("corporate_event")).toBe(true);
    expect(hasConditionalSectionB("product")).toBe(false);
  });

  it("builds food Section B with TBD styling line and Option labels", () => {
    const lines = buildFoodSectionBLines();
    expect(lines[0]?.description).toMatch(/^SECTION B · OPTIONAL · 食物攝影/);
    expect(
      lines.every((l) => l.code === "HEADER" || /（Option）/.test(l.description))
    ).toBe(true);
    expect(lines.filter((l) => l.code !== "HEADER").every((l) => l.quantity === 0)).toBe(
      true
    );
    expect(lines.some((l) => l.code === "B1.1" && /報價另議/.test(l.description))).toBe(true);
    expect(isQuoteTbdPrice(lines.find((l) => l.code === "B1.1")!.description, 0)).toBe(true);
  });

  it("builds event Section B with $800 rush fee and Option labels", () => {
    const charged = buildEventSectionBLines();
    expect(charged[0]?.description).toMatch(/^SECTION B · OPTIONAL · 活動攝影/);
    const rush = charged.find((l) => l.code === "B2")!;
    expect(rush.unitPrice).toBe(EVENT_RUSH_FEE_HKD);
    expect(rush.quantity).toBe(0);
    expect(rush.amount).toBe(0);
    expect(rush.description).toContain("（Option）");
    expect(charged.filter((l) => l.code !== "HEADER").every((l) => l.quantity === 0)).toBe(
      true
    );
    const waived = buildEventSectionBLines({ rushWaived: true }).find((l) => l.code === "B2")!;
    expect(waived.quantity).toBe(1);
    expect(isQuoteWaivedPrice(waived.unitPrice, waived.amount, waived.quantity)).toBe(true);
  });

  it("detects headers, codes, and managed rows", () => {
    expect(isQuoteSectionHeader("SECTION B · OPTIONAL · 活動攝影與線上直播")).toBe(true);
    expect(parseQuoteItemCode("B1.1 現場藝術指導")).toBe("B1.1");
    expect(isManagedSectionBItem("B2 快速交相（12小時內）（Option）")).toBe(true);
    expect(isManagedSectionBItem("Event Photoshoot")).toBe(false);
    expect(isEventRushFeeItem("B2 快速交相（12小時內）（Option）")).toBe(true);
    expect(isQuoteSectionBOptionItem("B1 QRCODE 相片直播（Option）")).toBe(true);
    expect(isQuoteSectionBOptionItem("SECTION B · OPTIONAL · 活動攝影")).toBe(false);
  });

  it("renders Section B $0 lines as Option, not Included", () => {
    expect(
      resolveQuotePriceDisplay({
        description: "B1 QRCODE 相片直播（Option）",
        quantity: 0,
        unitPrice: 0,
        amount: 0,
        isIncluded: true, // even if legacy flag set
      })
    ).toBe("option");
    expect(
      resolveQuotePriceDisplay({
        description: "B2 快速交相（12小時內）（Option）",
        quantity: 0,
        unitPrice: 800,
        amount: 0,
      })
    ).toBe("money"); // list price visible; not waived
    expect(
      resolveQuotePriceDisplay({
        description: "B2 快速交相（12小時內）（Option）",
        quantity: 1,
        unitPrice: 800,
        amount: 800,
      })
    ).toBe("money");
    expect(
      resolveQuotePriceDisplay({
        description: "B2 快速交相（12小時內）（Option）",
        quantity: 1,
        unitPrice: 800,
        amount: 0,
      })
    ).toBe("waived");
    expect(SECTION_B_OPTION_LABEL).toBe("Option");
  });

  it("only allows strikethrough waive on priced Section B options", () => {
    expect(
      canToggleQuoteWaive({
        description: "Transportation Fee",
        unitPrice: 320,
      })
    ).toBe(false);
    expect(
      canToggleQuoteWaive({
        description: "寵物攝影",
        unitPrice: 1000,
      })
    ).toBe(false);
    expect(
      canToggleQuoteWaive({
        description: "extra hour",
        unitPrice: 1000,
      })
    ).toBe(false);
    expect(
      canToggleQuoteWaive({
        description: "B1 QRCODE 相片直播（Option）",
        unitPrice: 0,
      })
    ).toBe(false);
    expect(
      canToggleQuoteWaive({
        description: "B2 快速交相（12小時內）（Option）",
        unitPrice: 800,
      })
    ).toBe(true);
  });

  it("applies Section B on service change and preserves rush waive", () => {
    let id = 0;
    const createId = () => `id-${++id}`;
    const withEvent = applySectionBForServiceType(
      [{ id: "a", description: "Event Photoshoot", quantity: 1, unitPrice: 5000, amount: 5000 }],
      "corporate_event",
      createId
    );
    expect(withEvent.some((i) => isQuoteSectionHeader(i.description))).toBe(true);
    expect(withEvent.some((i) => isEventRushFeeItem(i.description))).toBe(true);
    expect(
      withEvent
        .filter((i) => isQuoteSectionBOptionItem(i.description))
        .every((i) => i.isIncluded === false)
    ).toBe(true);

    const waived = toggleEventRushWaived(withEvent);
    const rush = waived.find((i) => isEventRushFeeItem(i.description))!;
    expect(rush.amount).toBe(0);
    expect(rush.quantity).toBe(1);
    expect(rush.unitPrice).toBe(EVENT_RUSH_FEE_HKD);

    const kept = applySectionBForServiceType(waived, "corporate_event", createId);
    const rush2 = kept.find((i) => isEventRushFeeItem(i.description))!;
    expect(rush2.amount).toBe(0);
    expect(rush2.quantity).toBe(1);

    const food = applySectionBForServiceType(kept, "food_beverage", createId);
    expect(food.some((i) => /食物造型/.test(i.description))).toBe(true);
    expect(food.some((i) => isEventRushFeeItem(i.description))).toBe(false);
  });

  it("ignores waive toggle on regular lines; only Section B B2 waives", () => {
    const items = [
      { id: "1", description: "寵物攝影", quantity: 1, unitPrice: 1000, amount: 1000 },
      {
        id: "2",
        description: "B2 快速交相（12小時內）（Option）",
        quantity: 1,
        unitPrice: 800,
        amount: 800,
      },
      {
        id: "3",
        description: "SECTION B · OPTIONAL · 活動攝影與線上直播",
        quantity: 0,
        unitPrice: 0,
        amount: 0,
      },
      { id: "4", description: "extra hour", quantity: 1, unitPrice: 1000, amount: 1000 },
    ];
    expect(canToggleQuoteWaive(items[0]!)).toBe(false);
    expect(canToggleQuoteWaive(items[1]!)).toBe(true);
    expect(canToggleQuoteWaive(items[2]!)).toBe(false);
    expect(canToggleQuoteWaive(items[3]!)).toBe(false);

    // Regular line: no-op
    const ignored = toggleQuoteItemWaived(items, 0);
    expect(ignored[0]!.amount).toBe(1000);

    const waivedRush = toggleQuoteItemWaived(items, 1);
    expect(
      isQuoteWaivedPrice(
        waivedRush[1]!.unitPrice,
        waivedRush[1]!.amount,
        waivedRush[1]!.quantity
      )
    ).toBe(true);
  });
});
