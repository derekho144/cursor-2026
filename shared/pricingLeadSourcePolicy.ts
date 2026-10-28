/**
 * Platform / lead-source budget priors for pricing learning suggestions.
 *
 * Marketplace RFQs (HelloToby, PRO360) skew low-budget.
 * Google Ads leads skew mid–upper. When the quote form picks a lead source,
 * suggested packages should prefer same-platform (or same-tier) history, or
 * softly adjust the global mid when samples are thin.
 */

export type LeadBudgetTier = "low" | "mid_high" | "neutral";

export type PlatformSuggestScope =
  | "exact"
  | "tier"
  | "global"
  | "global_adjusted";

/** Minimum accepted samples to prefer exact / tier history over a soft prior. */
export const PLATFORM_SUGGEST_MIN_SAMPLES = 5;

/** Soft multipliers when falling back to global history (clamped elsewhere). */
export const LEAD_TIER_SOFT_FACTOR: Record<LeadBudgetTier, number> = {
  low: 0.9,
  mid_high: 1.08,
  neutral: 1,
};

const LOW_BUDGET_SOURCES = new Set(["HelloToby", "PRO360"]);
const MID_HIGH_SOURCES = new Set(["Google"]);

export function leadBudgetTier(
  leadSource: string | null | undefined
): LeadBudgetTier {
  const s = (leadSource ?? "").trim();
  if (!s) return "neutral";
  if (LOW_BUDGET_SOURCES.has(s)) return "low";
  if (MID_HIGH_SOURCES.has(s)) return "mid_high";
  return "neutral";
}

export function normalizeLeadSourceKey(
  leadSource: string | null | undefined
): string | null {
  const s = (leadSource ?? "").trim();
  return s || null;
}

export function sameLeadBudgetTier(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const ta = leadBudgetTier(a);
  const tb = leadBudgetTier(b);
  if (ta === "neutral" || tb === "neutral") return false;
  return ta === tb;
}

export function softFactorForTier(tier: LeadBudgetTier): number {
  return LEAD_TIER_SOFT_FACTOR[tier] ?? 1;
}

export function applySoftFactorToAmount(
  amount: number | null | undefined,
  factor: number
): number | null {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null;
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) {
    return Math.round(amount);
  }
  return Math.round(amount * factor);
}

export function platformSuggestNote(input: {
  leadSource: string | null;
  tier: LeadBudgetTier;
  scope: PlatformSuggestScope;
  platformAcceptedCount: number;
  softFactor: number;
}): string {
  const { leadSource, tier, scope, platformAcceptedCount, softFactor } = input;
  if (!leadSource) {
    return "未選詢價來源：建議價用整體成交；選好平台後會按來源再調。";
  }
  if (scope === "exact") {
    return `已按「${leadSource}」歷史成交（${platformAcceptedCount} 筆）調整建議價。`;
  }
  if (scope === "tier") {
    const tierLabel =
      tier === "low"
        ? "低預算平台（HelloToby／PRO360）"
        : tier === "mid_high"
          ? "中上預算平台（Google）"
          : "同類平台";
    return `「${leadSource}」樣本不足，改用${tierLabel}成交（${platformAcceptedCount} 筆）。`;
  }
  if (scope === "global_adjusted") {
    const bias =
      softFactor < 1
        ? `偏低預算客（×${softFactor}）`
        : softFactor > 1
          ? `中上預算客（×${softFactor}）`
          : "中性";
    return `「${leadSource}」同層樣本仍少，用整體成交再按平台預算取向微調（${bias}）。`;
  }
  return `「${leadSource}」暫未有足夠平台樣本，建議價用整體成交（未做平台微調）。`;
}

/**
 * Pick which accepted rows drive the mid / packages, given a lead source.
 * Returns softFactor ≠ 1 only for global_adjusted.
 */
export function resolvePlatformSuggestRows<
  T extends { leadSource: string | null },
>(input: {
  matchedAccepted: T[];
  leadSource: string | null | undefined;
  minSamples?: number;
}): {
  rows: T[];
  scope: PlatformSuggestScope;
  tier: LeadBudgetTier;
  leadSource: string | null;
  platformAcceptedCount: number;
  softFactor: number;
  note: string;
} {
  const min = input.minSamples ?? PLATFORM_SUGGEST_MIN_SAMPLES;
  const leadSource = normalizeLeadSourceKey(input.leadSource);
  const tier = leadBudgetTier(leadSource);
  const matched = input.matchedAccepted;

  if (!leadSource) {
    return {
      rows: matched,
      scope: "global",
      tier: "neutral",
      leadSource: null,
      platformAcceptedCount: 0,
      softFactor: 1,
      note: platformSuggestNote({
        leadSource: null,
        tier: "neutral",
        scope: "global",
        platformAcceptedCount: 0,
        softFactor: 1,
      }),
    };
  }

  const exact = matched.filter((r) => r.leadSource === leadSource);
  if (exact.length >= min) {
    return {
      rows: exact,
      scope: "exact",
      tier,
      leadSource,
      platformAcceptedCount: exact.length,
      softFactor: 1,
      note: platformSuggestNote({
        leadSource,
        tier,
        scope: "exact",
        platformAcceptedCount: exact.length,
        softFactor: 1,
      }),
    };
  }

  if (tier !== "neutral") {
    const tierRows = matched.filter((r) =>
      sameLeadBudgetTier(r.leadSource, leadSource)
    );
    if (tierRows.length >= min) {
      return {
        rows: tierRows,
        scope: "tier",
        tier,
        leadSource,
        platformAcceptedCount: tierRows.length,
        softFactor: 1,
        note: platformSuggestNote({
          leadSource,
          tier,
          scope: "tier",
          platformAcceptedCount: tierRows.length,
          softFactor: 1,
        }),
      };
    }
  }

  const softFactor = softFactorForTier(tier);
  const scope: PlatformSuggestScope =
    softFactor !== 1 ? "global_adjusted" : "global";
  return {
    rows: matched,
    scope,
    tier,
    leadSource,
    platformAcceptedCount: exact.length,
    softFactor,
    note: platformSuggestNote({
      leadSource,
      tier,
      scope,
      platformAcceptedCount: exact.length,
      softFactor,
    }),
  };
}
