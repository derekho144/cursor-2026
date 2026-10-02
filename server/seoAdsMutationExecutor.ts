import type { AdsActionItem } from "@shared/adsActionQueue";
import type { AdsExecutionResult } from "@shared/adsActionExecution";
import { ADS_GUARDRAILS } from "@shared/adsActionExecution";
import { adsPayloadBundleForAction, type FinalUrlPayload, type KeywordPhrasePayload, type RsaAssetPayload, type SitelinkPayload, type SeoToAdsPayloadBundle } from "@shared/seoToAdsAgent";
import { mutateGoogleAds, mutateGoogleAdsService, runGoogleAdsGaql } from "./googleAds";
import { verifyLandingPage } from "./seoToAdsAgent";

const CUSTOMER_ID = "4839352747";
const SEARCH_CAMPAIGN_ID = "24002224927";

type MutationKind = "rsa_create" | "final_url_update" | "keyword_phrase_verify" | "sitelink_create" | "campaign_negative";

type MutationRun = { partialFailure: boolean; resources: string[]; verification?: string };

function assertSafeOperations(operations: unknown[]): void {
  const serialized = JSON.stringify(operations);
  if (/campaignBudget|targetCpa|targetCpaMicros|campaign\.status|campaignStatus/i.test(serialized)) {
    throw new Error("安全護欄拒絕含有 budget、tCPA 或 campaign status mutation 的 payload。");
  }
}

function responseResources(results: any[]): string[] {
  return results.flatMap((result) => {
    const candidates = [result?.resourceName, result?.adResult?.resourceName, result?.assetResult?.resourceName, result?.campaignAssetResult?.resourceName];
    return candidates.filter((value): value is string => typeof value === "string" && value.length > 0);
  });
}

function payloadOf(bundle: SeoToAdsPayloadBundle, kind: MutationKind) {
  return bundle.payloads.find((payload) => payload.kind === kind) as (RsaAssetPayload | FinalUrlPayload | SitelinkPayload | undefined);
}

async function findEnabledRsa(adGroupId: string): Promise<{ adGroupAdResource: string; adResource: string } | null> {
  const rows = await runGoogleAdsGaql(`
    SELECT ad_group_ad.resource_name, ad_group_ad.ad.resource_name
    FROM ad_group_ad
    WHERE ad_group.id = ${adGroupId}
      AND ad_group_ad.status = 'ENABLED'
      AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
    ORDER BY ad_group_ad.ad.id ASC
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  const adGroupAdResource = String(row.adGroupAd?.resourceName ?? row.ad_group_ad?.resource_name ?? "");
  const adResource = String(row.adGroupAd?.ad?.resourceName ?? row.ad_group_ad?.ad?.resource_name ?? "");
  return adGroupAdResource && adResource ? { adGroupAdResource, adResource } : null;
}

function adTextAssets(payload: RsaAssetPayload) {
  return payload.headlines.map((headline) => ({ text: headline.text, ...(headline.pinnedField ? { pinnedField: headline.pinnedField } : {}) }));
}

async function mutateRsa(payload: RsaAssetPayload, validateOnly: boolean): Promise<MutationRun> {
  const existing = await findEnabledRsa(payload.adGroupId);
  if (existing) {
    const operation = {
      update: {
        resourceName: existing.adResource,
        finalUrls: [payload.finalUrl],
        responsiveSearchAd: {
          headlines: adTextAssets(payload),
          descriptions: payload.descriptions.map((text) => ({ text })),
        },
      },
      updateMask: "finalUrls,responsiveSearchAd.headlines,responsiveSearchAd.descriptions",
    };
    assertSafeOperations([operation]);
    const response = await mutateGoogleAdsService("ads", [operation], validateOnly);
    return { partialFailure: response.partialFailure, resources: [existing.adResource, ...responseResources(response.results)] };
  }

  const operation = {
    create: {
      adGroup: `customers/${CUSTOMER_ID}/adGroups/${payload.adGroupId}`,
      status: "ENABLED",
      ad: {
        finalUrls: [payload.finalUrl],
        responsiveSearchAd: {
          headlines: adTextAssets(payload),
          descriptions: payload.descriptions.map((text) => ({ text })),
          path1: payload.path1,
          path2: payload.path2,
        },
      },
    },
  };
  assertSafeOperations([operation]);
  const response = await mutateGoogleAdsService("adGroupAds", [operation], validateOnly);
  return { partialFailure: response.partialFailure, resources: responseResources(response.results) };
}

async function mutateFinalUrl(payload: FinalUrlPayload, validateOnly: boolean): Promise<MutationRun> {
  const existing = await findEnabledRsa(payload.adGroupId);
  if (!existing) return { partialFailure: false, resources: [] };
  const operation = {
    update: { resourceName: existing.adResource, finalUrls: [payload.finalUrl] },
    updateMask: "finalUrls",
  };
  assertSafeOperations([operation]);
  const response = await mutateGoogleAdsService("ads", [operation], validateOnly);
  return { partialFailure: response.partialFailure, resources: [existing.adResource, ...responseResources(response.results)] };
}

async function verifyPhraseKeywords(payload: KeywordPhrasePayload): Promise<MutationRun> {
  const rows = await runGoogleAdsGaql(`
    SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
           ad_group_criterion.status
    FROM ad_group_criterion
    WHERE ad_group.id = ${payload.adGroupId}
      AND ad_group_criterion.type = 'KEYWORD'
      AND ad_group_criterion.status = 'ENABLED'
  `);
  const enabledPhraseKeywords = new Set(rows
    .filter((row) => String(row.adGroupCriterion?.keyword?.matchType ?? row.ad_group_criterion?.keyword?.match_type ?? "") === "PHRASE")
    .map((row) => String(row.adGroupCriterion?.keyword?.text ?? row.ad_group_criterion?.keyword?.text ?? "").trim().toLowerCase())
    .filter(Boolean));
  const missing = payload.keywords.filter((keyword) => !enabledPhraseKeywords.has(keyword.toLowerCase()));
  if (missing.length) throw new Error(`指定 Phrase keyword 未全部 ENABLED：${missing.join("、")}`);
  return { partialFailure: false, resources: [], verification: `GAQL verified ${payload.keywords.length} ENABLED PHRASE keywords.` };
}

async function mutateSitelink(payload: SitelinkPayload, validateOnly: boolean): Promise<MutationRun> {
  const assetOperation = {
    create: {
      finalUrls: [payload.finalUrl],
      sitelinkAsset: { linkText: payload.linkText, description1: payload.description1, description2: payload.description2 },
    },
  };
  assertSafeOperations([assetOperation]);
  const assetResponse = await mutateGoogleAdsService("assets", [assetOperation], validateOnly);
  const assetResource = responseResources(assetResponse.results)[0];
  if (validateOnly || !assetResource) return { partialFailure: assetResponse.partialFailure, resources: assetResource ? [assetResource] : [] };

  const campaignAssetOperation = {
    create: {
      asset: assetResource,
      campaign: `customers/${CUSTOMER_ID}/campaigns/${payload.campaignId}`,
      fieldType: "SITELINK",
    },
  };
  assertSafeOperations([campaignAssetOperation]);
  const campaignAssetResponse = await mutateGoogleAdsService("campaignAssets", [campaignAssetOperation], false);
  return {
    partialFailure: assetResponse.partialFailure || campaignAssetResponse.partialFailure,
    resources: [assetResource, ...responseResources(campaignAssetResponse.results)],
  };
}

async function mutateNegative(bundle: SeoToAdsPayloadBundle, validateOnly: boolean): Promise<MutationRun> {
  const payload = payloadOf(bundle, "campaign_negative") as any;
  if (!payload) return { partialFailure: false, resources: [] };
  const rows = await runGoogleAdsGaql(`
    SELECT campaign_criterion.resource_name, campaign_criterion.keyword.text, campaign_criterion.keyword.match_type
    FROM campaign_criterion
    WHERE campaign.id = ${payload.campaignId}
      AND campaign_criterion.negative = TRUE
      AND campaign_criterion.status != 'REMOVED'
  `);
  const existing = new Set(rows.map((row) => String(row.campaignCriterion?.keyword?.text ?? row.campaign_criterion?.keyword?.text ?? "").trim().toLowerCase()).filter(Boolean));
  const pending = payload.negativeTerms.filter((term: string) => !existing.has(term.toLowerCase()));
  if (!pending.length) return { partialFailure: false, resources: [] };
  const operations = pending.map((text: string) => ({ campaignCriterionOperation: { create: { campaign: `customers/${CUSTOMER_ID}/campaigns/${payload.campaignId}`, negative: true, keyword: { text, matchType: payload.matchType } } } }));
  assertSafeOperations(operations);
  const response = await mutateGoogleAds(operations, validateOnly);
  return { partialFailure: response.partialFailure, resources: responseResources(response.results) };
}

export async function executeSeoToAdsBundle(
  item: AdsActionItem,
  options: { dryRunOnly?: boolean; baselineFingerprint?: string } = {},
): Promise<AdsExecutionResult> {
  const bundle = adsPayloadBundleForAction(item);
  if (!bundle) {
    return { actionId: item.id, state: "blocked", message: "此項目沒有可信的 RSA／Final URL／Sitelink payload，未修改 Ads。", partialFailure: false, mutationCount: 0, guardrails: ADS_GUARDRAILS };
  }

  if (!options.baselineFingerprint) {
    return { actionId: item.id, state: "blocked", message: "必須先完成內容發布後的 landing verification；未提供 baseline，未修改 Ads。", partialFailure: false, mutationCount: 0, operations: bundle.payloads.map((payload) => payload.kind), guardrails: ADS_GUARDRAILS };
  }

  const verification = await verifyLandingPage(bundle.finalUrl, options.baselineFingerprint);
  if (!verification.readyForAds || !verification.contentChanged || verification.railwayDetected) {
    return { actionId: item.id, state: "blocked", message: "Landing verification 未通過，未修改 Ads。", partialFailure: false, mutationCount: 0, operations: bundle.payloads.map((payload) => payload.kind), verification: verification.reasons.join("；") || "landing 未達到 Ads readiness", guardrails: ADS_GUARDRAILS };
  }

  const operations = bundle.payloads.map((payload) => payload.kind);
  const results: MutationRun[] = [];
  try {
    const rsa = payloadOf(bundle, "rsa_create") as RsaAssetPayload;
    const finalUrl = payloadOf(bundle, "final_url_update") as FinalUrlPayload;
    const sitelink = payloadOf(bundle, "sitelink_create") as SitelinkPayload;
    results.push(await verifyPhraseKeywords(bundle.payloads.find((payload) => payload.kind === "keyword_phrase_verify") as KeywordPhrasePayload));
    results.push(await mutateRsa(rsa, true));
    results.push(await mutateFinalUrl(finalUrl, true));
    results.push(await mutateSitelink(sitelink, true));
    results.push(await mutateNegative(bundle, true));
    if (options.dryRunOnly) {
      return { actionId: item.id, state: "dry_run_passed", message: "RSA、Final URL、Sitelink validateOnly 通過；未執行 live mutation。", partialFailure: results.some((result) => result.partialFailure), mutationCount: 0, operations, verification: "Landing verification passed; all mapped payloads validateOnly passed.", guardrails: ADS_GUARDRAILS };
    }

    results.length = 0;
    results.push(await verifyPhraseKeywords(bundle.payloads.find((payload) => payload.kind === "keyword_phrase_verify") as KeywordPhrasePayload));
    results.push(await mutateRsa(rsa, false));
    results.push(await mutateFinalUrl(finalUrl, false));
    results.push(await mutateSitelink(sitelink, false));
    results.push(await mutateNegative(bundle, false));
    const resources = results.flatMap((result) => result.resources);
    const partialFailure = results.some((result) => result.partialFailure);
    const after = await runGoogleAdsGaql(`
      SELECT ad_group_ad.ad.resource_name, ad_group_ad.ad.final_urls
      FROM ad_group_ad
      WHERE ad_group.id = ${bundle.adGroupId}
        AND ad_group_ad.status = 'ENABLED'
        AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
    `);
    const finalUrlVerified = after.some((row) => {
      const urls = row.adGroupAd?.ad?.finalUrls ?? row.ad_group_ad?.ad?.final_urls ?? [];
      return Array.isArray(urls) && urls.includes(bundle.finalUrl);
    });
    const state = !partialFailure && finalUrlVerified && resources.length > 0 ? "executed" : "failed";
    return { actionId: item.id, state, message: state === "executed" ? "RSA、Final URL、Sitelink live mutation 已完成並 GAQL 覆核。" : "live mutation 完成但 GAQL 覆核未完全通過。", partialFailure, mutationCount: resources.length, operations, resources, verification: `Landing verified; final URL GAQL verified=${finalUrlVerified}; resources=${resources.length}.`, guardrails: ADS_GUARDRAILS };
  } catch (error) {
    return { actionId: item.id, state: "failed", message: error instanceof Error ? error.message : "SEO-to-Ads mutation failed", partialFailure: false, mutationCount: 0, operations, verification: "Landing verification passed, but a Google Ads mutation call failed.", guardrails: ADS_GUARDRAILS };
  }
}
