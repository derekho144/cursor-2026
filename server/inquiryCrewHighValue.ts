/** Crew / camera / video-team signals that force high-value (meeting) flow. */

const CN_COUNT: Array<[RegExp, number]> = [
  [/兩位|两位|兩名|两名|兩台|两台/g, 2],
  [/三位|三名|三台/g, 3],
  [/四位|四名|四台/g, 4],
  [/五位|五名/g, 5],
];

function normalizeCrewText(raw: string): string {
  let t = raw;
  for (const [re, n] of CN_COUNT) t = t.replace(re, String(n));
  t = t.replace(/雙機|双机|兩機|两机|二機/g, "2機");
  return t;
}

function maxCapturedCount(text: string, re: RegExp): number {
  let max = 0;
  const baseFlags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const copy = new RegExp(re.source, baseFlags);
  let m: RegExpExecArray | null = null;
  while ((m = copy.exec(text)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 30) max = Math.max(max, n);
  }
  return max;
}

export type CrewHighValueSignal = {
  highValue: boolean;
  photographerCount: number;
  assistantCount: number;
  cameraCount: number;
  hasVideoTeam: boolean;
  reasons: string[];
};

export function detectCrewHighValue(subjectAndBody: string): CrewHighValueSignal {
  const text = normalizeCrewText(subjectAndBody);

  const photographerCount = Math.max(
    maxCapturedCount(text, /(\d+)\s*(?:x\s*)?(?:chief\s+)?photographers?\b/gi),
    maxCapturedCount(text, /(\d+)\s*(?:位|名)?\s*(?:首席|主)?攝影師/g),
    maxCapturedCount(text, /(\d+)\s*Chief\s+photographers?\b/gi)
  );

  const assistantCount = Math.max(
    maxCapturedCount(text, /(\d+)\s*(?:photo\s+)?assistants?\b/gi),
    maxCapturedCount(text, /(\d+)\s*(?:位|名)?\s*(?:拍攝)?助理/g)
  );

  const cameraCount = Math.max(
    maxCapturedCount(text, /(\d+)\s*(?:cameras?|cams?|機位)\b/gi),
    maxCapturedCount(text, /(\d+)\s*機(?!構|關|會|場|票|會)/g)
  );

  const hasVideoTeam =
    /\bvideo\s*(crew|team|assistants?)\b/i.test(text) ||
    /\bvideographers?\b/i.test(text) ||
    /拍攝助理\s*[\(（]?\s*video/i.test(text) ||
    /video\s*[\)）]?\s*拍攝助理/i.test(text) ||
    /(錄影|攝錄)\s*(助理|團隊|crew|team)/i.test(text) ||
    /(助理|團隊).{0,8}(video|錄影|攝錄)/i.test(text);

  const reasons: string[] = [];
  if (hasVideoTeam) reasons.push("video team");
  if (assistantCount >= 2 && hasVideoTeam) reasons.push(`${assistantCount} video assistants`);

  // 2+ photographers / cameras is NOT automatically high-value
  // (e.g. 2 photographers × 3 hours can be under HK$8,000).
  // Video crew/team always is. Photographer headcount is priced in AI rules, then $8,000 applies.
  const highValue = hasVideoTeam;

  return {
    highValue,
    photographerCount,
    assistantCount,
    cameraCount,
    hasVideoTeam,
    reasons,
  };
}

export const CREW_BILLING_RULES = `
=== CREW SIZE (CRITICAL — never ignore headcount) ===
If the email specifies N photographers, assistants, or video crew, you MUST price PER PERSON × hours. Do NOT collapse a 4-person crew into one "Event Photography" line.

Rates (corporate / commercial, per person per hour):
  - Chief / lead photographer: HKD 1,000–1,500/hr each
  - Additional photographer: HKD 800–1,200/hr each
  - Photo assistant: HKD 500–800/hr each
  - Videographer: HKD 1,500–2,500/hr each
  - Video shooting assistant: HKD 600–1,000/hr each
  - Transportation Fee: HKD 320 (once)

Example — "2 Chief photographer + 2 拍攝助理 (video)", duration not stated → assume 4 hours:
  2 × Chief photographer × 4h × HKD 1,000 = HKD 8,000
  2 × Video assistant × 4h × HKD 800 = HKD 6,400
  Video editing (flat) HKD 2,500
  Transport HKD 320
  TOTAL ≈ HKD 17,220

HIGH-VALUE OVERRIDE (code + prompt):
  - Video team / videographer / 拍攝助理 (video) / video crew → HIGH VALUE (meeting email).
  - 2+ photographers or 2 cameras alone is NOT automatically high value
    (2 photographers × 3 hours can be under HK$8,000). Price per head, then apply the HK$8,000 total threshold.
`;
