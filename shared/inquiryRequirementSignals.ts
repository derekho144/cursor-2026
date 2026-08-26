/**
 * Deterministic requirement signals from inquiry text (body + PDF).
 *
 * These are facts, not prices. Used to:
 * 1. Prime the understanding pass
 * 2. Fail closed when the model drops a work package (HKSEA-style collapse)
 */

export type RequirementSignalKind =
  | "shot_count"
  | "event_hours"
  | "event_days"
  | "background_removal";

export type RequirementSignal = {
  kind: RequirementSignalKind;
  label: string;
  value: number | null;
  unit: string | null;
  evidence: string;
};

const YEAR_RE = /^(?:19|20)\d{2}$/;

function clipEvidence(text: string, start: number, end: number): string {
  const a = Math.max(0, start - 8);
  const b = Math.min(text.length, end + 8);
  return text.slice(a, b).replace(/\s+/g, " ").trim();
}

function isYearLike(n: number, after: string): boolean {
  if (YEAR_RE.test(String(n))) return /^(?:\s*年)/.test(after);
  return false;
}

/** Skip 交付後7天 / within 7 days — those are turnaround, not shoot duration. */
function isDeliveryTurnaround(before: string, after: string): boolean {
  const ctx = `${before.slice(-16)}${after.slice(0, 12)}`;
  return /交付|交貨|交片|turnaround|之內|之内|天內|天内|within|後\s*$|后\s*$/i.test(
    ctx
  );
}

function parseHourRange(startH: number, startMin: number, startMer: string, endH: number, endMin: number, endMer: string): number | null {
  const to24 = (h: number, mer: string): number => {
    let hh = h;
    const m = mer.toLowerCase();
    if (m === "pm" && hh < 12) hh += 12;
    if ((m === "am" || m === "nn" || m === "noon") && hh === 12) hh = 12;
    if (m === "nn" || m === "noon") hh = 12;
    return hh;
  };
  let a = to24(startH, startMer) + startMin / 60;
  let b = to24(endH, endMer) + endMin / 60;
  if (b <= a && b <= 12 && a >= 12) b += 12;
  if (b <= a && endMer === "" && startMer === "") {
    // 12-5 without am/pm → treat as noon to 5pm
    if (startH === 12 && endH <= 11) b += 12;
  }
  const hours = b - a;
  if (hours < 1 || hours > 16) return null;
  return Math.round(hours * 2) / 2;
}

export function extractRequirementSignals(raw: string): RequirementSignal[] {
  const text = raw ?? "";
  const signals: RequirementSignal[] = [];
  const seen = new Set<string>();

  const push = (s: RequirementSignal) => {
    const key = `${s.kind}:${s.value ?? ""}:${s.evidence}`;
    if (seen.has(key)) return;
    seen.add(key);
    signals.push(s);
  };

  if (/去背|去背景|抠图|摳圖|cut[\s-]?outs?|background\s*remov(?:al|e)/i.test(text)) {
    const m = text.match(
      /.{0,12}(?:去背|去背景|抠图|摳圖|cut[\s-]?outs?|background\s*remov(?:al|e)).{0,12}/i
    );
    push({
      kind: "background_removal",
      label: "作品／產品去背（獨立後期，唔係活動「執相已包含」）",
      value: null,
      unit: "cutouts",
      evidence: (m?.[0] ?? "去背").replace(/\s+/g, " ").trim(),
    });
  }

  const shotRe =
    /(?:約|大约|大約|around|about|approx(?:imately)?|~)?\s*(\d{2,4})\s*(?:件|張|张|幅|款|套|pcs?|pieces?|photos?|images?|shots?|skus?|artworks?|products?)(?:\s*(?:作品|產品|菜式|jewelry|珠寶))?/gi;
  let m: RegExpExecArray | null;
  while ((m = shotRe.exec(text)) !== null) {
    const n = Number(m[1]);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 6);
    if (!Number.isFinite(n) || n < 8 || n > 5000) continue;
    if (isYearLike(n, after)) continue;
    push({
      kind: "shot_count",
      label: `約 ${n} 件／張拍攝或交付`,
      value: n,
      unit: "shots",
      evidence: clipEvidence(text, m.index, m.index + m[0].length),
    });
  }

  const shotAdjRe =
    /(\d{2,4})\s+(?:[A-Za-z]+(?:ed|ing)?\s+){1,2}(?:photos?|images?|shots?|pieces?)/gi;
  while ((m = shotAdjRe.exec(text)) !== null) {
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n < 8 || n > 5000) continue;
    push({
      kind: "shot_count",
      label: `約 ${n} 件／張拍攝或交付`,
      value: n,
      unit: "shots",
      evidence: clipEvidence(text, m.index, m.index + m[0].length),
    });
  }

  const pieceRe = /(\d{2,4})\s*(?:件)?(?:作品|產品)/g;
  while ((m = pieceRe.exec(text)) !== null) {
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n < 8 || n > 5000) continue;
    push({
      kind: "shot_count",
      label: `約 ${n} 件作品／產品`,
      value: n,
      unit: "pieces",
      evidence: clipEvidence(text, m.index, m.index + m[0].length),
    });
  }

  const dayRe = /(\d{1,2})\s*(?:天|days?)(?!\s*(?:內|内|後|后))/gi;
  while ((m = dayRe.exec(text)) !== null) {
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n < 2 || n > 21) continue;
    const before = text.slice(Math.max(0, m.index - 16), m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 12);
    if (isDeliveryTurnaround(before, after)) continue;
    if (/月/.test(before.slice(-2))) continue;
    push({
      kind: "event_days",
      label: `${n} 天拍攝（唔可以當成 ${n} 小時）`,
      value: n,
      unit: "days",
      evidence: clipEvidence(text, m.index, m.index + m[0].length),
    });
  }

  const hourRe = /(\d{1,2}(?:\.\d)?)\s*(?:小時|hrs?|hours?)\b/gi;
  while ((m = hourRe.exec(text)) !== null) {
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n < 1 || n > 16) continue;
    push({
      kind: "event_hours",
      label: `${n} 小時活動／拍攝`,
      value: n,
      unit: "hours",
      evidence: clipEvidence(text, m.index, m.index + m[0].length),
    });
  }

  const rangeRe =
    /(?:中午|下午|上午)?\s*(\d{1,2})(?::(\d{2}))?\s*(nn|noon|am|pm|時)?\s*(?:至|到|[-–~])\s*(?:下午|上午|晚上)?\s*(\d{1,2})(?::(\d{2}))?\s*(nn|noon|am|pm|時)?/gi;
  const rangeHours: number[] = [];
  while ((m = rangeRe.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - 3), m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 2);
    if (/月/.test(before) || /^日/.test(after)) continue; // 12月15-22日
    const startH = Number(m[1]);
    const endH = Number(m[4]);
    const looksLikeDateRange =
      (startH > 12 || endH > 12) && !m[2] && !m[3] && !m[5] && !m[6];
    if (looksLikeDateRange) continue;
    const hours = parseHourRange(
      startH,
      Number(m[2] || 0),
      m[3] || "",
      endH,
      Number(m[5] || 0),
      m[6] || ""
    );
    if (hours == null) continue;
    rangeHours.push(hours);
    push({
      kind: "event_hours",
      label: `時段約 ${hours} 小時`,
      value: hours,
      unit: "hours",
      evidence: clipEvidence(text, m.index, m.index + m[0].length),
    });
  }

  const collapseByMax = (kind: RequirementSignalKind) => {
    const subset = signals.filter((s) => s.kind === kind);
    if (subset.length <= 1) return;
    const max = subset.reduce((a, b) => ((a.value ?? 0) >= (b.value ?? 0) ? a : b));
    for (let i = signals.length - 1; i >= 0; i--) {
      if (signals[i].kind === kind && signals[i] !== max) signals.splice(i, 1);
    }
  };
  collapseByMax("shot_count");
  collapseByMax("event_hours");
  collapseByMax("event_days");

  void rangeHours;
  return signals;
}

export function isMultiScopeSignals(signals: RequirementSignal[]): boolean {
  const hasTime = signals.some(
    (s) => s.kind === "event_hours" || s.kind === "event_days"
  );
  const hasStill = signals.some(
    (s) => s.kind === "shot_count" || s.kind === "background_removal"
  );
  return hasTime && hasStill;
}

export function formatSignalsForPrompt(signals: RequirementSignal[]): string {
  if (!signals.length) {
    return "（機械抽取：無明確數量／去背／天數訊號。唔好發明時數或張數。）";
  }
  return signals
    .map(
      (s, i) =>
        `${i + 1}. [${s.kind}] ${s.label}${s.value != null ? ` (value=${s.value})` : ""} — 原文：「${s.evidence}」`
    )
    .join("\n");
}
