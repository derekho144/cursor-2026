/**
 * Pricing learning analytics over accepted quotations.
 * Dimensions: shoot type (serviceType) · hours · crew arrangement.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./db";
import { emailInquiries, quoteItems, quotes } from "../drizzle/schema";
import {
  crewBucketLabel,
  extractQuoteShootFeatures,
  hoursBucketLabel,
  summarizeTotals,
  type CrewBucket,
  type HoursBucket,
  type QuoteShootFeatures,
} from "./pricingLearningExtract";

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

  // AI estimate for linked inquiries
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
    const features = extractQuoteShootFeatures({
      team: q.team,
      notes: q.notes,
      equipment: q.equipment,
      items: qItems,
    });
    const total = Number(q.total);
    const estimatedTotal =
      q.emailInquiryId != null
        ? estimateByInquiry.get(q.emailInquiryId) ?? null
        : null;
    const accuracyPct =
      estimatedTotal != null && estimatedTotal > 0 && total > 0
        ? Math.round(((total - estimatedTotal) / estimatedTotal) * 1000) / 10
        : null;

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
    .map(([serviceType, totals]) => ({
      serviceType,
      ...summarizeTotals(totals),
      withHours: rows.filter(
        (r) => r.serviceType === serviceType && r.features.hoursBucket !== "unknown"
      ).length,
      withCrew: rows.filter(
        (r) => r.serviceType === serviceType && r.features.crewBucket !== "unknown"
      ).length,
    }))
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

  return {
    generatedAt: new Date().toISOString(),
    acceptedCount: rows.length,
    coverage: {
      withHours: rows.filter((r) => r.features.hoursBucket !== "unknown").length,
      withCrew: rows.filter((r) => r.features.crewBucket !== "unknown").length,
      withAiPair: paired.length,
    },
    overall: summarizeTotals(rows.map((r) => r.total)),
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

  // Cross: hours × crew avg (only cells with data)
  const cross: Array<{
    hoursBucket: HoursBucket;
    hoursLabel: string;
    crewBucket: CrewBucket;
    crewLabel: string;
    count: number;
    avg: number;
    p50: number;
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
      });
    }
  }
  cross.sort((a, b) => b.count - a.count);

  return {
    serviceType,
    summary: summarizeTotals(rows.map((r) => r.total)),
    coverage: {
      withHours: rows.filter((r) => r.features.hoursBucket !== "unknown").length,
      withCrew: rows.filter((r) => r.features.crewBucket !== "unknown").length,
    },
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
      crewLabel: r.features.crewLabel,
      crewBucket: r.features.crewBucket,
      items: r.itemSummaries,
      estimatedTotal: r.estimatedTotal,
      accuracyPct: r.accuracyPct,
    })),
  };
}

/**
 * Statistical price suggestion from accepted history, filtered by fundamentals.
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
          items: [{ description: `${input.hours}小時` }],
        }).hoursBucket
      : null;
  const targetCrew =
    input.crewSize != null && input.crewSize > 0
      ? (input.crewSize === 1
          ? "solo"
          : input.crewSize === 2
            ? "pair"
            : "team") as CrewBucket
      : null;

  let matched = rows;
  if (targetHours && targetHours !== "unknown") {
    const filtered = matched.filter((r) => r.features.hoursBucket === targetHours);
    if (filtered.length >= 2) matched = filtered;
  }
  if (targetCrew && targetCrew !== "unknown") {
    const filtered = matched.filter((r) => r.features.crewBucket === targetCrew);
    if (filtered.length >= 2) matched = filtered;
  }

  const summary = summarizeTotals(matched.map((r) => r.total));
  return {
    serviceType: input.serviceType,
    filters: {
      hours: input.hours ?? null,
      hoursBucket: targetHours,
      crewSize: input.crewSize ?? null,
      crewBucket: targetCrew,
    },
    sampleCount: summary.count,
    suggestion: summary.count >= 2
      ? {
          low: summary.p25,
          mid: summary.p50,
          high: summary.p75,
          avg: summary.avg,
        }
      : null,
    note:
      summary.count < 2
        ? "同類已接受報價樣本不足，建議先用市場價參考。"
        : matched.length < rows.length
          ? `已按時數／人手篩選，剩餘 ${matched.length} / ${rows.length} 筆同類成交。`
          : `基於 ${summary.count} 筆「${input.serviceType}」已接受報價。`,
    comparables: matched.slice(0, 8).map((r) => ({
      id: r.id,
      quoteNumber: r.quoteNumber,
      total: r.total,
      hours: r.features.hours,
      crewLabel: r.features.crewLabel,
      clientName: r.clientCompany || r.clientName,
    })),
  };
}
