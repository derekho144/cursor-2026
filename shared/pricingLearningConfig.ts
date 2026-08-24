/**
 * Pricing learning only uses quotes created on/after this instant.
 * Override with env PRICING_LEARNING_START_AT (ISO 8601).
 */
const DEFAULT_START_AT = "2026-08-25T00:00:00+08:00";

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
