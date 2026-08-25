/**
 * Pricing learning only uses quotes created on/after this instant.
 * Override with env PRICING_LEARNING_START_AT (ISO 8601).
 */
const DEFAULT_START_AT = "2026-08-25T00:00:00+08:00";

/**
 * When to trust / show suggested prices from learning.
 *
 * Policy (accepted quotes in the matched learning slice):
 * - < 8          → hide suggestion (none)
 * - 8–14         → show as 「僅供參考」(advisory)
 * - 15–24 + ≥50% structured → 「可參考」(usable)
 * - ≥25 + ≥70% structured → 「較可信」(trusted)
 *
 * Below usable, never auto-fill quote totals from suggestion.
 */
export const SUGGEST_TRUST = {
  /** Below this: do not show mid / packages at all */
  MIN_SHOW_ACCEPTED: 8,
  /** 8–14: advisory only */
  MIN_USABLE_ACCEPTED: 15,
  /** ≥25 with high structured ratio: trusted */
  MIN_TRUSTED_ACCEPTED: 25,
  /** Structured field coverage for usable tier */
  MIN_USABLE_STRUCTURED_RATIO: 0.5,
  /** Structured field coverage for trusted tier */
  MIN_TRUSTED_STRUCTURED_RATIO: 0.7,
} as const;

export type SuggestConfidence =
  | "none"
  | "advisory"
  | "usable"
  | "trusted";

export function evaluateSuggestConfidence(input: {
  acceptedCount: number;
  structuredCount: number;
}): {
  confidence: SuggestConfidence;
  showSuggestion: boolean;
  label: string;
  shortLabel: string;
  note: string;
  progress: {
    accepted: number;
    needForShow: number;
    needForUsable: number;
    needForTrusted: number;
    structuredRatio: number;
  };
} {
  const accepted = Math.max(0, Math.floor(input.acceptedCount));
  const structured = Math.max(0, Math.floor(input.structuredCount));
  const structuredRatio =
    accepted === 0 ? 0 : Math.min(1, structured / accepted);

  const progress = {
    accepted,
    needForShow: SUGGEST_TRUST.MIN_SHOW_ACCEPTED,
    needForUsable: SUGGEST_TRUST.MIN_USABLE_ACCEPTED,
    needForTrusted: SUGGEST_TRUST.MIN_TRUSTED_ACCEPTED,
    structuredRatio: Math.round(structuredRatio * 1000) / 10,
  };

  if (accepted < SUGGEST_TRUST.MIN_SHOW_ACCEPTED) {
    return {
      confidence: "none",
      showSuggestion: false,
      label: "樣本不足 · 暫不顯示建議價",
      shortLabel: "未達門檻",
      note: `同類已接受 ${accepted} / ${SUGGEST_TRUST.MIN_SHOW_ACCEPTED} 筆先顯示建議。請先用市場價開單，並填齊結構化欄位。`,
      progress,
    };
  }

  if (
    accepted >= SUGGEST_TRUST.MIN_TRUSTED_ACCEPTED &&
    structuredRatio >= SUGGEST_TRUST.MIN_TRUSTED_STRUCTURED_RATIO
  ) {
    return {
      confidence: "trusted",
      showSuggestion: true,
      label: "較可信 · 可作開價參考",
      shortLabel: "較可信",
      note: `基於 ${accepted} 筆成交（結構化 ${progress.structuredRatio}%）。仍請對照成本底線，唔好盲跟中位。`,
      progress,
    };
  }

  if (
    accepted >= SUGGEST_TRUST.MIN_USABLE_ACCEPTED &&
    structuredRatio >= SUGGEST_TRUST.MIN_USABLE_STRUCTURED_RATIO
  ) {
    return {
      confidence: "usable",
      showSuggestion: true,
      label: "可參考 · 未達較可信門檻",
      shortLabel: "可參考",
      note: `已接受 ${accepted} 筆（結構化 ${progress.structuredRatio}%）。達 ${SUGGEST_TRUST.MIN_TRUSTED_ACCEPTED} 筆且結構化 ≥70% 先當較可信。`,
      progress,
    };
  }

  // 8–14, or 15+ but structured ratio too low
  return {
    confidence: "advisory",
    showSuggestion: true,
    label: "僅供參考 · 樣本／結構化仍偏少",
    shortLabel: "僅供參考",
    note:
      accepted < SUGGEST_TRUST.MIN_USABLE_ACCEPTED
        ? `已接受 ${accepted} 筆（需 ${SUGGEST_TRUST.MIN_USABLE_ACCEPTED} 先當「可參考」）。數字波動大，唔好直接當開價。`
        : `已接受 ${accepted} 筆，但結構化覆蓋只有 ${progress.structuredRatio}%（需 ≥50%）。請為新單填齊時數／人手／張數。`,
    progress,
  };
}

export function getPricingLearningStartAt(): Date {
  const raw =
    (typeof process !== "undefined" && process.env?.PRICING_LEARNING_START_AT) ||
    DEFAULT_START_AT;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    return new Date(DEFAULT_START_AT);
  }
  return d;
}

export function pricingLearningStartAtIso(): string {
  return getPricingLearningStartAt().toISOString();
}

/** Human-readable label for admin UI (Hong Kong time). */
export function formatPricingLearningStartAtLabel(): string {
  return getPricingLearningStartAt().toLocaleString("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function isQuoteEligibleForPricingLearning(
  createdAt: Date | string | null | undefined
): boolean {
  if (createdAt == null) return false;
  const t =
    createdAt instanceof Date
      ? createdAt.getTime()
      : new Date(createdAt).getTime();
  if (Number.isNaN(t)) return false;
  return t >= getPricingLearningStartAt().getTime();
}
