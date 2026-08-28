/**
 * Extract shoot fundamentals from structured fields + free-text quote fields.
 * Foundations for pricing learning: hours · shoot type · crew.
 */

import {
  shotCountBucket,
  type ShotCountBucket,
} from "../shared/quotePricingMode";
import { resolveLearningTotal } from "../shared/quoteLineItemKind";

export type HoursBucket = "unknown" | "lte_2" | "h2_4" | "h4_8" | "gt_8";
export type CrewBucket = "unknown" | "solo" | "pair" | "team";
export type { ShotCountBucket };

export interface CrewBreakdown {
  photographers: number;
  assistants: number;
  videographers: number;
  others: number;
  /** Estimated headcount (sum of roles, or 0 if unknown) */
  headcount: number;
}

export interface QuoteShootFeatures {
  hours: number | null;
  hoursBucket: HoursBucket;
  hoursSource: "structured" | "items" | "notes" | "team" | "inferred" | null;
  crew: CrewBreakdown;
  crewBucket: CrewBucket;
  crewLabel: string;
  crewSource: "structured" | "team" | "items" | "notes" | null;
  /** Delivered photo count (張數) for product-style quotes */
  shotCount: number | null;
  shotCountBucket: ShotCountBucket;
  shotCountSource: "structured" | "items" | "notes" | null;
  /** Price-per-hour when hours known; uses photographer-crew money when split available */
  pricePerHour: number | null;
  /** Price per delivered shot when shotCount known */
  pricePerShot: number | null;
  /** Photographer-only subtotal when line items classify cleanly */
  photographerCrewSubtotal: number | null;
  /** Full quote / items total passed in */
  quoteTotal: number | null;
  /** Money used for learning rates (crew photo ≠ photobooth mix) */
  learningTotal: number | null;
  learningTotalSource: "photographer_crew" | "quote_total" | null;
}

function hoursBucket(h: number | null): HoursBucket {
  if (h == null || !Number.isFinite(h) || h <= 0) return "unknown";
  if (h <= 2) return "lte_2";
  if (h <= 4) return "h2_4";
  if (h <= 8) return "h4_8";
  return "gt_8";
}

export function hoursBucketLabel(bucket: HoursBucket): string {
  switch (bucket) {
    case "lte_2":
      return "≤ 2 小時";
    case "h2_4":
      return "2–4 小時";
    case "h4_8":
      return "4–8 小時";
    case "gt_8":
      return "> 8 小時";
    default:
      return "時數未標明";
  }
}

export function crewBucketLabel(bucket: CrewBucket): string {
  switch (bucket) {
    case "solo":
      return "1 人";
    case "pair":
      return "2 人";
    case "team":
      return "3 人以上";
    default:
      return "人手未標明";
  }
}

function crewBucketFromHeadcount(n: number): CrewBucket {
  if (n <= 0) return "unknown";
  if (n === 1) return "solo";
  if (n === 2) return "pair";
  return "team";
}

/** Pull numeric hours from free text (supports 中文 + English). */
export function extractHoursFromText(text: string): number | null {
  if (!text?.trim()) return null;
  const t = text.toLowerCase();

  // Explicit hour counts — take the max mentioned (e.g. "4小時拍攝 + 1小時後製" → 5 if both, else largest shoot block)
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

  // Half / full day shorthand
  if (/半(?:天|日)|half\s*[- ]?day/.test(t)) return 4;
  if (/全(?:天|日)|full\s*[- ]?day/.test(t)) return 8;

  // "X-hour" compound
  const compound = text.match(/(\d+(?:\.\d+)?)\s*[- ]?(?:hr|hour)/i);
  if (compound) {
    const n = Number(compound[1]);
    if (Number.isFinite(n) && n > 0 && n <= 72) return n;
  }

  return null;
}

function countRole(text: string, patterns: RegExp[]): number {
  let total = 0;
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const n = m[1] != null ? Number(m[1]) : 1;
      if (Number.isFinite(n) && n > 0 && n <= 20) total += n;
      else total += 1;
    }
  }
  return total;
}

/** English word quantities for crew, e.g. "ONE photographer". */
function countWordPhotographers(text: string): number {
  let total = 0;
  const re = /\b(one|a|an|single)\s+photographers?\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    total += 1;
  }
  return total;
}

/** Parse crew roles from team / notes / item descriptions. */
export function extractCrewFromText(text: string): CrewBreakdown {
  const empty: CrewBreakdown = {
    photographers: 0,
    assistants: 0,
    videographers: 0,
    others: 0,
    headcount: 0,
  };
  if (!text?.trim()) return empty;

  const photographers = Math.max(
    countRole(text, [
      /(\d+)\s*(?:位|名|x|×|\*)?\s*(?:攝影師|摄影师|photographers?|photogs?)/gi,
      /(?:攝影師|摄影师|photographers?|photogs?)\s*[x×*]?\s*(\d+)/gi,
    ]),
    countWordPhotographers(text)
  );
  let photogs = photographers;
  if (photogs === 0 && /攝影師|摄影师|\bphotographer\b|\bphotog\b/i.test(text)) {
    photogs = 1;
  }

  const assistants = countRole(text, [
    /(\d+)\s*(?:位|名|x|×|\*)?\s*(?:助理|助手|assistants?)/gi,
    /(?:助理|助手|assistants?)\s*[x×*]?\s*(\d+)/gi,
  ]);
  let asst = assistants;
  if (asst === 0 && /助理|助手|\bassistant\b/i.test(text) && !/助理導演|assistant\s*director/i.test(text)) {
    asst = 1;
  }

  const videographers = countRole(text, [
    /(\d+)\s*(?:位|名|x|×|\*)?\s*(?:攝影師兼錄影|錄影師|摄像师|videographers?|cinematographers?|cameramen?)/gi,
    /(?:錄影師|摄像师|videographers?)\s*[x×*]?\s*(\d+)/gi,
  ]);
  let video = videographers;
  if (video === 0 && /錄影師|摄像师|\bvideographer\b|\bcinematographer\b/i.test(text)) {
    video = 1;
  }

  const others = countRole(text, [
    /(\d+)\s*(?:位|名|x|×|\*)?\s*(?:化妝|妆|makeup|造型|stylist|燈光|灯光|gaffer|製作|制作|producer)/gi,
  ]);

  // Patterns like "1+1" or "2pax" / "2人"
  let pax = 0;
  const paxMatch = text.match(/(\d+)\s*(?:人|位|pax|persons?|people)(?![a-zA-Z])/i);
  if (paxMatch) pax = Number(paxMatch[1]) || 0;
  const plusMatch = text.match(/(\d+)\s*\+\s*(\d+)/);
  if (plusMatch) {
    const a = Number(plusMatch[1]);
    const b = Number(plusMatch[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) pax = Math.max(pax, a + b);
  }

  // Shorthand "1P" / "2P" / "Team 1P" common in team field and line items
  const pShorthand = text.match(/(?:team\s*)?(\d+)\s*[Pp]\b/);
  if (pShorthand) {
    const n = Number(pShorthand[1]);
    if (Number.isFinite(n) && n > 0 && n <= 20) pax = Math.max(pax, n);
  }

  const roleSum = photogs + asst + video + others;
  const headcount = Math.max(roleSum, pax > 0 && pax <= 20 ? pax : 0);

  return {
    photographers: photogs,
    assistants: asst,
    videographers: video,
    others,
    headcount,
  };
}

/**
 * High-confidence crew parse for backfill — requires numeric / Team XP signals.
 * Skips bare role words (e.g. lone「攝影師」→1) that are too ambiguous to write.
 */
export function extractCrewHighConfidence(text: string): CrewBreakdown | null {
  if (!text?.trim()) return null;

  const photographers = Math.max(
    countRole(text, [
      /(\d+)\s*(?:位|名|x|×|\*)?\s*(?:攝影師|摄影师|photographers?|photogs?)/gi,
      /(?:攝影師|摄影师|photographers?|photogs?)\s*[x×*]?\s*(\d+)/gi,
    ]),
    countWordPhotographers(text)
  );
  const assistants = countRole(text, [
    /(\d+)\s*(?:位|名|x|×|\*)?\s*(?:助理|助手|assistants?)/gi,
    /(?:助理|助手|assistants?)\s*[x×*]?\s*(\d+)/gi,
  ]);
  const videographers = countRole(text, [
    /(\d+)\s*(?:位|名|x|×|\*)?\s*(?:攝影師兼錄影|錄影師|摄像师|videographers?|cinematographers?|cameramen?)/gi,
    /(?:錄影師|摄像师|videographers?)\s*[x×*]?\s*(\d+)/gi,
  ]);
  const others = countRole(text, [
    /(\d+)\s*(?:位|名|x|×|\*)?\s*(?:化妝|妆|makeup|造型|stylist|燈光|灯光|gaffer|製作|制作|producer)/gi,
  ]);

  let pax = 0;
  const paxMatch = text.match(/(\d+)\s*(?:人|位|pax|persons?|people)(?![a-zA-Z])/i);
  if (paxMatch) pax = Number(paxMatch[1]) || 0;
  const plusMatch = text.match(/(\d+)\s*\+\s*(\d+)/);
  if (plusMatch) {
    const a = Number(plusMatch[1]);
    const b = Number(plusMatch[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) pax = Math.max(pax, a + b);
  }
  const pShorthand = text.match(/(?:team\s*)?(\d+)\s*[Pp]\b/);
  if (pShorthand) {
    const n = Number(pShorthand[1]);
    if (Number.isFinite(n) && n > 0 && n <= 20) pax = Math.max(pax, n);
  }

  const roleSum = photographers + assistants + videographers + others;
  const hasNumericSignal = roleSum > 0 || pax > 0;
  if (!hasNumericSignal) return null;

  const headcount = Math.max(roleSum, pax > 0 && pax <= 20 ? pax : 0);
  if (headcount <= 0) return null;

  // Team XP with no role breakdown → photographers = headcount (studio convention)
  const photogs = roleSum > 0 ? photographers : headcount;
  return {
    photographers: photogs,
    assistants,
    videographers,
    others,
    headcount,
  };
}

/** True when text has an explicit hours / half-day / full-day signal. */
export function hasHighConfidenceHoursSignal(text: string): boolean {
  return extractHoursFromText(text) != null;
}

/** True when text has an explicit shot-count signal (張 / photos / pcs). */
export function hasHighConfidenceShotCountSignal(text: string): boolean {
  return extractShotCountFromText(text) != null;
}

export function formatCrewLabel(crew: CrewBreakdown): string {
  if (crew.headcount <= 0) return "人手未標明";
  const parts: string[] = [];
  if (crew.photographers > 0) parts.push(`攝影師×${crew.photographers}`);
  if (crew.videographers > 0) parts.push(`錄影×${crew.videographers}`);
  if (crew.assistants > 0) parts.push(`助理×${crew.assistants}`);
  if (crew.others > 0) parts.push(`其他×${crew.others}`);
  if (parts.length === 0) return `${crew.headcount} 人`;
  return parts.join(" + ");
}

/** Build display team string from structured crew counts. */
export function formatTeamFromStructured(crew: {
  photographers?: number;
  assistants?: number;
  videographers?: number;
  others?: number;
}): string {
  const photographers = Math.max(0, Math.floor(Number(crew.photographers) || 0));
  const assistants = Math.max(0, Math.floor(Number(crew.assistants) || 0));
  const videographers = Math.max(0, Math.floor(Number(crew.videographers) || 0));
  const others = Math.max(0, Math.floor(Number(crew.others) || 0));
  return formatCrewLabel({
    photographers,
    assistants,
    videographers,
    others,
    headcount: photographers + assistants + videographers + others,
  }).replace("人手未標明", "");
}

function crewFromStructured(input: {
  crewPhotographers?: number | null;
  crewAssistants?: number | null;
  crewVideographers?: number | null;
  crewOthers?: number | null;
}): CrewBreakdown | null {
  const photographers = Math.max(0, Math.floor(Number(input.crewPhotographers) || 0));
  const assistants = Math.max(0, Math.floor(Number(input.crewAssistants) || 0));
  const videographers = Math.max(0, Math.floor(Number(input.crewVideographers) || 0));
  const others = Math.max(0, Math.floor(Number(input.crewOthers) || 0));
  const headcount = photographers + assistants + videographers + others;
  if (headcount <= 0) return null;
  return { photographers, assistants, videographers, others, headcount };
}

function parseStructuredHours(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 72) return null;
  return Math.round(n * 10) / 10;
}

function parseStructuredShotCount(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 5000) return null;
  return Math.floor(n);
}

/** Pull delivered photo/shot count from free text (張數). */
export function extractShotCountFromText(text: string): number | null {
  if (!text?.trim()) return null;
  const matches: number[] = [];
  const re =
    /(\d+)\s*(?:張|款|件|pcs?|pieces?|photos?|images?|shots?|pictures?)(?![a-zA-Z])/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0 && n <= 5000) matches.push(n);
  }
  // "x20 final images" / "20 final"
  const en = text.match(
    /(\d+)\s*(?:final\s+)?(?:edited\s+)?(?:images?|photos?|shots?)/i
  );
  if (en) {
    const n = Number(en[1]);
    if (Number.isFinite(n) && n > 0 && n <= 5000) matches.push(n);
  }
  if (matches.length === 0) return null;
  // Prefer the largest mentioned count (usually the delivered package size)
  return Math.max(...matches);
}

/**
 * Derive shoot fundamentals from structured columns first, then free-text fallback.
 */
export function extractQuoteShootFeatures(input: {
  shootHours?: number | string | null;
  shotCount?: number | string | null;
  crewPhotographers?: number | null;
  crewAssistants?: number | null;
  crewVideographers?: number | null;
  crewOthers?: number | null;
  team?: string | null;
  notes?: string | null;
  equipment?: string | null;
  items?: Array<{
    description?: string | null;
    quantity?: number | string | null;
    unitPrice?: number | string | null;
    amount?: number | string | null;
  }>;
  total?: number | null;
}): QuoteShootFeatures {
  const itemText = (input.items ?? [])
    .map((i) => i.description ?? "")
    .filter(Boolean)
    .join("\n");
  const team = input.team ?? "";
  const notes = input.notes ?? "";
  const equipment = input.equipment ?? "";

  // Hours: prefer structured column
  let hours = parseStructuredHours(input.shootHours);
  let hoursSource: QuoteShootFeatures["hoursSource"] = hours != null ? "structured" : null;
  if (hours == null) {
    hours = extractHoursFromText(itemText);
    if (hours != null) hoursSource = "items";
  }
  if (hours == null) {
    hours = extractHoursFromText(notes);
    if (hours != null) hoursSource = "notes";
  }
  if (hours == null) {
    hours = extractHoursFromText(team);
    if (hours != null) hoursSource = "team";
  }

  // Shot count (張數)
  let shotCount = parseStructuredShotCount(input.shotCount);
  let shotCountSource: QuoteShootFeatures["shotCountSource"] =
    shotCount != null ? "structured" : null;
  if (shotCount == null) {
    shotCount = extractShotCountFromText(itemText);
    if (shotCount != null) shotCountSource = "items";
  }
  if (shotCount == null) {
    shotCount = extractShotCountFromText(notes);
    if (shotCount != null) shotCountSource = "notes";
  }

  // Crew: prefer structured counts
  let crew = crewFromStructured(input);
  let crewSource: QuoteShootFeatures["crewSource"] = crew ? "structured" : null;
  if (!crew) {
    crew = extractCrewFromText(team);
    if (crew.headcount > 0) crewSource = "team";
  }
  if (!crew || crew.headcount <= 0) {
    crew = extractCrewFromText(itemText);
    if (crew.headcount > 0) crewSource = "items";
  }
  if (!crew || crew.headcount <= 0) {
    crew = extractCrewFromText(`${notes}\n${equipment}`);
    if (crew.headcount > 0) crewSource = "notes";
  }
  if (!crew) {
    crew = {
      photographers: 0,
      assistants: 0,
      videographers: 0,
      others: 0,
      headcount: 0,
    };
  }

  const money = resolveLearningTotal({
    items: input.items,
    quoteTotal: input.total,
  });
  const learningTotal =
    money.learningTotal > 0 ? money.learningTotal : null;
  const quoteTotal = money.quoteTotal > 0 ? money.quoteTotal : null;
  const photographerCrewSubtotal = money.split.hasPhotographerCrewLines
    ? money.split.photographerCrewSubtotal
    : null;
  const rateBase = learningTotal;
  const pricePerHour =
    hours != null && hours > 0 && rateBase != null && rateBase > 0
      ? Math.round(rateBase / hours)
      : null;
  const pricePerShot =
    shotCount != null && shotCount > 0 && rateBase != null && rateBase > 0
      ? Math.round(rateBase / shotCount)
      : null;

  return {
    hours,
    hoursBucket: hoursBucket(hours),
    hoursSource,
    crew,
    crewBucket: crewBucketFromHeadcount(crew.headcount),
    crewLabel: formatCrewLabel(crew),
    crewSource,
    shotCount,
    shotCountBucket: shotCountBucket(shotCount),
    shotCountSource,
    pricePerHour,
    pricePerShot,
    photographerCrewSubtotal,
    quoteTotal,
    learningTotal,
    learningTotalSource: learningTotal != null
      ? money.split.hasPhotographerCrewLines
        ? "photographer_crew"
        : "quote_total"
      : null,
  };
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const w = idx - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

/** Drop extreme outliers via IQR fence when sample is large enough. */
export function trimOutliers(values: number[], minForTrim = 5): number[] {
  const sorted = [...values].filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (sorted.length < minForTrim) return sorted;
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  const iqr = q3 - q1;
  if (iqr <= 0) return sorted;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  const trimmed = sorted.filter((n) => n >= lo && n <= hi);
  return trimmed.length >= 3 ? trimmed : sorted;
}

export function summarizeTotals(totals: number[], opts?: { trim?: boolean }) {
  const raw = [...totals].filter((n) => Number.isFinite(n) && n > 0);
  const sorted = opts?.trim === false ? raw.sort((a, b) => a - b) : trimOutliers(raw);
  if (sorted.length === 0) {
    return {
      count: 0,
      rawCount: raw.length,
      avg: 0,
      min: 0,
      max: 0,
      p25: 0,
      p50: 0,
      p75: 0,
      trimmed: 0,
    };
  }
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    rawCount: raw.length,
    avg: Math.round(sum / sorted.length),
    min: Math.round(sorted[0]),
    max: Math.round(sorted[sorted.length - 1]),
    p25: Math.round(percentile(sorted, 0.25)),
    p50: Math.round(percentile(sorted, 0.5)),
    p75: Math.round(percentile(sorted, 0.75)),
    trimmed: Math.max(0, raw.length - sorted.length),
  };
}

/**
 * Time-weighted median: recent quotes weigh more (half-life ~180 days).
 */
export function timeWeightedMedian(
  points: Array<{ value: number; at: Date | string | null | undefined }>
): number | null {
  const now = Date.now();
  const halfLifeMs = 180 * 24 * 60 * 60 * 1000;
  const rows = points
    .map((p) => {
      const v = Number(p.value);
      if (!Number.isFinite(v) || v <= 0) return null;
      const t = p.at ? new Date(p.at).getTime() : now;
      const age = Number.isFinite(t) ? Math.max(0, now - t) : 0;
      const weight = Math.pow(0.5, age / halfLifeMs);
      return { value: v, weight };
    })
    .filter((x): x is { value: number; weight: number } => x != null)
    .sort((a, b) => a.value - b.value);

  if (rows.length === 0) return null;
  const totalW = rows.reduce((s, r) => s + r.weight, 0);
  if (totalW <= 0) return Math.round(rows[Math.floor(rows.length / 2)].value);

  let acc = 0;
  const target = totalW / 2;
  for (const r of rows) {
    acc += r.weight;
    if (acc >= target) return Math.round(r.value);
  }
  return Math.round(rows[rows.length - 1].value);
}
