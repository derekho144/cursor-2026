import { describe, expect, it } from "vitest";
import {
  GRAPHIC_DESIGN_SERVICE_NOTES,
  PRODUCT_RECEIVING_ADDRESS,
  PRODUCT_RECEIVING_ADDRESS_NOTE,
  applyServiceNotes,
  isGraphicDesignManagedNote,
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

  it("recognises graphic-design managed note lines", () => {
    for (const line of GRAPHIC_DESIGN_SERVICE_NOTES.split("\n")) {
      if (!line.trim()) continue;
      expect(isGraphicDesignManagedNote(line)).toBe(true);
    }
    expect(isGraphicDesignManagedNote("其他備註")).toBe(false);
    expect(
      isGraphicDesignManagedNote("【修改次數與範圍 (Revisions & Changes)】")
    ).toBe(true);
  });

  it("injects revisions + copyright notes for graphic_design", () => {
    expect(applyServiceNotes("", "graphic_design")).toBe(
      GRAPHIC_DESIGN_SERVICE_NOTES
    );
    expect(applyServiceNotes("請用品牌色", "graphic_design")).toBe(
      `請用品牌色\n\n${GRAPHIC_DESIGN_SERVICE_NOTES}`
    );
    expect(
      applyServiceNotes(GRAPHIC_DESIGN_SERVICE_NOTES, "graphic_design")
    ).toBe(GRAPHIC_DESIGN_SERVICE_NOTES);
  });

  it("strips graphic-design notes when leaving graphic_design", () => {
    const mixed = `客戶要求\n\n${GRAPHIC_DESIGN_SERVICE_NOTES}`;
    expect(applyServiceNotes(mixed, "product")).toBe(
      `客戶要求\n${PRODUCT_RECEIVING_ADDRESS_NOTE}`
    );
    expect(applyServiceNotes(GRAPHIC_DESIGN_SERVICE_NOTES, "jewelry")).toBe("");
  });

  it("includes 3 free revisions and portfolio rights wording", () => {
    expect(GRAPHIC_DESIGN_SERVICE_NOTES).toContain("3次免費修改機會");
    expect(GRAPHIC_DESIGN_SERVICE_NOTES).toContain("商業使用權將轉讓予客戶");
    expect(GRAPHIC_DESIGN_SERVICE_NOTES).toContain(
      "JD STUDIO HK 保留將是次設計成品用於公司作品集"
    );
  });
});
