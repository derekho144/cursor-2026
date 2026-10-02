import type { AdsActionItem, TrustedNegativePlan } from "./adsActionQueue";

export const ADS_GUARDRAILS = {
  dailyBudgetHKD: 100,
  monthlyBudgetHKD: 2700,
  targetCpaHKD: 20,
  monthlyLeadTarget: 25,
  autoExecuteApprovedActions: true,
} as const;

export type AdsExecutionState = "pending" | "dry_run_passed" | "executed" | "blocked" | "failed";
export type SeoToAdsPipelineStage = "content_contract" | "landing_verification" | "dry_run" | "live_mutation" | "gaql_verification";
export type AdsExecutionLog = {
  actionId: string;
  state: AdsExecutionState;
  message: string;
  partialFailure: boolean;
  mutationCount: number;
  operations?: Array<"rsa_create" | "final_url_update" | "keyword_phrase_verify" | "sitelink_create" | "campaign_negative">;
  resources?: string[];
  verification?: string;
  dryRun?: {
    validateOnly: boolean;
    campaignId: string;
    adGroupId: string;
    matchType: "PHRASE";
    negativeTerms: string[];
  };
  pipelineStage?: SeoToAdsPipelineStage;
  baselineFingerprint?: string;
  createdAt?: string;
};

export type AdsExecutionResult = AdsExecutionLog & { guardrails: typeof ADS_GUARDRAILS };

export function canAutoExecuteAdsAction(item: AdsActionItem): boolean {
  return item.actionType === "keyword_review" && Boolean(item.executionPlan?.kind === "campaign_negative");
}

export function isTrustedNegativePlan(value: unknown): value is TrustedNegativePlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Partial<TrustedNegativePlan>;
  return plan.kind === "campaign_negative" && plan.campaignId === "24002224927"
    && ["203224222492", "203224222452", "203224222532"].includes(String(plan.adGroupId))
    && plan.matchType === "PHRASE"
    && Array.isArray(plan.negativeTerms)
    && plan.negativeTerms.length > 0
    && plan.negativeTerms.every((term) => ["免費", "教學", "課程", "招聘", "DIY"].includes(term));
}

export function blockedExecutionResult(actionId: string, message = "此項目沒有可信的 server-side mutation plan，已 fail-closed，未修改 Ads。"): AdsExecutionResult {
  return { actionId, state: "blocked", message, partialFailure: false, mutationCount: 0, guardrails: ADS_GUARDRAILS };
}
