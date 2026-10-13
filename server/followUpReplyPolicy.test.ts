import { describe, expect, it } from "vitest";
import { clientHasRepliedAfterFirstSend } from "./followUpReplyPolicy";

describe("clientHasRepliedAfterFirstSend", () => {
  const first = new Date("2026-10-12T08:23:00Z"); // 16:23 HKT intro
  const clientReply = new Date("2026-10-12T09:48:00Z"); // 17:48 HKT
  const ourAck = new Date("2026-10-12T09:53:00Z");
  const ourQuote = new Date("2026-10-12T10:38:00Z"); // latest sent

  it("detects client reply even when we sent more emails after their reply", () => {
    // Bug case: anchoring on latest sent (ourQuote) would miss clientReply.
    expect(
      clientHasRepliedAfterFirstSend(first, [clientReply])
    ).toBe(true);
    expect(
      clientHasRepliedAfterFirstSend(ourQuote, [clientReply])
    ).toBe(false);
  });

  it("stays false when client never replied after first outreach", () => {
    expect(clientHasRepliedAfterFirstSend(first, [])).toBe(false);
    expect(
      clientHasRepliedAfterFirstSend(first, [new Date("2026-10-11T00:00:00Z")])
    ).toBe(false);
  });

  it("ignores invalid anchors / dates", () => {
    expect(clientHasRepliedAfterFirstSend(null, [clientReply])).toBe(false);
    expect(clientHasRepliedAfterFirstSend(first, [null, undefined])).toBe(false);
  });

  it("Basic Law thread timeline → should not send cold follow-up", () => {
    const engaged = clientHasRepliedAfterFirstSend(first, [clientReply]);
    // Later outbound must not clear engagement
    void ourAck;
    void ourQuote;
    expect(engaged).toBe(true);
  });
});
