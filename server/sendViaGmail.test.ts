import { describe, it, expect } from "vitest";
import { sendViaGmail } from "./resendEmail";

// This test sends a REAL email via Gmail SMTP.
// It is skipped by default to avoid sending emails during CI/automated test runs.
// To run manually: change `it.skip` to `it` and run `pnpm test --run sendViaGmail`
describe("sendViaGmail - Actual Email Sending", () => {
  it.skip("should send a test email via Gmail SMTP", async () => {
    const gmailUser = process.env.GMAIL_USER;
    expect(gmailUser).toBeTruthy();

    // Send a test email to the same Gmail account
    const result = await sendViaGmail({
      to: gmailUser!,
      subject: "[TEST] Follow-up Email System Test",
      html: "<p>This is a test email from the follow-up system.</p>",
      text: "This is a test email from the follow-up system.",
    });

    console.log("sendViaGmail result:", result);
    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();
    expect(result.provider).toBe("gmail");
  }, 30000);
});
