import type { AdsActionItem } from "@shared/adsActionQueue";
import { ADS_GUARDRAILS, type AdsExecutionResult } from "@shared/adsActionExecution";
import { adsPayloadBundleForAction } from "@shared/seoToAdsAgent";
import { buildSeoToAdsPlan, verifySeoToAdsPlan } from "./seoToAdsAgent";
import { executeSeoToAdsBundle } from "./seoAdsMutationExecutor";

/**
 * Single-command SEO-to-Ads flow. It never publishes website content.
 * The first run creates a baseline and stops; a later run, after the user
 * has published the approved content, verifies the changed landing page,
 * runs validateOnly, then performs live mutation and GAQL verification.
 */
export async function runSeoToAdsPipeline(
  item: AdsActionItem,
  options: { baselineFingerprint?: string } = {},
): Promise<AdsExecutionResult> {
  const bundle = adsPayloadBundleForAction(item);
  if (!bundle) {
    return {
      actionId: item.id,
      state: "blocked",
      message: "此 SEO-to-Ads 項目沒有可信 Ads payload；未修改 Ads，亦沒有自動 publish 網站。",
      partialFailure: false,
      mutationCount: 0,
      pipelineStage: "content_contract",
      guardrails: ADS_GUARDRAILS,
    };
  }

  const plan = await buildSeoToAdsPlan(item);
  const baselineFingerprint = options.baselineFingerprint ?? plan.baseline.contentFingerprint ?? undefined;
  if (!baselineFingerprint) {
    return {
      actionId: item.id,
      state: "blocked",
      message: "Content Contract 已建立，但未能取得 landing baseline；未修改 Ads。請修復頁面後重試。",
      partialFailure: false,
      mutationCount: 0,
      pipelineStage: "content_contract",
      verification: plan.baseline.reasons.join("；") || "baseline unavailable",
      guardrails: ADS_GUARDRAILS,
    };
  }

  // On the first command, the baseline is only recorded. This prevents a
  // pre-existing page from being treated as a newly approved content change.
  if (!options.baselineFingerprint) {
    return {
      actionId: item.id,
      state: "blocked",
      message: `Content Contract 已建立；baseline=${baselineFingerprint}。不會自動 publish，內容發布後再按同一個指令。`,
      partialFailure: false,
      mutationCount: 0,
      pipelineStage: "content_contract",
      baselineFingerprint,
      verification: `Landing baseline HTTP ${plan.baseline.httpStatus ?? "unknown"}; contentChanged=false by design.`,
      guardrails: ADS_GUARDRAILS,
    };
  }

  const verified = await verifySeoToAdsPlan(item, baselineFingerprint);
  if (!verified.adsReady) {
    return {
      actionId: item.id,
      state: "blocked",
      message: "Landing verification 未通過；已停止，未執行 dry-run 或 live mutation。",
      partialFailure: false,
      mutationCount: 0,
      pipelineStage: "landing_verification",
      baselineFingerprint,
      verification: verified.verification.reasons.join("；") || "landing page is not ready for Ads",
      operations: bundle.payloads.map((payload) => payload.kind),
      guardrails: ADS_GUARDRAILS,
    };
  }

  const result = await executeSeoToAdsBundle(item, { baselineFingerprint });
  return {
    ...result,
    pipelineStage: result.state === "executed" ? "gaql_verification" : result.state === "dry_run_passed" ? "dry_run" : "live_mutation",
    baselineFingerprint,
    message: result.state === "executed"
      ? `一鍵流程完成：Content Contract → Landing verification → Dry-run → Live mutation → GAQL 覆核。${result.message}`
      : result.message,
  };
}
