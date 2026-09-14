import { describe, expect, it } from "vitest";
import { generateQuotePdfHtml } from "./routers/quotePdf";

const quote = {
  quoteNumber: "JD202608-TEST",
  clientName: "測試客戶",
  clientCompany: "ABC Ltd",
  clientEmail: "client@example.com",
  clientPhone: "+852 1234 5678",
  serviceType: "product",
  createdAt: new Date("2026-08-01T00:00:00Z"),
  notes: "請於上午到場",
  subtotal: 10000,
  discountAmount: 0,
  total: 10000,
  depositMode: "percent",
  depositPercent: 50,
  items: [{ description: "產品攝影", quantity: 1, unitPrice: 10000, amount: 10000 }],
};

const labels = { product: "產品攝影" };

describe("generateQuotePdfHtml print-format template", () => {
  it("matches /print/quote layout markers used by the download button", () => {
    const html = generateQuotePdfHtml(quote, "專業產品攝影服務。", labels);

    expect(html).toContain("NotoSansCJK");
    expect(html).toContain("data:image/png;base64,");
    expect(html).toContain("JD202608-TEST");
    expect(html).toContain("PREPARED FOR");
    expect(html).toContain("PAYMENT DETAIL");
    expect(html).toContain("TERMS &amp; CONDITIONS");
    expect(html).toContain("Google Review");
    expect(html).toContain("10% Discount");
    expect(html).toContain("DEPOSIT (50%)");
    expect(html).not.toContain("d2xsxph8kpxj0f.cloudfront.net/310519663457748523/VbnWSJV6UQ79sGuykqPPae/%E8%9E%A2");
  });

  it("omits Google Review on receipts", () => {
    const html = generateQuotePdfHtml(quote, "感謝惠顧。", labels, "RECEIPT");
    expect(html).toContain("RECEIPT");
    expect(html).not.toContain("Google Review");
  });

  it("keeps payment detail together and wraps long equipment/delivery", () => {
    const longQuote = {
      ...quote,
      equipment:
        "CAMERA/ Sony A7R4 Lighting AD200 / AD600 / FLASH LIGHT X2 / Softbox / C-stand",
      deliveryMethod:
        "Photo: BY LINKS 5-10 DAY | Video first cut BY LINKS 7-10 DAY | Final edit 14 DAY",
      team: "攝影師×2+錄影×1",
    };
    const html = generateQuotePdfHtml(longQuote, "專業活動攝影服務。", labels);
    expect(html).toContain("break-inside:avoid");
    expect(html).toContain("PAYMENT DETAIL");
    expect(html).toContain("JD STUDIO Limited");
    expect(html).toContain("HUI MAN HO");
    expect(html).toContain(longQuote.equipment);
    expect(html).toContain(longQuote.deliveryMethod);
    expect(html).toContain("word-break:break-word");
  });

  it("aligns UNIT PRICE / AMOUNT columns with print widths and 2dp money", () => {
    const html = generateQuotePdfHtml(quote, "專業產品攝影服務。", labels);
    expect(html).toContain('width:48px');
    expect(html).toContain('width:110px');
    expect(html).toContain("10,000.00");
    expect(html).not.toMatch(/toLocaleString\(\)\.00/);
  });
});
