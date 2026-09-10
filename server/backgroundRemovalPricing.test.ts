import { describe, expect, it } from "vitest";
import {
  backgroundRemovalLineTotal,
  backgroundRemovalUnitPrice,
  backgroundRemovalBillingRulesText,
  multiScopeBillingRulesText,
} from "../shared/backgroundRemovalPricing";

describe("backgroundRemovalUnitPrice", () => {
  it("applies volume tiers", () => {
    expect(backgroundRemovalUnitPrice(10)).toBe(150);
    expect(backgroundRemovalUnitPrice(30)).toBe(120);
    expect(backgroundRemovalUnitPrice(80)).toBe(100);
    expect(backgroundRemovalUnitPrice(200)).toBe(80);
  });

  it("totals 200 cutouts at volume rate", () => {
    const line = backgroundRemovalLineTotal(200);
    expect(line).toEqual({ quantity: 200, unitPrice: 80, amount: 16000 });
  });
});

describe("billing rule text", () => {
  it("mentions 去背 as separate charge and multi-scope", () => {
    expect(backgroundRemovalBillingRulesText()).toContain("去背");
    expect(backgroundRemovalBillingRulesText()).toContain(
      "Background Removal (Cutout)"
    );
    expect(multiScopeBillingRulesText()).toContain("MULTI-SCOPE");
    expect(multiScopeBillingRulesText()).toContain("作品特寫");
  });
});
