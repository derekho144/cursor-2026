import { describe, expect, it } from "vitest";
import {
  DESIGN_SERVICE_TYPES,
  quotePricingMode,
} from "./quotePricingMode";

describe("quotePricingMode", () => {
  it("treats KOL/MI 推廣 like design: no shoot hours / schedule fields", () => {
    expect(DESIGN_SERVICE_TYPES.has("kol_mi")).toBe(true);
    expect(quotePricingMode("kol_mi")).toBe("design");
  });

  it("keeps event shoots on time_crew and product on shot_count", () => {
    expect(quotePricingMode("corporate_event")).toBe("time_crew");
    expect(quotePricingMode("product")).toBe("shot_count");
    expect(quotePricingMode("graphic_design")).toBe("design");
  });
});
