import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./db";
import { emailInquiries, freehunterJobs, quotes } from "../drizzle/schema";

export type ReceivableItem = {
  id: number;
  quoteNumber: string;
  clientName: string;
  status: string;
  paymentStatus: "unpaid" | "deposit_paid" | "fully_paid";
  total: number;
  outstanding: number;
  ageDays: number;
  bucket: "current" | "d30" | "d60" | "d90plus";
  anchorDate: string;
};

export type ReceivablesSummary = {
  totalOutstanding: number;
  count: number;
  buckets: { current: number; d30: number; d60: number; d90plus: number };
  items: ReceivableItem[];
};

function bucketForAge(ageDays: number): ReceivableItem["bucket"] {
  if (ageDays <= 30) return "current";
  if (ageDays <= 60) return "d30";
  if (ageDays <= 90) return "d60";
  return "d90plus";
}

/** Outstanding receivables for accepted quotes (unpaid / deposit only). */
export async function getReceivablesSummary(limit = 30): Promise<ReceivablesSummary> {
  const empty: ReceivablesSummary = {
    totalOutstanding: 0,
    count: 0,
    buckets: { current: 0, d30: 0, d60: 0, d90plus: 0 },
    items: [],
  };
  const db = await getDb();
  if (!db) return empty;

  const rows = await db
    .select({
      id: quotes.id,
      quoteNumber: quotes.quoteNumber,
      clientName: quotes.clientName,
      status: quotes.status,
      paymentStatus: quotes.paymentStatus,
      total: quotes.total,
      depositPaidAmount: quotes.depositPaidAmount,
      depositPaidAt: quotes.depositPaidAt,
      signedAt: quotes.signedAt,
      createdAt: quotes.createdAt,
      paymentNetDays: quotes.paymentNetDays,
    })
    .from(quotes)
    .where(
      and(
        eq(quotes.status, "accepted"),
        inArray(quotes.paymentStatus, ["unpaid", "deposit_paid"])
      )
    )
    .orderBy(desc(quotes.createdAt))
    .limit(200);

  const now = Date.now();
  const items: ReceivableItem[] = [];

  for (const r of rows) {
    const total = Number(r.total ?? 0);
    const deposit = Number(r.depositPaidAmount ?? 0);
    const outstanding =
      r.paymentStatus === "deposit_paid"
        ? Math.max(0, total - deposit)
        : total;
    if (outstanding <= 0) continue;

    const anchor =
      r.paymentStatus === "deposit_paid" && r.depositPaidAt
        ? new Date(r.depositPaidAt)
        : r.signedAt
          ? new Date(r.signedAt)
          : new Date(r.createdAt);
    const netDays = r.paymentNetDays != null ? Number(r.paymentNetDays) : 0;
    const dueMs = anchor.getTime() + netDays * 24 * 60 * 60 * 1000;
    const ageDays = Math.max(0, Math.floor((now - dueMs) / (24 * 60 * 60 * 1000)));
    const bucket = bucketForAge(ageDays);

    items.push({
      id: r.id,
      quoteNumber: r.quoteNumber,
      clientName: r.clientName,
      status: r.status,
      paymentStatus: r.paymentStatus as ReceivableItem["paymentStatus"],
      total,
      outstanding,
      ageDays,
      bucket,
      anchorDate: anchor.toISOString(),
    });
  }

  items.sort((a, b) => b.ageDays - a.ageDays || b.outstanding - a.outstanding);
  const top = items.slice(0, limit);
  const buckets = { current: 0, d30: 0, d60: 0, d90plus: 0 };
  let totalOutstanding = 0;
  for (const it of items) {
    totalOutstanding += it.outstanding;
    buckets[it.bucket] += it.outstanding;
  }

  return {
    totalOutstanding: Math.round(totalOutstanding),
    count: items.length,
    buckets: {
      current: Math.round(buckets.current),
      d30: Math.round(buckets.d30),
      d60: Math.round(buckets.d60),
      d90plus: Math.round(buckets.d90plus),
    },
    items: top,
  };
}

export type ActivityItem = {
  type: "quote" | "inquiry" | "fh_job";
  id: number;
  title: string;
  subtitle?: string;
  at: string;
  href: string;
};

export async function getRecentActivity(limit = 15): Promise<ActivityItem[]> {
  const db = await getDb();
  if (!db) return [];

  const [quoteRows, inquiryRows, fhRows] = await Promise.all([
    db
      .select({
        id: quotes.id,
        quoteNumber: quotes.quoteNumber,
        clientName: quotes.clientName,
        status: quotes.status,
        total: quotes.total,
        leadSource: quotes.leadSource,
        createdAt: quotes.createdAt,
      })
      .from(quotes)
      .orderBy(desc(quotes.createdAt))
      .limit(10),
    db
      .select({
        id: emailInquiries.id,
        fromName: emailInquiries.fromName,
        fromEmail: emailInquiries.fromEmail,
        subject: emailInquiries.subject,
        status: emailInquiries.status,
        receivedAt: emailInquiries.receivedAt,
        createdAt: emailInquiries.createdAt,
      })
      .from(emailInquiries)
      .orderBy(desc(emailInquiries.receivedAt))
      .limit(10),
    db
      .select({
        id: freehunterJobs.id,
        title: freehunterJobs.title,
        status: freehunterJobs.status,
        aiScore: freehunterJobs.aiScore,
        clientName: freehunterJobs.clientName,
        scrapedAt: freehunterJobs.scrapedAt,
      })
      .from(freehunterJobs)
      .orderBy(desc(freehunterJobs.scrapedAt))
      .limit(10),
  ]);

  const items: ActivityItem[] = [];

  for (const q of quoteRows) {
    items.push({
      type: "quote",
      id: q.id,
      title: `${q.quoteNumber} · ${q.clientName}`,
      subtitle: `${q.status} · HK$${Number(q.total ?? 0).toLocaleString()}${q.leadSource ? ` · ${q.leadSource}` : ""}`,
      at: new Date(q.createdAt).toISOString(),
      href: `/quotes/${q.id}`,
    });
  }
  for (const i of inquiryRows) {
    const when = i.receivedAt ?? i.createdAt;
    items.push({
      type: "inquiry",
      id: i.id,
      title: i.subject || "(無主旨)",
      subtitle: `${i.fromName || i.fromEmail || "未知"} · ${i.status}`,
      at: new Date(when).toISOString(),
      href: `/email-inquiries`,
    });
  }
  for (const j of fhRows) {
    items.push({
      type: "fh_job",
      id: j.id,
      title: j.title,
      subtitle: `${j.status}${j.clientName ? ` · ${j.clientName}` : ""}${j.aiScore != null ? ` · AI ${j.aiScore}` : ""}`,
      at: new Date(j.scrapedAt).toISOString(),
      href: `/freehunter-board`,
    });
  }

  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return items.slice(0, limit);
}
