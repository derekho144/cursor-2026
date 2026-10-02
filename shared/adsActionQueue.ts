export type AdsActionRisk = "low" | "medium" | "high";
export type AdsActionStatus = "pending" | "approved" | "rejected" | "completed";

export type AdsActionHistoryRecord = {
  actionId: string;
  title: string;
  state: "executed" | "blocked" | "failed";
  completedAt: string;
  message: string;
  mutationCount: number;
  verification?: string;
  operations?: string[];
  requeueReason?: string;
  requeuedBy?: string;
  requeuedAt?: string;
};

export type AdsActionHistoryFilter = "all" | AdsActionHistoryRecord["state"];

export function filterAdsActionHistory(
  records: AdsActionHistoryRecord[],
  filter: AdsActionHistoryFilter,
): AdsActionHistoryRecord[] {
  return filter === "all" ? records : records.filter((record) => record.state === filter);
}

/** Only approved, non-completed actions may reach a live executor. */
export function getExecutableAdsActions<T extends { id: string; status: AdsActionStatus }>(
  actions: T[],
  completedIds: ReadonlySet<string> = new Set(),
): T[] {
  return actions.filter((action) => action.status === "approved" && !completedIds.has(action.id));
}

/** Keep browser history audit-safe: no tokens, request bodies, or raw API responses. */
export function toAdsActionHistoryRecord(input: {
  actionId: string;
  title: string;
  state: "executed" | "blocked" | "failed";
  message: string;
  mutationCount: number;
  verification?: string;
  operations?: string[];
  requeueReason?: string;
  requeuedBy?: string;
  requeuedAt?: string;
  completedAt?: string;
}): AdsActionHistoryRecord {
  return {
    actionId: input.actionId,
    title: input.title,
    state: input.state,
    completedAt: input.completedAt ?? new Date().toISOString(),
    message: input.message.slice(0, 500),
    mutationCount: Math.max(0, Math.min(999, input.mutationCount)),
    verification: input.verification?.slice(0, 1000),
    operations: input.operations?.slice(0, 20),
    requeueReason: input.requeueReason?.slice(0, 500),
    requeuedBy: input.requeuedBy?.slice(0, 240),
    requeuedAt: input.requeuedAt,
  };
}

export type AdsActionCandidate = {
  id: string;
  query: string;
  serviceLabel: string;
  targetPath: string;
  score: number;
  organicPosition: number | null;
  ads: {
    commercialSignal: "available" | "unavailable";
    keywordCount: number;
    spendHKD: number;
    clicks: number;
    avgCpcHKD: number | null;
    weightedQualityScore: number | null;
    lowQualitySpendHKD: number;
  };
  revenue: { acceptedCount: number; acceptedRevenueHKD: number };
};

export const TRUSTED_SEARCH_CAMPAIGN_ID = "24002224927";
export const TRUSTED_AD_GROUP_MAPPINGS = {
  product: { service: "產品攝影", adGroupId: "203224222492", path: "/services/product-photography" },
  interior: { service: "室內／地產攝影", adGroupId: "203224222452", path: "/services/interior-photography" },
  event: { service: "活動攝影", adGroupId: "203224222532", path: "/services/corporate-event" },
} as const;

/** Conservative exclusions only; core service terms are never generated here. */
export const TRUSTED_NEGATIVE_TERMS = ["免費", "教學", "課程", "招聘", "DIY"] as const;

export type TrustedNegativePlan = {
  kind: "campaign_negative";
  mutationCount: number;
  preview: string;
  campaignId: string;
  adGroupId: string;
  matchType: "PHRASE";
  negativeTerms: string[];
};

export type AdsActionItem = {
  id: string;
  backlogId: string;
  actionType: "quality_review" | "landing_page_review" | "keyword_review";
  query: string;
  targetPath: string;
  /** Populated only when the server has an exact, guardrailed mutation plan. */
  executionPlan?: TrustedNegativePlan;
  title: string;
  rationale: string;
  expectedImpact: string;
  risk: AdsActionRisk;
  proposedScope: string;
  status: AdsActionStatus;
};

function trustedNegativePlan(row: AdsActionCandidate): TrustedNegativePlan | undefined {
  const mapping = Object.values(TRUSTED_AD_GROUP_MAPPINGS).find((item) => item.path === row.targetPath);
  if (!mapping) return undefined;
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

export function buildInteriorQualityReviewAction(status: AdsActionStatus = "pending"): AdsActionItem {
  return {
    id: "interior-photography:quality-review",
    backlogId: "interior-photography",
    actionType: "quality_review",
    query: "室內攝影 香港",
    targetPath: "/services/interior-photography",
    title: "先改善「室內攝影」相關性，再重驗 Landing",
    rationale: "室內攝影項目之前因 Landing verification 未通過而被阻擋；重加入後會先重新建立 Content Contract，再重驗頁面，不會直接修改 Ads。",
    expectedImpact: "確認室內／地產攝影頁、RSA、Phrase keyword 與 CTA 對口，通過後才可進入 validateOnly dry-run。",
    risk: "medium",
    proposedScope: `只處理室內／地產攝影 ad group ${TRUSTED_AD_GROUP_MAPPINGS.interior.adGroupId} 及 ${TRUSTED_AD_GROUP_MAPPINGS.interior.path}；不改 budget、tCPA 或 campaign status。`,
    status,
  };
}

export function isRequeueableInteriorAction(record: Pick<AdsActionHistoryRecord, "actionId" | "title" | "state">): boolean {
  return record.state !== "executed" && (/interior/i.test(record.actionId) || /室內/.test(record.title));
}

export function buildTrustedServiceNegativeQueue(): AdsActionItem[] {
  return Object.values(TRUSTED_AD_GROUP_MAPPINGS).map((mapping) => ({
    id: `trusted-negative:${mapping.adGroupId}`,
    backlogId: `trusted-negative:${mapping.adGroupId}`,
    actionType: "keyword_review" as const,
    query: `${mapping.service} 明顯非商業意圖排除`,
    targetPath: mapping.path,
    executionPlan: {
      kind: "campaign_negative" as const,
      mutationCount: TRUSTED_NEGATIVE_TERMS.length,
      preview: `campaign ${TRUSTED_SEARCH_CAMPAIGN_ID} phrase negatives: ${TRUSTED_NEGATIVE_TERMS.join(", ")}`,
      campaignId: TRUSTED_SEARCH_CAMPAIGN_ID,
      adGroupId: mapping.adGroupId,
      matchType: "PHRASE" as const,
      negativeTerms: [...TRUSTED_NEGATIVE_TERMS],
    },
    title: `${mapping.service}：固定 PHRASE negatives dry-run`,
    rationale: `只驗證 ${mapping.service} ad group 的固定安全排除詞，不讀取或修改核心服務詞。`,
    expectedImpact: "先用 validateOnly 及 GAQL 覆核，確認可安全排除明顯非商業意圖。",
    risk: "medium" as const,
    proposedScope: `Search #3 campaign ${TRUSTED_SEARCH_CAMPAIGN_ID}；mapping ad group ${mapping.adGroupId}；只允許五個固定 PHRASE negatives。`,
    status: "pending" as const,
  }));
}

/** Generate reviewable Ads actions; only keyword_review has a fixed trusted plan. */
export function buildAdsActionQueue(rows: AdsActionCandidate[]): AdsActionItem[] {
  const actions: AdsActionItem[] = [];

  for (const row of rows) {
    if (row.ads.commercialSignal !== "available" || row.ads.keywordCount === 0) continue;

    if (row.ads.weightedQualityScore != null && row.ads.weightedQualityScore <= 5) {
      actions.push({
        id: `${row.id}:quality-review`, backlogId: row.id, actionType: "quality_review",
        query: row.query, targetPath: row.targetPath,
        title: `先改善「${row.query}」相關性，再考慮競價`,
        rationale: `此服務已有 Ads 訊號，但加權 QS 只有 ${row.ads.weightedQualityScore}，且低 QS 花費約 HK$${Math.round(row.ads.lowQualitySpendHKD).toLocaleString("en-HK")}。`,
        expectedImpact: "可能改善廣告相關性、預期 CTR 及 Ad Rank；不保證增加轉換。",
        risk: "medium",
        proposedScope: `只審核 ${row.serviceLabel} ad group 的 RSA、keyword、search term 與 ${row.targetPath} 一致性；不改 budget、tCPA 或 pause 核心詞。`,
        status: "pending",
      });
      continue;
    }

    if (row.ads.clicks > 0 && row.organicPosition != null && row.organicPosition > 10) {
      actions.push({
        id: `${row.id}:landing-page-review`, backlogId: row.id, actionType: "landing_page_review",
        query: row.query, targetPath: row.targetPath,
        title: `核對「${row.query}」廣告與落地頁對口度`,
        rationale: `有 ${row.ads.clicks} clicks、約 HK$${Math.round(row.ads.spendHKD).toLocaleString("en-HK")} 花費，但自然排名仍在第 ${Math.round(row.organicPosition)} 位以後。`,
        expectedImpact: "先改善頁面訊息與 CTA 對口度，降低把流量導入弱頁面的風險。",
        risk: "low",
        proposedScope: `只檢查 ${row.targetPath} 的首屏、服務定義、報價 CTA、FAQ 及 RSA 用語；不直接修改網站。`,
        status: "pending",
      });
      continue;
    }

    if (row.ads.spendHKD > 0 && row.ads.clicks > 0) {
      actions.push({
        id: `${row.id}:keyword-review`, backlogId: row.id, actionType: "keyword_review",
        query: row.query, targetPath: row.targetPath,
        executionPlan: trustedNegativePlan(row),
        title: `審核「${row.query}」是否值得保留或加價`,
        rationale: `此主題已有 ${row.ads.clicks} clicks、約 HK$${Math.round(row.ads.spendHKD).toLocaleString("en-HK")} 花費及商業意圖資料。`,
        expectedImpact: "先排除免費、教學、課程、招聘及 DIY 等明顯非商業意圖，再評估競價；避免只因 CPC 低就加價。",
        risk: "high",
        proposedScope: `只對已映射的 ${row.serviceLabel} ad group 建立 campaign PHRASE negatives；不改 budget、tCPA 或核心服務詞。`,
        status: "pending",
      });
    }
  }

  return actions.sort((a, b) => {
    const riskWeight = { high: 0, medium: 1, low: 2 } as const;
    return riskWeight[a.risk] - riskWeight[b.risk];
  });
}
