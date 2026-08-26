import { describe, expect, it } from "vitest";
import {
  applyComprehensionToParsed,
  findComprehensionGaps,
  quoteSendBlocker,
} from "../shared/inquiryUnderstandingCoverage";
import { extractRequirementSignals } from "../shared/inquiryRequirementSignals";
import { evaluateInquiryDraftReadiness } from "../shared/inquiryDraftReadiness";
import { HKSEA_FIXTURE, HKRC_FIXTURE, HA_FIXTURE } from "./inquiryComprehension.fixtures";

describe("findComprehensionGaps — HKSEA collapse", () => {
  it("flags the stored 4h-event parse as a comprehension miss", () => {
    const signals = extractRequirementSignals(HKSEA_FIXTURE);
    const coverage = findComprehensionGaps({
      signals,
      workPackages: [],
      suggestedItems: [
        {
          description: "Event Photography (assumed 4 hours - please confirm)",
          quantity: 4,
        },
        { description: "Transportation Fee", quantity: 1 },
      ],
      notes: "假設活動為 4 小時",
      shootHours: 4,
      shotCount: 0,
    });
    expect(coverage.multiScope).toBe(true);
    expect(coverage.collapsedToEventHours).toBe(true);
    expect(coverage.gaps.some((g) => g.includes("200"))).toBe(true);
    expect(coverage.gaps.some((g) => /去背/.test(g))).toBe(true);

    const parsed = applyComprehensionToParsed(
      {
        serviceType: "corporate_event",
        isInquiry: true,
        confidence: "high",
        quantitySource: "assumed",
        shootHours: 4,
        suggestedItems: [
          { description: "Event Photography (assumed 4 hours)", quantity: 4, unitPrice: 920 },
          { description: "Transportation Fee", quantity: 1, unitPrice: 320 },
        ],
        missingFields: [],
        assumptions: [],
      },
      coverage,
      signals
    );
    expect(parsed.confidence).toBe("low");
    expect(parsed.comprehensionGaps.length).toBeGreaterThan(0);

    const readiness = evaluateInquiryDraftReadiness({
      ...parsed,
      learningReady: true,
    });
    expect(readiness.readyForAutoDraft).toBe(false);
    expect(readiness.blockers.some((b) => b.includes("閱讀理解缺口"))).toBe(true);
  });

  it("passes when packages cover event + 200 artwork + cutout", () => {
    const signals = extractRequirementSignals(HKSEA_FIXTURE);
    const coverage = findComprehensionGaps({
      signals,
      workPackages: [
        {
          kind: "event",
          summary: "頒獎禮 大會堂 12:00-17:00",
          quantity: 5,
          unit: "hours",
        },
        {
          kind: "artwork_shoot",
          summary: "約200件作品特寫",
          quantity: 200,
          unit: "pieces",
        },
        {
          kind: "background_removal",
          summary: "作品去背",
          quantity: 200,
          unit: "cutouts",
        },
      ],
      suggestedItems: [
        { description: "Event Photography", quantity: 5 },
        { description: "Artwork / Product Photography (white bg)", quantity: 200 },
        { description: "Background Removal (Cutout)", quantity: 200 },
        { description: "Transportation Fee", quantity: 1 },
      ],
      shootHours: 5,
      shotCount: 200,
    });
    expect(coverage.gaps).toEqual([]);
    expect(coverage.collapsedToEventHours).toBe(false);
  });
});

describe("findComprehensionGaps — days vs hours", () => {
  it("flags 3 days parsed as 3 hours", () => {
    const signals = extractRequirementSignals(HKRC_FIXTURE);
    const coverage = findComprehensionGaps({
      signals,
      suggestedItems: [
        { description: "Portrait Photography", quantity: 3 },
      ],
      shootHours: 3,
      shotCount: 0,
    });
    expect(coverage.gaps.some((g) => g.includes("3 天") && g.includes("小時"))).toBe(
      true
    );
  });
});

describe("quoteSendBlocker", () => {
  it("blocks HKSEA-style gaps", () => {
    const reason = quoteSendBlocker({
      comprehensionGaps: ["原文有「約 200 件／張拍攝或交付」，解析未覆蓋"],
      workPackages: [{ kind: "event", quantity: 4, unit: "hours" }],
    });
    expect(reason).toMatch(/閱讀理解缺口/);
  });

  it("blocks old pending_send with PDF but no workPackages", () => {
    const reason = quoteSendBlocker({
      attachmentStatus: "used",
      suggestedItems: [{ description: "Event Photography", quantity: 4 }],
    } as any);
    expect(reason).toMatch(/重讀需求/);
  });

  it("allows a complete re-read", () => {
    expect(
      quoteSendBlocker({
        comprehensionGaps: [],
        workPackages: [
          { kind: "event", quantity: 5, unit: "hours" },
          { kind: "artwork_shoot", quantity: 200, unit: "pieces" },
        ],
        attachmentStatus: "used",
      })
    ).toBeNull();
  });
});

describe("findComprehensionGaps — clean single-scope", () => {
  it("HA 3h + 40 photos has no collapse", () => {
    const signals = extractRequirementSignals(HA_FIXTURE);
    const coverage = findComprehensionGaps({
      signals,
      suggestedItems: [
        { description: "Event Photography", quantity: 3 },
        { description: "Photo Retouching", quantity: 40 },
        { description: "Transportation Fee", quantity: 1 },
      ],
      shootHours: 3,
      shotCount: 40,
    });
    expect(coverage.collapsedToEventHours).toBe(false);
    expect(coverage.missed).toEqual([]);
  });
});
