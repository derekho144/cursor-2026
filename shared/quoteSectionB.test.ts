import { describe, expect, it } from "vitest";
import {
  EVENT_RUSH_FEE_HKD,
  applySectionBForServiceType,
  buildEventSectionBLines,
  buildFoodSectionBLines,
  canToggleQuoteWaive,
  hasConditionalSectionB,
  isEventRushFeeItem,
  isManagedSectionBItem,
  isQuoteSectionHeader,
  isQuoteTbdPrice,
  isQuoteWaivedPrice,
  parseQuoteItemCode,
  toggleEventRushWaived,
  toggleQuoteItemWaived,
} from "./quoteSectionB";

describe("quoteSectionB", () => {
  it("exposes food and event service gates", () => {
    expect(hasConditionalSectionB("food_beverage")).toBe(true);
    expect(hasConditionalSectionB("corporate_event")).toBe(true);
    expect(hasConditionalSectionB("product")).toBe(false);
  });

  it("builds food Section B with TBD styling line", () => {
    const lines = buildFoodSectionBLines();
    expect(lines[0]?.description).toMatch(/^SECTION B · 食物攝影/);
    expect(lines.some((l) => l.code === "B1.1" && /報價另議/.test(l.description))).toBe(true);
    expect(isQuoteTbdPrice(lines.find((l) => l.code === "B1.1")!.description, 0)).toBe(true);
  });

  it("builds event Section B with $800 rush fee", () => {
    const charged = buildEventSectionBLines();
    const rush = charged.find((l) => l.code === "B2")!;
    expect(rush.unitPrice).toBe(EVENT_RUSH_FEE_HKD);
    expect(rush.amount).toBe(EVENT_RUSH_FEE_HKD);
    const waived = buildEventSectionBLines({ rushWaived: true }).find((l) => l.code === "B2")!;
    expect(isQuoteWaivedPrice(waived.unitPrice, waived.amount)).toBe(true);
  });

  it("detects headers, codes, and managed rows", () => {
    expect(isQuoteSectionHeader("SECTION B · 活動攝影與線上直播")).toBe(true);
    expect(parseQuoteItemCode("B1.1 現場藝術指導")).toBe("B1.1");
    expect(isManagedSectionBItem("B2 快速交相（12小時內）")).toBe(true);
    expect(isManagedSectionBItem("Event Photoshoot")).toBe(false);
    expect(isEventRushFeeItem("B2 快速交相（12小時內）")).toBe(true);
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

    const waived = toggleEventRushWaived(withEvent);
    const rush = waived.find((i) => isEventRushFeeItem(i.description))!;
    expect(rush.amount).toBe(0);
    expect(rush.unitPrice).toBe(EVENT_RUSH_FEE_HKD);

    const kept = applySectionBForServiceType(waived, "corporate_event", createId);
    const rush2 = kept.find((i) => isEventRushFeeItem(i.description))!;
    expect(rush2.amount).toBe(0);

    const food = applySectionBForServiceType(kept, "food_beverage", createId);
    expect(food.some((i) => /食物造型/.test(i.description))).toBe(true);
    expect(food.some((i) => isEventRushFeeItem(i.description))).toBe(false);
  });

  it("lets the editor pick any priced line for strikethrough waive", () => {
    const items = [
      { id: "1", description: "Retouch", quantity: 1, unitPrice: 1200, amount: 1200 },
      { id: "2", description: "B2 快速交相（12小時內）", quantity: 1, unitPrice: 800, amount: 800 },
      { id: "3", description: "SECTION B · 活動攝影與線上直播", quantity: 0, unitPrice: 0, amount: 0 },
    ];
    expect(canToggleQuoteWaive(items[0]!)).toBe(true);
    expect(canToggleQuoteWaive(items[2]!)).toBe(false);

    const waivedRetouch = toggleQuoteItemWaived(items, 0);
    expect(waivedRetouch[0]!.amount).toBe(0);
    expect(waivedRetouch[0]!.unitPrice).toBe(1200);
    expect(waivedRetouch[1]!.amount).toBe(800);

    const restored = toggleQuoteItemWaived(waivedRetouch, 0);
    expect(restored[0]!.amount).toBe(1200);

    const waivedRush = toggleQuoteItemWaived(items, 1);
    expect(isQuoteWaivedPrice(waivedRush[1]!.unitPrice, waivedRush[1]!.amount)).toBe(true);
  });
});
