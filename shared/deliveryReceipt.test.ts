import { describe, expect, it } from "vitest";
import { isDeliveryReceiptEnabled } from "./deliveryReceipt";

describe("isDeliveryReceiptEnabled", () => {
  it("respects explicit flag", () => {
    expect(isDeliveryReceiptEnabled({ receiptEnabled: true, quoteId: null })).toBe(true);
    expect(isDeliveryReceiptEnabled({ receiptEnabled: false, quoteId: 12 })).toBe(false);
  });

  it("falls back to quote linkage when flag missing", () => {
    expect(isDeliveryReceiptEnabled({ quoteId: 9 })).toBe(true);
    expect(isDeliveryReceiptEnabled({ quoteId: null })).toBe(false);
    expect(isDeliveryReceiptEnabled({})).toBe(false);
  });
});
