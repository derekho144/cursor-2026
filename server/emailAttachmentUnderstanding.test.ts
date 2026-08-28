import { describe, expect, it } from "vitest";
import {
  applyAttachmentUnderstandingToParsed,
  mentionsRequirementsAttachment,
  resolveAttachmentUnderstanding,
} from "../shared/emailAttachmentUnderstanding";
import { evaluateInquiryDraftReadiness } from "../shared/inquiryDraftReadiness";

describe("mentionsRequirementsAttachment", () => {
  it("detects Chinese and English cues", () => {
    expect(mentionsRequirementsAttachment("詳情請見附件。謝謝")).toBe(true);
    expect(mentionsRequirementsAttachment("Please find the attached brief")).toBe(
      true
    );
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

  it("marks used when PDF text is present", () => {
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
    expect(r.blockers[0]).toContain("未讀到");
  });

  it("marks missing when PDF present but OCR/text empty", () => {
    const r = resolveAttachmentUnderstanding({
      subject: "Brief",
      bodyText: "See attached",
      attachmentText: "",
      attachmentFileCount: 1,
    });
    expect(r.status).toBe("missing");
    expect(r.blockers[0]).toContain("OCR");
    expect(r.missingFields).toContain("attachmentText");
  });

  it("marks missing when PDF present but empty text layer", () => {
    const r = resolveAttachmentUnderstanding({
      subject: "RFQ",
      bodyText: "Please quote as discussed.",
      attachmentText: "",
      pdfFileCount: 1,
    });
    expect(r.status).toBe("missing");
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
