import { describe, expect, it } from "vitest";
import {
  PRODUCT_RECEIVING_ADDRESS,
  PRODUCT_RECEIVING_ADDRESS_NOTE,
  applyServiceNotes,
  isProductReceivingAddressNote,
} from "./quoteServiceNotes";

describe("quoteServiceNotes", () => {
  it("recognises the product receiving-address line", () => {
    expect(isProductReceivingAddressNote(PRODUCT_RECEIVING_ADDRESS_NOTE)).toBe(
      true
    );
    expect(
      isProductReceivingAddressNote(
        `收貨地址 ${PRODUCT_RECEIVING_ADDRESS}`
      )
    ).toBe(true);
    expect(isProductReceivingAddressNote("其他備註")).toBe(false);
  });

  it("injects receiving address for product and keeps other notes", () => {
    expect(applyServiceNotes("", "product")).toBe(PRODUCT_RECEIVING_ADDRESS_NOTE);
    expect(applyServiceNotes("請早上送貨", "product")).toBe(
      `請早上送貨\n${PRODUCT_RECEIVING_ADDRESS_NOTE}`
    );
    // idempotent
    expect(
      applyServiceNotes(PRODUCT_RECEIVING_ADDRESS_NOTE, "product")
    ).toBe(PRODUCT_RECEIVING_ADDRESS_NOTE);
  });

  it("strips managed product note when leaving product", () => {
    const mixed = `客戶要求白底\n${PRODUCT_RECEIVING_ADDRESS_NOTE}`;
    expect(applyServiceNotes(mixed, "corporate_event")).toBe("客戶要求白底");
    expect(applyServiceNotes(PRODUCT_RECEIVING_ADDRESS_NOTE, "jewelry")).toBe(
      ""
    );
  });
});
