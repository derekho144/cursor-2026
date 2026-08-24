import { describe, expect, it } from "vitest";
import {
  extractCrewFromText,
  extractHoursFromText,
  extractQuoteShootFeatures,
  summarizeTotals,
} from "./pricingLearningExtract";

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
});

describe("extractQuoteShootFeatures", () => {
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
});

describe("summarizeTotals", () => {
  it("computes percentiles", () => {
    const s = summarizeTotals([1000, 2000, 3000, 4000, 5000]);
    expect(s.count).toBe(5);
    expect(s.p50).toBe(3000);
    expect(s.min).toBe(1000);
    expect(s.max).toBe(5000);
  });
});
