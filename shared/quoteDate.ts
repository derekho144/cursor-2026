export function formatQuoteDateRange(start?: string | null, end?: string | null): string {
  const s = String(start ?? "").trim();
  const e = String(end ?? "").trim();
  if (!s) return e;
  if (!e || e === s) return s;
  return `${s} - ${e}`;
}

export function isValidQuoteDateRange(start?: string | null, end?: string | null): boolean {
  const s = String(start ?? "").trim();
  const e = String(end ?? "").trim();
  return !e || !s || e >= s;
}

/** Normalize a quote date field to YYYY-MM-DD, or null if invalid. */
export function normalizeQuoteDateYmd(value?: string | null): string | null {
  const raw = String(value ?? "")
    .trim()
    .slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

/** Next calendar day (UTC date arithmetic) for exclusive ICS DTEND. */
export function nextQuoteYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

/**
 * Inclusive shoot span for calendars.
 * Invalid / earlier end dates fall back to a single-day span on start.
 */
export function normalizeShootDateSpan(
  start?: string | null,
  end?: string | null
): { start: string; endInclusive: string } | null {
  const s = normalizeQuoteDateYmd(start);
  if (!s) return null;
  const e = normalizeQuoteDateYmd(end);
  if (!e || e < s) return { start: s, endInclusive: s };
  return { start: s, endInclusive: e };
}

/** Inclusive YYYY-MM-DD days from start through endInclusive (cap 366). */
export function enumerateInclusiveYmds(start: string, endInclusive: string): string[] {
  const out: string[] = [];
  let cur = start;
  for (let i = 0; i < 366; i++) {
    out.push(cur);
    if (cur >= endInclusive) break;
    cur = nextQuoteYmd(cur);
  }
  return out;
}
