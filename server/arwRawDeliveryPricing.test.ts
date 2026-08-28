import { describe, expect, it } from "vitest";
import {
  ARW_RAW_DELIVERY_DESCRIPTION,
  ARW_RAW_DELIVERY_UNIT_PRICE,
  arwRawDeliveryBillingRulesText,
  buildArwRawDeliveryLineItem,
  hasArwRawDeliverySignal,
  suggestedItemsIncludeArwRaw,
  syncInquiryPricingFromItems,
} from "../shared/arwRawDeliveryPricing";
import { refineInquiryParseWithExtractors } from "./inquiryParseRefine";

describe("hasArwRawDeliverySignal", () => {
  it("detects ARW file deliverable requests", () => {
    expect(
      hasArwRawDeliverySignal(
        "Please deliver final images in JPEG and ARW format via cloud link."
      )
    ).toBe(true);
    expect(hasArwRawDeliverySignal("需交回 ARW 原檔及精修 JPEG")).toBe(true);
    expect(hasArwRawDeliverySignal("Submit all .arw files with edited JPGs")).toBe(
      true
    );
    expect(hasArwRawDeliverySignal("Provide camera raw files for archive")).toBe(
      true
    );
  });

  it("does not trigger on unrelated raw wording", () => {
    expect(hasArwRawDeliverySignal("Draw the layout in raw sketch form")).toBe(
      false
    );
    expect(hasArwRawDeliverySignal("Event photography for 3 hours")).toBe(false);
  });
});

describe("buildArwRawDeliveryLineItem", () => {
  it("uses flat per-shoot pricing", () => {
    expect(buildArwRawDeliveryLineItem()).toEqual({
      description: ARW_RAW_DELIVERY_DESCRIPTION,
      quantity: 1,
      unitPrice: ARW_RAW_DELIVERY_UNIT_PRICE,
    });
  });
});

describe("suggestedItemsIncludeArwRaw", () => {
  it("recognizes existing ARW lines", () => {
    expect(
      suggestedItemsIncludeArwRaw([
        { description: "Event Photography (3 hours)" },
        { description: ARW_RAW_DELIVERY_DESCRIPTION },
      ])
    ).toBe(true);
    expect(
      suggestedItemsIncludeArwRaw([{ description: "Event Photography" }])
    ).toBe(false);
  });
});

describe("syncInquiryPricingFromItems", () => {
  it("recomputes pricing bands from suggestedItems", () => {
    const parsed: Record<string, unknown> = {
      suggestedItems: [
        { description: "Event Photography (3 hours)", quantity: 1, unitPrice: 3000 },
        buildArwRawDeliveryLineItem(),
        { description: "Transportation Fee", quantity: 1, unitPrice: 320 },
      ],
    };
    syncInquiryPricingFromItems(parsed);
    expect(parsed.pricingMid).toBe(4320);
    expect(parsed.pricingLow).toBe(3000);
    expect(parsed.pricingHigh).toBe(5800);
  });
});

describe("arwRawDeliveryBillingRulesText", () => {
  it("documents ARW as extra charge", () => {
    const text = arwRawDeliveryBillingRulesText();
    expect(text).toContain("EXTRA CHARGE");
    expect(text).toContain(ARW_RAW_DELIVERY_DESCRIPTION);
    expect(text).toContain(String(ARW_RAW_DELIVERY_UNIT_PRICE));
  });
});

describe("refineInquiryParseWithExtractors ARW", () => {
  it("adds RAW/ARW line item for HKCAAVQ-style RFQ", () => {
    const refined = refineInquiryParseWithExtractors({
      subject: "(HKCAAVQ) Request for Quotation - Photography Service (21 September 2026)",
      body: `Duration: approx. 3 hours
Time: 10:00 am - 12:00 pm
* ONE photographer to take standard individual, group photos AND snapshots
* Deliver edited JPEG and ARW files via secure link within 10 working days`,
      parsed: {
        serviceType: "corporate_event",
        shootHours: 3,
        crewPhotographers: 1,
        quantitySource: "explicit",
        assumptions: [],
        missingFields: [],
        suggestedItems: [
          { description: "Event Photography (3 hours)", quantity: 1, unitPrice: 3000 },
          { description: "Transportation Fee", quantity: 1, unitPrice: 320 },
        ],
        pricingMid: 3320,
        pricingLow: 2300,
        pricingHigh: 4500,
      },
    });

    expect(
      refined.suggestedItems.some(
        (it: { description: string }) => it.description === ARW_RAW_DELIVERY_DESCRIPTION
      )
    ).toBe(true);
    expect(refined.pricingMid).toBe(4320);
    expect(refined.assumptions).toContainEqual(
      `客人要求交付 RAW/ARW 原檔（額外收費 HKD ${ARW_RAW_DELIVERY_UNIT_PRICE}）`
    );
  });

  it("does not duplicate when LLM already added ARW line", () => {
    const refined = refineInquiryParseWithExtractors({
      subject: "Photography RFQ",
      body: "Please provide ARW files.",
      parsed: {
        serviceType: "corporate_event",
        assumptions: [],
        missingFields: [],
        suggestedItems: [
          { description: ARW_RAW_DELIVERY_DESCRIPTION, quantity: 1, unitPrice: 1000 },
        ],
      },
    });
    const arwLines = refined.suggestedItems.filter((it: { description: string }) =>
      it.description.includes("ARW")
    );
    expect(arwLines).toHaveLength(1);
  });
});
