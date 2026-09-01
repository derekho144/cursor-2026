/**
 * Google Ads API integration using REST API directly.
 *
 * Architecture:
 * - GOOGLE_ADS_CUSTOMER_ID = Manager Account (MCC) ID: 987-663-0892 (9876630892)
 *   Used as login-customer-id header for authentication.
 * - AD_ACCOUNT_ID = The actual advertising account: 4839352747
 *   This is the account that contains campaigns and metrics.
 *
 * The google-ads-api npm package has a bug with error parsing for Manager Accounts,
 * so we use the REST API directly instead.
 */

const DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN!;
const CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET!;
const REFRESH_TOKEN = process.env.GOOGLE_ADS_REFRESH_TOKEN!;
// Manager Account (MCC) ID - used as login-customer-id
const MANAGER_CUSTOMER_ID = (process.env.GOOGLE_ADS_CUSTOMER_ID ?? "").replace(/-/g, "");
// Actual advertising account ID that contains campaigns and metrics
const AD_ACCOUNT_ID = (process.env.GOOGLE_ADS_AD_ACCOUNT_ID ?? "4839352747").replace(/-/g, "");

const GOOGLE_ADS_API_VERSION = "v23";

export interface GoogleAdsDailyCost {
  date: string; // YYYY-MM-DD
  costMicros: number; // cost in micros (divide by 1_000_000 for HKD)
  campaignName?: string;
  campaignId?: string;
}

export interface GoogleAdsSummary {
  date: string;
  totalCostHKD: number;
  totalImpressions: number;
  totalClicks: number;
  campaigns: Array<{
    id: string;
    name: string;
    costHKD: number;
    impressions: number;
    clicks: number;
  }>;
}

/**
 * Check if all required Google Ads env vars are set.
 */
function checkEnvVars(): void {
  const missing = [
    ["GOOGLE_ADS_DEVELOPER_TOKEN", DEVELOPER_TOKEN],
    ["GOOGLE_ADS_CLIENT_ID", CLIENT_ID],
    ["GOOGLE_ADS_CLIENT_SECRET", CLIENT_SECRET],
    ["GOOGLE_ADS_REFRESH_TOKEN", REFRESH_TOKEN],
    ["GOOGLE_ADS_CUSTOMER_ID", MANAGER_CUSTOMER_ID],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length > 0) {
    throw new Error(`Missing Google Ads env vars: ${missing.join(", ")}`);
  }
}

/**
 * Get the active refresh token — prefers DB-stored token over env var.
 * This allows re-auth without redeployment.
 */
async function getActiveRefreshToken(): Promise<string> {
  try {
    const { getPlatformCredential } = await import("./db");
    const cred = await getPlatformCredential("google_ads");
    if (cred?.refreshToken) return cred.refreshToken;
  } catch (_) {}
  return REFRESH_TOKEN;
}

/**
 * Save a new refresh token to the database for google_ads platform.
 */
export async function saveGoogleAdsRefreshToken(refreshToken: string): Promise<void> {
  const { getDb } = await import("./db");
  const { platformCredentials } = await import("../drizzle/schema");
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .insert(platformCredentials)
    .values({ platform: "google_ads", refreshToken, isActive: 1 })
    .onDuplicateKeyUpdate({ set: { refreshToken, isActive: 1, updatedAt: new Date() } });
}

/**
 * Get a fresh OAuth2 access token using the refresh token.
 */
async function getAccessToken(): Promise<string> {
  const activeRefreshToken = await getActiveRefreshToken();
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: activeRefreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const json = await res.json() as any;
  if (!json.access_token) {
    throw new Error(`OAuth2 token refresh failed: ${JSON.stringify(json)}`);
  }
  return json.access_token as string;
}

/**
 * Execute a Google Ads Query Language (GAQL) query via REST API.
 * Queries are run against AD_ACCOUNT_ID, authenticated via MANAGER_CUSTOMER_ID.
 */
async function executeGaqlQuery(query: string): Promise<any[]> {
  const accessToken = await getAccessToken();

  const res = await fetch(
    `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${AD_ACCOUNT_ID}/googleAds:search`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "developer-token": DEVELOPER_TOKEN,
        "login-customer-id": MANAGER_CUSTOMER_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    }
  );

  const json = await res.json() as any;

  if (!res.ok) {
    const errMsg =
      json?.error?.details?.[0]?.errors?.[0]?.message ??
      json?.error?.message ??
      JSON.stringify(json);
    throw new Error(`Google Ads API error (${res.status}): ${errMsg}`);
  }

  return (json.results ?? []) as any[];
}

export async function fetchGoogleAdsCosts(
  startDate: string, // YYYY-MM-DD
  endDate: string    // YYYY-MM-DD
): Promise<GoogleAdsSummary[]> {
  checkEnvVars();

  const query = `
    SELECT
      campaign.id,
      campaign.name,
      segments.date,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND metrics.cost_micros > 0
    ORDER BY segments.date DESC, metrics.cost_micros DESC
  `;

  const rows = await executeGaqlQuery(query);

  // Group by date
  const dateMap = new Map<string, GoogleAdsSummary>();

  for (const row of rows) {
    const date = row.segments?.date as string;
    const campaignId = String(row.campaign?.id ?? "");
    const campaignName = (row.campaign?.name as string) ?? "Unknown";
    const costMicros = Number(row.metrics?.costMicros ?? 0);
    const costHKD = costMicros / 1_000_000;
    const impressions = Number(row.metrics?.impressions ?? 0);
    const clicks = Number(row.metrics?.clicks ?? 0);

    if (!dateMap.has(date)) {
      dateMap.set(date, { date, totalCostHKD: 0, totalImpressions: 0, totalClicks: 0, campaigns: [] });
    }

    const summary = dateMap.get(date)!;
    summary.totalCostHKD += costHKD;
    summary.totalImpressions += impressions;
    summary.totalClicks += clicks;
    summary.campaigns.push({ id: campaignId, name: campaignName, costHKD, impressions, clicks });
  }

  return Array.from(dateMap.values()).sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Fetch total Google Ads cost for a specific month
 * Returns total cost in HKD
 */
export async function fetchGoogleAdsMonthCost(
  year: number,
  month: number // 1-12
): Promise<number> {
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const summaries = await fetchGoogleAdsCosts(startDate, endDate);
  return summaries.reduce((sum, s) => sum + s.totalCostHKD, 0);
}

/**
 * Test connection to Google Ads API
 */
export type QualityScoreBucket = "BELOW_AVERAGE" | "AVERAGE" | "ABOVE_AVERAGE" | "UNSPECIFIED" | string;

export interface GoogleAdsKeywordQuality {
  campaignId: string;
  campaignName: string;
  adGroupName: string;
  keyword: string;
  matchType: string;
  qualityScore: number | null;
  expectedCtr: QualityScoreBucket | null;
  adRelevance: QualityScoreBucket | null;
  landingPageExperience: QualityScoreBucket | null;
  impressions: number;
  clicks: number;
  costHKD: number;
  ctr: number;
}

export interface GoogleAdsQualityDistributionRow {
  qualityScore: number;
  keywordCount: number;
  spendHKD: number;
}

export interface GoogleAdsCampaignQuality {
  campaignId: string;
  campaignName: string;
  avgQualityScore: number | null;
  impressions: number;
  clicks: number;
  costHKD: number;
  searchImpressionShare: number | null;
  searchRankLostImpressionShare: number | null;
}

export interface GoogleAdsRecommendationSummary {
  type: string;
  description: string;
  campaignName?: string;
}

export interface GoogleAdsQualityOverview {
  keywordCount: number;
  avgQualityScore: number | null;
  lowQsKeywordCount: number;
  lowQsSpendHKD: number;
  totalSpendHKD: number;
  lowQsSpendSharePct: number;
}

export interface GoogleAdsQualityDashboard {
  days: number;
  generatedAt: string;
  overview: GoogleAdsQualityOverview;
  distribution: GoogleAdsQualityDistributionRow[];
  topKeywords: GoogleAdsKeywordQuality[];
  campaigns: GoogleAdsCampaignQuality[];
  recommendations: GoogleAdsRecommendationSummary[];
}

function toNumber(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function microsToHkd(micros: unknown): number {
  return toNumber(micros) / 1_000_000;
}

function bucketLabel(v: unknown): QualityScoreBucket | null {
  if (v == null || v === "") return null;
  return String(v);
}

function computeOverview(keywords: GoogleAdsKeywordQuality[]): GoogleAdsQualityOverview {
  const withQs = keywords.filter((k) => k.qualityScore != null);
  const avgQualityScore =
    withQs.length > 0
      ? Math.round((withQs.reduce((s, k) => s + (k.qualityScore ?? 0), 0) / withQs.length) * 10) / 10
      : null;

  const totalSpendHKD = keywords.reduce((s, k) => s + k.costHKD, 0);
  const lowQs = keywords.filter((k) => (k.qualityScore ?? 10) <= 5);
  const lowQsSpendHKD = lowQs.reduce((s, k) => s + k.costHKD, 0);
  const lowQsSpendSharePct =
    totalSpendHKD > 0 ? Math.round((lowQsSpendHKD / totalSpendHKD) * 1000) / 10 : 0;

  return {
    keywordCount: keywords.length,
    avgQualityScore,
    lowQsKeywordCount: lowQs.length,
    lowQsSpendHKD: Math.round(lowQsSpendHKD * 100) / 100,
    totalSpendHKD: Math.round(totalSpendHKD * 100) / 100,
    lowQsSpendSharePct,
  };
}

function computeDistribution(keywords: GoogleAdsKeywordQuality[]): GoogleAdsQualityDistributionRow[] {
  const map = new Map<number, { keywordCount: number; spendHKD: number }>();
  for (const kw of keywords) {
    const qs = kw.qualityScore ?? 0;
    const cur = map.get(qs) ?? { keywordCount: 0, spendHKD: 0 };
    cur.keywordCount += 1;
    cur.spendHKD += kw.costHKD;
    map.set(qs, cur);
  }
  return Array.from(map.entries())
    .map(([qualityScore, v]) => ({
      qualityScore,
      keywordCount: v.keywordCount,
      spendHKD: Math.round(v.spendHKD * 100) / 100,
    }))
    .sort((a, b) => a.qualityScore - b.qualityScore);
}

/**
 * Keyword-level quality scores for Search campaigns (last N days).
 */
export async function fetchKeywordQualityScores(
  days = 30,
  limit = 100
): Promise<GoogleAdsKeywordQuality[]> {
  checkEnvVars();
  const safeDays = Math.max(7, Math.min(90, days));
  const safeLimit = Math.max(10, Math.min(500, limit));

  const query = `
    SELECT
      campaign.id,
      campaign.name,
      ad_group.name,
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      ad_group_criterion.quality_info.quality_score,
      ad_group_criterion.quality_info.search_predicted_ctr,
      ad_group_criterion.quality_info.creative_quality_score,
      ad_group_criterion.quality_info.post_click_quality_score,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.ctr
    FROM keyword_view
    WHERE segments.date DURING LAST_${safeDays}_DAYS
      AND campaign.advertising_channel_type = 'SEARCH'
      AND metrics.impressions > 0
    ORDER BY metrics.cost_micros DESC
    LIMIT ${safeLimit}
  `;

  const rows = await executeGaqlQuery(query);
  return rows.map((row) => {
    const impressions = toNumber(row.metrics?.impressions);
    const clicks = toNumber(row.metrics?.clicks);
    const costHKD = microsToHkd(row.metrics?.costMicros);
    const qi = row.adGroupCriterion?.qualityInfo ?? row.ad_group_criterion?.quality_info;
    const qsRaw = qi?.qualityScore ?? qi?.quality_score;
    const qualityScore = qsRaw != null && qsRaw !== "" ? toNumber(qsRaw) : null;

    return {
      campaignId: String(row.campaign?.id ?? ""),
      campaignName: String(row.campaign?.name ?? "Unknown"),
      adGroupName: String(row.adGroup?.name ?? row.ad_group?.name ?? ""),
      keyword: String(row.adGroupCriterion?.keyword?.text ?? row.ad_group_criterion?.keyword?.text ?? ""),
      matchType: String(row.adGroupCriterion?.keyword?.matchType ?? row.ad_group_criterion?.keyword?.match_type ?? ""),
      qualityScore: qualityScore && qualityScore > 0 ? qualityScore : null,
      expectedCtr: bucketLabel(qi?.searchPredictedCtr ?? qi?.search_predicted_ctr),
      adRelevance: bucketLabel(qi?.creativeQualityScore ?? qi?.creative_quality_score),
      landingPageExperience: bucketLabel(qi?.postClickQualityScore ?? qi?.post_click_quality_score),
      impressions,
      clicks,
      costHKD: Math.round(costHKD * 100) / 100,
      ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
    };
  });
}

/**
 * Campaign-level quality + impression share metrics.
 */
export async function fetchCampaignQualityScores(days = 30): Promise<GoogleAdsCampaignQuality[]> {
  checkEnvVars();
  const safeDays = Math.max(7, Math.min(90, days));

  const query = `
    SELECT
      campaign.id,
      campaign.name,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.historical_quality_score,
      metrics.search_impression_share,
      metrics.search_rank_lost_impression_share
    FROM campaign
    WHERE segments.date DURING LAST_${safeDays}_DAYS
      AND campaign.advertising_channel_type = 'SEARCH'
      AND metrics.impressions > 0
    ORDER BY metrics.cost_micros DESC
  `;

  const rows = await executeGaqlQuery(query);
  const byCampaign = new Map<string, GoogleAdsCampaignQuality & { qsSum: number; qsCount: number }>();

  for (const row of rows) {
    const id = String(row.campaign?.id ?? "");
    const name = String(row.campaign?.name ?? "Unknown");
    const impressions = toNumber(row.metrics?.impressions);
    const clicks = toNumber(row.metrics?.clicks);
    const costHKD = microsToHkd(row.metrics?.costMicros);
    const qs = row.metrics?.historicalQualityScore ?? row.metrics?.historical_quality_score;
    const qsNum = qs != null && qs !== "" ? toNumber(qs) : null;

    const cur =
      byCampaign.get(id) ??
      ({
        campaignId: id,
        campaignName: name,
        avgQualityScore: null,
        impressions: 0,
        clicks: 0,
        costHKD: 0,
        searchImpressionShare: null,
        searchRankLostImpressionShare: null,
        qsSum: 0,
        qsCount: 0,
      } as GoogleAdsCampaignQuality & { qsSum: number; qsCount: number });

    cur.impressions += impressions;
    cur.clicks += clicks;
    cur.costHKD += costHKD;
    if (qsNum && qsNum > 0) {
      cur.qsSum += qsNum;
      cur.qsCount += 1;
    }
    const is = row.metrics?.searchImpressionShare ?? row.metrics?.search_impression_share;
    const rankLost =
      row.metrics?.searchRankLostImpressionShare ?? row.metrics?.search_rank_lost_impression_share;
    if (is != null) cur.searchImpressionShare = Math.round(toNumber(is) * 1000) / 10;
    if (rankLost != null) cur.searchRankLostImpressionShare = Math.round(toNumber(rankLost) * 1000) / 10;
    byCampaign.set(id, cur);
  }

  return Array.from(byCampaign.values())
    .map(({ qsSum, qsCount, ...rest }) => ({
      ...rest,
      costHKD: Math.round(rest.costHKD * 100) / 100,
      avgQualityScore: qsCount > 0 ? Math.round((qsSum / qsCount) * 10) / 10 : null,
    }))
    .sort((a, b) => b.costHKD - a.costHKD);
}

/**
 * Google Ads optimization recommendations (read-only summary).
 */
export async function fetchGoogleAdsRecommendations(limit = 20): Promise<GoogleAdsRecommendationSummary[]> {
  checkEnvVars();
  const safeLimit = Math.max(5, Math.min(50, limit));

  const query = `
    SELECT
      recommendation.type,
      recommendation.campaign,
      recommendation.keyword_recommendation,
      recommendation.responsive_search_ad_recommendation,
      recommendation.text_ad_recommendation
    FROM recommendation
    LIMIT ${safeLimit}
  `;

  const rows = await executeGaqlQuery(query);
  return rows.map((row) => {
    const rec = row.recommendation ?? {};
    const type = String(rec.type ?? "UNKNOWN");
    let description = type;
    const kw = rec.keywordRecommendation ?? rec.keyword_recommendation;
    const rsa = rec.responsiveSearchAdRecommendation ?? rec.responsive_search_ad_recommendation;
    if (kw?.keyword?.text) description = `Add keyword: ${kw.keyword.text}`;
    else if (rsa?.ad?.headlines?.length) description = `RSA suggestion (${rsa.ad.headlines.length} headlines)`;
    return {
      type,
      description,
      campaignName: rec.campaign ? String(rec.campaign).split("/").pop() : undefined,
    };
  });
}

/**
 * Full QS dashboard payload for admin UI and weekly reports.
 */
export async function fetchGoogleAdsQualityDashboard(days = 30): Promise<GoogleAdsQualityDashboard> {
  const [topKeywords, campaigns, recommendations] = await Promise.all([
    fetchKeywordQualityScores(days, 150),
    fetchCampaignQualityScores(days),
    fetchGoogleAdsRecommendations(15).catch(() => [] as GoogleAdsRecommendationSummary[]),
  ]);

  const overview = computeOverview(topKeywords);
  const distribution = computeDistribution(topKeywords);

  // Prioritize low QS + high spend for action list
  const sortedKeywords = [...topKeywords].sort((a, b) => {
    const qsA = a.qualityScore ?? 10;
    const qsB = b.qualityScore ?? 10;
    if (qsA !== qsB) return qsA - qsB;
    return b.costHKD - a.costHKD;
  });

  return {
    days,
    generatedAt: new Date().toISOString(),
    overview,
    distribution,
    topKeywords: sortedKeywords.slice(0, 50),
    campaigns,
    recommendations,
  };
}

export async function testGoogleAdsConnection(): Promise<{ success: boolean; customerId?: string; error?: string }> {
  try {
    checkEnvVars();
    const rows = await executeGaqlQuery(`
      SELECT customer.id, customer.descriptive_name
      FROM customer
      LIMIT 1
    `);

    return {
      success: true,
      customerId: String(rows[0]?.customer?.id ?? AD_ACCOUNT_ID),
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message ?? String(error),
    };
  }
}
