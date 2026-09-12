import { describe, expect, it } from "vitest";
import {
  applyAttachmentUnderstandingToParsed,
  mentionsRequirementsAttachment,
  resolveAttachmentUnderstanding,
} from "../shared/emailAttachmentUnderstanding";
import { evaluateInquiryDraftReadiness } from "../shared/inquiryDraftReadiness";

describe("mentionsRequirementsAttachment", () => {
  it("detects Chinese and English cues (including relaxed phrasing)", () => {
    expect(mentionsRequirementsAttachment("詳情請見附件。謝謝")).toBe(true);
    expect(mentionsRequirementsAttachment("Please find the attached brief")).toBe(
      true
    );
    expect(
      mentionsRequirementsAttachment("Please see the attachment for details")
    ).toBe(true);
    expect(mentionsRequirementsAttachment("I have attached the RFQ")).toBe(true);
    expect(mentionsRequirementsAttachment("PFA the shot list")).toBe(true);
    expect(mentionsRequirementsAttachment("請查收附件 brief")).toBe(true);
    expect(mentionsRequirementsAttachment("附上需求說明")).toBe(true);
    expect(
      mentionsRequirementsAttachment("We need 3 hours event photography on Nov 2")
    ).toBe(false);
  });
});

describe("resolveAttachmentUnderstanding", () => {
  it("treats plain body RFQs as none (no attachment required)", () => {
    const r = resolveAttachmentUnderstanding({
      subject: "Graduation photography",
      bodyText: "3 hours on 2 Nov at HA Building, 40 retouched photos.",
      attachmentText: "",
      pdfFileCount: 0,
    });
    expect(r.status).toBe("none");
    expect(r.blockers).toHaveLength(0);
  });

  it("marks used when attachment text is present", () => {
    const r = resolveAttachmentUnderstanding({
      subject: "Quote",
      bodyText: "詳情請見附件",
      attachmentText: "Award ceremony 19 Dec 2026 City Hall…",
      pdfFileCount: 1,
    });
    expect(r.status).toBe("used");
  });

  it("marks missing when body points to attachment but no text", () => {
    const r = resolveAttachmentUnderstanding({
      subject: "攝影報價",
      bodyText: "擬向貴司查詢攝影報價，詳情請見附件。",
      attachmentText: "",
      attachmentFileCount: 0,
    });
    expect(r.status).toBe("missing");
    expect(r.blockers[0]).toMatch(/未讀到|未能|指明/);
  });

  it("marks missing when readable files present but OCR/text empty", () => {
    const r = resolveAttachmentUnderstanding({
      subject: "Brief",
      bodyText: "See attached",
      attachmentText: "",
      attachmentFileCount: 1,
    });
    expect(r.status).toBe("missing");
    expect(r.missingFields).toContain("attachmentText");
  });

  it("marks unsupported when non-extractable files present (not none)", () => {
    const r = resolveAttachmentUnderstanding({
      subject: "RFQ",
      bodyText: "Please quote as discussed.",
      attachmentText: "",
      pdfFileCount: 0,
      unsupportedFiles: ["brief.doc", "budget.xlsx"],
    });
    expect(r.status).toBe("unsupported");
    expect(r.hasUnsupportedFiles).toBe(true);
    expect(r.unsupportedFiles).toContain("brief.doc");
    expect(r.blockers[0]).toMatch(/不支援|格式/);
  });
});

describe("applyAttachmentUnderstandingToParsed + readiness", () => {
  it("downgrades confidence and blocks auto-draft when attachment missing", () => {
    const understanding = resolveAttachmentUnderstanding({
      subject: "A",
      bodyText: "詳見附件",
      attachmentText: "",
      pdfFileCount: 0,
    });
    const parsed = applyAttachmentUnderstandingToParsed(
      {
        serviceType: "corporate_event",
        isInquiry: true,
        confidence: "high",
        quantitySource: "assumed",
        shootHours: 4,
        missingFields: [],
        assumptions: [],
        suggestedItems: [{ quantity: 4, unitPrice: 920 }],
      },
      understanding
    );
    expect(parsed.confidence).toBe("medium");
    expect(parsed.attachmentStatus).toBe("missing");

    const readiness = evaluateInquiryDraftReadiness({
      ...parsed,
      learningReady: true,
    });
    expect(readiness.readyForAutoDraft).toBe(false);
    expect(readiness.blockers.some((b) => b.includes("附件"))).toBe(true);
  });

  it("blocks auto-draft for unsupported attachment formats", () => {
    const understanding = resolveAttachmentUnderstanding({
      subject: "Expo",
      bodyText: "Please see the attachment",
      attachmentText: "",
      unsupportedFiles: ["ifx-brief.doc"],
    });
    const parsed = applyAttachmentUnderstandingToParsed(
      {
        serviceType: "corporate_event",
        isInquiry: true,
        confidence: "high",
        quantitySource: "explicit",
        shootHours: 5,
        missingFields: [],
        assumptions: [],
        suggestedItems: [{ quantity: 5, unitPrice: 900 }],
      },
      understanding
    );
    expect(parsed.attachmentStatus).toBe("unsupported");
    const readiness = evaluateInquiryDraftReadiness({
      ...parsed,
      learningReady: true,
    });
    expect(readiness.readyForAutoDraft).toBe(false);
    expect(readiness.blockers.some((b) => /不支援|附件/.test(b))).toBe(true);
  });

  it("does not block plain-body explicit RFQs", () => {
    const understanding = resolveAttachmentUnderstanding({
      subject: "Graduation",
      bodyText: "3 hours photography 2 Nov 2026",
      attachmentText: "",
      pdfFileCount: 0,
    });
    expect(understanding.status).toBe("none");
    const readiness = evaluateInquiryDraftReadiness({
      serviceType: "corporate_event",
      isInquiry: true,
      confidence: "high",
      quantitySource: "explicit",
      shootHours: 3,
      durationPackage: "hours",
      attachmentStatus: understanding.status,
      suggestedItems: [{ quantity: 3, unitPrice: 650 }],
      learningReady: true,
    });
    expect(readiness.readyForAutoDraft).toBe(true);
  });
});
