import { describe, expect, it } from "vitest";
import { buildTrustedServiceNegativeQueue } from "./adsActionQueue";
import { canAutoExecuteAdsAction } from "./adsActionExecution";

describe("canAutoExecuteAdsAction", () => {
  it("allows only trusted-negative queue items", () => {
    const trusted = buildTrustedServiceNegativeQueue();
    expect(trusted.every((item) => canAutoExecuteAdsAction(item))).toBe(true);
    expect(
      canAutoExecuteAdsAction({
        ...trusted[0],
        id: "interior-photography:keyword-review",
      })
    ).toBe(false);
  });
});
