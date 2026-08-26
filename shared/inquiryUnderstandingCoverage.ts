/**
 * Compare machine-extracted requirement signals against AI understanding / quote lines.
 *
 * A gap here is a reading-comprehension miss, not a missing rate card.
 * Example: HKSEA RFQ had 200 artwork + 去背; AI quoted 4h event only.
 */
import {
  isMultiScopeSignals,
  type RequirementSignal,
} from "./inquiryRequirementSignals";

export type CoverageWorkPackage = {
  kind?: string | null;
  summary?: string | null;
  quantity?: number | null;
  unit?: string | null;
  quantitySource?: string | null;
};

export type CoverageLineItem = {
  description?: string | null;
  quantity?: number | null;
};

export type ComprehensionCoverage = {
  gaps: string[];
  covered: RequirementSignal[];
  missed: RequirementSignal[];
  multiScope: boolean;
  collapsedToEventHours: boolean;
};

function qtyClose(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return false;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return hi / lo <= 1.25 || Math.abs(a - b) <= 2;
}

function blobOf(input: {
  workPackages?: CoverageWorkPackage[] | null;
  suggestedItems?: CoverageLineItem[] | null;
  notes?: string | null;
  shotCount?: number | null;
  shootHours?: number | null;
}): string {
  const pkgs = (input.workPackages ?? [])
    .map((p) => `${p.kind ?? ""} ${p.summary ?? ""} ${p.quantity ?? ""} ${p.unit ?? ""}`)
    .join(" | ");
  const items = (input.suggestedItems ?? [])
    .map((it) => `${it.description ?? ""} x${it.quantity ?? ""}`)
    .join(" | ");
  return `${pkgs} ${items} ${input.notes ?? ""} 張${input.shotCount ?? ""} 時${input.shootHours ?? ""}`.toLowerCase();
}

function coversShotCount(
  signal: RequirementSignal,
  input: Parameters<typeof blobOf>[0]
): boolean {
  const v = signal.value;
  if (v == null) return false;
  if (qtyClose(Number(input.shotCount), v)) return true;
  for (const p of input.workPackages ?? []) {
    if (qtyClose(Number(p.quantity), v) && /shot|piece|cutout|image|張|件/i.test(String(p.unit ?? p.kind ?? ""))) {
      return true;
    }
  }
  for (const it of input.suggestedItems ?? []) {
    if (!qtyClose(Number(it.quantity), v)) continue;
    if (/photo|artwork|product|image|piece|shot|sku|張|件|作品/i.test(String(it.description ?? ""))) {
      return true;
    }
  }
  const blob = blobOf(input);
  return blob.includes(String(v)) && /件|張|artwork|product|photo|shot/.test(blob);
}

function coversCutout(input: Parameters<typeof blobOf>[0]): boolean {
  const blob = blobOf(input);
  if (/去背|cut[\s-]?out|background\s*remov/.test(blob)) return true;
  return (input.workPackages ?? []).some(
    (p) => String(p.kind ?? "") === "background_removal"
  );
}

function coversDays(
  signal: RequirementSignal,
  input: Parameters<typeof blobOf>[0]
): boolean {
  const v = signal.value;
  if (v == null) return false;
  const hours = Number(input.shootHours);
  // Classic miss: "3 days" parsed as "3 hours"
  if (hours === v) return false;
  for (const p of input.workPackages ?? []) {
    if (String(p.unit ?? "") === "days" && qtyClose(Number(p.quantity), v)) return true;
  }
  const blob = blobOf(input);
  return /multi_day|多日|天拍攝/.test(blob) && blob.includes(String(v));
}

function coversHours(
  signal: RequirementSignal,
  input: Parameters<typeof blobOf>[0]
): boolean {
  const v = signal.value;
  if (v == null) return false;
  if (qtyClose(Number(input.shootHours), v)) return true;
  for (const p of input.workPackages ?? []) {
    if (String(p.unit ?? "") === "hours" && qtyClose(Number(p.quantity), v)) return true;
  }
  for (const it of input.suggestedItems ?? []) {
    if (
      qtyClose(Number(it.quantity), v) &&
      /hour|event|活動|小時/i.test(String(it.description ?? ""))
    ) {
      return true;
    }
  }
  return false;
}

function isCollapsedToEventHours(
  signals: RequirementSignal[],
  input: Parameters<typeof blobOf>[0]
): boolean {
  const hasShot = signals.some((s) => s.kind === "shot_count" && (s.value ?? 0) >= 20);
  const hasCutout = signals.some((s) => s.kind === "background_removal");
  if (!hasShot && !hasCutout) return false;

  const items = input.suggestedItems ?? [];
  const hasLargeShotLine = items.some((it) => Number(it.quantity) >= 20);
  const hasCutoutLine = items.some((it) =>
    /去背|cut[\s-]?out|background/i.test(String(it.description ?? ""))
  );
  const pkgHasStill = (input.workPackages ?? []).some((p) =>
    /artwork|product|background|shot/i.test(`${p.kind ?? ""} ${p.unit ?? ""}`)
  );

  if (hasShot && !hasLargeShotLine && !pkgHasStill && !qtyClose(Number(input.shotCount), signals.find((s) => s.kind === "shot_count")?.value ?? -1)) {
    return true;
  }
  if (hasCutout && !hasCutoutLine && !coversCutout(input)) return true;
  if (items.length > 0 && hasShot && !hasLargeShotLine) return true;
  if (items.length > 0 && hasCutout && !hasCutoutLine) return true;
  return false;
}

export function findComprehensionGaps(input: {
  signals: RequirementSignal[];
  workPackages?: CoverageWorkPackage[] | null;
  suggestedItems?: CoverageLineItem[] | null;
  notes?: string | null;
  shotCount?: number | null;
  shootHours?: number | null;
}): ComprehensionCoverage {
  const covered: RequirementSignal[] = [];
  const missed: RequirementSignal[] = [];
  const gaps: string[] = [];
  const multiScope = isMultiScopeSignals(input.signals);

  for (const signal of input.signals) {
    let ok = false;
    if (signal.kind === "shot_count") ok = coversShotCount(signal, input);
    else if (signal.kind === "background_removal") ok = coversCutout(input);
    else if (signal.kind === "event_days") ok = coversDays(signal, input);
    else if (signal.kind === "event_hours") ok = coversHours(signal, input);

    if (ok) covered.push(signal);
    else {
      missed.push(signal);
      if (signal.kind === "event_days" && Number(input.shootHours) === signal.value) {
        gaps.push(
          `原文係 ${signal.value} 天拍攝，解析當成 ${input.shootHours} 小時（${signal.evidence}）`
        );
      } else {
        gaps.push(`原文有「${signal.label}」，解析未覆蓋（${signal.evidence}）`);
      }
    }
  }

  const collapsedToEventHours = isCollapsedToEventHours(input.signals, input);
  if (collapsedToEventHours) {
    const msg = "多範圍 RFQ 被塌成單一活動時數（作品／去背／張數消失）";
    if (!gaps.includes(msg)) gaps.push(msg);
  }

  return { gaps, covered, missed, multiScope, collapsedToEventHours };
}

export function applyComprehensionToParsed<
  T extends {
    confidence?: string | null;
    missingFields?: string[] | null;
    assumptions?: string[] | null;
    notes?: string | null;
    shotCount?: number | null;
    shootHours?: number | null;
    suggestedItems?: CoverageLineItem[] | null;
    workPackages?: CoverageWorkPackage[] | null;
  },
>(
  parsed: T,
  coverage: ComprehensionCoverage,
  signals: RequirementSignal[]
): T & {
  requirementSignals: RequirementSignal[];
  comprehensionGaps: string[];
  multiScope: boolean;
  confidence: string;
  missingFields: string[];
  assumptions: string[];
} {
  const missingFields = Array.isArray(parsed.missingFields)
    ? [...parsed.missingFields.map(String)]
    : [];
  const assumptions = Array.isArray(parsed.assumptions)
    ? [...parsed.assumptions.map(String)]
    : [];
  let confidence = String(parsed.confidence ?? "low");
  let notes = parsed.notes ?? "";

  if (coverage.gaps.length > 0) {
    if (!missingFields.includes("workPackages")) missingFields.push("workPackages");
    for (const g of coverage.gaps) {
      if (!assumptions.includes(g)) assumptions.push(g);
    }
    if (coverage.gaps.length >= 2 || coverage.collapsedToEventHours) {
      confidence = "low";
    } else if (confidence === "high") {
      confidence = "medium";
    }
    const tag = `【閱讀理解缺口】${coverage.gaps.join("；")}`;
    notes = notes?.trim() ? `${notes.trim()}（${tag}）` : tag;
  }

  return {
    ...parsed,
    confidence,
    missingFields,
    assumptions,
    notes,
    requirementSignals: signals,
    comprehensionGaps: coverage.gaps,
    multiScope: coverage.multiScope,
  };
}

/**
 * Hard stop before sending a quote email.
 * Old records (no workPackages) that pointed at an attachment must be re-read first —
 * that is how HKSEA pending_send 4h drafts get blocked after deploy.
 */
export function quoteSendBlocker(parsed: {
  comprehensionGaps?: string[] | null;
  workPackages?: CoverageWorkPackage[] | null;
  attachmentStatus?: string | null;
} | null | undefined): string | null {
  if (!parsed) return "未有 AI 解析結果，唔可以寄報價";
  const gaps = Array.isArray(parsed.comprehensionGaps)
    ? parsed.comprehensionGaps.map((g) => String(g).trim()).filter(Boolean)
    : [];
  if (gaps.length > 0) {
    return `閱讀理解缺口未解決，唔可以寄報價：${gaps.join("；")}`;
  }
  const hasPackages = Array.isArray(parsed.workPackages) && parsed.workPackages.length > 0;
  const att = String(parsed.attachmentStatus ?? "");
  if (!hasPackages && (att === "used" || att === "missing")) {
    return "此單未用工作包流程重讀（附件 RFQ）。請先按「重讀需求」，確認範圍齊再寄。";
  }
  return null;
}
