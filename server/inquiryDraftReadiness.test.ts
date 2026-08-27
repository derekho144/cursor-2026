import { describe, expect, it } from "vitest";
import {
  evaluateInquiryDraftReadiness,
  formatInquiryDraftNotes,
} from "../shared/inquiryDraftReadiness";

describe("evaluateInquiryDraftReadiness", () => {
  it("blocks other / low confidence / non-inquiry", () => {
    expect(
      evaluateInquiryDraftReadiness({
        serviceType: "other",
        isInquiry: true,
        confidence: "high",
        quantitySource: "explicit",
        shootHours: 4,
        suggestedItems: [{ quantity: 4, unitPrice: 1000 }],
      }).readyForAutoDraft
    ).toBe(false);

    expect(
      evaluateInquiryDraftReadiness({
        serviceType: "corporate_event",
        isInquiry: true,
        confidence: "medium",
        quantitySource: "explicit",
        shootHours: 4,
        suggestedItems: [{ quantity: 4, unitPrice: 1000 }],
      }).readyForAutoDraft
    ).toBe(false);
  });

  it("requires explicit hours for events", () => {
    const assumed = evaluateInquiryDraftReadiness({
      serviceType: "corporate_event",
      isInquiry: true,
      confidence: "high",
      quantitySource: "assumed",
      shootHours: 4,
      suggestedItems: [{ quantity: 4, unitPrice: 1000 }],
    });
    expect(assumed.readyForAutoDraft).toBe(false);
    expect(assumed.blockers.some((b) => b.includes("假設"))).toBe(true);

    const explicit = evaluateInquiryDraftReadiness({
      serviceType: "corporate_event",
      isInquiry: true,
      confidence: "high",
      quantitySource: "explicit",
      shootHours: 5,
      durationPackage: "half_day",
      suggestedItems: [{ quantity: 5, unitPrice: 950 }],
    });
    expect(explicit.readyForAutoDraft).toBe(true);
  });

  it("requires explicit shot count for product", () => {
    const missing = evaluateInquiryDraftReadiness({
      serviceType: "product",
      isInquiry: true,
      confidence: "high",
      quantitySource: "explicit",
      suggestedItems: [{ quantity: 20, unitPrice: 110 }],
    });
    expect(missing.readyForAutoDraft).toBe(false);

    const ok = evaluateInquiryDraftReadiness({
      serviceType: "product",
      isInquiry: true,
      confidence: "high",
      quantitySource: "explicit",
      shotCount: 20,
      suggestedItems: [{ quantity: 20, unitPrice: 110 }],
    });
    expect(ok.readyForAutoDraft).toBe(true);
  });

  it("allows design on high confidence without hours/shots", () => {
    const r = evaluateInquiryDraftReadiness({
      serviceType: "graphic_design",
      isInquiry: true,
      confidence: "high",
      quantitySource: "unknown",
      suggestedItems: [{ quantity: 1, unitPrice: 3000 }],
    });
    expect(r.readyForAutoDraft).toBe(true);
    expect(r.pricingMode).toBe("design");
  });

  it("blocks auto-draft when learning is not ready", () => {
    const r = evaluateInquiryDraftReadiness({
      serviceType: "corporate_event",
      isInquiry: true,
      confidence: "high",
      quantitySource: "explicit",
      shootHours: 5,
      durationPackage: "half_day",
      suggestedItems: [{ quantity: 5, unitPrice: 950 }],
      learningReady: false,
    });
    expect(r.readyForAutoDraft).toBe(false);
    expect(r.blockers.some((b) => b.includes("定價學習"))).toBe(true);
  });

  it("blocks when attachmentStatus is missing", () => {
    const r = evaluateInquiryDraftReadiness({
      serviceType: "corporate_event",
      isInquiry: true,
      confidence: "high",
      quantitySource: "explicit",
      shootHours: 5,
      durationPackage: "half_day",
      suggestedItems: [{ quantity: 5, unitPrice: 950 }],
      attachmentStatus: "missing",
      learningReady: true,
    });
    expect(r.readyForAutoDraft).toBe(false);
    expect(r.missingFields).toContain("attachmentText");
  });
});

describe("formatInquiryDraftNotes", () => {
  it("includes assumptions block", () => {
    const notes = formatInquiryDraftNotes({
      fromEmail: "a@b.com",
      subject: "Shoot",
      aiNotes: "需要活動攝影",
      autoDraft: true,
      readiness: evaluateInquiryDraftReadiness({
        serviceType: "corporate_event",
        isInquiry: true,
        confidence: "high",
        quantitySource: "assumed",
        shootHours: 4,
        assumptions: ["假設半日 4 小時"],
        suggestedItems: [{ quantity: 4, unitPrice: 1000 }],
      }),
    });
    expect(notes).toContain("假設半日 4 小時");
    expect(notes).toContain("AI 自動草稿");
  });
});

describe("comprehension gap blocks auto-draft", () => {
  it("blocks when work packages were dropped", () => {
    const r = evaluateInquiryDraftReadiness({
      serviceType: "corporate_event",
      isInquiry: true,
      confidence: "high",
      quantitySource: "explicit",
      shootHours: 5,
      durationPackage: "half_day",
      comprehensionGaps: ["原文有「約 200 件／張拍攝或交付」，解析未覆蓋"],
      suggestedItems: [{ quantity: 5, unitPrice: 950 }],
      learningReady: true,
    });
    expect(r.readyForAutoDraft).toBe(false);
    expect(r.blockers.some((b) => b.includes("閱讀理解缺口"))).toBe(true);
  });
});
