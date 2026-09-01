/**
 * Email inquiry → draft quote readiness.
 * Prefer accurate understanding over auto-creating shaky drafts.
 */
import { quotePricingMode, type QuotePricingMode } from "./quotePricingMode";

export type QuantitySource = "explicit" | "assumed" | "unknown";

export type InquiryParseExtras = {
  eventName?: string | null;
  shootHours?: number | null;
  shotCount?: number | null;
  durationPackage?: string | null;
  crewPhotographers?: number | null;
  crewVideographers?: number | null;
  quantitySource?: QuantitySource | string | null;
  assumptions?: string[] | null;
  missingFields?: string[] | null;
  /** none = plain body OK; used = PDF text read; missing = referenced/unread attachment */
  attachmentStatus?: "none" | "used" | "missing" | string | null;
};

export type InquiryDraftReadiness = {
  readyForAutoDraft: boolean;
  pricingMode: QuotePricingMode;
  missingFields: string[];
  assumptions: string[];
  quantitySource: QuantitySource;
  blockers: string[];
  summary: string;
};

function asNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeQuantitySource(raw: unknown): QuantitySource {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "explicit") return "explicit";
  if (s === "assumed") return "assumed";
  return "unknown";
}

function normalizeDurationPackage(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (
    s === "hours" ||
    s === "half_day" ||
    s === "full_day" ||
    s === "multi_day"
  ) {
    return s;
  }
  return null;
}

/**
 * Decide whether an AI parse is solid enough for auto draft quote creation.
 * Admin can still manually approve / create drafts when not ready.
 */
export function evaluateInquiryDraftReadiness(parsed: {
  serviceType?: string | null;
  isInquiry?: boolean | null;
  confidence?: string | null;
  shootingDate?: string | null;
  suggestedItems?: Array<{ quantity?: number; unitPrice?: number }> | null;
  /**
   * When false, skip auto-draft even if the parse is clear.
   * Pass from pricing-learning trust (usable/trusted). Omit to skip this check (unit tests).
   */
  learningReady?: boolean | null;
} & InquiryParseExtras): InquiryDraftReadiness {
  const serviceType = (parsed.serviceType ?? "other").trim() || "other";
  const pricingMode = quotePricingMode(serviceType);
  const quantitySource = normalizeQuantitySource(parsed.quantitySource);
  const shootHours = asNum(parsed.shootHours);
  const shotCount = asNum(parsed.shotCount);
  const durationPackage = normalizeDurationPackage(parsed.durationPackage);
  const assumptions = Array.isArray(parsed.assumptions)
    ? parsed.assumptions.map((a) => String(a).trim()).filter(Boolean)
    : [];
  const missingFromAi = Array.isArray(parsed.missingFields)
    ? parsed.missingFields.map((a) => String(a).trim()).filter(Boolean)
    : [];

  const missingFields: string[] = [...missingFromAi];
  const blockers: string[] = [];

  if (parsed.isInquiry !== true) {
    blockers.push("唔係明確服務詢價");
  }
  if (parsed.confidence !== "high") {
    blockers.push("AI 信心未達 high");
  }
  if (serviceType === "other") {
    blockers.push("服務類型為「其他」，太雜唔宜自動草稿");
    if (!missingFields.includes("serviceType")) missingFields.push("serviceType");
  }
  if (parsed.learningReady === false) {
    blockers.push("定價學習未達「可參考」，暫不自動開草稿（避免規則價偏離人手成交）");
  }
  if (String(parsed.attachmentStatus ?? "").toLowerCase() === "missing") {
    blockers.push("正文／PDF 指明附件需求但未讀到附件文字，暫不自動開草稿");
    if (!missingFields.includes("attachmentText")) {
      missingFields.push("attachmentText");
    }
  }

  if (pricingMode === "time_crew") {
    const hasHours = shootHours != null;
    const hasPackage = durationPackage != null;
    if (!hasHours && !hasPackage) {
      blockers.push("缺拍攝時數或時長套餐");
      if (!missingFields.includes("shootHours")) missingFields.push("shootHours");
      if (!missingFields.includes("durationPackage"))
        missingFields.push("durationPackage");
    }
    if (quantitySource !== "explicit") {
      blockers.push("時數／套餐非客人明確提供（假設值）");
    }
  } else if (pricingMode === "shot_count") {
    if (shotCount == null) {
      blockers.push("缺交付張數");
      if (!missingFields.includes("shotCount")) missingFields.push("shotCount");
    }
    if (quantitySource !== "explicit") {
      blockers.push("張數非客人明確提供（假設值）");
    }
  }
  // design: allow auto-draft on high confidence without hours/shots

  const items = parsed.suggestedItems ?? [];
  const itemsTotal = items.reduce(
    (sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0),
    0
  );
  if (pricingMode !== "design" && itemsTotal <= 0) {
    blockers.push("建議項目總額為 0");
  }

  const readyForAutoDraft = blockers.length === 0;

  const summary = readyForAutoDraft
    ? "需求夠清晰，可自動建立草稿報價單（仍需人手確認先寄）。"
    : `暫不自動開草稿：${blockers.join("；")}。可人手批核補齊後再開。`;

  return {
    readyForAutoDraft,
    pricingMode,
    missingFields: Array.from(new Set(missingFields)),
    assumptions,
    quantitySource,
    blockers,
    summary,
  };
}

/** Build Traditional Chinese notes block for draft quote. */
export function formatInquiryDraftNotes(input: {
  fromEmail: string;
  subject: string;
  aiNotes?: string | null;
  readiness?: InquiryDraftReadiness | null;
  autoDraft: boolean;
}): string {
  const lines: string[] = [];
  if (input.aiNotes?.trim()) {
    lines.push(input.aiNotes.trim());
  }
  if (input.readiness?.assumptions?.length) {
    if (lines.length) lines.push("");
    lines.push("【假設（請核實）】");
    for (const a of input.readiness.assumptions) {
      lines.push(`· ${a}`);
    }
  }
  if (input.readiness?.missingFields?.length) {
    if (lines.length) lines.push("");
    lines.push(`【缺欄】${input.readiness.missingFields.join("、")}`);
  }
  return lines.join("\n");
}
