import { describe, expect, it } from "vitest";
import {
  campaignIdFromLandingUrl,
  isProbeAdsWaClick,
  rankAdsWaClicksForPicker,
} from "./adsWaClickQuality";

describe("isProbeAdsWaClick", () => {
  it("flags deploy / template tracking rows", () => {
    expect(isProbeAdsWaClick({ gclid: "test-deploy-check" })).toBe(true);
    expect(isProbeAdsWaClick({ gclid: "deploy-check-179" })).toBe(true);
    expect(isProbeAdsWaClick({ gclid: "{gclid}" })).toBe(true);
    expect(isProbeAdsWaClick({ gclid: "testgclid123" })).toBe(true);
    expect(isProbeAdsWaClick({ landingPageUrl: "https://x/{lpurl}" })).toBe(true);
    expect(isProbeAdsWaClick({ adsCampaignId: "{campaignid}" })).toBe(true);
    expect(isProbeAdsWaClick({ refCode: "wa-test" })).toBe(true);
  });

  it("keeps real Ads click with gclid", () => {
    expect(
      isProbeAdsWaClick({
        gclid: "EAIaIQobChMI9-j_puXSlwMVblUPAh2bPQpuEAAY",
        landingPageUrl:
          "https://www.jdstudiohk.com/services/corporate-event?gad_campaignid=24386962688",
        matchedPhone: "85253031277",
      })
    ).toBe(false);
  });
});

describe("rankAdsWaClicksForPicker", () => {
  it("puts matching phone first and drops probes", () => {
    const ranked = rankAdsWaClicksForPicker(
      [
        {
          id: 1,
          gclid: "test-deploy",
          matchedPhone: "85253031277",
          clickedAt: "2026-10-24T13:00:00Z",
        },
        {
          id: 2,
          gclid: "EAIaRealOther",
          matchedPhone: "85251380549",
          clickedAt: "2026-10-24T14:00:00Z",
        },
        {
          id: 4110001,
          gclid: "EAIaIQobChMI9-j_puXSlwMVblUPAh2bPQpuEAAY",
          matchedPhone: "85253031277",
          clickedAt: "2026-10-24T13:47:00Z",
        },
      ],
      { preferPhoneDigits: "85253031277" }
    );
    expect(ranked.map((c) => c.id)).toEqual([4110001, 2]);
  });
});

describe("campaignIdFromLandingUrl", () => {
  it("reads gad_campaignid", () => {
    expect(
      campaignIdFromLandingUrl(
        "https://www.jdstudiohk.com/services/corporate-event?gad_source=1&gad_campaignid=24386962688&gclid=x"
      )
    ).toBe("24386962688");
  });
});
