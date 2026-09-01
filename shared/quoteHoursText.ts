/** Pull numeric hours from free text (supports 中文 + English). */
export function extractHoursFromText(text: string): number | null {
  if (!text?.trim()) return null;
  const t = text.toLowerCase();

  const hourMatches: number[] = [];
  const hourRe =
    /(\d+(?:\.\d+)?)\s*(?:小時|小时|hrs?|hours?)(?![a-zA-Z])/gi;
  let m: RegExpExecArray | null;
  while ((m = hourRe.exec(text)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0 && n <= 72) hourMatches.push(n);
  }
  if (hourMatches.length > 0) {
    return Math.round(hourMatches.reduce((a, b) => a + b, 0) * 10) / 10;
  }

  if (/半(?:天|日)|half\s*[- ]?day/.test(t)) return 4;
  if (/全(?:天|日)|full\s*[- ]?day/.test(t)) return 8;

  const compound = text.match(/(\d+(?:\.\d+)?)\s*[- ]?(?:hr|hour)/i);
  if (compound) {
    const n = Number(compound[1]);
    if (Number.isFinite(n) && n > 0 && n <= 72) return n;
  }

  return null;
}
