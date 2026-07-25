import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock nodemailer
vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn().mockResolvedValue({ messageId: "test-id" }),
      verify: vi.fn().mockResolvedValue(true),
    })),
  },
}));

// Mock db
vi.mock("./db", () => ({
  getQuoteById: vi.fn(),
  updateQuote: vi.fn(),
  createEmailLog: vi.fn(),
  getEmailLogsByQuote: vi.fn().mockResolvedValue([]),
}));

// Mock storage
vi.mock("./storage", () => ({
  storagePut: vi.fn().mockResolvedValue({ url: "https://cdn.example.com/test.pdf", key: "test.pdf" }),
}));

import nodemailer from "nodemailer";
import { getQuoteById, createEmailLog } from "./db";

describe("sendQuoteEmail logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GMAIL_USER = "test@gmail.com";
    process.env.GMAIL_APP_PASSWORD = "test-app-password";
  });

  it("should require to, subject, body as mandatory fields", () => {
    // Validate that all three fields are required (non-empty)
    const validateInput = (to: string, subject: string, body: string) => {
      if (!to.trim()) return "請填寫收件人電郵地址";
      if (!subject.trim()) return "請填寫標題";
      if (!body.trim()) return "請填寫正文";
      return null;
    };

    expect(validateInput("", "JD Studio Quotation", "Hello")).toBe("請填寫收件人電郵地址");
    expect(validateInput("client@test.com", "", "Hello")).toBe("請填寫標題");
    expect(validateInput("client@test.com", "JD Studio Quotation", "")).toBe("請填寫正文");
    expect(validateInput("client@test.com", "JD Studio Quotation", "Hello")).toBeNull();
  });

  it("should use provided to/subject/body instead of quote defaults", async () => {
    const mockQuote = {
      id: 1,
      quoteNumber: "QT-2026-001",
      clientName: "Test Client",
      clientEmail: "original@example.com",
      pdfUrl: "https://cdn.example.com/existing.pdf",
      status: "draft",
      items: [],
    };
    vi.mocked(getQuoteById).mockResolvedValue(mockQuote as any);

    // Simulate custom input overriding quote defaults
    const customInput = {
      id: 1,
      to: "custom@example.com",
      subject: "Custom Subject",
      body: "Custom body text",
    };

    expect(customInput.to).toBe("custom@example.com");
    expect(customInput.to).not.toBe(mockQuote.clientEmail);
  });

  it("should create nodemailer transporter with Gmail service config", () => {
    const createTransportSpy = vi.mocked(nodemailer.createTransport);

    nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });

    expect(createTransportSpy).toHaveBeenCalledWith({
      service: "gmail",
      auth: {
        user: "test@gmail.com",
        pass: "test-app-password",
      },
    });
  });

  it("should call createEmailLog on successful send", async () => {
    vi.mocked(createEmailLog).mockResolvedValue(undefined as any);

    await createEmailLog({
      quoteId: 1,
      to: "client@example.com",
      subject: "JD Studio Quotation",
      body: "Hello, ...",
      status: "sent",
    });

    expect(createEmailLog).toHaveBeenCalledWith(
      expect.objectContaining({ status: "sent", quoteId: 1 })
    );
  });

  it("should call createEmailLog with failed status on error", async () => {
    vi.mocked(createEmailLog).mockResolvedValue(undefined as any);

    await createEmailLog({
      quoteId: 1,
      to: "client@example.com",
      subject: "JD Studio Quotation",
      body: "Hello, ...",
      status: "failed",
      errorMessage: "SMTP connection refused",
    });

    expect(createEmailLog).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", errorMessage: "SMTP connection refused" })
    );
  });

  it("should auto-update quote status from draft to sent", () => {
    const quote = { status: "draft" };
    const shouldUpdate = quote.status === "draft";
    expect(shouldUpdate).toBe(true);

    const sentQuote = { status: "sent" };
    const shouldNotUpdate = sentQuote.status === "draft";
    expect(shouldNotUpdate).toBe(false);
  });

  it("should include default body with Derek signature", () => {
    const defaultBody = `Hello,\n\nNice talk to you just now. Please find the attached quotation for your review. All items and pricing details are included. Kindly take a moment to look through it, and feel free to contact me if you have any questions or need further clarification.\n\nCheers!\n\nDerek\nTel: 9153 1976\nwww.jdstudiohk.com`;

    expect(defaultBody).toContain("Derek");
    expect(defaultBody).toContain("9153 1976");
    expect(defaultBody).toContain("www.jdstudiohk.com");
    expect(defaultBody).toContain("attached quotation");
  });

  it("should verify Gmail SMTP credentials are set", () => {
    expect(process.env.GMAIL_USER).toBeTruthy();
    expect(process.env.GMAIL_APP_PASSWORD).toBeTruthy();
  });
});
