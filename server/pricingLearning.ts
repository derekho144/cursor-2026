/**
 * Pricing learning analytics over accepted quotations.
 * Dimensions: shoot type (serviceType) · hours · crew arrangement.
 * Accuracy focus: prefer structured fields, trim outliers, time-weight, coverage quality.
 */
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb } from "./db";
import { emailInquiries, quoteItems, quotes } from "../drizzle/schema";
import {
  crewBucketLabel,
  extractQuoteShootFeatures,
  formatTeamFromStructured,
  hoursBucketLabel,
  summarizeTotals,
  timeWeightedMedian,
  type CrewBucket,
  type HoursBucket,
  type QuoteShootFeatures,
} from "./pricingLearningExtract";

const MIN_BUCKET_SAMPLES = 2;

export interface PricingLearningQuoteRow {
  id: number;
  quoteNumber: string;
  clientName: string;
  clientCompany: string | null;
  serviceType: string;
  total: number;
  shootingDate: string | null;
  createdAt: Date | null;
  team: string | null;
  features: QuoteShootFeatures;
  itemSummaries: string[];
  estimatedTotal: number | null;
  accuracyPct: number | null;
  hasStructuredHours: boolean;
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

async function loadAcceptedQuotesWithItems(opts?: {
  serviceType?: string;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [
    eq(quotes.status, "accepted"),
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
      total: quotes.total,
      shootingDate: quotes.shootingDate,
      createdAt: quotes.createdAt,
      team: quotes.team,
      notes: quotes.notes,
      equipment: quotes.equipment,
      emailInquiryId: quotes.emailInquiryId,
      shootHours: quotes.shootHours,
      crewPhotographers: quotes.crewPhotographers,
      crewAssistants: quotes.crewAssistants,
      crewVideographers: quotes.crewVideographers,
      crewOthers: quotes.crewOthers,
    })
    .from(quotes)
    .where(and(...conditions))
    .orderBy(desc(quotes.createdAt))
    .limit(opts?.limit ?? 2000);

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
    const hasStructuredCrew =
      (q.crewPhotographers ?? 0) +
        (q.crewAssistants ?? 0) +
        (q.crewVideographers ?? 0) +
        (q.crewOthers ?? 0) >
      0;

    return {
      id: q.id,
      quoteNumber: q.quoteNumber,
      clientName: q.clientName,
      clientCompany: q.clientCompany,
      serviceType: q.serviceType,
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
      hasStructuredCrew,
    } satisfies PricingLearningQuoteRow;
  });
}

export async function getPricingLearningOverview() {
  const rows = await loadAcceptedQuotesWithItems({ limit: 3000 });
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
        withStructuredHours: typeRows.filter((r) => r.hasStructuredHours).length,
        withStructuredCrew: typeRows.filter((r) => r.hasStructuredCrew).length,
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

  const withHoursRows = rows.filter((r) => r.features.hours != null && r.features.hours > 0);
  const pricePerHourStats = summarizeTotals(
    withHoursRows
      .map((r) => r.features.pricePerHour)
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

  const incomplete = rows
    .filter(
      (r) =>
        r.features.hoursBucket === "unknown" ||
        r.features.crewBucket === "unknown"
    )
    .slice(0, 25)
    .map((r) => ({
      id: r.id,
      quoteNumber: r.quoteNumber,
      clientName: r.clientCompany || r.clientName,
      serviceType: r.serviceType,
      total: r.total,
      missingHours: r.features.hoursBucket === "unknown",
      missingCrew: r.features.crewBucket === "unknown",
      hoursSource: r.features.hoursSource,
      crewSource: r.features.crewSource,
    }));

  const structuredBoth = rows.filter(
    (r) => r.hasStructuredHours && r.hasStructuredCrew
  ).length;
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

  return {
    generatedAt: new Date().toISOString(),
    acceptedCount: rows.length,
    coverage: {
      withHours: rows.filter((r) => r.features.hoursBucket !== "unknown").length,
      withCrew: rows.filter((r) => r.features.crewBucket !== "unknown").length,
      withBothFundamentals: rows.filter(
        (r) =>
          r.features.hoursBucket !== "unknown" &&
          r.features.crewBucket !== "unknown"
      ).length,
      withStructuredHours: rows.filter((r) => r.hasStructuredHours).length,
      withStructuredCrew: rows.filter((r) => r.hasStructuredCrew).length,
      withStructuredBoth: structuredBoth,
      textOnlyHours,
      textOnlyCrew,
      withAiPair: paired.length,
      incompleteCount: rows.filter(
        (r) =>
          r.features.hoursBucket === "unknown" ||
          r.features.crewBucket === "unknown"
      ).length,
    },
    dataQuality: {
      score:
        rows.length === 0
          ? 0
          : Math.round(
              ((structuredBoth * 1.0 +
                (rows.filter(
                  (r) =>
                    (r.hasStructuredHours || r.features.hoursBucket !== "unknown") &&
                    (r.hasStructuredCrew || r.features.crewBucket !== "unknown")
                ).length -
                  structuredBoth) *
                  0.55) /
                rows.length) *
                100
            ),
      tips: [
        "報價單請填「拍攝時數」同人手人數（攝影師／助理等），學習會優先用結構化欄位。",
        "自由文字「Team」仍可作後備，但準確度低過結構化欄位。",
        "統計已自動剔除極端離群成交價（IQR），近半年成交權重較高。",
        incomplete.length > 0
          ? `尚有 ${incomplete.length}+ 筆已接受報價缺時數或人手，補齊可提升準確率。`
          : "時數／人手覆蓋良好。",
      ],
      incomplete,
    },
    overall: summarizeTotals(rows.map((r) => r.total)),
    overallRecentMid: timeWeightedMedian(
      rows.map((r) => ({ value: r.total, at: r.shootingDate || r.createdAt }))
    ),
    pricePerHour: pricePerHourStats.count > 0 ? pricePerHourStats : null,
    byServiceType,
    hoursBuckets,
    crewBuckets,
    aiAccuracy,
  };
}

export async function getPricingLearningByServiceType(serviceType: string) {
  const rows = await loadAcceptedQuotesWithItems({ serviceType, limit: 1000 });

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

  const withHours = rows.filter((r) => r.features.hours != null && r.features.hours > 0);
  const pricePerHour = summarizeTotals(
    withHours
      .map((r) => r.features.pricePerHour)
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
    summary: summarizeTotals(rows.map((r) => r.total)),
    recentWeightedMid: timeWeightedMedian(
      rows.map((r) => ({ value: r.total, at: r.shootingDate || r.createdAt }))
    ),
    coverage: {
      withHours: rows.filter((r) => r.features.hoursBucket !== "unknown").length,
      withCrew: rows.filter((r) => r.features.crewBucket !== "unknown").length,
      withStructuredHours: rows.filter((r) => r.hasStructuredHours).length,
      withStructuredCrew: rows.filter((r) => r.hasStructuredCrew).length,
    },
    pricePerHour: pricePerHour.count > 0 ? pricePerHour : null,
    hoursBuckets,
    crewBuckets,
    cross,
    recent: rows.slice(0, 30).map((r) => ({
      id: r.id,
      quoteNumber: r.quoteNumber,
      clientName: r.clientCompany || r.clientName,
      total: r.total,
      shootingDate: r.shootingDate,
      hours: r.features.hours,
      hoursLabel: hoursBucketLabel(r.features.hoursBucket),
      hoursSource: r.features.hoursSource,
      crewLabel: r.features.crewLabel,
      crewBucket: r.features.crewBucket,
      crewSource: r.features.crewSource,
      pricePerHour: r.features.pricePerHour,
      structured: r.hasStructuredHours || r.hasStructuredCrew,
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
}) {
  const rows = await loadAcceptedQuotesWithItems({
    serviceType: input.serviceType,
    limit: 1000,
  });

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

  let matched = rows;
  if (targetHours && targetHours !== "unknown") {
    const filtered = matched.filter((r) => r.features.hoursBucket === targetHours);
    if (filtered.length >= MIN_BUCKET_SAMPLES) matched = filtered;
  }
  if (targetCrew && targetCrew !== "unknown") {
    const filtered = matched.filter((r) => r.features.crewBucket === targetCrew);
    if (filtered.length >= MIN_BUCKET_SAMPLES) matched = filtered;
  }

  // Prefer structured-field rows when enough samples
  const structuredMatched = matched.filter(
    (r) =>
      (targetHours == null || targetHours === "unknown" || r.hasStructuredHours) &&
      (targetCrew == null || targetCrew === "unknown" || r.hasStructuredCrew)
  );
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

  return {
    serviceType: input.serviceType,
    filters: {
      hours: input.hours ?? null,
      hoursBucket: targetHours,
      crewSize: input.crewSize ?? null,
      crewBucket: targetCrew,
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
          }
        : null,
    note:
      summary.count < MIN_BUCKET_SAMPLES
        ? "同類已接受報價樣本不足，建議先用市場價參考，並補齊時數／人手欄位。"
        : useRows.length < rows.length
          ? `已按時數／人手篩選（${structuredMatched.length >= MIN_BUCKET_SAMPLES ? "優先結構化" : "含文字抽取"}），剩餘 ${useRows.length} / ${rows.length} 筆同類成交。`
          : `基於 ${summary.count} 筆「${input.serviceType}」已接受報價（已剔除離群值）。`,
    comparables: useRows.slice(0, 8).map((r) => ({
      id: r.id,
      quoteNumber: r.quoteNumber,
      total: r.total,
      hours: r.features.hours,
      crewLabel: r.features.crewLabel,
      clientName: r.clientCompany || r.clientName,
      structured: r.hasStructuredHours || r.hasStructuredCrew,
    })),
  };
}

/**
 * Backfill structured shootHours / crew counts from free-text extraction
 * when structured columns are empty. Improves future learning accuracy.
 */
export async function backfillStructuredShootFields(opts?: {
  limit?: number;
  dryRun?: boolean;
}) {
  const db = await getDb();
  if (!db) return { updated: 0, scanned: 0, dryRun: !!opts?.dryRun };

  const limit = opts?.limit ?? 500;
  const dryRun = !!opts?.dryRun;

  const candidates = await db
    .select({
      id: quotes.id,
      team: quotes.team,
      notes: quotes.notes,
      equipment: quotes.equipment,
      shootHours: quotes.shootHours,
      crewPhotographers: quotes.crewPhotographers,
      crewAssistants: quotes.crewAssistants,
      crewVideographers: quotes.crewVideographers,
      crewOthers: quotes.crewOthers,
    })
    .from(quotes)
    .where(
      or(
        isNull(quotes.shootHours),
        and(
          eq(quotes.crewPhotographers, 0),
          eq(quotes.crewAssistants, 0),
          eq(quotes.crewVideographers, 0),
          eq(quotes.crewOthers, 0)
        )
      )
    )
    .orderBy(desc(quotes.updatedAt))
    .limit(limit);

  if (candidates.length === 0) {
    return { updated: 0, scanned: 0, dryRun };
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
  for (const q of candidates) {
    const features = extractQuoteShootFeatures({
      team: q.team,
      notes: q.notes,
      equipment: q.equipment,
      items: itemsByQuote.get(q.id) ?? [],
    });

    const patch: Partial<{
      shootHours: string;
      crewPhotographers: number;
      crewAssistants: number;
      crewVideographers: number;
      crewOthers: number;
      team: string;
    }> = {};

    const needHours = q.shootHours == null || Number(q.shootHours) <= 0;
    if (needHours && features.hours != null && features.hours > 0) {
      patch.shootHours = String(features.hours);
    }

    const existingCrew =
      (q.crewPhotographers ?? 0) +
      (q.crewAssistants ?? 0) +
      (q.crewVideographers ?? 0) +
      (q.crewOthers ?? 0);
    if (existingCrew <= 0 && features.crew.headcount > 0) {
      // If roles unknown but headcount known, put into photographers as best-effort solo/pair
      if (
        features.crew.photographers +
          features.crew.assistants +
          features.crew.videographers +
          features.crew.others >
        0
      ) {
        patch.crewPhotographers = features.crew.photographers;
        patch.crewAssistants = features.crew.assistants;
        patch.crewVideographers = features.crew.videographers;
        patch.crewOthers = features.crew.others;
      } else {
        patch.crewPhotographers = features.crew.headcount;
      }
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

    if (Object.keys(patch).length === 0) continue;
    updated += 1;
    if (!dryRun) {
      await db.update(quotes).set(patch).where(eq(quotes.id, q.id));
    }
  }

  return { updated, scanned: candidates.length, dryRun };
}
