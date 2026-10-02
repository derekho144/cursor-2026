import { and, eq, gte, sql } from "drizzle-orm";
import { quotes } from "../drizzle/schema";
import { getDb } from "./db";
import {
  DEFAULT_GSC_SITE_URL,
  listGscSites,
  queryGscSearchAnalytics,
  type GscSearchAnalyticsRow,
} from "./googleSearchConsole";
import {
  fetchKeywordQualityScores,
  type GoogleAdsKeywordQuality,
} from "./googleAds";

/**
 * A transparent, read-only prioritisation model for JD Studio growth work.
 *
 * The score deliberately ranks work by business impact and opportunity rather
 * than attempting to predict rankings. It uses four visible components:
 * business value (0-40), paid-search friction (0-25), organic opportunity
 * (0-25), and AEO/page readiness gap (0-10).
 */

export type AeoReadiness = "ready" | "partial" | "weak" | "unavailable";

export type AeoSignals = {
  status: AeoReadiness;
  httpStatus: number | null;
  hasFaqPage: boolean;
  hasService: boolean;
  hasOffer: boolean;
  hasDefinition: boolean;
  hasContactCta: boolean;
};

export type PriorityBreakdown = {
  businessValue: number;
  paidSearchFriction: number;
  organicOpportunity: number;
  aeoGap: number;
};

export type ServicePriorityInput = {
  id: string;
  label: string;
  path: string;
  acceptedRevenueHKD: number;
  acceptedCount: number;
  maxAcceptedRevenueHKD: number;
  ads: {
    keywordCount: number;
    spendHKD: number;
    clicks?: number;
    avgCpcHKD?: number | null;
    weightedQualityScore: number | null;
    lowQualitySpendHKD: number;
  };
  organic: {
    clicks: number;
    impressions: number;
    ctr: number;
    position: number | null;
  };
  aeo: AeoSignals;
};

export type ServicePriority = ServicePriorityInput & {
  score: number;
  breakdown: PriorityBreakdown;
  confidence: "high" | "medium" | "limited";
  recommendations: string[];
};

export type AhrefsCompetitor = {
  position: number;
  title: string | null;
  url: string | null;
  domainRating: number | null;
  referringDomains: number | null;
  types: string[];
};

export type QueryBacklogItem = {
  id: string;
  query: string;
  serviceLabel: string;
  targetPath: string;
  targetUrl: string;
  score: number;
  confidence: "high" | "medium" | "limited";
  organic: {
    clicks: number;
    impressions: number;
    ctr: number;
    position: number | null;
    previousPosition?: number | null;
    positionChange?: number | null;
    positionTrend?: "up" | "down" | "flat" | "insufficient";
  };
  ads: {
    keywordCount: number;
    spendHKD: number;
    clicks: number;
    avgCpcHKD: number | null;
    weightedQualityScore: number | null;
    lowQualitySpendHKD: number;
    commercialSignal: "available" | "unavailable";
  };
  revenue: { acceptedCount: number; acceptedRevenueHKD: number };
  aeo: AeoSignals;
  ahrefs: {
    available: boolean;
    difficulty: number | null;
    volume: number | null;
    trafficPotential: number | null;
    intents: string[];
    serpFeatures: string[];
    competitors: AhrefsCompetitor[];
    top3MedianReferringDomains: number | null;
  };
  gaps: {
    content: string[];
    internalLinks: string;
    authority: string;
  };
  expectedTime: { label: string; basis: string };
  actions: string[];
  breakdown: {
    businessValue: number;
    paidIntent: number;
    organicOpportunity: number;
    aeoGap: number;
    ahrefsFeasibility: number;
  };
};

export function gscPositionTrend(current: number | null, previous: number | null): { change: number | null; trend: "up" | "down" | "flat" | "insufficient" } {
  if (current == null || previous == null) return { change: null, trend: "insufficient" };
  const change = round(previous - current, 1);
  return { change, trend: change > 0.5 ? "up" : change < -0.5 ? "down" : "flat" };
}

type ServiceProfile = {
  id: string;
  label: string;
  path: string;
  serviceTypes: string[];
  terms: string[];
};

export const SERVICE_PROFILES: ServiceProfile[] = [
  {
    id: "product",
    label: "產品攝影",
    path: "/services/product-photography",
    serviceTypes: ["product"],
    terms: ["產品", "商品", "product", "catalogue", "catalog", "白底"],
  },
  {
    id: "interior",
    label: "室內／地產攝影",
    path: "/services/interior-photography",
    serviceTypes: ["interior", "360_photography"],
    terms: ["室內", "地產", "空間", "interior", "property", "real estate"],
  },
  {
    id: "food",
    label: "食物攝影",
    path: "/services/food-photography",
    serviceTypes: ["food_beverage", "menu_design"],
    terms: ["食物", "餐飲", "菜式", "food", "menu"],
  },
  {
    id: "corporate-event",
    label: "企業活動攝影",
    path: "/services/corporate-event",
    serviceTypes: ["corporate_event"],
    terms: ["企業活動", "公司活動", "活動攝影", "corporate event", "event photography", "研討會", "開幕"],
  },
  {
    id: "jewelry",
    label: "珠寶攝影",
    path: "/services/jewelry-photography",
    serviceTypes: ["jewelry"],
    terms: ["珠寶", "首飾", "jewelry", "jewellery"],
  },
  {
    id: "video",
    label: "企業影片製作",
    path: "/services/video-production",
    serviceTypes: ["video_production", "ad_video"],
    terms: ["企業影片", "影片製作", "tvc", "video production", "corporate video"],
  },
];

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function safeNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function dateInHkt(daysAgo: number): string {
  const hkt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  hkt.setUTCDate(hkt.getUTCDate() - daysAgo);
  return hkt.toISOString().slice(0, 10);
}

function matchingProfile(text: string, profile: ServiceProfile): boolean {
  const normalized = text.toLowerCase();
  return profile.terms.some((term) => {
    const normalizedTerm = term.toLowerCase();
    // CJK terms do not have word boundaries. Latin terms do, so use a boundary
    // check to prevent `product` matching the unrelated word `production`.
    if (/^[a-z0-9\s]+$/i.test(normalizedTerm)) {
      const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i").test(normalized);
    }
    return normalized.includes(normalizedTerm);
  });
}

function gscSummary(rows: GscSearchAnalyticsRow[]): {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
} {
  let clicks = 0;
  let impressions = 0;
  let weightedPosition = 0;
  let positionWeight = 0;

  for (const row of rows) {
    const rowClicks = safeNumber(row.clicks);
    const rowImpressions = safeNumber(row.impressions);
    clicks += rowClicks;
    impressions += rowImpressions;
    if (row.position != null && rowImpressions > 0) {
      weightedPosition += safeNumber(row.position) * rowImpressions;
      positionWeight += rowImpressions;
    }
  }

  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? round((clicks / impressions) * 100, 2) : 0,
    position: positionWeight > 0 ? round(weightedPosition / positionWeight, 1) : null,
  };
}

function adsSummary(keywords: GoogleAdsKeywordQuality[], profile: ServiceProfile) {
  const related = keywords.filter((keyword) =>
    matchingProfile(`${keyword.keyword} ${keyword.adGroupName}`, profile)
  );
  const spendHKD = related.reduce((sum, keyword) => sum + keyword.costHKD, 0);
  const clicks = related.reduce((sum, keyword) => sum + keyword.clicks, 0);
  const lowQualitySpendHKD = related
    .filter((keyword) => (keyword.qualityScore ?? 10) <= 5)
    .reduce((sum, keyword) => sum + keyword.costHKD, 0);
  const weightedQualityScore = related
    .filter((keyword) => keyword.qualityScore != null)
    .reduce(
      (acc, keyword) => {
        const weight = Math.max(keyword.costHKD, 1);
        return { weighted: acc.weighted + (keyword.qualityScore ?? 0) * weight, weight: acc.weight + weight };
      },
      { weighted: 0, weight: 0 }
    );

  return {
    keywordCount: related.length,
    spendHKD: round(spendHKD, 2),
    clicks,
    avgCpcHKD: clicks > 0 ? round(spendHKD / clicks, 2) : null,
    lowQualitySpendHKD: round(lowQualitySpendHKD, 2),
    weightedQualityScore:
      weightedQualityScore.weight > 0
        ? round(weightedQualityScore.weighted / weightedQualityScore.weight, 1)
        : null,
  };
}

type AhrefsKeywordMetric = {
  difficulty: number | null;
  volume: number | null;
  trafficPotential: number | null;
  intents: string[];
  serpFeatures: string[];
};

type AhrefsSnapshot = {
  available: boolean;
  metrics: Map<string, AhrefsKeywordMetric>;
  competitors: Map<string, AhrefsCompetitor[]>;
  error: string | null;
  cached: boolean;
};

const AHREFS_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
let ahrefsCache: { expiresAt: number; snapshot: AhrefsSnapshot } | null = null;

function ahrefsNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizedKeyword(value: string): string {
  return value.trim().toLowerCase();
}

async function ahrefsJson(path: string, params: Record<string, string>): Promise<any> {
  const apiKey = process.env.AHREFS_API_KEY?.trim();
  if (!apiKey) throw new Error("AHREFS_API_KEY is not configured");
  const url = new URL(`https://api.ahrefs.com/v3${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  const text = await response.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; }
  if (!response.ok) {
    const message = body?.error?.message ?? body?.message ?? `Ahrefs API failed (${response.status})`;
    throw new Error(String(message).slice(0, 300));
  }
  return body;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : round((ordered[middle - 1] + ordered[middle]) / 2, 1);
}

async function fetchAhrefsSnapshot(queries: string[]): Promise<AhrefsSnapshot> {
  const now = Date.now();
  if (ahrefsCache && ahrefsCache.expiresAt > now) return { ...ahrefsCache.snapshot, cached: true };
  const uniqueQueries = Array.from(new Set(queries.map((query) => query.trim()).filter(Boolean))).slice(0, 10);
  const unavailable = (error: string): AhrefsSnapshot => ({
    available: false,
    metrics: new Map(),
    competitors: new Map(),
    error,
    cached: false,
  });
  if (!uniqueQueries.length) return unavailable("No eligible GSC queries available for Ahrefs enrichment");

  try {
    const overview = await ahrefsJson("/keywords-explorer/overview", {
      select: "keyword,difficulty,volume,traffic_potential,intents,serp_features",
      country: "hk",
      keywords: uniqueQueries.join(","),
      output: "json",
    });
    const metrics = new Map<string, AhrefsKeywordMetric>();
    for (const row of Array.isArray(overview?.keywords) ? overview.keywords : []) {
      const intents = row?.intents && typeof row.intents === "object"
        ? Object.entries(row.intents).filter(([, enabled]) => Boolean(enabled)).map(([intent]) => intent)
        : [];
      metrics.set(normalizedKeyword(String(row?.keyword ?? "")), {
        difficulty: ahrefsNumber(row?.difficulty),
        volume: ahrefsNumber(row?.volume),
        trafficPotential: ahrefsNumber(row?.traffic_potential),
        intents,
        serpFeatures: Array.isArray(row?.serp_features) ? row.serp_features.map(String) : [],
      });
    }

    const competitorPairs = await Promise.all(
      uniqueQueries.map(async (keyword) => {
        try {
          const serp = await ahrefsJson("/serp-overview/serp-overview", {
            select: "position,title,url,domain_rating,refdomains,type",
            keyword,
            country: "hk",
            top_positions: "3",
            output: "json",
          });
          const competitors = (Array.isArray(serp?.positions) ? serp.positions : [])
            .filter((row: any) => Array.isArray(row?.type) && row.type.includes("organic"))
            .slice(0, 3)
            .map((row: any): AhrefsCompetitor => ({
              position: safeNumber(row?.position),
              title: row?.title == null ? null : String(row.title),
              url: row?.url == null ? null : String(row.url),
              domainRating: ahrefsNumber(row?.domain_rating),
              referringDomains: ahrefsNumber(row?.refdomains),
              types: Array.isArray(row?.type) ? row.type.map(String) : [],
            }));
          return [normalizedKeyword(keyword), competitors] as const;
        } catch {
          return [normalizedKeyword(keyword), []] as const;
        }
      })
    );
    const snapshot: AhrefsSnapshot = {
      available: metrics.size > 0,
      metrics,
      competitors: new Map(competitorPairs),
      error: metrics.size > 0 ? null : "Ahrefs did not return keyword metrics",
      cached: false,
    };
    ahrefsCache = { expiresAt: now + AHREFS_CACHE_TTL_MS, snapshot };
    return snapshot;
  } catch (error: unknown) {
    const snapshot = unavailable(error instanceof Error ? error.message : String(error));
    // Cache a failed upstream response briefly to avoid repeated paid calls or retries.
    ahrefsCache = { expiresAt: now + 5 * 60 * 1_000, snapshot };
    return snapshot;
  }
}

export function isCommercialHongKongQuery(query: string): boolean {
  const normalized = query.toLowerCase();
  if (/(如何|點樣|教學|課程|自學|diy|how to|tutorial|learn|免費|free)/i.test(normalized)) return false;
  const serviceIntent = /(攝影|拍攝|photography|photographer|video production|影片製作|tvc)/i.test(normalized);
  const localOrCommercial = /(香港|hong kong|報價|價錢|收費|價目|服務|公司|企業|product|food|interior|event|jewelry|珠寶|產品|食物|室內|活動)/i.test(normalized);
  return serviceIntent && localOrCommercial;
}

function queryProfile(query: string): ServiceProfile | null {
  return SERVICE_PROFILES.find((profile) => matchingProfile(query, profile)) ?? null;
}

export function canonicalQueryIntent(query: string): string {
  return query
    .toLowerCase()
    .replace(/[\s\-_/]+/g, "")
    .replace(/服務$/, "")
    .trim();
}

export function expectedTime(position: number | null, difficulty: number | null): { label: string; basis: string } {
  if (position != null && position <= 20 && (difficulty == null || difficulty <= 30)) {
    return { label: "快：2–6 週", basis: "已有第一頁邊緣曝光；以現有服務頁補強為主" };
  }
  if (position != null && position <= 40 && (difficulty == null || difficulty <= 50)) {
    return { label: "中：1–3 個月", basis: "需要內容深度、內部連結與頁面相關性累積" };
  }
  return { label: "慢：3–6+ 個月", basis: "排名或競爭門檻較高；通常需持續內容與權威訊號" };
}

export function backlogScore(input: {
  revenue: number;
  maxRevenue: number;
  ads: ReturnType<typeof adsSummary>;
  organic: ReturnType<typeof gscSummary>;
  aeo: AeoSignals;
  difficulty: number | null;
}): QueryBacklogItem["breakdown"] & { total: number } {
  const businessValue = input.maxRevenue > 0 ? round(Math.min(30, (input.revenue / input.maxRevenue) * 30)) : 0;
  const paidIntent = input.ads.keywordCount > 0
    ? round(Math.min(20, Math.min(12, input.ads.spendHKD / 8) + Math.max(0, (7 - (input.ads.weightedQualityScore ?? 7)) * 2)))
    : 0;
  const organicOpportunity = input.organic.position == null ? 0
    : input.organic.position <= 20 ? 25
    : input.organic.position <= 40 ? 21
    : input.organic.position <= 60 ? 14 : 8;
  const aeoGap = input.aeo.status === "weak" ? 12 : input.aeo.status === "partial" ? 8 : input.aeo.status === "ready" ? 2 : 5;
  const ahrefsFeasibility = input.difficulty == null ? 4 : input.difficulty <= 30 ? 13 : input.difficulty <= 50 ? 8 : 3;
  const total = round(businessValue + paidIntent + organicOpportunity + aeoGap + ahrefsFeasibility);
  return { businessValue, paidIntent, organicOpportunity, aeoGap, ahrefsFeasibility, total };
}

export function classifyAeoReadiness(input: Omit<AeoSignals, "status">): AeoReadiness {
  if (!input.httpStatus || input.httpStatus < 200 || input.httpStatus >= 400) return "unavailable";
  const structuredCount = [input.hasFaqPage, input.hasService, input.hasOffer].filter(Boolean).length;
  if (structuredCount === 3 && input.hasDefinition && input.hasContactCta) return "ready";
  if (structuredCount >= 1 || input.hasDefinition || input.hasContactCta) return "partial";
  return "weak";
}

export async function inspectServicePageAeo(profile: Pick<ServiceProfile, "path">): Promise<AeoSignals> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(`https://www.jdstudiohk.com${profile.path}`, {
      headers: { "User-Agent": "JD-Studio-Admin-Growth-Audit/1.0" },
      signal: controller.signal,
    });
    const html = await response.text();
    const lower = html.toLowerCase();
    const base = {
      httpStatus: response.status,
      hasFaqPage: /"@type"\s*:\s*"faqpage"|"faqpage"/i.test(html),
      hasService: /"@type"\s*:\s*"service"|"service"/i.test(html),
      hasOffer: /"@type"\s*:\s*"offer(?:catalog)?"|"offer(?:catalog)?"/i.test(html),
      hasDefinition: lower.includes("是專門") || lower.includes("專門提供") || lower.includes("speciali[sz]es in"),
      hasContactCta: lower.includes("whatsapp") || lower.includes("立即報價") || lower.includes("立即查詢"),
    };
    return { ...base, status: classifyAeoReadiness(base) };
  } catch {
    const base = {
      httpStatus: null,
      hasFaqPage: false,
      hasService: false,
      hasOffer: false,
      hasDefinition: false,
      hasContactCta: false,
    };
    return { ...base, status: "unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}

export function scoreServicePriority(input: ServicePriorityInput): ServicePriority {
  const businessValue =
    input.maxAcceptedRevenueHKD > 0
      ? round(Math.min(40, (input.acceptedRevenueHKD / input.maxAcceptedRevenueHKD) * 40))
      : 0;

  const hasPaidSignal = input.ads.keywordCount > 0 || input.ads.spendHKD > 0;
  const qualityGap = input.ads.weightedQualityScore != null
    ? Math.max(0, Math.min(10, (7 - input.ads.weightedQualityScore) * 2))
    : 0;
  const paidSearchFriction = hasPaidSignal
    ? round(Math.min(25, Math.min(15, input.ads.spendHKD / 8) + qualityGap))
    : 0;

  let organicOpportunity = 0;
  if (input.organic.impressions > 0 && input.organic.position != null) {
    if (input.organic.position > 20) organicOpportunity = 24;
    else if (input.organic.position > 10) organicOpportunity = 22;
    else if (input.organic.position > 4) organicOpportunity = 18;
    else if (input.organic.ctr < 2) organicOpportunity = 10;
    else organicOpportunity = 4;
  } else if (input.organic.impressions > 0) {
    organicOpportunity = 12;
  }

  const aeoGap = input.aeo.status === "weak" ? 10 : input.aeo.status === "partial" ? 6 : input.aeo.status === "ready" ? 1 : 4;
  const breakdown: PriorityBreakdown = {
    businessValue,
    paidSearchFriction,
    organicOpportunity,
    aeoGap,
  };
  const score = round(
    breakdown.businessValue + breakdown.paidSearchFriction + breakdown.organicOpportunity + breakdown.aeoGap
  );

  const recommendations: string[] = [];
  if (input.organic.position == null || input.organic.position > 10) {
    recommendations.push("以服務頁的商業問題、價錢／報價 FAQ 與內部連結，先攻自然搜尋第一頁。");
  } else if (input.organic.ctr < 2 && input.organic.impressions > 0) {
    recommendations.push("已在第一頁附近；優先改善標題、meta 描述與答案式摘要，爭取更高 CTR。");
  }
  if (input.aeo.status === "weak" || input.aeo.status === "partial") {
    recommendations.push("補齊可見定義句、FAQ、Service 與 Offer JSON-LD，讓搜尋及 AI 更容易理解頁面。 ");
  }
  if (hasPaidSignal && ((input.ads.weightedQualityScore ?? 10) < 6 || input.ads.lowQualitySpendHKD > 0)) {
    recommendations.push("檢視 Ads 關鍵字、RSA 文案與此落地頁是否同一服務意圖；先改善相關性，再考慮提高競價。");
  }
  if (recommendations.length === 0) {
    recommendations.push("維持現有頁面品質並累積案例、客戶評價及可引用的本地服務資料。");
  }

  const availableSources = [
    input.acceptedRevenueHKD > 0 || input.acceptedCount > 0,
    hasPaidSignal,
    input.organic.impressions > 0,
    input.aeo.status !== "unavailable",
  ].filter(Boolean).length;

  return {
    ...input,
    score,
    breakdown,
    confidence: availableSources >= 4 ? "high" : availableSources >= 2 ? "medium" : "limited",
    recommendations,
  };
}

async function chooseGscSiteUrl(): Promise<string> {
  const sites = await listGscSites();
  return (
    sites.find((site) => site.siteUrl === DEFAULT_GSC_SITE_URL)?.siteUrl ??
    sites.find((site) => site.siteUrl.includes("jdstudiohk.com") && site.siteUrl.startsWith("https://"))?.siteUrl ??
    DEFAULT_GSC_SITE_URL
  );
}

export async function getGrowthPriorities(days = 28) {
  const safeDays = Math.max(14, Math.min(90, days));
  const endDate = dateInHkt(1);
  const startDate = dateInHkt(safeDays);
  const since = new Date(`${startDate}T00:00:00.000Z`);
  const db = await getDb();

  const acceptedRevenuePromise = db
    ? db
        .select({
          serviceType: quotes.serviceType,
          acceptedCount: sql<number>`COUNT(*)`,
          acceptedRevenueHKD: sql<number>`COALESCE(SUM(${quotes.total}), 0)`,
        })
        .from(quotes)
        .where(and(eq(quotes.status, "accepted"), gte(quotes.createdAt, since)))
        .groupBy(quotes.serviceType)
    : Promise.resolve([] as Array<{ serviceType: string; acceptedCount: number; acceptedRevenueHKD: number }>);

  const adsPromise = fetchKeywordQualityScores(safeDays, 150)
    .then((keywords) => ({ available: true as const, keywords, error: null }))
    .catch((error: unknown) => ({ available: false as const, keywords: [] as GoogleAdsKeywordQuality[], error: error instanceof Error ? error.message : String(error) }));

  const gscPromise = (async () => {
    try {
      const siteUrl = await chooseGscSiteUrl();
      const previousStartDate = dateInHkt(safeDays * 2);
      const previousEndDate = dateInHkt(safeDays + 1);
      const [pageRows, queryRows, queryPageRows, previousQueryRows] = await Promise.all([
        queryGscSearchAnalytics({ siteUrl, startDate, endDate, dimensions: ["page"], rowLimit: 1_000 }),
        queryGscSearchAnalytics({ siteUrl, startDate, endDate, dimensions: ["query"], rowLimit: 1_000 }),
        queryGscSearchAnalytics({ siteUrl, startDate, endDate, dimensions: ["query", "page"], rowLimit: 5_000 }),
        queryGscSearchAnalytics({ siteUrl, startDate: previousStartDate, endDate: previousEndDate, dimensions: ["query"], rowLimit: 1_000 }),
      ]);
      return { available: true as const, siteUrl, pageRows, queryRows, queryPageRows, previousQueryRows, error: null };
    } catch (error: unknown) {
      return {
        available: false as const,
        siteUrl: DEFAULT_GSC_SITE_URL,
        pageRows: [] as GscSearchAnalyticsRow[],
        queryRows: [] as GscSearchAnalyticsRow[],
        queryPageRows: [] as GscSearchAnalyticsRow[],
        previousQueryRows: [] as GscSearchAnalyticsRow[],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  })();

  const [acceptedRevenueRows, ads, gsc, aeoRows] = await Promise.all([
    acceptedRevenuePromise,
    adsPromise,
    gscPromise,
    Promise.all(SERVICE_PROFILES.map((profile) => inspectServicePageAeo(profile))),
  ]);

  const revenueByService = new Map(
    acceptedRevenueRows.map((row) => [
      row.serviceType,
      { acceptedCount: safeNumber(row.acceptedCount), acceptedRevenueHKD: safeNumber(row.acceptedRevenueHKD) },
    ])
  );

  const draftInputs: ServicePriorityInput[] = SERVICE_PROFILES.map((profile, index) => {
    const revenue = profile.serviceTypes.reduce(
      (total, serviceType) => {
        const row = revenueByService.get(serviceType);
        return {
          acceptedCount: total.acceptedCount + (row?.acceptedCount ?? 0),
          acceptedRevenueHKD: total.acceptedRevenueHKD + (row?.acceptedRevenueHKD ?? 0),
        };
      },
      { acceptedCount: 0, acceptedRevenueHKD: 0 }
    );

    const pageRows = gsc.pageRows.filter((row) => row.keys?.[0]?.includes(profile.path));
    const queryRows = gsc.queryRows.filter((row) => matchingProfile(row.keys?.[0] ?? "", profile));
    // Page rows are the most reliable signal for the service page. Query rows
    // are only a fallback when the property does not yet report that URL.
    // Combining the two would double-count the same impressions and clicks.
    const combinedOrganic = gscSummary(pageRows.length > 0 ? pageRows : queryRows);

    return {
      id: profile.id,
      label: profile.label,
      path: profile.path,
      acceptedCount: revenue.acceptedCount,
      acceptedRevenueHKD: round(revenue.acceptedRevenueHKD, 2),
      maxAcceptedRevenueHKD: 0,
      ads: adsSummary(ads.keywords, profile),
      organic: combinedOrganic,
      aeo: aeoRows[index],
    };
  });

  const maxAcceptedRevenueHKD = Math.max(0, ...draftInputs.map((row) => row.acceptedRevenueHKD));
  const priorities = draftInputs
    .map((row) => scoreServicePriority({ ...row, maxAcceptedRevenueHKD }))
    .sort((a, b) => b.score - a.score);

  const aeoByService = new Map(SERVICE_PROFILES.map((profile, index) => [profile.id, aeoRows[index]]));
  const sortedCandidateRows = gsc.queryRows
    .map((row) => {
      const query = String(row.keys?.[0] ?? "").trim();
      const profile = queryProfile(query);
      return { row, query, profile };
    })
    .filter(({ row, query, profile }) => {
      const position = row.position == null ? null : safeNumber(row.position);
      return Boolean(
        profile &&
        query &&
        isCommercialHongKongQuery(query) &&
        safeNumber(row.impressions) > 0 &&
        position != null &&
        position > 10
      );
    })
    .sort((a, b) => {
      const aPosition = safeNumber(a.row.position);
      const bPosition = safeNumber(b.row.position);
      const aPageTwoBoost = aPosition <= 20 ? 1_000 : 0;
      const bPageTwoBoost = bPosition <= 20 ? 1_000 : 0;
      return bPageTwoBoost + safeNumber(b.row.impressions) - (aPageTwoBoost + safeNumber(a.row.impressions));
    });
  const seenIntents = new Set<string>();
  const candidateRows = sortedCandidateRows
    .filter(({ query, profile }) => {
      const key = `${profile?.id}:${canonicalQueryIntent(query)}`;
      if (seenIntents.has(key)) return false;
      seenIntents.add(key);
      return true;
    })
    .slice(0, 10);

  const ahrefs = await fetchAhrefsSnapshot(candidateRows.map(({ query }) => query));
  const revenueByProfile = new Map(
    draftInputs.map((input) => [input.id, { acceptedCount: input.acceptedCount, acceptedRevenueHKD: input.acceptedRevenueHKD }])
  );
  const backlog: QueryBacklogItem[] = candidateRows.map(({ row, query, profile }) => {
    const service = profile!;
    const organic = gscSummary([row]);
    const previousRow = gsc.previousQueryRows.find((candidate) => String(candidate.keys?.[0] ?? "").trim().toLowerCase() === query.toLowerCase());
    const previousOrganic = gscSummary(previousRow ? [previousRow] : []);
    const positionTrend = gscPositionTrend(organic.position, previousOrganic.position);
    const adsForService = adsSummary(ads.keywords, service);
    const revenue = revenueByProfile.get(service.id) ?? { acceptedCount: 0, acceptedRevenueHKD: 0 };
    const aeo = aeoByService.get(service.id) ?? {
      status: "unavailable" as const,
      httpStatus: null,
      hasFaqPage: false,
      hasService: false,
      hasOffer: false,
      hasDefinition: false,
      hasContactCta: false,
    };
    const metric = ahrefs.metrics.get(normalizedKeyword(query));
    const competitors = ahrefs.competitors.get(normalizedKeyword(query)) ?? [];
    const top3MedianReferringDomains = median(
      competitors.map((competitor) => competitor.referringDomains).filter((value): value is number => value != null)
    );
    const breakdown = backlogScore({
      revenue: revenue.acceptedRevenueHKD,
      maxRevenue: maxAcceptedRevenueHKD,
      ads: adsForService,
      organic,
      aeo,
      difficulty: metric?.difficulty ?? null,
    });

    const content: string[] = [];
    if (organic.position != null && organic.position <= 20) content.push("把此 query 放入目標頁的 H2、首段答案及報價／服務 FAQ，保留自然語句。");
    else content.push("建立或擴寫對應的商業問題段落、服務流程、價錢／報價 FAQ 及實際案例。");
    if (!aeo.hasFaqPage) content.push("補上可見 FAQ 與 FAQPage JSON-LD，優先回答香港客戶的服務範圍、報價及交付問題。");
    if (!aeo.hasOffer) content.push("補足 Offer／OfferCatalog 結構化資料及可見的服務範圍與報價 CTA。");
    if (metric?.serpFeatures.includes("local_pack")) content.push("SERP 有本地圖包：補強一致的香港本地實體、服務區與案例佐證。");
    if (metric?.serpFeatures.includes("ai_overview")) content.push("SERP 有 AI Overview：加入可引用的定義、流程、數字與精簡問答。");

    const actions = [
      `目標頁：${service.path}`,
      organic.position != null && organic.position <= 20
        ? "先更新現有服務頁，不急於新建相近頁面，避免關鍵字互相競爭。"
        : "評估以現有服務頁為主，必要時再新增支援內容頁並以內鏈導回服務頁。",
      ads.available && adsForService.keywordCount > 0
        ? "用 Ads 關鍵字與 RSA 用語核對此頁的主標題、CTA 與服務意圖是否完全一致。"
        : "等待 Google Ads 權限恢復後，自動補入 CPC、QS 與商業意圖訊號。",
    ];

    const sourceCount = [
      revenue.acceptedRevenueHKD > 0 || revenue.acceptedCount > 0,
      ads.available,
      gsc.available,
      aeo.status !== "unavailable",
      ahrefs.available && metric != null,
    ].filter(Boolean).length;
    const confidence: QueryBacklogItem["confidence"] =
      sourceCount >= 4 ? "high" : sourceCount >= 2 ? "medium" : "limited";
    const commercialSignal: QueryBacklogItem["ads"]["commercialSignal"] =
      ads.available ? "available" : "unavailable";

    return {
      id: `${service.id}:${normalizedKeyword(query)}`,
      query,
      serviceLabel: service.label,
      targetPath: service.path,
      targetUrl: `https://www.jdstudiohk.com${service.path}`,
      score: breakdown.total,
      confidence,
      organic: { ...organic, previousPosition: previousOrganic.position, positionChange: positionTrend.change, positionTrend: positionTrend.trend },
      ads: { ...adsForService, commercialSignal },
      revenue,
      aeo,
      ahrefs: {
        available: ahrefs.available && metric != null,
        difficulty: metric?.difficulty ?? null,
        volume: metric?.volume ?? null,
        trafficPotential: metric?.trafficPotential ?? null,
        intents: metric?.intents ?? [],
        serpFeatures: metric?.serpFeatures ?? [],
        competitors,
        top3MedianReferringDomains,
      },
      gaps: {
        content,
        internalLinks: `由首頁、相關服務頁及至少一個相符 portfolio／案例頁，以描述性錨文字連至 ${service.path}。`,
        authority: ahrefs.available
          ? top3MedianReferringDomains != null
            ? `Top 3 競爭頁的 referring domains 中位數：${top3MedianReferringDomains}。優先爭取本地商業、供應商、案例合作或媒體提及。`
            : "Ahrefs 未提供足夠競爭頁外鏈資料；先比較 SERP 首頁的頁面類型與本地權威訊號。"
          : "Ahrefs 恢復後會自動補入競爭頁與 referring-domain 缺口。",
      },
      expectedTime: expectedTime(organic.position, metric?.difficulty ?? null),
      actions,
      breakdown: {
        businessValue: breakdown.businessValue,
        paidIntent: breakdown.paidIntent,
        organicOpportunity: breakdown.organicOpportunity,
        aeoGap: breakdown.aeoGap,
        ahrefsFeasibility: breakdown.ahrefsFeasibility,
      },
    };
  }).sort((a, b) => b.score - a.score);

  return {
    generatedAt: new Date().toISOString(),
    window: { days: safeDays, startDate, endDate },
    sources: {
      revenue: { available: Boolean(db), acceptedStatuses: ["accepted"] },
      googleAds: { available: ads.available, error: ads.error },
      googleSearchConsole: { available: gsc.available, siteUrl: gsc.siteUrl, error: gsc.error },
      livePageAudit: { available: aeoRows.some((row) => row.status !== "unavailable") },
      ahrefs: { available: ahrefs.available, error: ahrefs.error, cached: ahrefs.cached, cacheHours: 24 },
    },
    methodology: {
      scoreOutOf: 100,
      components: [
        { label: "已接受報價收入", max: 40, meaning: "近窗已接受收入越高，優先度越高" },
        { label: "Ads 摩擦", max: 25, meaning: "已有花費且 QS／落地頁相關性出現缺口" },
        { label: "自然搜尋機會", max: 25, meaning: "已有曝光但尚未穩定在第一頁" },
        { label: "AEO 頁面缺口", max: 10, meaning: "FAQ、Service、Offer、可見定義與 CTA 未齊" },
      ],
    },
    priorities,
    backlog,
    backlogDefinition: {
      limit: 10,
      selection: "GSC 有曝光、商業＋香港服務意圖且平均位置大於 10 的 query；以接近第一頁、曝光和可執行性排序。",
      automaticRefresh: "頁面開啟時會重新讀取可用來源；Google Ads 與 Ahrefs 連線恢復時會自動補齊分數。Ahrefs 成功結果快取 24 小時；失敗只快取 5 分鐘，避免重複 API 呼叫。",
    },
  };
}
