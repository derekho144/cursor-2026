/**
 * Platform / lead-source matching for pricing learning suggestions.
 *
 * Goal: raise win rate by aligning suggested price with what *actually closed*
 * on that platform (accepted quote history) — not invented discount priors.
 *
 * HelloToby / PRO360 often close lower than Google in the data; we surface that
 * only when we have enough accepted samples. If samples are thin we keep the
 * global mid unchanged (no ×0.9 / ×1.08 soft factor — those were unverified).
 */

export type LeadBudgetTier = "low" | "mid_high" | "neutral";

export type PlatformSuggestScope = "exact" | "tier" | "global";

/** Minimum accepted samples to prefer exact / tier history over global. */
export const PLATFORM_SUGGEST_MIN_SAMPLES = 5;

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

export function platformSuggestNote(input: {
  leadSource: string | null;
  tier: LeadBudgetTier;
  scope: PlatformSuggestScope;
  platformAcceptedCount: number;
}): string {
  const { leadSource, tier, scope, platformAcceptedCount } = input;
  if (!leadSource) {
    return "未選詢價來源：建議價用整體已接受成交；選好平台後會改用該來源歷史成交。";
  }
  if (scope === "exact") {
    return `已按「${leadSource}」已接受成交中位（${platformAcceptedCount} 筆）——唔係人工折扣。`;
  }
  if (scope === "tier") {
    const tierLabel =
      tier === "low"
        ? "低預算平台層（HelloToby／PRO360 合併）"
        : tier === "mid_high"
          ? "中上預算平台層（Google）"
          : "同類平台";
    return `「${leadSource}」單平台樣本不足，改用${tierLabel}已接受成交（${platformAcceptedCount} 筆）。`;
  }
  return `「${leadSource}」同層已接受樣本仍少（${platformAcceptedCount} 筆），暫時用整體成交中位；唔會用無證據嘅 ×0.9／×1.08 微調。累積夠 ${PLATFORM_SUGGEST_MIN_SAMPLES} 筆先跟平台價。`;
}

/**
 * Pick which accepted rows drive the mid / packages, given a lead source.
 * Soft invented multipliers are intentionally not applied.
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
        }),
      };
    }
  }

  return {
    rows: matched,
    scope: "global",
    tier,
    leadSource,
    platformAcceptedCount: exact.length,
    softFactor: 1,
    note: platformSuggestNote({
      leadSource,
      tier,
      scope: "global",
      platformAcceptedCount: exact.length,
    }),
  };
}
