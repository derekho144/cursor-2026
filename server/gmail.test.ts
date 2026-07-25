import { describe, it, expect } from "vitest";
import nodemailer from "nodemailer";

describe("Gmail SMTP credentials", () => {
  it("should verify Gmail SMTP connection with provided credentials", async () => {
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;

    expect(user).toBeTruthy();
    expect(pass).toBeTruthy();

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    });

    // verify() checks SMTP connection without sending email
    await expect(transporter.verify()).resolves.toBe(true);
  }, 15000);
});
