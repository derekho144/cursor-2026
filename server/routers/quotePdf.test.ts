import { describe, expect, it } from "vitest";
import {
  generateQuotePdfHtml,
  renderQuotePdfLikePrint,
  resolvePdfBrowserExecutablePath,
} from "./quotePdf";
import { SERVICE_TYPE_LABELS } from "./quotePdfKit";
import { generateQuotePdfMatchingDownload } from "./quotes";
import { PDFParse } from "pdf-parse";
import { getQuoteById } from "../db";
import { QUOTE_PRINT_DESIGN } from "../../shared/quotePrintDesign";

const quoteFixture = {
  quoteNumber: "JD202609-TEST",
  createdAt: "2026-09-15T00:00:00.000Z",
  clientName: "Test Client",
  clientCompany: "Test Company",
  clientPhone: "91234567",
  clientEmail: "client@example.com",
  serviceType: "corporate_event",
  shootingDate: "2026-12-17",
  shootingLocation: "HKCEC",
  items: [
    {
      description: "Event Photography - Day 1",
      quantity: 8,
      unitPrice: 800,
      amount: 6400,
    },
  ],
  subtotal: 6400,
  discountAmount: 0,
  total: 6400,
  depositPercent: 50,
  depositMode: "percent",
  notes: "Print layout verification.",
};

describe("quote print PDF renderer", () => {
  it("renders the print-page structure used by downloadable quotations", () => {
    const html = generateQuotePdfHtml(
      quoteFixture,
      "",
      SERVICE_TYPE_LABELS
    );

    expect(html).toContain("JD202609-TEST");
    expect(html).toContain("PREPARED FOR");
    expect(html).toContain("SERVICE DETAILS");
    expect(html).toContain("TOTAL AMOUNT");
    expect(html).toContain("DEPOSIT (50%)");
    expect(html).toContain("NET PAYMENT");
    expect(html).toContain("PAYMENT DETAIL");
    expect(html).toContain(`font-family:${QUOTE_PRINT_DESIGN.fontFamily}`);
    expect(html).toContain(`width:${QUOTE_PRINT_DESIGN.pageWidthPx}px`);
    expect(html).toContain(
      `padding:0 ${QUOTE_PRINT_DESIGN.contentHorizontalPaddingPx}px 32px ${QUOTE_PRINT_DESIGN.contentHorizontalPaddingPx}px`
    );
  });

  it("resolves a usable Chromium executable before rendering", async () => {
    const renderer = await resolvePdfBrowserExecutablePath();
    expect(renderer.executablePath).toBeTruthy();
    expect(["platform", "sparticuz"]).toContain(renderer.runtime);
  });

  it("produces a real PDF from the same print-page HTML", async () => {
    const pdf = await renderQuotePdfLikePrint(
      quoteFixture,
      "",
      SERVICE_TYPE_LABELS
    );

    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(10_000);
  }, 45_000);

  it("keeps a multi-page quotation readable through totals and payment detail", async () => {
    const multiPageQuote = {
      ...quoteFixture,
      items: Array.from({ length: 42 }, (_, index) => ({
        description: `Event Photography Day ${index + 1} — extended service scope, delivery requirements and on-site coordination notes for print pagination verification.`,
        quantity: 1,
        unitPrice: 800,
        amount: 800,
      })),
      subtotal: 33_600,
      total: 33_600,
      notes: "Multi-page print renderer verification.\nTotals, notes and payment details must follow the item table.",
    };
    const pdf = await renderQuotePdfLikePrint(
      multiPageQuote,
      "",
      SERVICE_TYPE_LABELS
    );
    const parser = new PDFParse({ data: pdf });
    try {
      const parsed = await parser.getText();
      expect(parsed.total).toBeGreaterThan(1);
      // PDF text extraction can preserve CSS letter-spacing as spaces between glyphs.
      const normalizedText = parsed.text.replace(/\s+/g, "").toUpperCase();
      expect(normalizedText).toContain("TOTALAMOUNT");
      expect(normalizedText).toContain("PAYMENTDETAIL");
      expect(normalizedText).toContain("NETPAYMENT");
      expect(normalizedText).toContain("MULTI-PAGEPRINTRENDERERVERIFICATION");
      const itemPosition = normalizedText.indexOf("EVENTPHOTOGRAPHYDAY42");
      const totalPosition = normalizedText.indexOf("TOTALAMOUNT");
      const netPaymentPosition = normalizedText.indexOf("NETPAYMENT");
      const notesPosition = normalizedText.indexOf("MULTI-PAGEPRINTRENDERERVERIFICATION");
      const paymentPosition = normalizedText.indexOf("PAYMENTDETAIL");
      expect(itemPosition).toBeGreaterThan(-1);
      expect(totalPosition).toBeGreaterThan(itemPosition);
      expect(netPaymentPosition).toBeGreaterThan(totalPosition);
      expect(notesPosition).toBeGreaterThan(totalPosition);
      expect(notesPosition).toBeGreaterThan(netPaymentPosition);
      expect(paymentPosition).toBeGreaterThan(notesPosition);
    } finally {
      await parser.destroy();
    }
  }, 60_000);

  it("uses the print renderer for the email attachment path", async () => {
    const pdf = await generateQuotePdfMatchingDownload(
      quoteFixture,
      "",
      "QUOTATION"
    );

    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(10_000);
  }, 45_000);

  it("renders an existing quote through the email attachment generator without sending mail", async () => {
    let quote: Awaited<ReturnType<typeof getQuoteById>> = null;
    try {
      quote = await getQuoteById(11_010_001);
    } catch (err) {
      console.warn(
        "[quotePdf.test] Skipping existing-quote path; database unavailable:",
        err
      );
      return;
    }
    if (!quote) {
      console.warn(
        "[quotePdf.test] Skipping existing-quote path; quote 11010001 not present in this environment"
      );
      return;
    }

    const pdf = await generateQuotePdfMatchingDownload(
      quote,
      quote.llmDescription || "",
      "QUOTATION",
      (quote as any)?.signatureData || null
    );
    const parser = new PDFParse({ data: pdf });
    try {
      const parsed = await parser.getText();
      expect(parsed.text.replace(/\s+/g, "")).toContain(quote.quoteNumber);
    } finally {
      await parser.destroy();
    }
  }, 60_000);
});
