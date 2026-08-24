import { describe, expect, it } from "vitest";
import {
  extractCrewFromText,
  extractCrewHighConfidence,
  extractHoursFromText,
  extractQuoteShootFeatures,
  extractShotCountFromText,
  summarizeTotals,
  timeWeightedMedian,
  trimOutliers,
} from "./pricingLearningExtract";

describe("extractCrewHighConfidence", () => {
  it("accepts Team XP and numeric roles", () => {
    expect(extractCrewHighConfidence("Team 1P")?.headcount).toBe(1);
    expect(extractCrewHighConfidence("Team 1P")?.photographers).toBe(1);
    const c = extractCrewHighConfidence("1攝影師 + 1助理");
    expect(c?.photographers).toBe(1);
    expect(c?.assistants).toBe(1);
  });

  it("rejects bare role words without numbers", () => {
    expect(extractCrewHighConfidence("攝影師到場")).toBeNull();
    expect(extractCrewHighConfidence("需要 assistant")).toBeNull();
  });
});

describe("extractHoursFromText", () => {
  it("parses Chinese hours and sums multiple blocks", () => {
    expect(extractHoursFromText("產品拍攝 4小時")).toBe(4);
    expect(extractHoursFromText("拍攝 3小時 + 後期 1小時")).toBe(4);
  });

  it("parses half/full day", () => {
    expect(extractHoursFromText("半日拍攝")).toBe(4);
    expect(extractHoursFromText("Full day coverage")).toBe(8);
  });

  it("parses English hours", () => {
    expect(extractHoursFromText("6 hours on location")).toBe(6);
    expect(extractHoursFromText("2hr product shoot")).toBe(2);
  });
});

describe("extractCrewFromText", () => {
  it("parses photographer + assistant", () => {
    const c = extractCrewFromText("1攝影師 + 1助理");
    expect(c.photographers).toBe(1);
    expect(c.assistants).toBe(1);
    expect(c.headcount).toBe(2);
  });

  it("parses English team field", () => {
    const c = extractCrewFromText("1 Photographer + 2 Assistants");
    expect(c.photographers).toBe(1);
    expect(c.assistants).toBe(2);
    expect(c.headcount).toBe(3);
  });

  it("parses pax shorthand", () => {
    const c = extractCrewFromText("現場 3人");
    expect(c.headcount).toBe(3);
  });

  it("parses Team 1P / Team 2P line items", () => {
    expect(extractCrewFromText("Team 1P").headcount).toBe(1);
    expect(extractCrewFromText("Team 2P").headcount).toBe(2);
  });
});

describe("extractShotCountFromText", () => {
  it("parses Chinese 張數", () => {
    expect(extractShotCountFromText("產品精修 20張")).toBe(20);
    expect(extractShotCountFromText("交付 15 款圖")).toBe(15);
  });

  it("parses English photo counts", () => {
    expect(extractShotCountFromText("30 final images")).toBe(30);
    expect(extractShotCountFromText("12 photos delivered")).toBe(12);
  });
});

describe("extractQuoteShootFeatures", () => {
  it("prefers structured shot count", () => {
    const f = extractQuoteShootFeatures({
      shotCount: 24,
      items: [{ description: "10張", quantity: 1 }],
      total: 4800,
    });
    expect(f.shotCount).toBe(24);
    expect(f.shotCountSource).toBe("structured");
    expect(f.shotCountBucket).toBe("n21_50");
    expect(f.pricePerShot).toBe(200);
  });

  it("prefers item hours and team crew", () => {
    const f = extractQuoteShootFeatures({
      team: "攝影師×1 + 助理×1",
      notes: "",
      items: [{ description: "餐廳拍攝 5小時", quantity: 1 }],
    });
    expect(f.hours).toBe(5);
    expect(f.hoursBucket).toBe("h4_8");
    expect(f.crewBucket).toBe("pair");
    expect(f.crew.photographers).toBe(1);
    expect(f.crew.assistants).toBe(1);
  });

  it("reads Team 1P from line items when structured empty", () => {
    const f = extractQuoteShootFeatures({
      items: [
        { description: "Event Photoshoot", quantity: 1 },
        { description: "Team 1P", quantity: 1 },
      ],
    });
    expect(f.crewBucket).toBe("solo");
    expect(f.crew.headcount).toBe(1);
    expect(f.crewSource).toBe("items");
  });

  it("prefers structured hours and crew over free text", () => {
    const f = extractQuoteShootFeatures({
      shootHours: 6,
      crewPhotographers: 1,
      crewAssistants: 1,
      team: "wrong text 2小時 5人",
      items: [{ description: "2小時 產品", quantity: 1 }],
      total: 12000,
    });
    expect(f.hours).toBe(6);
    expect(f.hoursSource).toBe("structured");
    expect(f.crew.headcount).toBe(2);
    expect(f.crewSource).toBe("structured");
    expect(f.pricePerHour).toBe(2000);
  });
});

describe("summarizeTotals", () => {
  it("computes percentiles", () => {
    const s = summarizeTotals([1000, 2000, 3000, 4000, 5000], { trim: false });
    expect(s.count).toBe(5);
    expect(s.p50).toBe(3000);
    expect(s.min).toBe(1000);
    expect(s.max).toBe(5000);
  });

  it("trims extreme outliers", () => {
    const trimmed = trimOutliers([1000, 1100, 1200, 1300, 1400, 50000]);
    expect(trimmed).not.toContain(50000);
    const s = summarizeTotals([1000, 1100, 1200, 1300, 1400, 50000]);
    expect(s.max).toBeLessThan(50000);
    expect(s.trimmed).toBeGreaterThan(0);
  });
});

describe("timeWeightedMedian", () => {
  it("returns null for empty", () => {
    expect(timeWeightedMedian([])).toBeNull();
  });

  it("weights recent values", () => {
    const mid = timeWeightedMedian([
      { value: 1000, at: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000) },
      { value: 5000, at: new Date() },
    ]);
    expect(mid).toBeGreaterThan(1000);
  });
});
