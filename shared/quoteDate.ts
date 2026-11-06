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
