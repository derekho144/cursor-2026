import type { AdsActionItem, TrustedNegativePlan } from "@shared/adsActionQueue";
import { TRUSTED_AD_GROUP_MAPPINGS, TRUSTED_NEGATIVE_TERMS, TRUSTED_SEARCH_CAMPAIGN_ID } from "@shared/adsActionQueue";
import { ADS_GUARDRAILS, blockedExecutionResult, isTrustedNegativePlan, type AdsExecutionResult } from "@shared/adsActionExecution";
import { getDb } from "./db";
import { adSyncLogs } from "../drizzle/schema";
import { mutateGoogleAds, runGoogleAdsGaql } from "./googleAds";
import { executeSeoToAdsBundle } from "./seoAdsMutationExecutor";

function planForAction(item: AdsActionItem): TrustedNegativePlan | null {
  if (item.actionType !== "keyword_review") return null;
  const mapping = Object.values(TRUSTED_AD_GROUP_MAPPINGS).find((candidate) => candidate.path === item.targetPath);
  if (!mapping) return null;
  return {
    kind: "campaign_negative",
    mutationCount: TRUSTED_NEGATIVE_TERMS.length,
    preview: `campaign ${TRUSTED_SEARCH_CAMPAIGN_ID} phrase negatives: ${TRUSTED_NEGATIVE_TERMS.join(", ")}`,
    campaignId: TRUSTED_SEARCH_CAMPAIGN_ID,
    adGroupId: mapping.adGroupId,
    matchType: "PHRASE",
    negativeTerms: [...TRUSTED_NEGATIVE_TERMS],
  };
}

function operationsFor(plan: TrustedNegativePlan, terms: string[]) {
  return terms.map((text) => ({
    campaignCriterionOperation: {
      create: {
        campaign: `customers/4839352747/campaigns/${plan.campaignId}`,
        negative: true,
        keyword: { text, matchType: plan.matchType },
      },
    },
  }));
}

async function existingNegativeTerms(plan: TrustedNegativePlan): Promise<Set<string>> {
  const rows = await runGoogleAdsGaql(`
    SELECT campaign.id, campaign_criterion.keyword.text, campaign_criterion.keyword.match_type,
           campaign_criterion.negative, campaign_criterion.status
    FROM campaign_criterion
    WHERE campaign.id = ${plan.campaignId}
      AND campaign_criterion.negative = TRUE
      AND campaign_criterion.status != 'REMOVED'
  `);
  return new Set(rows
    .filter((row) => String(row.campaignCriterion?.keyword?.matchType ?? row.campaign_criterion?.keyword?.match_type ?? "") === "PHRASE")
    .map((row) => String(row.campaignCriterion?.keyword?.text ?? row.campaign_criterion?.keyword?.text ?? "").trim().toLowerCase())
    .filter(Boolean));
}

async function persist(result: AdsExecutionResult): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(adSyncLogs).values({
      platform: "google_ads",
      status: result.state === "executed" || result.state === "dry_run_passed" ? "success" : "error",
      message: JSON.stringify({ actionId: result.actionId, state: result.state, message: result.message, verification: result.verification, mutationCount: result.mutationCount, operations: result.operations, resources: result.resources }),
      recordsUpdated: result.mutationCount,
    });
  } catch (error) {
    console.warn("[Ads Action Queue] Could not persist execution log", error instanceof Error ? error.message : "unknown");
  }
}

export async function executeApprovedAdsAction(item: AdsActionItem, options: { dryRunOnly?: boolean; baselineFingerprint?: string } = {}): Promise<AdsExecutionResult> {
  if (item.actionType === "keyword_review" && !item.id.startsWith("trusted-negative:")) {
    const result = await executeSeoToAdsBundle(item, options);
    await persist(result);
    return result;
  }
  const plan = planForAction(item);
  if (!plan || !isTrustedNegativePlan(plan)) {
    const result = blockedExecutionResult(item.id, "只有產品、室內／地產、活動攝影的固定 campaign PHRASE-negative plan 可自動執行；此項目已 fail-closed。");
    await persist(result);
    return result;
  }

  try {
    const existing = await existingNegativeTerms(plan);
    const pendingTerms = plan.negativeTerms.filter((term) => !existing.has(term.toLowerCase()));
    const verificationBefore = `GAQL before: ${existing.size} existing PHRASE negatives; ${pendingTerms.length} new candidates.`;
    const dryRunPayload = {
      validateOnly: true,
      campaignId: plan.campaignId,
      adGroupId: plan.adGroupId,
      matchType: plan.matchType,
      negativeTerms: pendingTerms,
    } as const;

    // Google Ads rejects an empty repeated mutateOperations field. When GAQL
    // proves every trusted term already exists, this is a successful no-op.
    if (!pendingTerms.length) {
      const result: AdsExecutionResult = {
        actionId: item.id, state: options.dryRunOnly ? "dry_run_passed" : "executed",
        message: "GAQL 覆核確認 negatives 已存在，跳過空 mutation。",
        partialFailure: false, mutationCount: 0,
        verification: `${verificationBefore} GAQL after: no changes required.`,
        dryRun: dryRunPayload, guardrails: ADS_GUARDRAILS,
      };
      await persist(result);
      return result;
    }

    const operations = operationsFor(plan, pendingTerms);
    const dryRun = await mutateGoogleAds(operations, true);

    if (options.dryRunOnly) {
      const result: AdsExecutionResult = {
        actionId: item.id, state: "dry_run_passed",
        message: pendingTerms.length ? "dry-run 通過；未執行 live mutation。" : "dry-run 通過；所有 phrase negatives 已存在，無需 mutation。",
        partialFailure: dryRun.partialFailure, mutationCount: 0, verification: verificationBefore,
        dryRun: dryRunPayload, guardrails: ADS_GUARDRAILS,
      };
      await persist(result);
      return result;
    }

    const live = await mutateGoogleAds(operations, false);
    const after = await existingNegativeTerms(plan);
    const verified = pendingTerms.filter((term) => after.has(term.toLowerCase()));
    const result: AdsExecutionResult = {
      actionId: item.id, state: verified.length === pendingTerms.length ? "executed" : "failed",
      message: verified.length === pendingTerms.length ? "dry-run 通過，live campaign PHRASE negatives 已套用。" : "live mutation 完成但 GAQL 覆核未完全通過。",
      partialFailure: live.partialFailure, mutationCount: verified.length,
      verification: `${verificationBefore} GAQL after: ${verified.length}/${pendingTerms.length} verified.`, dryRun: dryRunPayload, guardrails: ADS_GUARDRAILS,
    };
    await persist(result);
    return result;
  } catch (error) {
    const result: AdsExecutionResult = {
      actionId: item.id, state: "failed", message: error instanceof Error ? error.message : "Google Ads execution failed",
      partialFailure: false, mutationCount: 0, guardrails: ADS_GUARDRAILS,
    };
    await persist(result);
    return result;
  }
}
