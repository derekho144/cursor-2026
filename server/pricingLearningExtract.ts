/**
 * Extract shoot fundamentals from free-text quote fields.
 * Foundations for pricing learning: hours · shoot type · crew.
 */

export type HoursBucket = "unknown" | "lte_2" | "h2_4" | "h4_8" | "gt_8";
export type CrewBucket = "unknown" | "solo" | "pair" | "team";

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
  hoursSource: "items" | "notes" | "team" | "inferred" | null;
  crew: CrewBreakdown;
  crewBucket: CrewBucket;
  crewLabel: string;
  crewSource: "team" | "items" | "notes" | null;
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

  const photographers = countRole(text, [
    /(\d+)\s*(?:位|名|x|×|\*)?\s*(?:攝影師|摄影师|photographers?|photogs?)/gi,
    /(?:攝影師|摄影师|photographers?|photogs?)\s*[x×*]?\s*(\d+)/gi,
  ]);
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

function formatCrewLabel(crew: CrewBreakdown): string {
  if (crew.headcount <= 0) return "人手未標明";
  const parts: string[] = [];
  if (crew.photographers > 0) parts.push(`攝影師×${crew.photographers}`);
  if (crew.videographers > 0) parts.push(`錄影×${crew.videographers}`);
  if (crew.assistants > 0) parts.push(`助理×${crew.assistants}`);
  if (crew.others > 0) parts.push(`其他×${crew.others}`);
  if (parts.length === 0) return `${crew.headcount} 人`;
  return parts.join(" + ");
}

/**
 * Derive shoot fundamentals from a quote's free-text fields + line items.
 */
export function extractQuoteShootFeatures(input: {
  team?: string | null;
  notes?: string | null;
  equipment?: string | null;
  items?: Array<{ description?: string | null; quantity?: number | string | null }>;
}): QuoteShootFeatures {
  const itemText = (input.items ?? [])
    .map((i) => i.description ?? "")
    .filter(Boolean)
    .join("\n");
  const team = input.team ?? "";
  const notes = input.notes ?? "";
  const equipment = input.equipment ?? "";

  // Hours: prefer item lines, then notes, then team
  let hours = extractHoursFromText(itemText);
  let hoursSource: QuoteShootFeatures["hoursSource"] = hours != null ? "items" : null;
  if (hours == null) {
    hours = extractHoursFromText(notes);
    if (hours != null) hoursSource = "notes";
  }
  if (hours == null) {
    hours = extractHoursFromText(team);
    if (hours != null) hoursSource = "team";
  }
  // Infer: quantity on "小時" unit-like lines already covered; if still null leave unknown

  // Crew: prefer dedicated team field
  let crew = extractCrewFromText(team);
  let crewSource: QuoteShootFeatures["crewSource"] = crew.headcount > 0 ? "team" : null;
  if (crew.headcount <= 0) {
    crew = extractCrewFromText(itemText);
    if (crew.headcount > 0) crewSource = "items";
  }
  if (crew.headcount <= 0) {
    crew = extractCrewFromText(`${notes}\n${equipment}`);
    if (crew.headcount > 0) crewSource = "notes";
  }

  return {
    hours,
    hoursBucket: hoursBucket(hours),
    hoursSource,
    crew,
    crewBucket: crewBucketFromHeadcount(crew.headcount),
    crewLabel: formatCrewLabel(crew),
    crewSource,
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

export function summarizeTotals(totals: number[]) {
  const sorted = [...totals].filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return { count: 0, avg: 0, min: 0, max: 0, p25: 0, p50: 0, p75: 0 };
  }
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    avg: Math.round(sum / sorted.length),
    min: Math.round(sorted[0]),
    max: Math.round(sorted[sorted.length - 1]),
    p25: Math.round(percentile(sorted, 0.25)),
    p50: Math.round(percentile(sorted, 0.5)),
    p75: Math.round(percentile(sorted, 0.75)),
  };
}
