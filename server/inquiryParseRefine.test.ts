import { describe, expect, it } from "vitest";
import {
  buildInquiryClassifyText,
  hintServiceTypeFromText,
  refineInquiryParseWithExtractors,
  resolveInquiryCrewCounts,
} from "./inquiryParseRefine";

describe("buildInquiryClassifyText", () => {
  it("includes subject, body, and PDF section beyond first 300 chars", () => {
    const body =
      "詳見附件 brief。\n" +
      "x".repeat(400) +
      "\n=== PDF ATTACHMENT TEXT ===\n產品白底攝影 30張\n";
    const text = buildInquiryClassifyText("產品報價", body, 2500);
    expect(text).toContain("Subject: 產品報價");
    expect(text).toContain("PDF ATTACHMENT");
    expect(text).toContain("30張");
    expect(text.length).toBeGreaterThan(300);
  });
});

describe("hintServiceTypeFromText", () => {
  it("detects kol_mi and product", () => {
    expect(hintServiceTypeFromText("想找 KOL 推廣合作")).toBe("kol_mi");
    expect(hintServiceTypeFromText("需要產品攝影白底 20 張")).toBe("product");
  });
});

describe("refineInquiryParseWithExtractors", () => {
  it("clears assumed LLM hours when email has no duration signal", () => {
    const refined = refineInquiryParseWithExtractors({
      subject: "活動攝影報價",
      body: "你好，想查詢活動攝影，詳情再傾。",
      parsed: {
        serviceType: "corporate_event",
        shootHours: 5,
        shotCount: 0,
        durationPackage: "half_day",
        quantitySource: "explicit",
        assumptions: [],
        missingFields: [],
        suggestedItems: [
          {
            description: "Event Photography (assumed 5 hours)",
            quantity: 5,
            unitPrice: 950,
          },
        ],
      },
    });
    expect(refined.shootHours).toBe(0);
    expect(refined.durationPackage).toBe("unknown");
    expect(refined.quantitySource).toBe("assumed");
    expect(refined.missingFields).toContain("shootHours");
  });

  it("promotes explicit hours from text over LLM default", () => {
    const refined = refineInquiryParseWithExtractors({
      subject: "開幕活動",
      body: "需要活動攝影 3小時，兩位攝影師。",
      parsed: {
        serviceType: "corporate_event",
        shootHours: 5,
        shotCount: 0,
        durationPackage: "unknown",
        crewPhotographers: 0,
        quantitySource: "assumed",
        assumptions: ["假設 5 小時"],
        missingFields: ["shootHours"],
        suggestedItems: [],
      },
    });
    expect(refined.shootHours).toBe(3);
    expect(refined.quantitySource).toBe("explicit");
    expect(refined.crewPhotographers).toBe(2);
  });

  it("clears assumed shot count for product when no 張數 signal", () => {
    const refined = refineInquiryParseWithExtractors({
      subject: "產品攝影",
      body: "想影產品，數量未定。",
      parsed: {
        serviceType: "product",
        shootHours: 0,
        shotCount: 20,
        quantitySource: "explicit",
        assumptions: [],
        missingFields: [],
        suggestedItems: [
          { description: "Product Photography (assumed 20)", quantity: 20, unitPrice: 110 },
        ],
      },
    });
    expect(refined.shotCount).toBe(0);
    expect(refined.quantitySource).toBe("assumed");
    expect(refined.missingFields).toContain("shotCount");
  });

  it("keeps explicit shot count from text", () => {
    const refined = refineInquiryParseWithExtractors({
      subject: "產品",
      body: "白底產品攝影 25張",
      parsed: {
        serviceType: "product",
        shotCount: 20,
        quantitySource: "assumed",
        assumptions: [],
        missingFields: [],
        suggestedItems: [],
      },
    });
    expect(refined.shotCount).toBe(25);
    expect(refined.quantitySource).toBe("explicit");
  });

  it("treats half-day wording as explicit duration", () => {
    const refined = refineInquiryParseWithExtractors({
      subject: "活動",
      body: "需要半日活動攝影",
      parsed: {
        serviceType: "corporate_event",
        shootHours: 0,
        durationPackage: "unknown",
        quantitySource: "unknown",
        assumptions: [],
        missingFields: [],
        suggestedItems: [],
      },
    });
    expect(refined.durationPackage).toBe("half_day");
    expect(refined.shootHours).toBe(4);
    expect(refined.quantitySource).toBe("explicit");
  });

  it("overrides wrong LLM crew when email says ONE photographer", () => {
    const refined = refineInquiryParseWithExtractors({
      subject: "(HKCAAVQ) Request for Quotation - Photography Service",
      body: `Duration: approx. 3 hours
Time: 10:00 am - 12:00 pm
* ONE photographer to take standard individual, group photos AND snapshots`,
      parsed: {
        serviceType: "corporate_event",
        shootHours: 3,
        shotCount: 0,
        crewPhotographers: 4,
        quantitySource: "explicit",
        assumptions: ["派遣1名攝影師"],
        missingFields: [],
        suggestedItems: [
          { description: "Event Photography (3 hours)", quantity: 3, unitPrice: 950 },
        ],
      },
    });
    expect(refined.crewPhotographers).toBe(1);
    expect(refined.suggestedItems[0].quantity).toBe(1);
  });
});

describe("resolveInquiryCrewCounts", () => {
  it("clamps LLM crew=4 when email says ONE photographer", () => {
    const resolved = resolveInquiryCrewCounts({
      subject: "Photography RFQ",
      body: "* ONE photographer to take standard individual and group photos",
      aiParsed: {
        crewPhotographers: 4,
        shootHours: 3,
        assumptions: ["派遣1名攝影師"],
      },
    });
    expect(resolved.crewPhotographers).toBe(1);
  });

  it("fixes crew=hours confusion (3h → 3 photographers)", () => {
    const resolved = resolveInquiryCrewCounts({
      subject: "Event photo",
      body: "ONE photographer for approx. 3 hours",
      aiParsed: { crewPhotographers: 3, shootHours: 3 },
    });
    expect(resolved.crewPhotographers).toBe(1);
  });

  it("keeps explicit multi-photographer requests", () => {
    const resolved = resolveInquiryCrewCounts({
      subject: "活動攝影",
      body: "需要兩位攝影師，拍攝約 4 小時",
      aiParsed: { crewPhotographers: 2, shootHours: 4 },
    });
    expect(resolved.crewPhotographers).toBe(2);
  });

  it("extracts two photographers from English words over wrong LLM count", () => {
    const resolved = resolveInquiryCrewCounts({
      subject: "Event coverage",
      body: "We need two photographers for a 4-hour corporate event.",
      aiParsed: { crewPhotographers: 1, shootHours: 4 },
    });
    expect(resolved.crewPhotographers).toBe(2);
  });
});
