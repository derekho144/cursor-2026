import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.fn().mockResolvedValue({ messageId: "gmail-msg" });

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail })),
  },
}));

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: {
      send: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "The string did not match the expected pattern." },
      }),
    },
  })),
}));

import { sendEmail } from "./resendEmail";

describe("sendEmail with attachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GMAIL_USER = "test@gmail.com";
    process.env.GMAIL_APP_PASSWORD = "app-pass";
    process.env.RESEND_API_KEY = "re_test";
  });

  it("sends via Gmail directly when attachments are present", async () => {
    const result = await sendEmail({
      to: "derekho1144@gmail.com",
      subject: "JD Studio Quotation",
      html: "<p>hi</p>",
      text: "hi",
      attachments: [
        {
          filename: "JD202610-9HC4.pdf",
          content: Buffer.from("%PDF"),
          contentType: "application/pdf",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.provider).toBe("gmail");
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});
