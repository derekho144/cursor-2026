/**
 * Quote follow-up reply detection.
 *
 * Cold follow-up emails ("wanted to follow up on my previous email…") must NOT
 * send once the client has already engaged. Anchor on our *first* non-follow-up
 * outbound in the tracking window — not the latest — so a client reply that
 * happened before our later ack/quote emails still counts as engagement.
 */

/** True when the client emailed us after our first outreach. */
export function clientHasRepliedAfterFirstSend(
  firstSentAt: Date | null | undefined,
  clientMessageDates: Array<Date | null | undefined>
): boolean {
  if (!firstSentAt || Number.isNaN(firstSentAt.getTime())) return false;
  const anchorMs = firstSentAt.getTime();
  return clientMessageDates.some((d) => {
    if (!d) return false;
    const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
    return Number.isFinite(t) && t > anchorMs;
  });
}
