import { describe, expect, it } from "vitest";
import {
  hasPaidAdsSignal,
  inferSearchLeadSource,
  inferWaTrackSource,
  leadSourceLabel,
} from "./leadChannels";

describe("leadChannels Ads vs Organic vs AI", () => {
  it("treats gclid / paid UTM as Google Ads", () => {
    expect(inferSearchLeadSource({ gclid: "Cj0" })).toBe("Google");
    expect(
      inferSearchLeadSource({ utmSource: "google", utmMedium: "cpc" })
    ).toBe("Google");
    expect(inferWaTrackSource({ adsCampaignId: "2400" })).toBe("google_ads");
    expect(hasPaidAdsSignal({ landingPageUrl: "https://jdstudiohk.com/" })).toBe(
      false
    );
  });

  it("treats utm_medium=organic / search referrer as Organic", () => {
    expect(
      inferSearchLeadSource({
        utmSource: "google",
        utmMedium: "organic",
        landingPageUrl: "https://jdstudiohk.com/food-photography",
      })
    ).toBe("Organic");
    expect(
      inferSearchLeadSource({
        pageReferrer: "https://www.google.com/search?q=food+photography+hong+kong",
        landingPageUrl: "https://jdstudiohk.com/food-photography",
      })
    ).toBe("Organic");
    expect(
      inferWaTrackSource({ utmMedium: "organic", utmSource: "google" })
    ).toBe("organic");
  });

  it("treats chatgpt / AI referrers as AI", () => {
    expect(
      inferSearchLeadSource({
        utmSource: "chatgpt",
        utmMedium: "ai",
        landingPageUrl: "https://jdstudiohk.com/",
      })
    ).toBe("AI");
    expect(
      inferSearchLeadSource({
        pageReferrer: "https://chatgpt.com/",
        landingPageUrl: "https://jdstudiohk.com/event-photography",
      })
    ).toBe("AI");
    expect(inferWaTrackSource({ utmSource: "perplexity" })).toBe("ai");
  });

  it("falls back to Website for bare site traffic", () => {
    expect(
      inferSearchLeadSource({
        src: "website",
        landingPageUrl: "https://jdstudiohk.com/",
      })
    ).toBe("Website");
    expect(leadSourceLabel("Website")).toBe("網站直訪");
    expect(leadSourceLabel("Organic")).toBe("SEO／GEO 自然搜尋");
    expect(leadSourceLabel("AI")).toBe("AI／AEO（ChatGPT 等）");
  });

  it("paid wins over organic-looking UTM when click id present", () => {
    expect(
      inferSearchLeadSource({
        gclid: "x",
        utmMedium: "organic",
        utmSource: "google",
      })
    ).toBe("Google");
  });
});
