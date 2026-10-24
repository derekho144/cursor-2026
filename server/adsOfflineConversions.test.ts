import { beforeEach, describe, expect, it, vi } from "vitest";

const uploadClickConversions = vi.fn();
const ensureUploadClickConversionAction = vi.fn();
const formatAdsConversionDateTime = vi.fn((d: Date) => "2026-10-24 12:00:00+08:00");
const getDb = vi.fn();
const updateWhere = vi.fn();
const updateSet = vi.fn(() => ({ where: updateWhere }));
const update = vi.fn(() => ({ set: updateSet }));

vi.mock("./googleAds", () => ({
  uploadClickConversions: (...args: unknown[]) => uploadClickConversions(...args),
  ensureUploadClickConversionAction: (...args: unknown[]) =>
    ensureUploadClickConversionAction(...args),
  formatAdsConversionDateTime: (...args: unknown[]) => formatAdsConversionDateTime(...args as [Date]),
}));

vi.mock("./db", () => ({
  getDb: () => getDb(),
}));

vi.mock("../drizzle/schema", () => ({
  quotes: { id: "id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => [a, b],
  sql: { raw: (s: string) => s },
}));

describe("adsOfflineConversions", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getDb.mockResolvedValue({ update, execute: vi.fn() });
    updateWhere.mockResolvedValue(undefined);
    ensureUploadClickConversionAction.mockResolvedValue(
      "customers/4839352747/conversionActions/111"
    );
    uploadClickConversions.mockResolvedValue({ partialFailure: false, results: [{}] });
    delete process.env.GOOGLE_ADS_QUOTE_INQUIRY_CONVERSION_ACTION_ID;
    delete process.env.GOOGLE_ADS_QUOTE_ACCEPTED_CONVERSION_ACTION_ID;
  });

  it("skips inquiry upload when no click id", async () => {
    const { uploadQuoteInquiryConversion } = await import("./adsOfflineConversions");
    const r = await uploadQuoteInquiryConversion({ id: 1, total: "1000" });
    expect(r).toEqual({ ok: true, skipped: "no_click_id" });
    expect(uploadClickConversions).not.toHaveBeenCalled();
  });

  it("uploads inquiry conversion with gclid and order id", async () => {
    const { uploadQuoteInquiryConversion } = await import("./adsOfflineConversions");
    const r = await uploadQuoteInquiryConversion({
      id: 42,
      gclid: "Cj0TEST",
      total: "5000",
      currency: "HKD",
      createdAt: new Date("2026-10-24T04:00:00Z"),
    });
    expect(r.ok).toBe(true);
    expect(ensureUploadClickConversionAction).toHaveBeenCalledWith(
      "JD Quote Inquiry (Offline)",
      "SUBMIT_LEAD_FORM"
    );
    expect(uploadClickConversions).toHaveBeenCalledWith([
      expect.objectContaining({
        gclid: "Cj0TEST",
        orderId: "jd-quote-42-inquiry",
        conversionValue: 1,
        currencyCode: "HKD",
      }),
    ]);
  });

  it("uploads accepted conversion with quote total as value", async () => {
    ensureUploadClickConversionAction.mockResolvedValue(
      "customers/4839352747/conversionActions/222"
    );
    const { uploadQuoteAcceptedConversion } = await import("./adsOfflineConversions");
    const r = await uploadQuoteAcceptedConversion({
      id: 9,
      gclid: "abc",
      total: "12000",
      currency: "HKD",
    });
    expect(r.ok).toBe(true);
    expect(ensureUploadClickConversionAction).toHaveBeenCalledWith(
      "JD Quote Accepted (Offline)",
      "PURCHASE"
    );
    expect(uploadClickConversions).toHaveBeenCalledWith([
      expect.objectContaining({
        gclid: "abc",
        orderId: "jd-quote-9-accepted",
        conversionValue: 12000,
      }),
    ]);
  });

  it("skips when already uploaded", async () => {
    const { uploadQuoteInquiryConversion } = await import("./adsOfflineConversions");
    const r = await uploadQuoteInquiryConversion({
      id: 3,
      gclid: "x",
      adsOfflineInquiryUploadedAt: new Date(),
    });
    expect(r.skipped).toBe("already_uploaded");
    expect(uploadClickConversions).not.toHaveBeenCalled();
  });
});
