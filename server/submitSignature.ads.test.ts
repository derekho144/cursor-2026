import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  updateQuote,
  resyncClientMembershipFromQuotes,
  scheduleQuoteAcceptedConversionUpload,
  sendEmail,
} = vi.hoisted(() => ({
  updateQuote: vi.fn(),
  resyncClientMembershipFromQuotes: vi.fn(),
  scheduleQuoteAcceptedConversionUpload: vi.fn(),
  sendEmail: vi.fn().mockResolvedValue({ success: true, messageId: "msg_1" }),
}));

vi.mock("./db", () => ({
  getDb: vi.fn(async () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: 42, signedAt: null }],
        }),
      }),
    }),
  })),
  updateQuote,
  resyncClientMembershipFromQuotes,
  createQuote: vi.fn(),
  createEmailLog: vi.fn(),
  deleteQuote: vi.fn(),
  getEmailLogsByQuote: vi.fn(),
  getQuoteById: vi.fn(),
  getQuotes: vi.fn(),
  upsertClientFromQuote: vi.fn(),
  searchClients: vi.fn(),
  backfillEmailInquiryLeadSources: vi.fn(),
  listRecentAdsWhatsappClicks: vi.fn(),
  linkWhatsappClickToQuote: vi.fn(),
  findAdsWhatsappClickByRef: vi.fn(),
  getQuotesPendingReviewEmail: vi.fn().mockResolvedValue([]),
  markReviewEmailSent: vi.fn(),
}));

vi.mock("./adsOfflineConversions", () => ({
  scheduleQuoteAcceptedConversionUpload,
  scheduleQuoteInquiryConversionUpload: vi.fn(),
  ensureAdsOfflineConversionSchema: vi.fn(),
}));

vi.mock("./resendEmail", () => ({
  normalizeEmailAddress: (s: string) => s,
  sendEmail,
}));

vi.mock("./quoteEmailSendQueue", () => ({
  enqueueQuoteEmailSend: vi.fn(),
  getQuoteEmailSendStatus: vi.fn(),
}));

vi.mock("./airwallexPayment", () => ({
  createQuoteAirwallexPaymentLink: vi.fn(),
  listAirwallexPaymentLinksForQuote: vi.fn(),
  syncRecentAirwallexPayments: vi.fn(),
}));

vi.mock("./airwallex", () => ({
  isAirwallexConfigured: vi.fn(() => false),
}));

vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(),
  extractLLMText: vi.fn(),
}));

vi.mock("./storage", () => ({
  storagePut: vi.fn(),
}));

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function publicCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

describe("quotes.submitSignature ads + print link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateQuote.mockResolvedValue({
      id: 42,
      quoteNumber: "Q-2026-001",
      clientEmail: "client@example.com",
      clientId: null,
      total: "12000",
      currency: "HKD",
      gclid: "Cj0KCQ_test",
      gbraid: null,
      wbraid: null,
      createdAt: new Date("2026-11-01T00:00:00.000Z"),
      adsOfflineAcceptedUploadedAt: null,
    });
    sendEmail.mockResolvedValue({ success: true, messageId: "msg_1" });
  });

  it("schedules Google Ads accepted conversion on client e-sign", async () => {
    const caller = appRouter.createCaller(publicCtx());
    await caller.quotes.submitSignature({
      token: "sign_tok_abc",
      signedByName: "Alex Client",
      signatureData: "data:image/png;base64,aaa",
      origin: "https://jdsys.biz",
    });

    expect(scheduleQuoteAcceptedConversionUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 42,
        gclid: "Cj0KCQ_test",
        total: "12000",
        currency: "HKD",
      })
    );
  });

  it("emails a public /print/sign/:token link (not login-walled /print/quote/:id)", async () => {
    const caller = appRouter.createCaller(publicCtx());
    await caller.quotes.submitSignature({
      token: "sign_tok_abc",
      signedByName: "Alex Client",
      signatureData: "data:image/png;base64,aaa",
      origin: "https://jdsys.biz",
    });

    // Confirmation email is fire-and-forget
    await vi.waitFor(() => {
      expect(sendEmail).toHaveBeenCalled();
    });

    const html = String(sendEmail.mock.calls[0]?.[0]?.html ?? "");
    expect(html).toContain("https://jdsys.biz/print/sign/sign_tok_abc");
    expect(html).not.toContain("/print/quote/42");
  });
});
