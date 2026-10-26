import { describe, expect, it } from "vitest";
import {
  appendAttributionParams,
  enrichAdsAttribution,
  hasAdsAttribution,
  landingPageFromReferer,
  normalizeAttributionForDb,
  parseAdsAttribution,
  parseAdsAttributionFromUrl,
} from "./adsAttribution";

describe("parseAdsAttribution", () => {
  it("reads gclid, campaign_id, lp and UTM from query-style keys", () => {
    const a = parseAdsAttribution({
      gclid: " Cj0KCQiw ",
      campaign_id: "24002224927",
      campaign: "Search #3",
      lp: "https://jdstudiohk.com/food-photography",
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "search-3",
    });
    expect(a.gclid).toBe("Cj0KCQiw");
    expect(a.adsCampaignId).toBe("24002224927");
    expect(a.adsCampaignName).toBe("Search #3");
    expect(a.landingPageUrl).toBe("https://jdstudiohk.com/food-photography");
    expect(a.utmSource).toBe("google");
    expect(a.utmMedium).toBe("cpc");
    expect(a.utmCampaign).toBe("search-3");
  });

  it("accepts camelCase keys used by quote forms", () => {
    const a = parseAdsAttribution({
      adsCampaignId: "111",
      landingPageUrl: "https://example.com",
      utmSource: "google",
    });
    expect(a.adsCampaignId).toBe("111");
    expect(a.landingPageUrl).toBe("https://example.com");
    expect(a.utmSource).toBe("google");
  });

  it("returns empty attribution for blank input", () => {
    expect(hasAdsAttribution(parseAdsAttribution({}))).toBe(false);
    expect(hasAdsAttribution(null)).toBe(false);
  });

  it("does not treat landing page alone as paid Ads", () => {
    expect(
      hasAdsAttribution(
        parseAdsAttribution({ lp: "https://jdstudiohk.com/food-photography" })
      )
    ).toBe(false);
    expect(
      hasAdsAttribution(
        parseAdsAttribution({ utm_source: "google", utm_medium: "cpc" })
      )
    ).toBe(true);
  });

  it("captures page referrer for organic / AI split", () => {
    const a = parseAdsAttribution({
      ref: "https://www.google.com/search?q=food",
      lp: "https://jdstudiohk.com/",
    });
    expect(a.pageReferrer).toContain("google.com");
  });

  it("reads gad_campaignid as adsCampaignId", () => {
    const a = parseAdsAttribution({ gad_campaignid: "24002224927" });
    expect(a.adsCampaignId).toBe("24002224927");
  });
});

describe("enrichAdsAttribution", () => {
  it("pulls gclid and gad_campaignid from pageReferrer when lp was stripped", () => {
    const enriched = enrichAdsAttribution({
      gclid: null,
      gbraid: null,
      wbraid: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmContent: null,
      utmTerm: null,
      adsCampaignId: null,
      adsCampaignName: null,
      landingPageUrl: "https://www.jdstudiohk.com/services/corporate-event",
      pageReferrer:
        "https://www.jdstudiohk.com/services/corporate-event?gad_source=1&gad_campaignid=24002224927&gclid=Cj0TEST&gbraid=GBRAID1",
    });
    expect(enriched.gclid).toBe("Cj0TEST");
    expect(enriched.gbraid).toBe("GBRAID1");
    expect(enriched.adsCampaignId).toBe("24002224927");
    expect(hasAdsAttribution(enriched)).toBe(true);
  });

  it("does not overwrite an existing gclid", () => {
    const enriched = enrichAdsAttribution({
      gclid: "KEEP",
      gbraid: null,
      wbraid: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmContent: null,
      utmTerm: null,
      adsCampaignId: null,
      adsCampaignName: null,
      landingPageUrl: "https://www.jdstudiohk.com/?gclid=OTHER",
      pageReferrer: null,
    });
    expect(enriched.gclid).toBe("KEEP");
  });

  it("parses attribution from a URL string", () => {
    const a = parseAdsAttributionFromUrl(
      "https://www.jdstudiohk.com/x?gclid=ABC&gad_campaignid=24002224927"
    );
    expect(a.gclid).toBe("ABC");
    expect(a.adsCampaignId).toBe("24002224927");
  });
});

describe("appendAttributionParams", () => {
  it("appends trackable params onto a WA track URL", () => {
    const url = appendAttributionParams("https://jdsys.biz/api/track/wa?src=google_ads", {
      gclid: "abc",
      adsCampaignId: "24002224927",
      landingPageUrl: "https://jdstudiohk.com/",
    });
    const u = new URL(url);
    expect(u.searchParams.get("gclid")).toBe("abc");
    expect(u.searchParams.get("campaign_id")).toBe("24002224927");
    expect(u.searchParams.get("lp")).toBe("https://jdstudiohk.com/");
    expect(u.searchParams.get("src")).toBe("google_ads");
  });
});

describe("normalizeAttributionForDb", () => {
  it("turns empty strings into null and keeps whatsappClickId", () => {
    const n = normalizeAttributionForDb({
      gclid: "  ",
      adsCampaignId: "24002224927",
      landingPageUrl: "",
      whatsappClickId: 42,
    });
    expect(n.gclid).toBeNull();
    expect(n.adsCampaignId).toBe("24002224927");
    expect(n.landingPageUrl).toBeNull();
    expect(n.whatsappClickId).toBe(42);
  });
});

describe("landingPageFromReferer", () => {
  it("keeps marketing-site referers and drops WhatsApp / track self-hits", () => {
    expect(
      landingPageFromReferer("https://jdstudiohk.com/food-photography?utm_source=google")
    ).toContain("/food-photography");
    expect(landingPageFromReferer("https://wa.me/85291531976")).toBeNull();
    expect(
      landingPageFromReferer("https://jdsys.biz/api/track/wa?src=google_ads")
    ).toBeNull();
    expect(landingPageFromReferer("")).toBeNull();
  });
});
