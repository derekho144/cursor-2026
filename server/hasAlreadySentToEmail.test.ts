import { describe, expect, it } from "vitest";
import { inquiryIndicatesOutboundSent } from "./db";

describe("inquiryIndicatesOutboundSent", () => {
  it("does not treat pending_send processedAt as outbound sent", () => {
    // Regression: createEmailInquiry stamps processedAt for pending_send before any mail.
    // That must not block a later high-value meeting email to the same fromEmail.
    expect(
      inquiryIndicatesOutboundSent({
        meetingStatus: "none",
        autoRepliedAt: null,
      })
    ).toBe(false);
    expect(
      inquiryIndicatesOutboundSent({
        meetingStatus: "pending_meeting",
        autoRepliedAt: null,
      })
    ).toBe(false);
  });

  it("does not treat ignored/rejected (no send) as outbound sent", () => {
    expect(
      inquiryIndicatesOutboundSent({
        meetingStatus: "none",
        autoRepliedAt: null,
      })
    ).toBe(false);
  });

  it("detects meeting email already sent", () => {
    expect(
      inquiryIndicatesOutboundSent({
        meetingStatus: "meeting_scheduled",
        autoRepliedAt: null,
      })
    ).toBe(true);
    expect(
      inquiryIndicatesOutboundSent({
        meetingStatus: "meeting_done",
        autoRepliedAt: null,
      })
    ).toBe(true);
  });

  it("detects quote/auto-reply email already sent via autoRepliedAt", () => {
    expect(
      inquiryIndicatesOutboundSent({
        meetingStatus: "none",
        autoRepliedAt: new Date("2026-11-01T00:00:00Z"),
      })
    ).toBe(true);
  });
});
