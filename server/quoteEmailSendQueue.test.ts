import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./db", () => ({
  getQuoteById: vi.fn(),
  createEmailLog: vi.fn().mockResolvedValue(99),
  updateQuote: vi.fn(),
  getDb: vi.fn().mockResolvedValue(null),
}));

vi.mock("./resendEmail", () => ({
  sendViaGmail: vi.fn().mockResolvedValue({
    success: true,
    messageId: "gmail-1",
    provider: "gmail",
  }),
  normalizeEmailAddress: (v: string) => v.trim(),
}));

vi.mock("./_core/env", () => ({
  ENV: { gmailUser: "test@gmail.com", gmailAppPassword: "app-pass" },
}));

vi.mock("./routers/quotes", () => ({
  generateQuotePdfMatchingDownload: vi
    .fn()
    .mockResolvedValue(Buffer.from("%PDF-1.4 test")),
}));

import { getQuoteById } from "./db";
import { sendViaGmail } from "./resendEmail";
import {
  enqueueQuoteEmailSend,
  getQuoteEmailSendStatus,
} from "./quoteEmailSendQueue";

describe("quoteEmailSendQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getQuoteById).mockResolvedValue({
      id: 1,
      quoteNumber: "JD202610-9HC4",
      status: "draft",
      llmDescription: null,
      signatureData: null,
    } as any);
  });

  it("enqueues and completes a Gmail send without hanging the caller", async () => {
    const { jobId } = enqueueQuoteEmailSend({
      quoteId: 1,
      to: "derekho1144@gmail.com",
      subject: "JD Studio Quotation",
      body: "Hello",
    });
    expect(jobId).toMatch(/^qe-1-/);

    // Wait for background chain
    for (let i = 0; i < 40; i++) {
      const st = getQuoteEmailSendStatus(jobId);
      if (st && st.status !== "running") break;
      await new Promise((r) => setTimeout(r, 25));
    }

    const done = getQuoteEmailSendStatus(jobId);
    expect(done?.status).toBe("ok");
    expect(done?.sentTo).toBe("derekho1144@gmail.com");
    expect(sendViaGmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendViaGmail).mock.calls[0]![0].to).toBe(
      "derekho1144@gmail.com"
    );
  });
});
