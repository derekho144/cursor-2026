/**
 * Deterministic requirement signals from inquiry text (body + PDF).
 *
 * These are facts, not prices. Used to:
 * 1. Prime the understanding pass
 * 2. Fail closed when the model drops a work package (HKSEA-style collapse)
 */

export type RequirementSignalKind =
  | "shot_count"
  | "retouch_count"
  | "revision_rounds"
  | "event_hours"
  | "event_days"
  | "background_removal"
  | "video_count"
  | "clip_seconds"
  | "video_edit"
  | "crew_1p1v";

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

const CN_STRIP: Array<[RegExp, string]> = [
  [/兩次|两次|二次/g, "2次"],
  [/三次/g, "3次"],
  [/四次/g, "4次"],
  [/五次/g, "5次"],
  [/兩條|两条|二條|二条/g, "2條"],
  [/三條|三条/g, "3條"],
  [/四條|四条/g, "4條"],
  [/五條|五条/g, "5條"],
  [/六條|六条/g, "6條"],
  [/七條|七条/g, "7條"],
  [/八條|八条/g, "8條"],
  [/九條|九条/g, "9條"],
  [/十條|十条/g, "10條"],
];

const EN_COUNT: Array<[RegExp, string]> = [
  [/\btwo\s+(videos?|clips?|reels?|films?)/gi, "2 $1"],
  [/\bthree\s+(videos?|clips?|reels?|films?)/gi, "3 $1"],
  [/\bfour\s+(videos?|clips?|reels?|films?)/gi, "4 $1"],
  [/\bfive\s+(videos?|clips?|reels?|films?)/gi, "5 $1"],
  [/\bsix\s+(videos?|clips?|reels?|films?)/gi, "6 $1"],
];

/** 「三條影片」→「3條影片」so count regex can run. */
export function normalizeDeliverableCounts(raw: string): string {
  let t = raw ?? "";
  for (const [re, to] of CN_STRIP) t = t.replace(re, to);
  for (const [re, to] of EN_COUNT) t = t.replace(re, to);
  return t;
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

const PHOTO_NEED_RE = /攝影|photograph|photos?\b|影相|照片|相片/i;
const VIDEO_NEED_RE =
  /攝像|錄影|攝錄|videograph|\bvideos?\b|影片拍攝|拍片|精選視頻|精選影片|影片|視頻|reels?|highlight\s*video/i;

/** On-site stills / photography is in scope. */
export function briefNeedsPhotography(text: string): boolean {
  return PHOTO_NEED_RE.test(text ?? "");
}

/** Video capture or a video deliverable is in scope. */
export function briefNeedsVideo(text: string): boolean {
  return VIDEO_NEED_RE.test(text ?? "");
}

/**
 * Studio rule: photography + video in the same brief → on-site crew is 1P+1V.
 * Not one person dual-role. Explicit 2P still satisfies the 1P minimum later.
 */
export function briefNeedsCrew1p1v(text: string): boolean {
  const t = text ?? "";
  return briefNeedsPhotography(t) && briefNeedsVideo(t);
}

export function extractRequirementSignals(raw: string): RequirementSignal[] {
  const text = normalizeDeliverableCounts(raw ?? "");
  const signals: RequirementSignal[] = [];
  const seen = new Set<string>();

  const push = (s: RequirementSignal) => {
    const key = `${s.kind}:${s.value ?? ""}:${s.evidence}`;
    if (seen.has(key)) return;
    seen.add(key);
    signals.push(s);
  };

  let m: RegExpExecArray | null;

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

  if (/剪埋|剪接|剪輯|剪片|video\s*edit|post[- ]?production\s*edit/i.test(text)) {
    const em = text.match(
      /.{0,10}(?:剪埋|剪接|剪輯|剪片|video\s*edit|post[- ]?production\s*edit).{0,16}/i
    );
    push({
      kind: "video_edit",
      label: "影片剪接／後期（獨立工作包，唔係活動攝影附送）",
      value: null,
      unit: "edit",
      evidence: (em?.[0] ?? "剪接").replace(/\s+/g, " ").trim(),
    });
  }

  const videoCountRe =
    /(\d{1,2})\s*(?:條|条|支)?\s*(?:影片|短片|片花|宣傳片|clips?|videos?|reels?|films?)/gi;
  while ((m = videoCountRe.exec(text)) !== null) {
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n < 1 || n > 30) continue;
    push({
      kind: "video_count",
      label: `${n} 條影片／clips（獨立交付）`,
      value: n,
      unit: "clips",
      evidence: clipEvidence(text, m.index, m.index + m[0].length),
    });
  }

  const perClipSecRe =
    /每[條条支個个]\s*(\d{1,4})\s*(?:秒|seconds?|secs?)|(\d{1,4})\s*(?:秒|seconds?|secs?)\s*(?:each|一條|一条|\/\s*clip)/gi;
  while ((m = perClipSecRe.exec(text)) !== null) {
    const n = Number(m[1] || m[2]);
    if (!Number.isFinite(n) || n < 5 || n > 600) continue;
    push({
      kind: "clip_seconds",
      label: `每條約 ${n} 秒`,
      value: n,
      unit: "seconds",
      evidence: clipEvidence(text, m.index, m.index + m[0].length),
    });
  }

  // 「1分鐘精選視頻」is highlight duration, not event hours.
  const highlightMinRe =
    /(\d{1,2})\s*分鐘(?:精選)?(?:視頻|影片|片花|短片)|(\d{1,2})[- ]?minute(?:s)?\s+(?:highlight|video|film|reel)/gi;
  while ((m = highlightMinRe.exec(text)) !== null) {
    const n = Number(m[1] || m[2]);
    if (!Number.isFinite(n) || n < 1 || n > 10) continue;
    push({
      kind: "clip_seconds",
      label: `精選視頻約 ${n} 分鐘`,
      value: n * 60,
      unit: "seconds",
      evidence: clipEvidence(text, m.index, m.index + m[0].length),
    });
  }

  const shotRe =
    /(?:約|大约|大約|around|about|approx(?:imately)?|~)?\s*(\d{2,4})\s*(?:件|張|张|幅|款|套|pcs?|pieces?|photos?|images?|shots?|skus?|artworks?|products?)(?:\s*(?:作品|產品|菜式|jewelry|珠寶))?/gi;
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

  const retouchRe =
    /(?:精修|修圖)\s*(?:不少於|至少|約)?\s*(\d{2,4})\s*張|(?:不少於|至少|約)?\s*(\d{2,4})\s*張(?:合格)?(?:照片)?(?:之)?(?:精修|修圖)|(\d{2,4})\s+(?:retouched|edited)\s+(?:photos?|images?)/gi;
  while ((m = retouchRe.exec(text)) !== null) {
    const n = Number(m[1] || m[2] || m[3]);
    if (!Number.isFinite(n) || n < 8 || n > 5000) continue;
    push({
      kind: "retouch_count",
      label: `精修不少於 ${n} 張（獨立於合格張數）`,
      value: n,
      unit: "shots",
      evidence: clipEvidence(text, m.index, m.index + m[0].length),
    });
  }

  const revisionRe =
    /(\d{1,2})\s*次(?:根據要求)?(?:精修|修改|修圖|revision)|(\d{1,2})\s*(?:rounds?|revisions?)\s*(?:of\s*)?(?:retouch|edit)?/gi;
  while ((m = revisionRe.exec(text)) !== null) {
    const n = Number(m[1] || m[2]);
    if (!Number.isFinite(n) || n < 2 || n > 10) continue;
    push({
      kind: "revision_rounds",
      label: `精修 ${n} 次修改`,
      value: n,
      unit: "rounds",
      evidence: clipEvidence(text, m.index, m.index + m[0].length),
    });
  }

  const dayRe = /(\d{1,2})\s*(?:天|日|days?)(?!\s*(?:內|内|後|后))/gi;
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

  const hourRe = /(\d{1,2}(?:\.\d)?)\s*(?:小時|hrs?|hours?)/gi;
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
    /(?:中午|下午|上午|晚上)?\s*(\d{1,2})(?::(\d{2}))?\s*(nn|noon|am|pm|時|點|点)?\s*(?:至|到|[-–~])\s*(?:下午|上午|晚上)?\s*(\d{1,2})(?::(\d{2}))?\s*(nn|noon|am|pm|時|點|点)?/gi;
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
  collapseByMax("retouch_count");
  collapseByMax("revision_rounds");
  collapseByMax("event_hours");
  collapseByMax("event_days");
  collapseByMax("video_count");
  collapseByMax("clip_seconds");

  if (briefNeedsCrew1p1v(text)) {
    const ev =
      text.match(
        /.{0,10}(?:攝影攝像|攝影.{0,16}(?:攝像|影片|視頻|video)|photograph.{0,24}video).{0,12}/i
      )?.[0] ?? "攝影 + 影片";
    push({
      kind: "crew_1p1v",
      label: "現場人手 1 攝影師 + 1 攝像師（影相兼拍片，唔可以一人包辦）",
      value: 2,
      unit: "people",
      evidence: ev.replace(/\s+/g, " ").trim(),
    });
  }

  void rangeHours;
  return signals;
}

export function isMultiScopeSignals(signals: RequirementSignal[]): boolean {
  const families = new Set<string>();
  for (const s of signals) {
    if (s.kind === "event_hours" || s.kind === "event_days") families.add("time");
    if (
      s.kind === "shot_count" ||
      s.kind === "background_removal" ||
      s.kind === "retouch_count" ||
      s.kind === "revision_rounds"
    ) {
      families.add("still");
    }
    if (
      s.kind === "video_count" ||
      s.kind === "clip_seconds" ||
      s.kind === "video_edit"
    ) {
      families.add("video");
    }
    if (s.kind === "crew_1p1v") families.add("crew");
  }
  return families.size >= 2;
}

export function formatSignalsForPrompt(signals: RequirementSignal[]): string {
  if (!signals.length) {
    return "（機械抽取：無明確數量／去背／影片／天數／人手訊號。唔好發明時數或張數。）";
  }
  return signals
    .map(
      (s, i) =>
        `${i + 1}. [${s.kind}] ${s.label}${s.value != null ? ` (value=${s.value})` : ""} — 原文：「${s.evidence}」`
    )
    .join("\n");
}
