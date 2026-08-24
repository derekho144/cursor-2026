/**
 * Pricing learning analytics over accepted (+ rejected for coverage/backfill).
 * Price mids / suggestions use accepted only; rejected are backfilled for learning features.
 * Accuracy focus: prefer structured fields, trim outliers, time-weight, coverage quality.
 */
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb } from "./db";
import { emailInquiries, quoteItems, quotes } from "../drizzle/schema";
import {
  crewBucketLabel,
  extractCrewHighConfidence,
  extractHoursFromText,
  extractQuoteShootFeatures,
  extractShotCountFromText,
  formatTeamFromStructured,
  hoursBucketLabel,
  summarizeTotals,
  timeWeightedMedian,
  type CrewBucket,
  type HoursBucket,
  type QuoteShootFeatures,
  type ShotCountBucket,
} from "./pricingLearningExtract";
import {
  quotePricingMode,
  shotCountBucketLabel,
  SHOT_COUNT_SERVICE_TYPES,
} from "../shared/quotePricingMode";

const MIN_BUCKET_SAMPLES = 2;

export interface PricingLearningQuoteRow {
  id: number;
  quoteNumber: string;
  clientName: string;
  clientCompany: string | null;
  serviceType: string;
  status: "accepted" | "rejected";
  total: number;
  shootingDate: string | null;
  createdAt: Date | null;
  team: string | null;
  features: QuoteShootFeatures;
  itemSummaries: string[];
  estimatedTotal: number | null;
  accuracyPct: number | null;
  hasStructuredHours: boolean;
  hasStructuredShotCount: boolean;
  hasStructuredCrew: boolean;
}

function bucketStats<T extends string>(
  rows: Array<{ total: number; key: T }>,
  order: T[],
  labelFn: (k: T) => string
) {
  return order.map((key) => {
    const totals = rows.filter((r) => r.key === key).map((r) => r.total);
    const s = summarizeTotals(totals);
    return {
      key,
      label: labelFn(key),
      ...s,
      reliable: s.count >= MIN_BUCKET_SAMPLES,
    };
  });
}

async function loadLearningQuotesWithItems(opts?: {
  serviceType?: string;
  limit?: number;
  /** Default: accepted + rejected (both useful for price learning). */
  statuses?: Array<"accepted" | "rejected">;
}) {
  const db = await getDb();
  if (!db) return [];

  const statuses = opts?.statuses ?? (["accepted", "rejected"] as const);
  const conditions = [
    inArray(quotes.status, statuses as any),
    sql`CAST(${quotes.total} AS DECIMAL(12,2)) > 0`,
  ];
  if (opts?.serviceType) {
    conditions.push(eq(quotes.serviceType, opts.serviceType as any));
  }

  const qRows = await db
    .select({
      id: quotes.id,
      quoteNumber: quotes.quoteNumber,
      clientName: quotes.clientName,
      clientCompany: quotes.clientCompany,
      serviceType: quotes.serviceType,
      status: quotes.status,
      total: quotes.total,
      shootingDate: quotes.shootingDate,
      createdAt: quotes.createdAt,
      team: quotes.team,
      notes: quotes.notes,
      equipment: quotes.equipment,
      emailInquiryId: quotes.emailInquiryId,
      shootHours: quotes.shootHours,
      shotCount: quotes.shotCount,
      crewPhotographers: quotes.crewPhotographers,
      crewAssistants: quotes.crewAssistants,
      crewVideographers: quotes.crewVideographers,
      crewOthers: quotes.crewOthers,
    })
    .from(quotes)
    .where(and(...conditions))
    .orderBy(desc(quotes.createdAt))
    .limit(opts?.limit ?? 3000);

  if (qRows.length === 0) return [];

  const ids = qRows.map((q) => q.id);
  const items = await db
    .select({
      quoteId: quoteItems.quoteId,
      description: quoteItems.description,
      quantity: quoteItems.quantity,
      unitPrice: quoteItems.unitPrice,
      amount: quoteItems.amount,
    })
    .from(quoteItems)
    .where(inArray(quoteItems.quoteId, ids));

  const itemsByQuote = new Map<number, typeof items>();
  for (const it of items) {
    const list = itemsByQuote.get(it.quoteId) ?? [];
    list.push(it);
    itemsByQuote.set(it.quoteId, list);
  }

  const inquiryIds = qRows
    .map((q) => q.emailInquiryId)
    .filter((id): id is number => id != null);
  const estimateByInquiry = new Map<number, number>();
  if (inquiryIds.length > 0) {
    const inqRows = await db
      .select({
        id: emailInquiries.id,
        estimatedTotal: emailInquiries.estimatedTotal,
      })
      .from(emailInquiries)
      .where(inArray(emailInquiries.id, inquiryIds));
    for (const row of inqRows) {
      const n = Number(row.estimatedTotal);
      if (Number.isFinite(n) && n > 0) estimateByInquiry.set(row.id, n);
    }
  }

  return qRows.map((q) => {
    const qItems = itemsByQuote.get(q.id) ?? [];
    const total = Number(q.total);
    const features = extractQuoteShootFeatures({
      shootHours: q.shootHours,
      shotCount: q.shotCount,
      crewPhotographers: q.crewPhotographers,
      crewAssistants: q.crewAssistants,
      crewVideographers: q.crewVideographers,
      crewOthers: q.crewOthers,
      team: q.team,
      notes: q.notes,
      equipment: q.equipment,
      items: qItems,
      total,
    });
    const estimatedTotal =
      q.emailInquiryId != null
        ? estimateByInquiry.get(q.emailInquiryId) ?? null
        : null;
    const accuracyPct =
      estimatedTotal != null && estimatedTotal > 0 && total > 0
        ? Math.round(((total - estimatedTotal) / estimatedTotal) * 1000) / 10
        : null;

    const hasStructuredHours =
      q.shootHours != null && Number(q.shootHours) > 0;
    const hasStructuredShotCount =
      q.shotCount != null && Number(q.shotCount) > 0;
    const hasStructuredCrew =
      (q.crewPhotographers ?? 0) +
        (q.crewAssistants ?? 0) +
        (q.crewVideographers ?? 0) +
        (q.crewOthers ?? 0) >
      0;

    const status =
      q.status === "rejected" ? ("rejected" as const) : ("accepted" as const);

    return {
      id: q.id,
      quoteNumber: q.quoteNumber,
      clientName: q.clientName,
      clientCompany: q.clientCompany,
      serviceType: q.serviceType,
      status,
      total,
      shootingDate: q.shootingDate,
      createdAt: q.createdAt,
      team: q.team,
      features,
      itemSummaries: qItems
        .slice(0, 4)
        .map(
          (i) =>
            `${i.description} ×${Number(i.quantity)} @ ${Number(i.unitPrice)}`
        ),
      estimatedTotal,
      accuracyPct,
      hasStructuredHours,
      hasStructuredShotCount,
      hasStructuredCrew,
    } satisfies PricingLearningQuoteRow;
  });
}

export async function getPricingLearningOverview() {
  const allRows = await loadLearningQuotesWithItems({
    limit: 3000,
    statuses: ["accepted", "rejected"],
  });
  /** Winning prices only — rejected totals must not skew mid/avg. */
  const rows = allRows.filter((r) => r.status === "accepted");
  const rejectedCount = allRows.filter((r) => r.status === "rejected").length;
  const byTypeMap = new Map<string, number[]>();
  for (const r of rows) {
    const list = byTypeMap.get(r.serviceType) ?? [];
    list.push(r.total);
    byTypeMap.set(r.serviceType, list);
  }

  const byServiceType = Array.from(byTypeMap.entries())
    .map(([serviceType, totals]) => {
      const typeRows = rows.filter((r) => r.serviceType === serviceType);
      return {
        serviceType,
        ...summarizeTotals(totals),
        withHours: typeRows.filter((r) => r.features.hoursBucket !== "unknown")
          .length,
        withCrew: typeRows.filter((r) => r.features.crewBucket !== "unknown")
          .length,
        withShots: typeRows.filter(
          (r) => r.features.shotCountBucket !== "unknown"
        ).length,
        withStructuredHours: typeRows.filter((r) => r.hasStructuredHours).length,
        withStructuredCrew: typeRows.filter((r) => r.hasStructuredCrew).length,
        withStructuredShots: typeRows.filter((r) => r.hasStructuredShotCount)
          .length,
        pricingMode: quotePricingMode(serviceType),
        recentWeightedMid: timeWeightedMedian(
          typeRows.map((r) => ({
            value: r.total,
            at: r.shootingDate || r.createdAt,
          }))
        ),
      };
    })
    .sort((a, b) => b.count - a.count);

  const hoursOrder: HoursBucket[] = ["lte_2", "h2_4", "h4_8", "gt_8", "unknown"];
  const crewOrder: CrewBucket[] = ["solo", "pair", "team", "unknown"];
  const shotOrder: ShotCountBucket[] = [
    "lte_10",
    "n11_20",
    "n21_50",
    "gt_50",
    "unknown",
  ];

  const hoursBuckets = bucketStats(
    rows.map((r) => ({ total: r.total, key: r.features.hoursBucket })),
    hoursOrder,
    hoursBucketLabel
  );
  const crewBuckets = bucketStats(
    rows.map((r) => ({ total: r.total, key: r.features.crewBucket })),
    crewOrder,
    crewBucketLabel
  );
  const shotBuckets = bucketStats(
    rows
      .filter((r) => SHOT_COUNT_SERVICE_TYPES.has(r.serviceType))
      .map((r) => ({ total: r.total, key: r.features.shotCountBucket })),
    shotOrder,
    shotCountBucketLabel
  );

  const withHoursRows = rows.filter((r) => r.features.hours != null && r.features.hours > 0);
  const pricePerHourStats = summarizeTotals(
    withHoursRows
      .map((r) => r.features.pricePerHour)
      .filter((n): n is number => n != null && n > 0)
  );
  const withShotRows = rows.filter(
    (r) => r.features.shotCount != null && r.features.shotCount > 0
  );
  const pricePerShotStats = summarizeTotals(
    withShotRows
      .map((r) => r.features.pricePerShot)
      .filter((n): n is number => n != null && n > 0)
  );

  const paired = rows.filter((r) => r.estimatedTotal != null && r.accuracyPct != null);
  const absErr = paired.map((r) => Math.abs(r.accuracyPct!));
  const aiAccuracy =
    paired.length === 0
      ? null
      : {
          pairedCount: paired.length,
          avgAbsErrorPct: Math.round(
            (absErr.reduce((a, b) => a + b, 0) / absErr.length) * 10
          ) / 10,
          within15Pct: paired.filter((r) => Math.abs(r.accuracyPct!) <= 15).length,
          within30Pct: paired.filter((r) => Math.abs(r.accuracyPct!) <= 30).length,
        };

  const incomplete = allRows
    .filter((r) => {
      const mode = quotePricingMode(r.serviceType);
      if (mode === "shot_count") return r.features.shotCountBucket === "unknown";
      if (mode === "time_crew") {
        return (
          r.features.hoursBucket === "unknown" ||
          r.features.crewBucket === "unknown"
        );
      }
      return false;
    })
    .slice(0, 40)
    .map((r) => ({
      id: r.id,
      quoteNumber: r.quoteNumber,
      clientName: r.clientCompany || r.clientName,
      serviceType: r.serviceType,
      status: r.status,
      total: r.total,
      missingHours:
        quotePricingMode(r.serviceType) === "time_crew" &&
        r.features.hoursBucket === "unknown",
      missingCrew:
        quotePricingMode(r.serviceType) === "time_crew" &&
        r.features.crewBucket === "unknown",
      missingShots:
        quotePricingMode(r.serviceType) === "shot_count" &&
        r.features.shotCountBucket === "unknown",
      hoursSource: r.features.hoursSource,
      crewSource: r.features.crewSource,
      shotCountSource: r.features.shotCountSource,
    }));

  const structuredBoth = rows.filter((r) => {
    const mode = quotePricingMode(r.serviceType);
    if (mode === "shot_count") return r.hasStructuredShotCount;
    if (mode === "time_crew") return r.hasStructuredHours && r.hasStructuredCrew;
    return false;
  }).length;
  const textOnlyHours = rows.filter(
    (r) =>
      !r.hasStructuredHours &&
      r.features.hoursBucket !== "unknown" &&
      r.features.hoursSource !== "structured"
  ).length;
  const textOnlyCrew = rows.filter(
    (r) =>
      !r.hasStructuredCrew &&
      r.features.crewBucket !== "unknown" &&
      r.features.crewSource !== "structured"
  ).length;

  const incompleteAccepted = incomplete.filter((r) => r.status === "accepted")
    .length;
  const incompleteRejected = incomplete.filter((r) => r.status === "rejected")
    .length;

  return {
    generatedAt: new Date().toISOString(),
    acceptedCount: rows.length,
    rejectedCount,
    coverage: {
      withHours: rows.filter((r) => r.features.hoursBucket !== "unknown").length,
      withCrew: rows.filter((r) => r.features.crewBucket !== "unknown").length,
      withShots: rows.filter((r) => r.features.shotCountBucket !== "unknown")
        .length,
      withBothFundamentals: rows.filter((r) => {
        const mode = quotePricingMode(r.serviceType);
        if (mode === "shot_count") return r.features.shotCountBucket !== "unknown";
        if (mode === "time_crew") {
          return (
            r.features.hoursBucket !== "unknown" &&
            r.features.crewBucket !== "unknown"
          );
        }
        return true;
      }).length,
      withStructuredHours: rows.filter((r) => r.hasStructuredHours).length,
      withStructuredCrew: rows.filter((r) => r.hasStructuredCrew).length,
      withStructuredShots: rows.filter((r) => r.hasStructuredShotCount).length,
      withStructuredBoth: structuredBoth,
      textOnlyHours,
      textOnlyCrew,
      withAiPair: paired.length,
      incompleteCount: incomplete.length,
      incompleteAccepted,
      incompleteRejected,
    },
    dataQuality: {
      score:
        rows.length === 0
          ? 0
          : Math.round(
              (rows.filter((r) => {
                const mode = quotePricingMode(r.serviceType);
                if (mode === "shot_count") {
                  return r.features.shotCountBucket !== "unknown";
                }
                if (mode === "time_crew") {
                  return (
                    r.features.hoursBucket !== "unknown" &&
                    r.features.crewBucket !== "unknown"
                  );
                }
                return true;
              }).length /
                rows.length) *
                100
            ),
      tips: [
        "無法保證 100% 自動回填：只會寫入文字／項目裏已有明確訊號嘅欄位（例如「4小時」「Team 1P」「20張」）。",
        "已接受＋已拒絕都會回填結構化欄位；成交中位／建議價仍然只用已接受，避免拒單價拉歪。",
        "產品／食物／珠寶等：填「交付張數」；活動／錄影：填時數同人手。",
        "統計已自動剔除極端離群成交價（IQR），近半年成交權重較高。",
        incomplete.length > 0
          ? `尚有約 ${incompleteAccepted} 筆已接受、${incompleteRejected} 筆已拒絕缺對應基礎資料（見下表）；無訊號嘅要人手補。`
          : "基礎資料覆蓋良好。",
      ],
      incomplete,
    },
    overall: summarizeTotals(rows.map((r) => r.total)),
    overallRecentMid: timeWeightedMedian(
      rows.map((r) => ({ value: r.total, at: r.shootingDate || r.createdAt }))
    ),
    pricePerHour: pricePerHourStats.count > 0 ? pricePerHourStats : null,
    pricePerShot: pricePerShotStats.count > 0 ? pricePerShotStats : null,
    byServiceType,
    hoursBuckets,
    crewBuckets,
    shotBuckets,
    aiAccuracy,
  };
}

export async function getPricingLearningByServiceType(serviceType: string) {
  const allRows = await loadLearningQuotesWithItems({
    serviceType,
    limit: 1000,
    statuses: ["accepted", "rejected"],
  });
  const rows = allRows.filter((r) => r.status === "accepted");
  const rejectedCount = allRows.filter((r) => r.status === "rejected").length;

  const hoursOrder: HoursBucket[] = ["lte_2", "h2_4", "h4_8", "gt_8", "unknown"];
  const crewOrder: CrewBucket[] = ["solo", "pair", "team", "unknown"];

  const hoursBuckets = bucketStats(
    rows.map((r) => ({ total: r.total, key: r.features.hoursBucket })),
    hoursOrder,
    hoursBucketLabel
  );
  const crewBuckets = bucketStats(
    rows.map((r) => ({ total: r.total, key: r.features.crewBucket })),
    crewOrder,
    crewBucketLabel
  );

  const shotOrder: ShotCountBucket[] = [
    "lte_10",
    "n11_20",
    "n21_50",
    "gt_50",
    "unknown",
  ];
  const shotBuckets = bucketStats(
    rows.map((r) => ({ total: r.total, key: r.features.shotCountBucket })),
    shotOrder,
    shotCountBucketLabel
  );

  const withHours = rows.filter((r) => r.features.hours != null && r.features.hours > 0);
  const pricePerHour = summarizeTotals(
    withHours
      .map((r) => r.features.pricePerHour)
      .filter((n): n is number => n != null && n > 0)
  );
  const withShots = rows.filter(
    (r) => r.features.shotCount != null && r.features.shotCount > 0
  );
  const pricePerShot = summarizeTotals(
    withShots
      .map((r) => r.features.pricePerShot)
      .filter((n): n is number => n != null && n > 0)
  );

  const cross: Array<{
    hoursBucket: HoursBucket;
    hoursLabel: string;
    crewBucket: CrewBucket;
    crewLabel: string;
    count: number;
    avg: number;
    p50: number;
    reliable: boolean;
  }> = [];
  for (const hb of hoursOrder) {
    for (const cb of crewOrder) {
      if (hb === "unknown" && cb === "unknown") continue;
      const totals = rows
        .filter(
          (r) =>
            r.features.hoursBucket === hb && r.features.crewBucket === cb
        )
        .map((r) => r.total);
      if (totals.length === 0) continue;
      const s = summarizeTotals(totals);
      cross.push({
        hoursBucket: hb,
        hoursLabel: hoursBucketLabel(hb),
        crewBucket: cb,
        crewLabel: crewBucketLabel(cb),
        count: s.count,
        avg: s.avg,
        p50: s.p50,
        reliable: s.count >= MIN_BUCKET_SAMPLES,
      });
    }
  }
  cross.sort((a, b) => b.count - a.count);

  return {
    serviceType,
    pricingMode: quotePricingMode(serviceType),
    acceptedCount: rows.length,
    rejectedCount,
    summary: summarizeTotals(rows.map((r) => r.total)),
    recentWeightedMid: timeWeightedMedian(
      rows.map((r) => ({ value: r.total, at: r.shootingDate || r.createdAt }))
    ),
    coverage: {
      withHours: rows.filter((r) => r.features.hoursBucket !== "unknown").length,
      withCrew: rows.filter((r) => r.features.crewBucket !== "unknown").length,
      withShots: rows.filter((r) => r.features.shotCountBucket !== "unknown")
        .length,
      withStructuredHours: rows.filter((r) => r.hasStructuredHours).length,
      withStructuredCrew: rows.filter((r) => r.hasStructuredCrew).length,
      withStructuredShots: rows.filter((r) => r.hasStructuredShotCount).length,
    },
    pricePerHour: pricePerHour.count > 0 ? pricePerHour : null,
    pricePerShot: pricePerShot.count > 0 ? pricePerShot : null,
    hoursBuckets,
    crewBuckets,
    shotBuckets,
    cross,
    recent: allRows.slice(0, 40).map((r) => ({
      id: r.id,
      quoteNumber: r.quoteNumber,
      clientName: r.clientCompany || r.clientName,
      status: r.status,
      total: r.total,
      shootingDate: r.shootingDate,
      hours: r.features.hours,
      hoursLabel: hoursBucketLabel(r.features.hoursBucket),
      hoursSource: r.features.hoursSource,
      shotCount: r.features.shotCount,
      shotCountLabel: shotCountBucketLabel(r.features.shotCountBucket),
      shotCountSource: r.features.shotCountSource,
      crewLabel: r.features.crewLabel,
      crewBucket: r.features.crewBucket,
      crewSource: r.features.crewSource,
      pricePerHour: r.features.pricePerHour,
      pricePerShot: r.features.pricePerShot,
      structured:
        r.hasStructuredHours ||
        r.hasStructuredCrew ||
        r.hasStructuredShotCount,
      items: r.itemSummaries,
      estimatedTotal: r.estimatedTotal,
      accuracyPct: r.accuracyPct,
    })),
  };
}

/**
 * Statistical price suggestion from accepted history, filtered by fundamentals.
 * Uses outlier-trimmed stats + prefers structured matches when available.
 */
export async function suggestPriceFromLearning(input: {
  serviceType: string;
  hours?: number | null;
  crewSize?: number | null;
  shotCount?: number | null;
}) {
  const rows = await loadLearningQuotesWithItems({
    serviceType: input.serviceType,
    limit: 1000,
    statuses: ["accepted"],
  });
  const mode = quotePricingMode(input.serviceType);

  const targetHours =
    input.hours != null && input.hours > 0
      ? extractQuoteShootFeatures({
          shootHours: input.hours,
        }).hoursBucket
      : null;
  const targetCrew =
    input.crewSize != null && input.crewSize > 0
      ? ((input.crewSize === 1
          ? "solo"
          : input.crewSize === 2
            ? "pair"
            : "team") as CrewBucket)
      : null;
  const targetShots =
    input.shotCount != null && input.shotCount > 0
      ? extractQuoteShootFeatures({
          shotCount: input.shotCount,
        }).shotCountBucket
      : null;

  let matched = rows;
  if (mode === "shot_count") {
    if (targetShots && targetShots !== "unknown") {
      const filtered = matched.filter(
        (r) => r.features.shotCountBucket === targetShots
      );
      if (filtered.length >= MIN_BUCKET_SAMPLES) matched = filtered;
    }
  } else {
    if (targetHours && targetHours !== "unknown") {
      const filtered = matched.filter(
        (r) => r.features.hoursBucket === targetHours
      );
      if (filtered.length >= MIN_BUCKET_SAMPLES) matched = filtered;
    }
    if (targetCrew && targetCrew !== "unknown") {
      const filtered = matched.filter(
        (r) => r.features.crewBucket === targetCrew
      );
      if (filtered.length >= MIN_BUCKET_SAMPLES) matched = filtered;
    }
  }

  const structuredMatched = matched.filter((r) => {
    if (mode === "shot_count") return r.hasStructuredShotCount;
    return (
      (targetHours == null ||
        targetHours === "unknown" ||
        r.hasStructuredHours) &&
      (targetCrew == null || targetCrew === "unknown" || r.hasStructuredCrew)
    );
  });
  const useRows =
    structuredMatched.length >= MIN_BUCKET_SAMPLES ? structuredMatched : matched;

  const summary = summarizeTotals(useRows.map((r) => r.total));
  const weightedMid = timeWeightedMedian(
    useRows.map((r) => ({ value: r.total, at: r.shootingDate || r.createdAt }))
  );

  const perHourVals = useRows
    .map((r) => r.features.pricePerHour)
    .filter((n): n is number => n != null && n > 0);
  const perHour = summarizeTotals(perHourVals);
  const hoursHint =
    input.hours != null && input.hours > 0 && perHour.count >= MIN_BUCKET_SAMPLES
      ? Math.round(perHour.p50 * input.hours)
      : null;

  const perShotVals = useRows
    .map((r) => r.features.pricePerShot)
    .filter((n): n is number => n != null && n > 0);
  const perShot = summarizeTotals(perShotVals);
  const shotsHint =
    input.shotCount != null &&
    input.shotCount > 0 &&
    perShot.count >= MIN_BUCKET_SAMPLES
      ? Math.round(perShot.p50 * input.shotCount)
      : null;

  return {
    serviceType: input.serviceType,
    pricingMode: mode,
    filters: {
      hours: input.hours ?? null,
      hoursBucket: targetHours,
      crewSize: input.crewSize ?? null,
      crewBucket: targetCrew,
      shotCount: input.shotCount ?? null,
      shotCountBucket: targetShots,
    },
    sampleCount: summary.count,
    preferredStructured: structuredMatched.length >= MIN_BUCKET_SAMPLES,
    suggestion:
      summary.count >= MIN_BUCKET_SAMPLES
        ? {
            low: summary.p25,
            mid: weightedMid ?? summary.p50,
            high: summary.p75,
            avg: summary.avg,
            fromPerHour: hoursHint,
            fromPerShot: shotsHint,
          }
        : null,
    note:
      summary.count < MIN_BUCKET_SAMPLES
        ? mode === "shot_count"
          ? "同類已接受報價樣本不足，建議先用市場價參考，並補齊交付張數。"
          : "同類已接受報價樣本不足，建議先用市場價參考，並補齊時數／人手欄位。"
        : useRows.length < rows.length
          ? `已按${mode === "shot_count" ? "張數" : "時數／人手"}篩選（${structuredMatched.length >= MIN_BUCKET_SAMPLES ? "優先結構化" : "含文字抽取"}），剩餘 ${useRows.length} / ${rows.length} 筆同類成交。`
          : `基於 ${summary.count} 筆「${input.serviceType}」已接受報價（已剔除離群值）。`,
    comparables: useRows.slice(0, 8).map((r) => ({
      id: r.id,
      quoteNumber: r.quoteNumber,
      total: r.total,
      hours: r.features.hours,
      shotCount: r.features.shotCount,
      crewLabel: r.features.crewLabel,
      clientName: r.clientCompany || r.clientName,
      structured:
        r.hasStructuredHours ||
        r.hasStructuredCrew ||
        r.hasStructuredShotCount,
    })),
  };
}

/**
 * Backfill structured fields from high-confidence free-text signals.
 * Targets accepted + rejected quotes. Mode-aware:
 * - shot_count → shotCount only
 * - time_crew → shootHours + crew
 * - design → skip
 *
 * Cannot reach 100% when quotes lack explicit signals in text/items.
 */
export async function backfillStructuredShootFields(opts?: {
  limit?: number;
  dryRun?: boolean;
}) {
  const db = await getDb();
  const emptyReport = {
    updated: 0,
    scanned: 0,
    dryRun: !!opts?.dryRun,
    filled: [] as Array<{
      id: number;
      quoteNumber: string;
      status: string;
      fields: string[];
    }>,
    skippedNoSignal: 0,
    skippedAlreadyComplete: 0,
    skippedDesign: 0,
    skippedDraftOrOther: 0,
    unfillableSample: [] as Array<{
      id: number;
      quoteNumber: string;
      status: string;
      serviceType: string;
      reason: string;
    }>,
    accuracyNote:
      "自動回填只寫入文字／項目裏有明確訊號嘅欄位，無法保證 100% 覆蓋；無訊號嘅報價需人手補齊。",
  };
  if (!db) return emptyReport;

  const limit = opts?.limit ?? 2000;
  const dryRun = !!opts?.dryRun;

  const candidates = await db
    .select({
      id: quotes.id,
      quoteNumber: quotes.quoteNumber,
      status: quotes.status,
      serviceType: quotes.serviceType,
      team: quotes.team,
      notes: quotes.notes,
      equipment: quotes.equipment,
      shootHours: quotes.shootHours,
      shotCount: quotes.shotCount,
      crewPhotographers: quotes.crewPhotographers,
      crewAssistants: quotes.crewAssistants,
      crewVideographers: quotes.crewVideographers,
      crewOthers: quotes.crewOthers,
    })
    .from(quotes)
    .where(
      and(
        inArray(quotes.status, ["accepted", "rejected"]),
        sql`CAST(${quotes.total} AS DECIMAL(12,2)) > 0`,
        or(
          isNull(quotes.shootHours),
          isNull(quotes.shotCount),
          and(
            eq(quotes.crewPhotographers, 0),
            eq(quotes.crewAssistants, 0),
            eq(quotes.crewVideographers, 0),
            eq(quotes.crewOthers, 0)
          )
        )
      )
    )
    .orderBy(desc(quotes.updatedAt))
    .limit(limit);

  if (candidates.length === 0) {
    return { ...emptyReport, dryRun };
  }

  const ids = candidates.map((c) => c.id);
  const items = await db
    .select({
      quoteId: quoteItems.quoteId,
      description: quoteItems.description,
      quantity: quoteItems.quantity,
    })
    .from(quoteItems)
    .where(inArray(quoteItems.quoteId, ids));

  const itemsByQuote = new Map<number, typeof items>();
  for (const it of items) {
    const list = itemsByQuote.get(it.quoteId) ?? [];
    list.push(it);
    itemsByQuote.set(it.quoteId, list);
  }

  let updated = 0;
  let skippedNoSignal = 0;
  let skippedAlreadyComplete = 0;
  let skippedDesign = 0;
  const filled: typeof emptyReport.filled = [];
  const unfillableSample: typeof emptyReport.unfillableSample = [];

  const pushUnfillable = (
    q: (typeof candidates)[0],
    reason: string
  ) => {
    if (unfillableSample.length >= 30) return;
    unfillableSample.push({
      id: q.id,
      quoteNumber: q.quoteNumber,
      status: q.status,
      serviceType: q.serviceType,
      reason,
    });
  };

  for (const q of candidates) {
    const mode = quotePricingMode(q.serviceType);
    if (mode === "design") {
      skippedDesign += 1;
      continue;
    }

    const qItems = itemsByQuote.get(q.id) ?? [];
    const itemText = qItems
      .map((i) => i.description ?? "")
      .filter(Boolean)
      .join("\n");
    const blob = [q.team ?? "", q.notes ?? "", q.equipment ?? "", itemText]
      .filter(Boolean)
      .join("\n");

    const needHours = q.shootHours == null || Number(q.shootHours) <= 0;
    const needShots = q.shotCount == null || Number(q.shotCount) <= 0;
    const existingCrew =
      (q.crewPhotographers ?? 0) +
      (q.crewAssistants ?? 0) +
      (q.crewVideographers ?? 0) +
      (q.crewOthers ?? 0);
    const needCrew = existingCrew <= 0;

    const alreadyComplete =
      mode === "shot_count"
        ? !needShots
        : !needHours && !needCrew;
    if (alreadyComplete) {
      skippedAlreadyComplete += 1;
      continue;
    }

    const patch: Partial<{
      shootHours: string;
      shotCount: number;
      crewPhotographers: number;
      crewAssistants: number;
      crewVideographers: number;
      crewOthers: number;
      team: string;
    }> = {};
    const fields: string[] = [];

    if (mode === "shot_count") {
      if (needShots) {
        const shots =
          extractShotCountFromText(itemText) ??
          extractShotCountFromText(q.notes ?? "") ??
          extractShotCountFromText(blob);
        if (shots != null && shots > 0) {
          patch.shotCount = shots;
          fields.push("shotCount");
        }
      }
    } else {
      // time_crew
      if (needHours) {
        const hours =
          extractHoursFromText(itemText) ??
          extractHoursFromText(q.notes ?? "") ??
          extractHoursFromText(q.team ?? "") ??
          extractHoursFromText(blob);
        if (hours != null && hours > 0) {
          patch.shootHours = String(hours);
          fields.push("shootHours");
        }
      }
      if (needCrew) {
        const crew =
          extractCrewHighConfidence(q.team ?? "") ??
          extractCrewHighConfidence(itemText) ??
          extractCrewHighConfidence(`${q.notes ?? ""}\n${q.equipment ?? ""}`);
        if (crew && crew.headcount > 0) {
          patch.crewPhotographers = crew.photographers;
          patch.crewAssistants = crew.assistants;
          patch.crewVideographers = crew.videographers;
          patch.crewOthers = crew.others;
          fields.push("crew");
          if (!q.team?.trim()) {
            const label = formatTeamFromStructured({
              photographers: patch.crewPhotographers ?? 0,
              assistants: patch.crewAssistants ?? 0,
              videographers: patch.crewVideographers ?? 0,
              others: patch.crewOthers ?? 0,
            });
            if (label) patch.team = label.slice(0, 128);
          }
        }
      }
    }

    if (fields.length === 0) {
      skippedNoSignal += 1;
      pushUnfillable(
        q,
        mode === "shot_count"
          ? "文字／項目無明確張數訊號"
          : "文字／項目無明確時數或人手訊號"
      );
      continue;
    }

    updated += 1;
    filled.push({
      id: q.id,
      quoteNumber: q.quoteNumber,
      status: q.status,
      fields,
    });
    if (!dryRun) {
      await db.update(quotes).set(patch).where(eq(quotes.id, q.id));
    }
  }

  return {
    updated,
    scanned: candidates.length,
    dryRun,
    filled: filled.slice(0, 50),
    skippedNoSignal,
    skippedAlreadyComplete,
    skippedDesign,
    skippedDraftOrOther: 0,
    unfillableSample,
    accuracyNote: emptyReport.accuracyNote,
  };
}
