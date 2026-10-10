import { and, desc, eq, gte, lte, sql, isNotNull } from "drizzle-orm";
import { getDb, getFollowUpSettings } from "./db";
import { adSyncLogs, quoteFollowUps, quotes } from "../drizzle/schema";
import { buildTrustedServiceNegativeQueue } from "@shared/adsActionQueue";
import {
  adsActionLight,
  adsDataLight,
  completionRate,
  followUpLight,
  metricDelta,
  quotesLight,
  rollingWeekWindows,
  type CockpitLight,
  type MetricDelta,
  type WeekWindow,
} from "@shared/growthCockpit";
import { runGoogleAdsGaql } from "./googleAds";

export type AdsWeekMetrics = {
  spendHKD: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number | null;
  cpc: number | null;
  cpa: number | null;
  searchImpressionShare: number | null;
};

export type GrowthCockpitPayload = {
  generatedAt: string;
  windows: { thisWeek: WeekWindow; lastWeek: WeekWindow };
  lights: CockpitLight[];
  quotesWow: {
    created: MetricDelta;
    accepted: MetricDelta;
    revenueHKD: MetricDelta;
  };
  adsWow: {
    available: boolean;
    error: string | null;
    spendHKD: MetricDelta;
    clicks: MetricDelta;
    conversions: MetricDelta;
    ctr: MetricDelta;
    cpc: MetricDelta;
    cpa: MetricDelta;
    searchImpressionShare: MetricDelta;
    thisWeek: AdsWeekMetrics;
    lastWeek: AdsWeekMetrics;
  };
  followUp: {
    enabled: boolean;
    pending: number;
    sent7d: number;
    replied7d: number;
    completionPct: number | null;
    recentPending: Array<{
      id: number;
      toEmail: string;
      toName: string | null;
      subject: string;
      sentAt: string;
      status: string;
    }>;
  };
  adsActions: {
    trustedTotal: number;
    pendingTrusted: number;
    executed7d: number;
    failed7d: number;
    blocked7d: number;
    completionPct: number | null;
    recentLogs: Array<{
      actionId: string;
      state: string;
      message: string;
      syncedAt: string;
    }>;
  };
  modules: Array<{ id: string; label: string; href: string; blurb: string }>;
};

function emptyAdsMetrics(): AdsWeekMetrics {
  return {
    spendHKD: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    ctr: null,
    cpc: null,
    cpa: null,
    searchImpressionShare: null,
  };
}

function finalizeAdsMetrics(partial: {
  spendHKD: number;
  impressions: number;
  clicks: number;
  conversions: number;
  isWeightedSum: number;
  isWeight: number;
}): AdsWeekMetrics {
  const ctr = partial.impressions > 0 ? Math.round((partial.clicks / partial.impressions) * 10000) / 100 : null;
  const cpc = partial.clicks > 0 ? Math.round((partial.spendHKD / partial.clicks) * 100) / 100 : null;
  const cpa = partial.conversions > 0 ? Math.round((partial.spendHKD / partial.conversions) * 100) / 100 : null;
  const searchImpressionShare =
    partial.isWeight > 0 ? Math.round((partial.isWeightedSum / partial.isWeight) * 1000) / 10 : null;
  return {
    spendHKD: Math.round(partial.spendHKD * 100) / 100,
    impressions: partial.impressions,
    clicks: partial.clicks,
    conversions: Math.round(partial.conversions * 100) / 100,
    ctr,
    cpc,
    cpa,
    searchImpressionShare,
  };
}

async function fetchAdsWindows(
  thisWeek: WeekWindow,
  lastWeek: WeekWindow
): Promise<{ available: boolean; error: string | null; thisWeek: AdsWeekMetrics; lastWeek: AdsWeekMetrics }> {
  try {
    const query = `
      SELECT
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.search_impression_share
      FROM customer
      WHERE segments.date BETWEEN '${lastWeek.startDate}' AND '${thisWeek.endDate}'
    `;
    const rows = await runGoogleAdsGaql(query);
    const buckets = {
      this: { spendHKD: 0, impressions: 0, clicks: 0, conversions: 0, isWeightedSum: 0, isWeight: 0 },
      last: { spendHKD: 0, impressions: 0, clicks: 0, conversions: 0, isWeightedSum: 0, isWeight: 0 },
    };

    for (const row of rows) {
      const date = String(row.segments?.date ?? "");
      if (!date) continue;
      const spendHKD = Number(row.metrics?.costMicros ?? row.metrics?.cost_micros ?? 0) / 1_000_000;
      const impressions = Number(row.metrics?.impressions ?? 0);
      const clicks = Number(row.metrics?.clicks ?? 0);
      const conversions = Number(row.metrics?.conversions ?? 0);
      const isRaw = row.metrics?.searchImpressionShare ?? row.metrics?.search_impression_share;
      const is = isRaw == null ? null : Number(isRaw);

      const bucket =
        date >= thisWeek.startDate && date <= thisWeek.endDate
          ? buckets.this
          : date >= lastWeek.startDate && date <= lastWeek.endDate
            ? buckets.last
            : null;
      if (!bucket) continue;

      bucket.spendHKD += spendHKD;
      bucket.impressions += impressions;
      bucket.clicks += clicks;
      bucket.conversions += conversions;
      if (is != null && Number.isFinite(is) && impressions > 0) {
        bucket.isWeightedSum += is * 100 * impressions;
        bucket.isWeight += impressions;
      }
    }

    return {
      available: true,
      error: null,
      thisWeek: finalizeAdsMetrics(buckets.this),
      lastWeek: finalizeAdsMetrics(buckets.last),
    };
  } catch (error: unknown) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
      thisWeek: emptyAdsMetrics(),
      lastWeek: emptyAdsMetrics(),
    };
  }
}

async function quoteWindowStats(startDate: string, endDate: string) {
  const db = await getDb();
  if (!db) return { created: 0, accepted: 0, revenueHKD: 0 };

  const start = new Date(`${startDate}T00:00:00+08:00`);
  const end = new Date(`${endDate}T23:59:59.999+08:00`);

  const [createdRow, acceptedRow] = await Promise.all([
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(quotes)
      .where(and(gte(quotes.createdAt, start), lte(quotes.createdAt, end))),
    db
      .select({
        count: sql<number>`COUNT(*)`,
        total: sql<number>`COALESCE(SUM(${quotes.total}), 0)`,
      })
      .from(quotes)
      .where(
        and(
          eq(quotes.status, "accepted"),
          gte(quotes.createdAt, start),
          lte(quotes.createdAt, end)
        )
      ),
  ]);

  return {
    created: Number(createdRow[0]?.count ?? 0),
    accepted: Number(acceptedRow[0]?.count ?? 0),
    revenueHKD: Number(acceptedRow[0]?.total ?? 0),
  };
}

async function followUpSnapshot(thisWeekStart: string) {
  const db = await getDb();
  const settings = await getFollowUpSettings();
  const enabled = Boolean(settings?.enabled ?? true);

  if (!db) {
    return {
      enabled,
      pending: 0,
      sent7d: 0,
      replied7d: 0,
      recentPending: [] as GrowthCockpitPayload["followUp"]["recentPending"],
    };
  }

  const since = new Date(`${thisWeekStart}T00:00:00+08:00`);
  const [pendingRow, sentRow, repliedRow, pendingList] = await Promise.all([
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(quoteFollowUps)
      .where(eq(quoteFollowUps.status, "pending")),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(quoteFollowUps)
      .where(
        and(
          eq(quoteFollowUps.status, "sent"),
          isNotNull(quoteFollowUps.followUpSentAt),
          gte(quoteFollowUps.followUpSentAt, since)
        )
      ),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(quoteFollowUps)
      .where(and(eq(quoteFollowUps.status, "replied"), gte(quoteFollowUps.repliedAt, since))),
    db
      .select({
        id: quoteFollowUps.id,
        toEmail: quoteFollowUps.toEmail,
        toName: quoteFollowUps.toName,
        subject: quoteFollowUps.subject,
        sentAt: quoteFollowUps.sentAt,
        status: quoteFollowUps.status,
      })
      .from(quoteFollowUps)
      .where(eq(quoteFollowUps.status, "pending"))
      .orderBy(desc(quoteFollowUps.sentAt))
      .limit(8),
  ]);

  return {
    enabled,
    pending: Number(pendingRow[0]?.count ?? 0),
    sent7d: Number(sentRow[0]?.count ?? 0),
    replied7d: Number(repliedRow[0]?.count ?? 0),
    recentPending: pendingList.map((row) => ({
      id: row.id,
      toEmail: row.toEmail,
      toName: row.toName,
      subject: row.subject,
      sentAt: row.sentAt instanceof Date ? row.sentAt.toISOString() : String(row.sentAt),
      status: row.status,
    })),
  };
}

async function adsActionSnapshot(thisWeekStart: string) {
  const db = await getDb();
  const trusted = buildTrustedServiceNegativeQueue();

  let executed7d = 0;
  let failed7d = 0;
  let blocked7d = 0;
  const completedTrusted = new Set<string>();
  const recentLogs: GrowthCockpitPayload["adsActions"]["recentLogs"] = [];

  if (db) {
    const since = new Date(`${thisWeekStart}T00:00:00+08:00`);
    const rows = await db
      .select({
        message: adSyncLogs.message,
        status: adSyncLogs.status,
        syncedAt: adSyncLogs.syncedAt,
      })
      .from(adSyncLogs)
      .where(eq(adSyncLogs.platform, "google_ads"))
      .orderBy(desc(adSyncLogs.syncedAt))
      .limit(200);

    type LogPayload = { actionId?: string; state?: string; message?: string };
    for (const row of rows) {
      let payload: LogPayload | null = null;
      try {
        payload = row.message ? (JSON.parse(row.message) as LogPayload) : null;
      } catch {
        continue;
      }
      const actionId = payload?.actionId;
      const state = payload?.state;
      if (!actionId || !state) continue;

      if (state === "executed") completedTrusted.add(actionId);

      const syncedAt = row.syncedAt instanceof Date ? row.syncedAt : new Date(row.syncedAt);
      if (syncedAt >= since) {
        if (state === "executed") executed7d += 1;
        else if (state === "failed") failed7d += 1;
        else if (state === "blocked") blocked7d += 1;
      }

      if (recentLogs.length < 8) {
        recentLogs.push({
          actionId,
          state,
          message: payload?.message ?? "",
          syncedAt: syncedAt.toISOString(),
        });
      }
    }
  }

  const pendingTrusted = trusted.filter((item) => !completedTrusted.has(item.id)).length;
  const trustedTotal = trusted.length;
  const doneTrusted = trustedTotal - pendingTrusted;

  return {
    trustedTotal,
    pendingTrusted,
    executed7d,
    failed7d,
    blocked7d,
    completionPct: completionRate(doneTrusted, trustedTotal),
    recentLogs,
  };
}

export async function getGrowthCockpit(): Promise<GrowthCockpitPayload> {
  const windows = rollingWeekWindows();
  const [thisQuotes, lastQuotes, ads, followUp, adsActions] = await Promise.all([
    quoteWindowStats(windows.thisWeek.startDate, windows.thisWeek.endDate),
    quoteWindowStats(windows.lastWeek.startDate, windows.lastWeek.endDate),
    fetchAdsWindows(windows.thisWeek, windows.lastWeek),
    followUpSnapshot(windows.thisWeek.startDate),
    adsActionSnapshot(windows.thisWeek.startDate),
  ]);

  const quotesWow = {
    created: metricDelta(thisQuotes.created, lastQuotes.created),
    accepted: metricDelta(thisQuotes.accepted, lastQuotes.accepted),
    revenueHKD: metricDelta(thisQuotes.revenueHKD, lastQuotes.revenueHKD),
  };

  const adsWow = {
    available: ads.available,
    error: ads.error,
    spendHKD: metricDelta(ads.thisWeek.spendHKD, ads.lastWeek.spendHKD),
    clicks: metricDelta(ads.thisWeek.clicks, ads.lastWeek.clicks),
    conversions: metricDelta(ads.thisWeek.conversions, ads.lastWeek.conversions),
    ctr: metricDelta(ads.thisWeek.ctr ?? 0, ads.lastWeek.ctr ?? 0),
    cpc: metricDelta(ads.thisWeek.cpc ?? 0, ads.lastWeek.cpc ?? 0),
    cpa: metricDelta(ads.thisWeek.cpa ?? 0, ads.lastWeek.cpa ?? 0),
    searchImpressionShare: metricDelta(
      ads.thisWeek.searchImpressionShare ?? 0,
      ads.lastWeek.searchImpressionShare ?? 0
    ),
    thisWeek: ads.thisWeek,
    lastWeek: ads.lastWeek,
  };

  const lights: CockpitLight[] = [
    quotesLight({ createdDelta: quotesWow.created, acceptedDelta: quotesWow.accepted }),
    adsDataLight({ available: ads.available, error: ads.error }),
    adsActionLight({
      pendingTrusted: adsActions.pendingTrusted,
      executed7d: adsActions.executed7d,
      failed7d: adsActions.failed7d + adsActions.blocked7d,
    }),
    followUpLight({ enabled: followUp.enabled, pending: followUp.pending }),
  ];

  const followUpTouched = followUp.sent7d + followUp.replied7d + followUp.pending;
  const followUpDone = followUp.sent7d + followUp.replied7d;

  return {
    generatedAt: new Date().toISOString(),
    windows,
    lights,
    quotesWow,
    adsWow,
    followUp: {
      ...followUp,
      completionPct: completionRate(followUpDone, followUpTouched),
    },
    adsActions,
    modules: [
      {
        id: "growth-priorities",
        label: "增長優先模型",
        href: "/growth-priorities",
        blurb: "Ads Action Queue、SEO→Ads pipeline、backlog",
      },
      {
        id: "follow-up",
        label: "報價跟進",
        href: "/follow-up",
        blurb: "自動 follow-up 隊列與設定",
      },
      {
        id: "google-ads-quality",
        label: "Google Ads QS",
        href: "/google-ads-quality",
        blurb: "Quality Score／Impression Share",
      },
      {
        id: "ad-expenses",
        label: "廣告開支",
        href: "/ad-expenses",
        blurb: "月度花費與平台報表",
      },
      {
        id: "platform-efficiency",
        label: "平台效益",
        href: "/platform-efficiency",
        blurb: "渠道 ROI 與 AI 分析",
      },
      {
        id: "pricing-learning",
        label: "定價學習",
        href: "/pricing-learning",
        blurb: "成交定價回饋",
      },
    ],
  };
}
