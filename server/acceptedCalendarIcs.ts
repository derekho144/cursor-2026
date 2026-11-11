import crypto from "crypto";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import {
  nextQuoteYmd,
  normalizeQuoteDateYmd,
  normalizeShootDateSpan,
} from "../shared/quoteDate";
import { quotes } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { getDb } from "./db";

export type AcceptedShootCalendarEvent = {
  id: number;
  quoteNumber: string;
  clientName: string;
  clientCompany?: string | null;
  clientPhone?: string | null;
  shootingDate: string;
  /** Inclusive end day when multi-day; omitted/blank = single day. */
  shootingEndDate?: string | null;
  shootingLocation?: string | null;
  shootHours?: string | number | null;
  serviceType?: string | null;
  notes?: string | null;
  /** Used for monotonic ICS SEQUENCE (unix seconds). */
  updatedAt?: Date | string | null;
};

/** Stable feed token — prefer CALENDAR_FEED_SECRET, else derive from JWT secret. */
export function getCalendarFeedToken(): string {
  const explicit = ENV.calendarFeedSecret.trim();
  if (explicit) return explicit;
  const seed = ENV.cookieSecret.trim() || "jdsys-calendar";
  return crypto
    .createHmac("sha256", seed)
    .update("accepted-calendar-ics-v1")
    .digest("hex")
    .slice(0, 32);
}

export function timingSafeEqualToken(provided: string | undefined, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function buildAcceptedCalendarFeedUrl(baseUrl: string, token = getCalendarFeedToken()): string {
  const origin = baseUrl.replace(/\/+$/, "");
  return `${origin}/api/calendar/accepted.ics?token=${encodeURIComponent(token)}`;
}

/**
 * Google Calendar deep link for an ICS/webcal feed.
 * Opens Calendar with the subscribe dialog when possible; otherwise user pastes the HTTPS feed URL
 * via Settings → Add calendar → From URL.
 */
export function buildGoogleCalendarAddByUrlLink(icsUrl: string): string {
  const webcalUrl = icsUrl.replace(/^https:\/\//i, "webcal://").replace(/^http:\/\//i, "webcal://");
  return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`;
}

export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\n|\r/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

export function normalizeShootingDateYmd(value: string | null | undefined): string | null {
  return normalizeQuoteDateYmd(value);
}

/** Exclusive end date for an all-day ICS event (next calendar day). */
export function nextYmd(ymd: string): string {
  return nextQuoteYmd(ymd);
}

function ymdToIcsDate(ymd: string): string {
  return ymd.replace(/-/g, "");
}

function formatIcsUtcStamp(d = new Date()): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function buildAcceptedShootEventSummary(event: AcceptedShootCalendarEvent): string {
  const company = String(event.clientCompany ?? "").trim();
  const client = String(event.clientName ?? "").trim() || "客戶";
  const who = company && company !== client ? `${company} · ${client}` : client;
  return `${event.quoteNumber} · ${who}`;
}

export function buildAcceptedShootEventDescription(
  event: AcceptedShootCalendarEvent,
  quoteUrl?: string
): string {
  const lines: string[] = [
    `報價：${event.quoteNumber}`,
    `客戶：${event.clientName}`,
  ];
  if (event.clientCompany) lines.push(`公司：${event.clientCompany}`);
  if (event.clientPhone) lines.push(`電話：${event.clientPhone}`);
  if (event.serviceType) lines.push(`服務：${event.serviceType}`);
  if (event.shootHours != null && String(event.shootHours).trim() !== "") {
    lines.push(`拍攝時數：${event.shootHours}`);
  }
  if (quoteUrl) lines.push(`系統：${quoteUrl}`);
  if (event.notes) {
    const note = String(event.notes).trim().slice(0, 400);
    if (note) lines.push(`備註：${note}`);
  }
  return lines.join("\n");
}

/**
 * Monotonic ICS SEQUENCE so Google applies updates on the same UID.
 * Prefer quote `updatedAt` (unix seconds). Date-sum fallback is only for
 * fixtures without updatedAt — not used for production feed rows.
 */
export function shootCalendarSequence(input: {
  updatedAt?: Date | string | null;
  startYmd?: string;
  endInclusiveYmd?: string;
}): number {
  if (input.updatedAt != null && String(input.updatedAt).trim() !== "") {
    const ms = new Date(input.updatedAt).getTime();
    if (Number.isFinite(ms) && ms > 0) {
      return Math.max(1, Math.min(2_000_000_000, Math.floor(ms / 1000)));
    }
  }
  const s = Number(String(input.startYmd ?? "").replace(/-/g, ""));
  const e = Number(String(input.endInclusiveYmd ?? input.startYmd ?? "").replace(/-/g, ""));
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 1;
  return Math.max(1, Math.min(2_000_000_000, s + e));
}

/** @deprecated Use shootCalendarSequence — kept name for older imports/tests. */
export function shootSpanSequence(startYmd: string, endInclusiveYmd: string): number {
  return shootCalendarSequence({ startYmd, endInclusiveYmd });
}

/**
 * One stable all-day VEVENT per quote (UID jd-quote-{id}@).
 * Multi-day shoots use exclusive DTEND after the inclusive end day.
 * SEQUENCE follows quote updatedAt so subscribed Google calendars refresh.
 */
export function buildAcceptedShootVEvent(
  event: AcceptedShootCalendarEvent,
  opts?: { quoteBaseUrl?: string; dtStamp?: Date }
): string {
  const span = normalizeShootDateSpan(event.shootingDate, event.shootingEndDate);
  if (!span) throw new Error("Invalid shootingDate");

  const quoteUrl = opts?.quoteBaseUrl
    ? `${opts.quoteBaseUrl.replace(/\/+$/, "")}/quotes/${event.id}`
    : undefined;
  const summary = escapeIcsText(buildAcceptedShootEventSummary(event));
  const description = escapeIcsText(
    buildAcceptedShootEventDescription(event, quoteUrl)
  );
  const location = event.shootingLocation
    ? escapeIcsText(String(event.shootingLocation).trim())
    : "";
  const uid = `jd-quote-${event.id}@jdsys.biz`;
  const stamp = formatIcsUtcStamp(opts?.dtStamp ?? new Date());
  const sequence = shootCalendarSequence({
    updatedAt: event.updatedAt,
    startYmd: span.start,
    endInclusiveYmd: span.endInclusive,
  });
  const dtEndExclusive = nextYmd(span.endInclusive);

  const lines = [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `LAST-MODIFIED:${stamp}`,
    `SEQUENCE:${sequence}`,
    `DTSTART;VALUE=DATE:${ymdToIcsDate(span.start)}`,
    `DTEND;VALUE=DATE:${ymdToIcsDate(dtEndExclusive)}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
  ];
  if (location) lines.push(`LOCATION:${location}`);
  if (quoteUrl) lines.push(`URL:${quoteUrl}`);
  lines.push("TRANSP:OPAQUE", "STATUS:CONFIRMED", "END:VEVENT");
  return lines.join("\r\n");
}

export function buildAcceptedShootsIcs(
  events: AcceptedShootCalendarEvent[],
  opts?: { quoteBaseUrl?: string; calendarName?: string; dtStamp?: Date }
): string {
  const calName = escapeIcsText(opts?.calendarName ?? "JD Studio 拍攝");
  const stamp = opts?.dtStamp ?? new Date();
  const vevents = events
    .filter((e) => normalizeShootingDateYmd(e.shootingDate))
    .sort((a, b) => {
      const da = normalizeShootingDateYmd(a.shootingDate)!;
      const db = normalizeShootingDateYmd(b.shootingDate)!;
      return da === db ? a.id - b.id : da.localeCompare(db);
    })
    .map((e) => buildAcceptedShootVEvent(e, { quoteBaseUrl: opts?.quoteBaseUrl, dtStamp: stamp }));

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//JD Studio//Accepted Shoots//ZH",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${calName}`,
    "X-WR-TIMEZONE:Asia/Hong_Kong",
    ...vevents,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

/** All accepted quotes that have a YYYY-MM-DD shootingDate. */
export async function listAcceptedQuotesWithShootingDate(): Promise<
  AcceptedShootCalendarEvent[]
> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({
      id: quotes.id,
      quoteNumber: quotes.quoteNumber,
      clientName: quotes.clientName,
      clientCompany: quotes.clientCompany,
      clientPhone: quotes.clientPhone,
      shootingDate: quotes.shootingDate,
      shootingEndDate: quotes.shootingEndDate,
      shootingLocation: quotes.shootingLocation,
      shootHours: quotes.shootHours,
      serviceType: quotes.serviceType,
      notes: quotes.notes,
      updatedAt: quotes.updatedAt,
    })
    .from(quotes)
    .where(
      and(
        eq(quotes.status, "accepted"),
        isNotNull(quotes.shootingDate),
        ne(quotes.shootingDate, "")
      )
    );

  return rows
    .map((r) => {
      const span = normalizeShootDateSpan(r.shootingDate, r.shootingEndDate);
      if (!span) return null;
      return {
        ...r,
        shootingDate: span.start,
        shootingEndDate: span.endInclusive === span.start ? null : span.endInclusive,
      };
    })
    .filter((r): r is NonNullable<typeof r> => Boolean(r));
}

export async function renderAcceptedShootsIcsFeed(): Promise<string> {
  const events = await listAcceptedQuotesWithShootingDate();
  return buildAcceptedShootsIcs(events, {
    quoteBaseUrl: ENV.publicBaseUrl,
    calendarName: "JD Studio 拍攝",
  });
}
