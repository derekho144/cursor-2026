import { describe, expect, it } from "vitest";
import {
  buildAcceptedShootsIcs,
  buildAcceptedShootEventSummary,
  buildAcceptedShootVEvent,
  buildAcceptedCalendarFeedUrl,
  buildGoogleCalendarAddByUrlLink,
  escapeIcsText,
  nextYmd,
  normalizeShootingDateYmd,
  timingSafeEqualToken,
} from "./acceptedCalendarIcs";

describe("accepted calendar ICS helpers", () => {
  it("normalizes shooting dates", () => {
    expect(normalizeShootingDateYmd("2026-09-28")).toBe("2026-09-28");
    expect(normalizeShootingDateYmd("2026-09-28T10:00:00")).toBe("2026-09-28");
    expect(normalizeShootingDateYmd("pending")).toBeNull();
    expect(normalizeShootingDateYmd("")).toBeNull();
  });

  it("computes exclusive all-day end date", () => {
    expect(nextYmd("2026-09-28")).toBe("2026-09-29");
    expect(nextYmd("2026-12-31")).toBe("2027-01-01");
  });

  it("escapes ICS text", () => {
    expect(escapeIcsText("A, B; C\\D\nE")).toBe("A\\, B\\; C\\\\D\\nE");
  });

  it("builds summary with company when different from client", () => {
    expect(
      buildAcceptedShootEventSummary({
        id: 1,
        quoteNumber: "JD202609-AF93",
        clientName: "Derek",
        clientCompany: "Exposure HK",
        shootingDate: "2026-09-28",
      })
    ).toBe("JD202609-AF93 · Exposure HK · Derek");
  });

  it("builds VEVENT as all-day shoot on shootingDate without amount", () => {
    const vevent = buildAcceptedShootVEvent(
      {
        id: 42,
        quoteNumber: "JD202609-TEST",
        clientName: "測試客戶",
        shootingDate: "2026-10-01",
        shootingLocation: "觀塘 Studio",
        shootHours: "4",
      },
      {
        quoteBaseUrl: "https://jdsys.biz",
        dtStamp: new Date("2026-09-28T00:00:00.000Z"),
      }
    );
    expect(vevent).toContain("BEGIN:VEVENT");
    expect(vevent).toContain("UID:jd-quote-42@jdsys.biz");
    expect(vevent).toContain("DTSTART;VALUE=DATE:20261001");
    expect(vevent).toContain("DTEND;VALUE=DATE:20261002");
    expect(vevent).toContain("SUMMARY:JD202609-TEST · 測試客戶");
    expect(vevent).toContain("LOCATION:觀塘 Studio");
    expect(vevent).toContain("URL:https://jdsys.biz/quotes/42");
    expect(vevent).not.toContain("金額");
    expect(vevent).not.toMatch(/HKD|\$/);
    expect(vevent).toContain("END:VEVENT");
  });

  it("builds full ICS calendar and skips invalid shootingDate", () => {
    const ics = buildAcceptedShootsIcs(
      [
        {
          id: 2,
          quoteNumber: "JD-B",
          clientName: "B",
          shootingDate: "2026-11-02",
        },
        {
          id: 1,
          quoteNumber: "JD-A",
          clientName: "A",
          shootingDate: "not-a-date",
        },
        {
          id: 3,
          quoteNumber: "JD-C",
          clientName: "C",
          shootingDate: "2026-11-01",
        },
      ],
      { dtStamp: new Date("2026-09-28T12:00:00.000Z") }
    );
    expect(ics.startsWith("BEGIN:VCALENDAR")).toBe(true);
    expect(ics).toContain("X-WR-CALNAME:JD Studio 拍攝");
    expect(ics).toContain("X-WR-TIMEZONE:Asia/Hong_Kong");
    expect(ics).toContain("UID:jd-quote-3@jdsys.biz");
    expect(ics).toContain("UID:jd-quote-2@jdsys.biz");
    expect(ics).not.toContain("UID:jd-quote-1@jdsys.biz");
    expect(ics.indexOf("jd-quote-3@")).toBeLessThan(ics.indexOf("jd-quote-2@"));
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
  });

  it("builds feed and Google Calendar add-by-url links", () => {
    const feed = buildAcceptedCalendarFeedUrl("https://jdsys.biz/", "abc123");
    expect(feed).toBe("https://jdsys.biz/api/calendar/accepted.ics?token=abc123");
    const gcal = buildGoogleCalendarAddByUrlLink(feed);
    expect(gcal).toContain("calendar.google.com/calendar/r?cid=");
    expect(gcal).toContain(encodeURIComponent("webcal://jdsys.biz/api/calendar/accepted.ics?token=abc123"));
  });

  it("compares feed tokens safely", () => {
    expect(timingSafeEqualToken("same-token", "same-token")).toBe(true);
    expect(timingSafeEqualToken("a", "b")).toBe(false);
    expect(timingSafeEqualToken(undefined, "x")).toBe(false);
  });
});
