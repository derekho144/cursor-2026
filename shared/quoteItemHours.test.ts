import { describe, expect, it } from "vitest";
import {
  formatHourlyQuantityAdjustments,
  looksLikeFlatPackageLineItem,
  reconcileHourlyQuoteItems,
} from "./quoteItemHours";

describe("reconcileHourlyQuoteItems", () => {
  it("aligns quantity to hours in Event Photography (8 hours)", () => {
    const { items, adjustments } = reconcileHourlyQuoteItems("corporate_event", [
      {
        description: "Event Photography (8 hours)",
        quantity: 1,
        unitPrice: 1000,
        amount: 1000,
      },
      {
        description: "Transportation Fee",
        quantity: 1,
        unitPrice: 320,
        amount: 320,
      },
    ]);

    expect(adjustments).toHaveLength(1);
    expect(items[0].quantity).toBe(8);
    expect(items[0].amount).toBe(8000);
    expect(items[1].quantity).toBe(1);
  });

  it("skips product shot-count quotes", () => {
    const { adjustments } = reconcileHourlyQuoteItems("product", [
      {
        description: "Product Photography (8 hours)",
        quantity: 1,
        unitPrice: 130,
      },
    ]);
    expect(adjustments).toHaveLength(0);
  });

  it("leaves quantity unchanged when already matches per-hour line", () => {
    const { adjustments } = reconcileHourlyQuoteItems("corporate_event", [
      {
        description: "Event Photography",
        quantity: 8,
        unitPrice: 1000,
      },
    ]);
    expect(adjustments).toHaveLength(0);
  });

  it("skips flat package lines (qty 1 @ high unit price)", () => {
    const { items, adjustments } = reconcileHourlyQuoteItems("corporate_event", [
      {
        description: "Event Photography (8 hours)",
        quantity: 1,
        unitPrice: 7000,
        amount: 7000,
      },
      {
        description: "Event Videograph (8 hours)",
        quantity: 1,
        unitPrice: 7000,
        amount: 7000,
      },
    ]);
    expect(adjustments).toHaveLength(0);
    expect(items[0].quantity).toBe(1);
    expect(items[0].amount).toBe(7000);
    expect(items[1].quantity).toBe(1);
  });

  it("still reconciles when unit price looks per-hour", () => {
    const { items, adjustments } = reconcileHourlyQuoteItems("corporate_event", [
      {
        description: "Event Photography (8 hours)",
        quantity: 1,
        unitPrice: 1000,
        amount: 1000,
      },
    ]);
    expect(adjustments).toHaveLength(1);
    expect(items[0].quantity).toBe(8);
    expect(items[0].amount).toBe(8000);
  });

  it("keeps PhotoBooth / PhotoPrint / 全天直播 as qty 1 packages", () => {
    const { items, adjustments } = reconcileHourlyQuoteItems("corporate_event", [
      {
        description: "1.PhotoBooth (2小時)",
        quantity: 1,
        unitPrice: 4500,
        amount: 4500,
      },
      {
        description: "2.PhotoPrint (2小時)",
        quantity: 1,
        unitPrice: 3000,
        amount: 3000,
      },
      {
        description: "3. 圖片直播 QR實時下載相片 (全天) 人面識別",
        quantity: 1,
        unitPrice: 3850,
        amount: 3850,
      },
    ]);
    expect(adjustments).toHaveLength(0);
    expect(items.map((i) => i.quantity)).toEqual([1, 1, 1]);
    expect(items.map((i) => i.amount)).toEqual([4500, 3000, 3850]);
  });

  it("reverses mistaken qty=hours on package add-ons", () => {
    const { items, adjustments } = reconcileHourlyQuoteItems("corporate_event", [
      {
        description: "1.PhotoBooth (2小時)",
        quantity: 2,
        unitPrice: 4500,
        amount: 9000,
      },
      {
        description: "2.PhotoPrint (2小時)",
        quantity: 2,
        unitPrice: 3000,
        amount: 6000,
      },
      {
        description: "3. 圖片直播 QR實時下載相片 (全天) 人面識別",
        quantity: 8,
        unitPrice: 3850,
        amount: 30800,
      },
    ]);
    expect(adjustments).toHaveLength(3);
    expect(items[0]).toMatchObject({ quantity: 1, amount: 4500 });
    expect(items[1]).toMatchObject({ quantity: 1, amount: 3000 });
    expect(items[2]).toMatchObject({ quantity: 1, amount: 3850 });
  });

  it("does not flatten explicit per-hour add-ons", () => {
    const { items, adjustments } = reconcileHourlyQuoteItems("corporate_event", [
      {
        description: "額外每小時",
        quantity: 0,
        unitPrice: 1500,
        amount: 0,
      },
    ]);
    expect(adjustments).toHaveLength(0);
    expect(items[0].quantity).toBe(0);
  });
});

describe("looksLikeFlatPackageLineItem", () => {
  it("treats paren duration and livestream as packages", () => {
    expect(
      looksLikeFlatPackageLineItem(
        { description: "PhotoPrint (2小時)", quantity: 2, unitPrice: 3000 },
        2
      )
    ).toBe(true);
    expect(
      looksLikeFlatPackageLineItem(
        {
          description: "圖片直播 QR實時下載相片 (全天) 人面識別",
          quantity: 8,
          unitPrice: 3850,
        },
        8
      )
    ).toBe(true);
  });
});

describe("formatHourlyQuantityAdjustments", () => {
  it("formats adjustment summary", () => {
    const msg = formatHourlyQuantityAdjustments([
      {
        description: "Event Photography (8 hours)",
        previousQuantity: 1,
        nextQuantity: 8,
        hoursFromText: 8,
      },
    ]);
    expect(msg).toContain("1→8");
    expect(msg).toContain("8 小時");
  });
});
