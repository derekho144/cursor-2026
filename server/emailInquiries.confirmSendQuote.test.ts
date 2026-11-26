/**
 * confirmSendQuote must attach the quotation PDF — body says "Please find attached…".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateQuotePdfMatchingDownload = vi.fn();
const sendEmail = vi.fn();

vi.mock("./routers/quotes", () => ({
  generateQuotePdfMatchingDownload: (...args: unknown[]) =>
    generateQuotePdfMatchingDownload(...args),
}));

vi.mock("./resendEmail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./resendEmail")>();
  return {
    ...actual,
    sendEmail: (...args: unknown[]) => sendEmail(...args),
  };
});

import {
  escapeConfirmSendEmailHtml,
  sendInquiryConfirmQuoteEmail,
} from "./routers/emailInquiries";

describe("escapeConfirmSendEmailHtml", () => {
  it("escapes HTML special characters", () => {
    expect(escapeConfirmSendEmailHtml(`a<b>&"c`)).toBe("a&lt;b&gt;&amp;\"c");
  });
});

describe("sendInquiryConfirmQuoteEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateQuotePdfMatchingDownload.mockResolvedValue(Buffer.from("%PDF-quote"));
    sendEmail.mockResolvedValue({
      success: true,
      messageId: "msg-1",
      provider: "gmail",
    });
  });

  it("generates a quotation PDF and passes it as an attachment", async () => {
    const quote = {
      quoteNumber: "JD202611-TEST",
      llmDescription: "Custom cover",
      signatureData: null,
      clientName: "Alice",
    };

    const result = await sendInquiryConfirmQuoteEmail({
      to: "alice@example.com",
      subject: "JD Studio HK Quotation - JD202611-TEST",
      body: "Dear Alice,\n\nPlease find attached our quotation.\n",
      quote,
      inquiryId: 42,
    });

    expect(result.success).toBe(true);
    expect(generateQuotePdfMatchingDownload).toHaveBeenCalledTimes(1);
    expect(generateQuotePdfMatchingDownload).toHaveBeenCalledWith(
      quote,
      "Custom cover",
      "QUOTATION",
      null
    );

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const opts = sendEmail.mock.calls[0]![0] as {
      to: string;
      attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
      html: string;
    };
    expect(opts.to).toBe("alice@example.com");
    expect(opts.attachments).toHaveLength(1);
    expect(opts.attachments![0]!.filename).toBe("JD202611-TEST.pdf");
    expect(opts.attachments![0]!.contentType).toBe("application/pdf");
    expect(Buffer.isBuffer(opts.attachments![0]!.content)).toBe(true);
    expect(opts.html).toContain("Please find attached");
    expect(opts.html).not.toContain("<script>");
  });

  it("escapes HTML in the body before embedding", async () => {
    await sendInquiryConfirmQuoteEmail({
      to: "bob@example.com",
      subject: "Quote",
      body: `Dear <img src=x onerror=alert(1)>,`,
      quote: { quoteNumber: "JD202611-ESC" },
      inquiryId: 7,
    });

    const opts = sendEmail.mock.calls[0]![0] as { html: string };
    expect(opts.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(opts.html).not.toContain("<img src=x");
  });

  it("does not mark success path without calling sendEmail when PDF fails", async () => {
    generateQuotePdfMatchingDownload.mockRejectedValueOnce(new Error("pdf boom"));

    await expect(
      sendInquiryConfirmQuoteEmail({
        to: "carol@example.com",
        subject: "Quote",
        body: "Hi",
        quote: { quoteNumber: "JD202611-FAIL" },
        inquiryId: 9,
      })
    ).rejects.toThrow("pdf boom");

    expect(sendEmail).not.toHaveBeenCalled();
  });
});
