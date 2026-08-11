import crypto from "crypto";
import { and, desc, eq, inArray, isNotNull, isNull, like, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2";
import {
  adExpenses,
  adPlatformConfigs,
  adSyncLogs,
  adTransactions,
  aiAnalysisReports,
  AiAnalysisReport,
  Client,
  clients,
  clientMemberships,
  ClientMembership,
  InsertClientMembership,
  referralCodes,
  ReferralCode,
  InsertReferralCode,
  loyaltyEmailsLog,
  LoyaltyEmailLog,
  InsertLoyaltyEmailLog,
  emailLogs,
  emailInquiries,
  emailOpenEvents,
  freehunterJobs,
  expenses,
  InsertAdExpense,
  InsertAdPlatformConfig,
  InsertAdSyncLog,
  InsertAiAnalysisReport,
  InsertClient,
  InsertEmailLog,
  InsertEmailInquiry,
  InsertQuote,
  InsertQuoteItem,
  InsertUser,
  platformCredentials,
  InsertPlatformCredential,
  quoteItems,
  quoteCosts,
  InsertQuoteCost,
  quotes,
  users,
  whatsappClickEvents,
  quoteFollowUps,
  QuoteFollowUp,
  InsertQuoteFollowUp,
  followUpSettings,
  FollowUpSettings,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _pool: mysql.Pool | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

function getPool(): mysql.Pool {
  if (!_pool && process.env.DATABASE_URL) {
    _pool = mysql.createPool({
      uri: process.env.DATABASE_URL,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
    });
    console.log("[Database] Connection pool created");
  }
  return _pool!;
}

export async function getDb() {
  if (!process.env.DATABASE_URL) return null;
  if (!_db) {
    try {
      const pool = getPool();
      _db = drizzle(pool);
      console.log("[Database] Drizzle initialized with pool");
    } catch (error) {
      console.warn("[Database] Failed to initialize:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── Users ────────────────────────────────────────────────────────
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;

  for (const field of textFields) {
    const value = user[field];
    if (value === undefined) continue;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  }

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Quotes ───────────────────────────────────────────────────────
export async function generateQuoteNumber(): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  // Use timestamp (last 3 digits of seconds) + 4 random alphanumeric chars
  // Format: JD202603-A4K2 — collision probability < 0.001%
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const rand = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `JD${year}${month}-${rand}`;
}

export async function createQuote(
  data: Omit<InsertQuote, "quoteNumber"> & { items: Omit<InsertQuoteItem, "quoteId">[] }
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const quoteNumber = await generateQuoteNumber();
  const { items, ...quoteData } = data;

  await db.insert(quotes).values({ ...quoteData, quoteNumber });
  const [newQuote] = await db
    .select()
    .from(quotes)
    .where(eq(quotes.quoteNumber, quoteNumber))
    .limit(1);

  // Auto-link to email_inquiry if clientEmail matches and no email_inquiry_id was provided
  if (!quoteData.emailInquiryId && quoteData.clientEmail) {
    let conn: mysql.PoolConnection | null = null;
    try {
      const clientEmail = quoteData.clientEmail.toLowerCase().trim();
      const createdAt = new Date();
      const since = new Date(createdAt.getTime() - 60 * 24 * 60 * 60 * 1000);
      conn = await new Promise<mysql.PoolConnection>((resolve, reject) =>
        getPool().getConnection((err, c) => err ? reject(err) : resolve(c))
      );
      const [inquiries] = await conn.promise().execute(
        `SELECT ei.id FROM email_inquiries ei
         WHERE LOWER(ei.from_email) = ?
           AND ei.inq_created_at >= ?
           AND ei.estimated_total IS NOT NULL AND ei.estimated_total > 0
           AND NOT EXISTS (SELECT 1 FROM quotes q2 WHERE q2.email_inquiry_id = ei.id)
         ORDER BY ei.inq_created_at DESC LIMIT 1`,
        [clientEmail, since]
      );
      if (inquiries && (inquiries as any[]).length > 0) {
        const inquiryId = (inquiries as any[])[0].id;
        await db.update(quotes).set({ emailInquiryId: inquiryId }).where(eq(quotes.id, newQuote.id));
        (newQuote as any).emailInquiryId = inquiryId;
      }
    } catch (_e) {
      // Auto-link is best-effort, don't fail quote creation
    } finally {
      if (conn) conn.release();
    }
  }

  if (items.length > 0) {
    await db.insert(quoteItems).values(
      items.map((item, idx) => ({ ...item, quoteId: newQuote.id, sortOrder: idx }))
    );
  }
  return newQuote;
}

export async function getQuotes(opts: {
  search?: string;
  serviceType?: string;
  status?: string;
  leadSource?: string;
  year?: number;
  month?: number; // 1-12
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };

  const conditions = [];
  if (opts.search) {
    conditions.push(
      or(
        like(quotes.clientName, `%${opts.search}%`),
        like(quotes.quoteNumber, `%${opts.search}%`),
        like(quotes.clientCompany, `%${opts.search}%`),
        like(quotes.clientPhone, `%${opts.search}%`)
      )
    );
  }
  if (opts.serviceType) conditions.push(eq(quotes.serviceType, opts.serviceType as any));
  if (opts.status) conditions.push(eq(quotes.status, opts.status as any));
  if (opts.leadSource) conditions.push(eq(quotes.leadSource, opts.leadSource));
  // Month/Year filter: align with Dashboard「已成交」歸屬
  // 有拍攝日 → 按拍攝年月；無拍攝日 → 按開單年月 createdAt
  if (opts.year && opts.month) {
    conditions.push(sql`(
      (shootingDate IS NOT NULL AND shootingDate != '' AND YEAR(STR_TO_DATE(shootingDate, '%Y-%m-%d')) = ${opts.year} AND MONTH(STR_TO_DATE(shootingDate, '%Y-%m-%d')) = ${opts.month})
      OR
      ((shootingDate IS NULL OR shootingDate = '') AND YEAR(createdAt) = ${opts.year} AND MONTH(createdAt) = ${opts.month})
    )`);
  } else if (opts.year) {
    conditions.push(sql`(
      (shootingDate IS NOT NULL AND shootingDate != '' AND YEAR(STR_TO_DATE(shootingDate, '%Y-%m-%d')) = ${opts.year})
      OR
      ((shootingDate IS NULL OR shootingDate = '') AND YEAR(createdAt) = ${opts.year})
    )`);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;

    const [data, countResult] = await Promise.all([
    db.select().from(quotes).where(where).orderBy(desc(quotes.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`COUNT(*)` }).from(quotes).where(where),
  ]);

  // Batch-fetch email open status using a single IN query (indexed on quoteId + opened_at)
  const quoteIds = data.map(q => q.id);
  let openedQuoteIds = new Set<number>();
  if (quoteIds.length > 0) {
    const openedLogs = await db
      .selectDistinct({ quoteId: emailLogs.quoteId })
      .from(emailLogs)
      .where(
        and(
          inArray(emailLogs.quoteId, quoteIds),
          isNotNull(emailLogs.openedAt)
        )
      );
    openedQuoteIds = new Set(openedLogs.map(l => l.quoteId).filter((id): id is number => id !== null));
  }
  const enriched = data.map(q => ({ ...q, emailOpened: openedQuoteIds.has(q.id) }));
  return { data: enriched, total: Number(countResult[0]?.count ?? 0) };
}
export async function getQuoteById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const [quote] = await db.select().from(quotes).where(eq(quotes.id, id)).limit(1);
  if (!quote) return null;
  const items = await db
    .select()
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, id))
    .orderBy(quoteItems.sortOrder);
  return { ...quote, items };
}

export async function updateQuote(
  id: number,
  data: Partial<InsertQuote> & { items?: Omit<InsertQuoteItem, "quoteId">[] }
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const { items, ...quoteData } = data;

  if (Object.keys(quoteData).length > 0) {
    await db.update(quotes).set(quoteData).where(eq(quotes.id, id));
  }
  if (items !== undefined) {
    await db.delete(quoteItems).where(eq(quoteItems.quoteId, id));
    if (items.length > 0) {
      await db.insert(quoteItems).values(
        items.map((item, idx) => ({ ...item, quoteId: id, sortOrder: idx }))
      );
    }
  }
  return getQuoteById(id);
}

export async function deleteQuote(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(quoteItems).where(eq(quoteItems.quoteId, id));
  await db.delete(quotes).where(eq(quotes.id, id));
}

// ─── Ad Expenses ──────────────────────────────────────────────────
export async function upsertAdExpense(data: InsertAdExpense) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const existing = await db
    .select()
    .from(adExpenses)
    .where(
      and(
        eq(adExpenses.platform, data.platform),
        eq(adExpenses.year, data.year),
        eq(adExpenses.month, data.month)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(adExpenses)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(adExpenses.id, existing[0].id));
    return existing[0].id;
  } else {
    await db.insert(adExpenses).values(data);
    const [newRecord] = await db
      .select()
      .from(adExpenses)
      .where(
        and(
          eq(adExpenses.platform, data.platform),
          eq(adExpenses.year, data.year),
          eq(adExpenses.month, data.month)
        )
      )
      .limit(1);
    return newRecord.id;
  }
}

export async function getAdExpenses(opts: { year?: number; month?: number; platform?: string }) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (opts.year) conditions.push(eq(adExpenses.year, opts.year));
  if (opts.month) conditions.push(eq(adExpenses.month, opts.month));
  if (opts.platform) conditions.push(eq(adExpenses.platform, opts.platform as any));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return db.select().from(adExpenses).where(where).orderBy(desc(adExpenses.year), desc(adExpenses.month));
}

export async function getAdExpenseSummary(year: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      month: adExpenses.month,
      platform: adExpenses.platform,
      amount: adExpenses.amount,
      refundAmount: adExpenses.refundAmount,
      impressions: adExpenses.impressions,
      clicks: adExpenses.clicks,
      conversions: adExpenses.conversions,
    })
    .from(adExpenses)
    .where(eq(adExpenses.year, year))
    .orderBy(adExpenses.month, adExpenses.platform);
}

export async function deleteAdExpense(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(adExpenses).where(eq(adExpenses.id, id));
}

// ─── Ad Platform Configs ──────────────────────────────────────────
export async function getAdPlatformConfigs() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(adPlatformConfigs);
}

export async function upsertAdPlatformConfig(data: InsertAdPlatformConfig) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const { platform, ...rest } = data;
  await db
    .insert(adPlatformConfigs)
    .values(data)
    .onDuplicateKeyUpdate({ set: rest });
}

export async function updateAdPlatformSyncStatus(
  platform: string,
  status: "idle" | "syncing" | "success" | "error",
  error?: string
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(adPlatformConfigs)
    .set({
      syncStatus: status,
      syncError: error ?? null,
      lastSyncAt: status === "success" || status === "error" ? new Date() : undefined,
    })
    .where(eq(adPlatformConfigs.platform, platform as any));
}

// ─── Ad Sync Logs ─────────────────────────────────────────────────
export async function createAdSyncLog(data: InsertAdSyncLog) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(adSyncLogs).values(data);
}

export async function getAdSyncLogs(platform?: string) {
  const db = await getDb();
  if (!db) return [];
  const where = platform ? eq(adSyncLogs.platform, platform as any) : undefined;
  return db.select().from(adSyncLogs).where(where).orderBy(desc(adSyncLogs.syncedAt)).limit(50);
}

/**
 * Delete sync logs for a platform, keeping only the most recent `keepCount` records.
 * If keepCount is 0, deletes all logs for the platform.
 */
export async function deleteAdSyncLogs(platform: string, keepCount = 0): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  // Get IDs to keep
  const toKeep = keepCount > 0
    ? await db.select({ id: adSyncLogs.id }).from(adSyncLogs)
        .where(eq(adSyncLogs.platform, platform as any))
        .orderBy(desc(adSyncLogs.syncedAt))
        .limit(keepCount)
    : [];
  const keepIds = toKeep.map((r) => r.id);
  if (keepIds.length > 0) {
    const result = await db.delete(adSyncLogs)
      .where(and(eq(adSyncLogs.platform, platform as any), sql`${adSyncLogs.id} NOT IN (${sql.join(keepIds.map(id => sql`${id}`), sql`, `)})` ));
    return (result as any)[0]?.affectedRows ?? 0;
  } else {
    const result = await db.delete(adSyncLogs).where(eq(adSyncLogs.platform, platform as any));
    return (result as any)[0]?.affectedRows ?? 0;
  }
}

// ─── Dashboard Stats ──────────────────────────────────────────────────────
// Fast dashboard stats for initial load (only KPI cards)
export async function getDashboardStatsQuick(year?: number, month?: number) {
  const db = await getDb();
  if (!db) return null;

  const now = new Date();
  const targetYear = year ?? now.getFullYear();
  const targetMonth = month ?? (now.getMonth() + 1);

  const [
    acceptedQuotesForMonth,
    monthlyAdSpend,
    monthlyExpensesResult,
    monthlyProjectCostsResult,
  ] = await Promise.all([
    // Accepted quotes for selected month (revenue):
    // - If shootingDate exists: use shootingDate
    // - If no shootingDate: fall back to createdAt
    db
      .select({ count: sql<number>`COUNT(*)`, total: sql<number>`SUM(total)` })
      .from(quotes)
      .where(
        and(
          eq(quotes.status, "accepted"),
          sql`(
            (shootingDate IS NOT NULL AND shootingDate != '' AND YEAR(STR_TO_DATE(shootingDate, '%Y-%m-%d')) = ${targetYear} AND MONTH(STR_TO_DATE(shootingDate, '%Y-%m-%d')) = ${targetMonth})
            OR
            ((shootingDate IS NULL OR shootingDate = '') AND YEAR(createdAt) = ${targetYear} AND MONTH(createdAt) = ${targetMonth})
          )`
        )
      ),
    // Monthly ad spend for selected month
    db
      .select({ total: sql<number>`SUM(amount)` })
      .from(adExpenses)
      .where(and(eq(adExpenses.year, targetYear), eq(adExpenses.month, targetMonth))),
    // Monthly business expenses for selected month
    db
      .select({ total: sql<number>`SUM(amount)` })
      .from(expenses)
      .where(
        and(
          sql`YEAR(date) = ${targetYear}`,
          sql`MONTH(date) = ${targetMonth}`
        )
      ),
    // Monthly quote direct costs (project costs) for accepted quotes in selected month
    db
      .select({ total: sql<number>`SUM(${quoteCosts.amount})` })
      .from(quoteCosts)
      .innerJoin(quotes, eq(quoteCosts.quoteId, quotes.id))
      .where(
        and(
          eq(quotes.status, "accepted"),
          sql`(
            (${quotes.shootingDate} IS NOT NULL AND ${quotes.shootingDate} != '' AND YEAR(STR_TO_DATE(${quotes.shootingDate}, '%Y-%m-%d')) = ${targetYear} AND MONTH(STR_TO_DATE(${quotes.shootingDate}, '%Y-%m-%d')) = ${targetMonth})
            OR
            ((${quotes.shootingDate} IS NULL OR ${quotes.shootingDate} = '') AND YEAR(${quotes.createdAt}) = ${targetYear} AND MONTH(${quotes.createdAt}) = ${targetMonth})
          )`
        )
      ),
  ]);

  const monthlyRevenue = Number(acceptedQuotesForMonth[0]?.total ?? 0);
  const adSpend = Number(monthlyAdSpend[0]?.total ?? 0);
  const businessExpenses = Number(monthlyExpensesResult[0]?.total ?? 0);
  const projectCosts = Number(monthlyProjectCostsResult[0]?.total ?? 0);
  const grossProfit = monthlyRevenue - projectCosts;
  const netProfit = monthlyRevenue - adSpend - businessExpenses;

  return {
    monthlyRevenue,
    adSpend,
    businessExpenses,
    netProfit,
    grossProfit,
    projectCosts,
  };
}

// Full dashboard stats (detailed analytics)
export async function getDashboardStats(year?: number, month?: number) {
  const db = await getDb();
  if (!db) return null;

  const now = new Date();
  const targetYear = year ?? now.getFullYear();
  const targetMonth = month ?? (now.getMonth() + 1);

  // Build 6-month window for trend chart
  const months6: { year: number; month: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(targetYear, targetMonth - 1 - i, 1);
    months6.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }

  const [
    allQuotesForMonth,
    acceptedQuotesForMonth,
    acceptedQuotesByCreatedAt,
    rejectedQuotesForMonth,
    monthlyAdSpend,
    monthlyAdSpendByPlatform,
    recentQuotes,
    revenueTrend,
    adSpendTrend,
    sourceDistribution,
    monthlyExpensesResult,
    monthlyProjectCostsResult,
  ] = await Promise.all([
    // All quotes for selected month (by createdAt) — 總詢價／開單軸
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(quotes)
      .where(
        and(
          sql`YEAR(createdAt) = ${targetYear}`,
          sql`MONTH(createdAt) = ${targetMonth}`
        )
      ),
    // Accepted quotes for selected month (revenue / 已成交):
    // - If shootingDate exists: use shootingDate
    // - If no shootingDate: fall back to createdAt
    db
      .select({ count: sql<number>`COUNT(*)`, total: sql<number>`SUM(total)` })
      .from(quotes)
      .where(
        and(
          eq(quotes.status, "accepted"),
          sql`(
            (shootingDate IS NOT NULL AND shootingDate != '' AND YEAR(STR_TO_DATE(shootingDate, '%Y-%m-%d')) = ${targetYear} AND MONTH(STR_TO_DATE(shootingDate, '%Y-%m-%d')) = ${targetMonth})
            OR
            ((shootingDate IS NULL OR shootingDate = '') AND YEAR(createdAt) = ${targetYear} AND MONTH(createdAt) = ${targetMonth})
          )`
        )
      ),
    // Accepted quotes by createdAt month — 成交率分母／分子同一開單軸
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(quotes)
      .where(
        and(
          eq(quotes.status, "accepted"),
          sql`YEAR(createdAt) = ${targetYear}`,
          sql`MONTH(createdAt) = ${targetMonth}`
        )
      ),
    // Rejected quotes for selected month (by createdAt)
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(quotes)
      .where(
        and(
          eq(quotes.status, "rejected"),
          sql`YEAR(createdAt) = ${targetYear}`,
          sql`MONTH(createdAt) = ${targetMonth}`
        )
      ),
    // Monthly ad spend for selected month
    db
      .select({ total: sql<number>`SUM(amount)` })
      .from(adExpenses)
      .where(and(eq(adExpenses.year, targetYear), eq(adExpenses.month, targetMonth))),
    // Monthly ad spend by platform (for subtitle display)
    db
      .select({ platform: adExpenses.platform, total: sql<number>`SUM(amount)` })
      .from(adExpenses)
      .where(and(eq(adExpenses.year, targetYear), eq(adExpenses.month, targetMonth)))
      .groupBy(adExpenses.platform),
    // Recent 5 quotes
    db.select().from(quotes).orderBy(desc(quotes.createdAt)).limit(5),
    // Revenue trend: last 6 months (accepted quotes):
    // - If shootingDate exists: use shootingDate
    // - If no shootingDate: fall back to createdAt
    db
      .select({
        year: sql<number>`CASE WHEN shootingDate IS NOT NULL AND shootingDate != '' THEN YEAR(STR_TO_DATE(shootingDate, '%Y-%m-%d')) ELSE YEAR(createdAt) END`,
        month: sql<number>`CASE WHEN shootingDate IS NOT NULL AND shootingDate != '' THEN MONTH(STR_TO_DATE(shootingDate, '%Y-%m-%d')) ELSE MONTH(createdAt) END`,
        revenue: sql<number>`SUM(total)`,
        count: sql<number>`COUNT(*)`
      })
      .from(quotes)
      .where(
        and(
          eq(quotes.status, "accepted"),
          sql`(
            (shootingDate IS NOT NULL AND shootingDate != '' AND (YEAR(STR_TO_DATE(shootingDate, '%Y-%m-%d')) * 100 + MONTH(STR_TO_DATE(shootingDate, '%Y-%m-%d'))) >= ${months6[0].year * 100 + months6[0].month} AND (YEAR(STR_TO_DATE(shootingDate, '%Y-%m-%d')) * 100 + MONTH(STR_TO_DATE(shootingDate, '%Y-%m-%d'))) <= ${targetYear * 100 + targetMonth})
            OR
            ((shootingDate IS NULL OR shootingDate = '') AND (YEAR(createdAt) * 100 + MONTH(createdAt)) >= ${months6[0].year * 100 + months6[0].month} AND (YEAR(createdAt) * 100 + MONTH(createdAt)) <= ${targetYear * 100 + targetMonth})
          )`
        )
      )
      .groupBy(
        sql`CASE WHEN shootingDate IS NOT NULL AND shootingDate != '' THEN YEAR(STR_TO_DATE(shootingDate, '%Y-%m-%d')) ELSE YEAR(createdAt) END`,
        sql`CASE WHEN shootingDate IS NOT NULL AND shootingDate != '' THEN MONTH(STR_TO_DATE(shootingDate, '%Y-%m-%d')) ELSE MONTH(createdAt) END`
      ),
    // Ad spend trend: last 6 months
    db
      .select({
        year: adExpenses.year,
        month: adExpenses.month,
        total: sql<number>`SUM(amount)`
      })
      .from(adExpenses)
      .where(
        and(
          sql`(year * 100 + month) >= ${months6[0].year * 100 + months6[0].month}`,
          sql`(year * 100 + month) <= ${targetYear * 100 + targetMonth}`
        )
      )
      .groupBy(adExpenses.year, adExpenses.month),
    // Source distribution: group by leadSource (actual platform tracking)
    db
      .select({
        leadSource: quotes.leadSource,
        count: sql<number>`COUNT(*)`
      })
      .from(quotes)
      .where(
        and(
          sql`YEAR(createdAt) = ${targetYear}`,
          sql`MONTH(createdAt) = ${targetMonth}`
        )
      )
      .groupBy(quotes.leadSource),
    // Monthly business expenses for selected month
    db
      .select({ total: sql<number>`SUM(amount)` })
      .from(expenses)
      .where(
        and(
          sql`YEAR(date) = ${targetYear}`,
          sql`MONTH(date) = ${targetMonth}`
        )
      ),
    // Monthly quote direct costs (project costs) for accepted quotes in selected month
    db
      .select({ total: sql<number>`SUM(${quoteCosts.amount})` })
      .from(quoteCosts)
      .innerJoin(quotes, eq(quoteCosts.quoteId, quotes.id))
      .where(
        and(
          eq(quotes.status, "accepted"),
          sql`(
            (${quotes.shootingDate} IS NOT NULL AND ${quotes.shootingDate} != '' AND YEAR(STR_TO_DATE(${quotes.shootingDate}, '%Y-%m-%d')) = ${targetYear} AND MONTH(STR_TO_DATE(${quotes.shootingDate}, '%Y-%m-%d')) = ${targetMonth})
            OR
            ((${quotes.shootingDate} IS NULL OR ${quotes.shootingDate} = '') AND YEAR(${quotes.createdAt}) = ${targetYear} AND MONTH(${quotes.createdAt}) = ${targetMonth})
          )`
        )
      ),
  ]);

  const totalQuotesCount = Number(allQuotesForMonth[0]?.count ?? 0);
  const acceptedCount = Number(acceptedQuotesForMonth[0]?.count ?? 0);
  const acceptedByCreatedCount = Number(acceptedQuotesByCreatedAt[0]?.count ?? 0);
  const rejectedCount = Number(rejectedQuotesForMonth[0]?.count ?? 0);
  const monthlyRevenue = Number(acceptedQuotesForMonth[0]?.total ?? 0);
  const adSpend = Number(monthlyAdSpend[0]?.total ?? 0);
  // 成交率：本月開單中已接受比例（分子分母同一 createdAt 軸，避免 >100%）
  const conversionRate = totalQuotesCount > 0 ? Math.round((acceptedByCreatedCount / totalQuotesCount) * 100) : 0;
  const costPerQuote = totalQuotesCount > 0 ? Math.round(adSpend / totalQuotesCount) : 0;
  const businessExpenses = Number(monthlyExpensesResult[0]?.total ?? 0);
  const projectCosts = Number(monthlyProjectCostsResult[0]?.total ?? 0);
  const grossProfit = monthlyRevenue - projectCosts;
  const grossMargin = monthlyRevenue > 0 ? Math.round((grossProfit / monthlyRevenue) * 100) : null;
  const netProfit = monthlyRevenue - adSpend - businessExpenses;
  const roas = adSpend > 0 ? Math.round((monthlyRevenue / adSpend) * 10) / 10 : null;

  // Build trend chart data (fill missing months with 0)
  const revMap: Record<string, number> = {};
  for (const r of revenueTrend) {
    revMap[`${r.year}-${r.month}`] = Number(r.revenue);
  }
  const adMap: Record<string, number> = {};
  for (const r of adSpendTrend) {
    adMap[`${r.year}-${r.month}`] = Number(r.total);
  }
  const trendData = months6.map(({ year: y, month: m }) => ({
    label: `${m}月`,
    revenue: revMap[`${y}-${m}`] ?? 0,
    adSpend: adMap[`${y}-${m}`] ?? 0,
  }));

  // Build ad spend platform labels
  const PLATFORM_LABELS: Record<string, string> = {
    hellotoby: "HelloToby",
    "360pro": "360Pro",
    freehunter: "FreeHunter",
    google_ads: "Google Ads",
  };
  const adSpendPlatforms = monthlyAdSpendByPlatform
    .filter((r) => Number(r.total) > 0)
    .map((r) => PLATFORM_LABELS[r.platform] ?? r.platform);

  return {
    // KPI cards
    monthlyRevenue,
    adSpend,
    adSpendPlatforms,
    businessExpenses,
    netProfit,
    costPerQuote,
    projectCosts,
    grossProfit,
    grossMargin,
    // Stats cards
    totalQuotes: totalQuotesCount,
    acceptedQuotes: acceptedCount,
    rejectedQuotes: rejectedCount,
    conversionRate,
    roas,
    // Charts
    trendData,
    sourceDistribution: sourceDistribution.map((r) => ({
      name: r.leadSource ?? "未知",
      value: Number(r.count),
    })),
    // Legacy
    totalRevenue: Number(acceptedQuotesForMonth[0]?.total ?? 0),
    monthlyAdSpend: adSpend,
    recentQuotes,
  };
}
// --- Platform Credentials ---

// Derive a fixed 32-byte key from JWT_SECRET using SHA-256 to ensure correct AES-256 key length
const _rawSecret = process.env.JWT_SECRET || "jd-studio-secret-key-for-encryption";
const ENCRYPTION_KEY = crypto.createHash("sha256").update(_rawSecret).digest();
const IV_LENGTH = 16;

function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

function decrypt(text: string): string {
  const [ivHex, encryptedHex] = text.split(":");
  if (!ivHex || !encryptedHex) return "";
  const iv = Buffer.from(ivHex, "hex");
  const encryptedText = Buffer.from(encryptedHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

export async function savePlatformCredential(
  platform: InsertPlatformCredential["platform"],
  email: string,
  password: string
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const encryptedPassword = encrypt(password);
  await db
    .insert(platformCredentials)
    .values({ platform, loginEmail: email, loginPassword: encryptedPassword, isActive: 1 })
    .onDuplicateKeyUpdate({
      set: { loginEmail: email, loginPassword: encryptedPassword, isActive: 1, updatedAt: new Date() },
    });
}

export async function getPlatformCredential(platform: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select()
    .from(platformCredentials)
    .where(eq(platformCredentials.platform, platform as any))
    .limit(1);
  if (!result[0]) return null;
  const cred = result[0];
  return {
    ...cred,
    loginPassword: cred.loginPassword ? decrypt(cred.loginPassword) : null,
  };
}

export async function getAllPlatformCredentials() {
  const db = await getDb();
  if (!db) return [];
  const result = await db.select().from(platformCredentials);
  // Return without decrypted passwords for listing
  return result.map((c) => ({
    ...c,
    loginPassword: c.loginPassword ? "••••••••" : null,
    hasPassword: !!c.loginPassword,
  }));
}

export async function deletePlatformCredential(platform: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(platformCredentials).where(eq(platformCredentials.platform, platform as any));
}

// ─── PRO360 Cookie Session (replaces Google OAuth) ────────────────
// We reuse the loginPassword column to store the encrypted cookie JSON,
// and loginEmail to store the PRO360 account email for display.
export async function savePro360Cookies(
  cookiesJson: string,
  accountEmail?: string
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const encryptedCookies = encrypt(cookiesJson);
  const email = accountEmail || "pro360@session";
  await db
    .insert(platformCredentials)
    .values({ platform: "360pro", loginEmail: email, loginPassword: encryptedCookies, isActive: 1 })
    .onDuplicateKeyUpdate({
      set: { loginEmail: email, loginPassword: encryptedCookies, isActive: 1, updatedAt: new Date() },
    });
}

export async function getPro360Cookies(): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select()
    .from(platformCredentials)
    .where(eq(platformCredentials.platform, "360pro"))
    .limit(1);
  if (!result[0]?.loginPassword) return null;
  try {
    return decrypt(result[0].loginPassword);
  } catch {
    return null;
  }
}

// ─── HelloToby Cookie Session (replaces Google OAuth) ───────────────────────
// We reuse the loginPassword column to store the encrypted cookie JSON,
// and loginEmail to store the HelloToby account email for display.
export async function saveHelloTobyCookies(
  cookiesJson: string,
  accountEmail?: string
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const encryptedCookies = encrypt(cookiesJson);
  const email = accountEmail || "hellotoby@session";
  await db
    .insert(platformCredentials)
    .values({ platform: "hellotoby", loginEmail: email, loginPassword: encryptedCookies, isActive: 1 })
    .onDuplicateKeyUpdate({
      set: { loginEmail: email, loginPassword: encryptedCookies, isActive: 1, updatedAt: new Date() },
    });
}

export async function getHelloTobyCookies(): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select()
    .from(platformCredentials)
    .where(eq(platformCredentials.platform, "hellotoby"))
    .limit(1);
  if (!result[0]?.loginPassword) return null;
  try {
    return decrypt(result[0].loginPassword);
  } catch {
    return null;
  }
}

// ─── Platform Efficiency Analysis ─────────────────────────────────────────────
/**
 * 平台效益分析底層邏輯（業界標準雙指標體系）
 *
 * 數據來源（精確匹配）：
 *  - ad_expenses 表：廣告開支、退款（僅付費平台）
 *  - quotes.leadSource 欄位：精確識別詢價來源平台
 *    可選值：HelloToby / PRO360 / FreelanceHunter / Google / Repeat / 其他
 *  - expenses 表：直接服務成本（transport + equipment_rent + equipment_buy + staff）
 *
 * 指標體系（業界標準）：
 *  - 詢價數 (totalLeads)       = COUNT(*) FROM quotes WHERE leadSource = platform（該年 createdAt，不論 status）
 *  - 成交數 (conversions)      = status = 'accepted'：有 shootingDate 按拍攝年；無則按開單年 createdAt
 *  - 成交收入 (revenue)        = 同上條件之 SUM(total)
 *  - 成交率 (conversionRate)   = conversions / totalLeads * 100
 *  - 廣告開支 (adSpend)        = SUM(amount) FROM ad_expenses
 *  - 淨廣告開支 (netAdSpend)   = adSpend - refund
 *  - CPL (每詢價廣告成本)      = netAdSpend / totalLeads
 *  - CPA (每成交廣告成本)      = netAdSpend / conversions
 *
 *  ── 業界雙指標 ──
 *  - ROAS (廣告回報率)         = revenue / netAdSpend
 *    衡量廣告效率：每 $1 廣告開支帶來多少收入
 *    業界基準：服務業 ROAS ≥ 3 為良好，≥ 5 為優秀
 *
 *  - 真實 ROI (真實投資回報率) = (revenue - netAdSpend - allocatedServiceCost) / (netAdSpend + allocatedServiceCost) * 100
 *    衡量真實盈利：扣除廣告開支及按比例分攤的直接服務成本後的實際利潤率
 *    allocatedServiceCost = 全年直接服務成本 × (該平台成交收入 / 全年總成交收入)
 *    直接服務成本 = transport + equipment_rent + equipment_buy + staff（不含 software/office 等固定成本）
 *
 *  - LTV/CAC 比率              = 客戶終身價值 / 每客戶獲取成本
 *    LTV = 平均成交金額 × 平均回購次數（以 Repeat 詢價數估算）
 *    CAC = netAdSpend / conversions（即 CPA）
 *    業界黃金比率：LTV/CAC ≥ 3:1
 *
 * 綜合評分 (0-100)：
 *  - ROAS 佔 40%（以 ROAS=5 為滿分基準；無廣告開支則以成交率替代）
 *  - 成交率 佔 30%（以 30% 成交率為滿分基準）
 *  - CPL 效率 佔 20%（成本越低分越高；無廣告開支得滿分）
 *  - 趨勢 佔 10%（近期開支趨勢是否下降）
 */
export async function getPlatformEfficiency(year: number) {
  const db = await getDb();
  if (!db) return null;

  // 平台定義：leadSource 值 → 廣告開支平台 key（null = 無廣告開支）
  const PLATFORM_DEFS = [
    { key: "hellotoby",  leadSource: "HelloToby",       adKey: "hellotoby" as const,  label: "HelloToby",  hasAd: true,  adType: "cpc" },
    { key: "360pro",     leadSource: "PRO360",          adKey: "360pro" as const,      label: "360Pro",     hasAd: true,  adType: "cpc" },
    { key: "freehunter", leadSource: "FreelanceHunter", adKey: "freehunter" as const,  label: "FreeHunter", hasAd: true,  adType: "subscription" },
    { key: "google_ads", leadSource: "Google",          adKey: "google_ads" as const,  label: "Google Ads", hasAd: true,  adType: "cpc" },
    { key: "instagram",  leadSource: "Instagram",       adKey: null,                   label: "Instagram",  hasAd: false, adType: "none" },
    { key: "facebook",   leadSource: "Facebook",        adKey: null,                   label: "Facebook",   hasAd: false, adType: "none" },
    { key: "88db",       leadSource: "88DB",            adKey: null,                   label: "88DB",       hasAd: false, adType: "none" },
    { key: "referral",   leadSource: "Referral",        adKey: null,                   label: "朋友介紹",   hasAd: false, adType: "none" },
    { key: "website",    leadSource: "Website",         adKey: null,                   label: "自家網站",   hasAd: false, adType: "none" },
    { key: "repeat",     leadSource: "Repeat",          adKey: null,                   label: "回頭客",     hasAd: false, adType: "none" },
    { key: "other",      leadSource: "Other",           adKey: null,                   label: "其他",       hasAd: false, adType: "none" },
  ];

  // 1. 全年廣告開支 + 退款（按平台）
  const adData = await db
    .select({
      platform: adExpenses.platform,
      totalSpend: sql<number>`SUM(amount)`,
      totalRefund: sql<number>`SUM(refundAmount)`,
      totalImpressions: sql<number>`SUM(impressions)`,
      totalClicks: sql<number>`SUM(clicks)`,
    })
    .from(adExpenses)
    .where(eq(adExpenses.year, year))
    .groupBy(adExpenses.platform);

  // 2. 月度廣告趨勢（按平台）
  const trendData = await db
    .select({
      platform: adExpenses.platform,
      month: adExpenses.month,
      spend: sql<number>`SUM(amount)`,
      refund: sql<number>`SUM(refundAmount)`,
    })
    .from(adExpenses)
    .where(eq(adExpenses.year, year))
    .groupBy(adExpenses.platform, adExpenses.month)
    .orderBy(adExpenses.month);

  // 3. 從 quotes.leadSource 精確查詢各平台詢價數、成交數、收入
  // 詢價數（totalLeads）：該年 createdAt 全部報價（不論是否接受）
  // 成交數／收入：已接受；有拍攝日按拍攝年，無拍攝日按開單年 createdAt（與 Dashboard 一致）
  const yearStart = `${year}-01-01 00:00:00`;
  const yearEnd = `${year + 1}-01-01 00:00:00`;

  // 3a. 詢價數：按 createdAt 統計（所有 status）
  const leadSummary = await db
    .select({
      leadSource: quotes.leadSource,
      count: sql<number>`COUNT(*)`,
    })
    .from(quotes)
    .where(sql`createdAt >= ${yearStart} AND createdAt < ${yearEnd}`)
    .groupBy(quotes.leadSource);

  // 3b. 成交數 + 收入：已接受；有 shootingDate → 拍攝年；否則 → createdAt 年
  const acceptedSummary = await db
    .select({
      leadSource: quotes.leadSource,
      count: sql<number>`COUNT(*)`,
      revenue: sql<number>`SUM(total)`,
    })
    .from(quotes)
    .where(sql`
      status = 'accepted'
      AND (
        (shootingDate IS NOT NULL AND shootingDate != '' AND YEAR(STR_TO_DATE(shootingDate, '%Y-%m-%d')) = ${year})
        OR
        ((shootingDate IS NULL OR shootingDate = '') AND createdAt >= ${yearStart} AND createdAt < ${yearEnd})
      )
    `)
    .groupBy(quotes.leadSource);

  const quotesBySource: Record<string, { total: number; accepted: number; revenue: number }> = {};
  for (const row of leadSummary) {
    const src = (row.leadSource && row.leadSource.trim() !== "") ? row.leadSource : "unknown";
    if (!quotesBySource[src]) quotesBySource[src] = { total: 0, accepted: 0, revenue: 0 };
    quotesBySource[src].total += Number(row.count);
  }
  for (const row of acceptedSummary) {
    const src = (row.leadSource && row.leadSource.trim() !== "") ? row.leadSource : "unknown";
    if (!quotesBySource[src]) quotesBySource[src] = { total: 0, accepted: 0, revenue: 0 };
    quotesBySource[src].accepted += Number(row.count);
    quotesBySource[src].revenue += Number(row.revenue ?? 0);
  }

  // 4. 查詢直接服務成本（用於計算真實 ROI）
  // 直接成本：transport + equipment_rent + equipment_buy + staff
  // 不含 software/office 等固定成本（屬於間接成本，無論有沒有平台詢價都會發生）
  const dcResult = await db
    .select({ total: sql<number>`SUM(amount)` })
    .from(expenses)
    .where(sql`date >= ${yearStart} AND date < ${yearEnd} AND category IN ('transport','equipment_rent','equipment_buy','staff')`);
  const totalDirectServiceCost = Number(dcResult[0]?.total ?? 0);

  // 5. 計算全年總成交收入（用於按比例分攤服務成本）
  const totalAcceptedRevenue = Object.values(quotesBySource).reduce((s, q) => s + q.revenue, 0);

  // 6. 計算 LTV（客戶終身價值）用於 LTV/CAC 比率
  // LTV = 平均成交金額 × 平均回購次數
  // 平均回購次數 = 1 + (Repeat 詢價成交數 / 全年總成交客戶數)
  const totalConversionsAll = Object.values(quotesBySource).reduce((s, q) => s + q.accepted, 0);
  const repeatConversions = quotesBySource["Repeat"]?.accepted ?? 0;
  const avgRepurchaseRate = totalConversionsAll > 0 ? 1 + (repeatConversions / totalConversionsAll) : 1;
  const avgDealValue = totalConversionsAll > 0 ? totalAcceptedRevenue / totalConversionsAll : 0;
  const ltv = avgDealValue * avgRepurchaseRate;

  // 6b. Follow-up → win + email open rate by leadSource
  const followUpMetrics = await db
    .select({
      leadSource: quotes.leadSource,
      sent: sql<number>`COUNT(*)`,
      wins: sql<number>`SUM(CASE WHEN ${quotes.status} = 'accepted' THEN 1 ELSE 0 END)`,
    })
    .from(quoteFollowUps)
    .innerJoin(quotes, eq(quoteFollowUps.quoteId, quotes.id))
    .where(sql`
      ${quoteFollowUps.followUpSentAt} IS NOT NULL
      AND ${quoteFollowUps.followUpSentAt} > '1971-01-01'
      AND ${quotes.createdAt} >= ${yearStart} AND ${quotes.createdAt} < ${yearEnd}
    `)
    .groupBy(quotes.leadSource);

  const openMetrics = await db
    .select({
      leadSource: quotes.leadSource,
      emailsSent: sql<number>`COUNT(*)`,
      emailsOpened: sql<number>`SUM(CASE WHEN ${emailLogs.openedAt} IS NOT NULL THEN 1 ELSE 0 END)`,
    })
    .from(emailLogs)
    .innerJoin(quotes, eq(emailLogs.quoteId, quotes.id))
    .where(sql`${quotes.createdAt} >= ${yearStart} AND ${quotes.createdAt} < ${yearEnd}`)
    .groupBy(quotes.leadSource);

  const fuBySource: Record<string, { sent: number; wins: number }> = {};
  for (const row of followUpMetrics) {
    const src = (row.leadSource && row.leadSource.trim() !== "") ? row.leadSource : "unknown";
    fuBySource[src] = { sent: Number(row.sent), wins: Number(row.wins) };
  }
  const openBySource: Record<string, { emailsSent: number; emailsOpened: number }> = {};
  for (const row of openMetrics) {
    const src = (row.leadSource && row.leadSource.trim() !== "") ? row.leadSource : "unknown";
    openBySource[src] = { emailsSent: Number(row.emailsSent), emailsOpened: Number(row.emailsOpened) };
  }

  // 7. 計算各平台效益指標
  const platformStats = PLATFORM_DEFS.map(def => {
    const ad = def.adKey ? adData.find(r => r.platform === def.adKey) : null;
    const spend = Number(ad?.totalSpend ?? 0);
    const refund = Number(ad?.totalRefund ?? 0);
    // HelloToby: refund = coins returned to wallet (not a cash refund), so net spend = full purchase amount
    const netAdSpend = def.key === "hellotoby" ? spend : spend - refund;  // 淨廣告開支
    const refundRate = spend > 0 ? (refund / spend) * 100 : 0;
    const totalImpressions = ad?.totalImpressions ? Number(ad.totalImpressions) : null;
    const totalClicks = ad?.totalClicks ? Number(ad.totalClicks) : null;
    // CPC = 淨廣告開支 / 點擊數（實際 CPC）
    const cpc = totalClicks && totalClicks > 0 && netAdSpend > 0 ? netAdSpend / totalClicks : null;
    // CTR = 點擊數 / 曝光次數
    const ctr = totalImpressions && totalImpressions > 0 && totalClicks ? (totalClicks / totalImpressions) * 100 : null;

    const q = quotesBySource[def.leadSource] ?? { total: 0, accepted: 0, revenue: 0 };
    const totalLeads = q.total;
    const conversions = q.accepted;
    const revenue = q.revenue;

    const conversionRate = totalLeads > 0 ? (conversions / totalLeads) * 100 : 0;
    const cpl = totalLeads > 0 && netAdSpend > 0 ? netAdSpend / totalLeads : null;
    const cpa = conversions > 0 && netAdSpend > 0 ? netAdSpend / conversions : null;

    // ── 業界雙指標 ──
    // ROAS：廣告回報率 = 收入 / 淨廣告開支（衡量廣告效率）
    // 業界基準：服務業 ROAS ≥ 3 為良好，≥ 5 為優秀
    const roas = netAdSpend > 0 ? revenue / netAdSpend : null;

    // 真實 ROI：扣除廣告開支 + 按收入比例分攤的直接服務成本
    // allocatedServiceCost = 全年直接服務成本 × (該平台成交收入 / 全年總成交收入)
    const revenueShare = totalAcceptedRevenue > 0 ? revenue / totalAcceptedRevenue : 0;
    const allocatedServiceCost = totalDirectServiceCost * revenueShare;
    const totalCost = netAdSpend + allocatedServiceCost;
    const trueRoi = totalCost > 0 ? ((revenue - totalCost) / totalCost) * 100 : null;

    // LTV/CAC 比率（僅付費平台有意義）
    const ltvCacRatio = cpa !== null && cpa > 0 ? ltv / cpa : null;

    // ── 綜合評分 (0-100) ──
    // 改用 ROAS 作為廣告效率主指標（以 ROAS=5 為滿分）
    // 無廣告開支的平台（回頭客）：以成交率替代 ROAS 評分
    const effectiveRoas = roas ?? (def.hasAd ? null : (conversionRate > 0 ? conversionRate / 20 : null));
    const roasScore = effectiveRoas !== null ? Math.min((Math.max(effectiveRoas, 0) / 5) * 40, 40) : 0;
    const convScore = Math.min((conversionRate / 30) * 30, 30);
    const cplScore = !def.hasAd ? 20 : (cpl !== null ? Math.min((Math.max(0, (200 - cpl) / 200)) * 20, 20) : (netAdSpend === 0 && totalLeads === 0 ? 0 : 10));

    const platformMonths = def.adKey
      ? trendData.filter(r => r.platform === def.adKey).sort((a, b) => a.month - b.month)
      : [];
    let trendScore = 5;
    if (platformMonths.length >= 2) {
      const last = Number(platformMonths[platformMonths.length - 1].spend) - Number(platformMonths[platformMonths.length - 1].refund);
      const prev = Number(platformMonths[platformMonths.length - 2].spend) - Number(platformMonths[platformMonths.length - 2].refund);
      if (last < prev * 0.9) trendScore = 10;
      else if (last > prev * 1.2) trendScore = 2;
      else trendScore = 6;
    } else if (!def.hasAd) {
      trendScore = 8;
    }

    const overallScore = Math.round(roasScore + convScore + cplScore + trendScore);

    let grade: "S" | "A" | "B" | "C" | "D" = "D";
    if (overallScore >= 80) grade = "S";
    else if (overallScore >= 65) grade = "A";
    else if (overallScore >= 50) grade = "B";
    else if (overallScore >= 35) grade = "C";

    const fu = fuBySource[def.leadSource] ?? { sent: 0, wins: 0 };
    const om = openBySource[def.leadSource] ?? { emailsSent: 0, emailsOpened: 0 };
    const followUpWinRate = fu.sent > 0 ? Math.round((fu.wins / fu.sent) * 1000) / 10 : null;
    const openRate = om.emailsSent > 0 ? Math.round((om.emailsOpened / om.emailsSent) * 1000) / 10 : null;

    return {
      platform: def.key,
      label: def.label,
      hasAd: def.hasAd,
      adType: def.adType,
      spend,
      refund,
      netSpend: netAdSpend,
      refundRate: Math.round(refundRate * 10) / 10,
      totalLeads,
      conversions,
      revenue: Math.round(revenue),
      conversionRate: Math.round(conversionRate * 10) / 10,
      cpl: cpl !== null ? Math.round(cpl) : null,
      cpa: cpa !== null ? Math.round(cpa) : null,
      // 曝光 + 點擊數據（Google Ads 手動輸入）
      impressions: totalImpressions,
      clicks: totalClicks,
      cpc: cpc !== null ? Math.round(cpc * 100) / 100 : null,             // 實際 CPC（淨開支 / 點擊數）
      ctr: ctr !== null ? Math.round(ctr * 100) / 100 : null,             // CTR 點擊率（%）
      // 業界雙指標
      roas: roas !== null ? Math.round(roas * 100) / 100 : null,           // ROAS 廣告回報率
      trueRoi: trueRoi !== null ? Math.round(trueRoi * 10) / 10 : null,   // 真實 ROI（扣除服務成本）
      allocatedServiceCost: Math.round(allocatedServiceCost),              // 分攤服務成本
      ltvCacRatio: ltvCacRatio !== null ? Math.round(ltvCacRatio * 10) / 10 : null, // LTV/CAC 比率
      followUpsSent: fu.sent,
      followUpWins: fu.wins,
      followUpWinRate,
      emailsSent: om.emailsSent,
      emailsOpened: om.emailsOpened,
      openRate,
      overallScore,
      grade,
    };
  });

  // 5. 月度廣告開支趨勢（按月份，僅付費平台）
  const adPlatformKeys = ["hellotoby", "360pro", "freehunter", "google_ads"] as const;
  const monthlyTrend: Record<number, Record<string, { spend: number; refund: number }>> = {};
  for (const row of trendData) {
    if (!monthlyTrend[row.month]) monthlyTrend[row.month] = {};
    monthlyTrend[row.month][row.platform] = { spend: Number(row.spend), refund: Number(row.refund) };
  }
  const trendByMonth = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const entry: { month: number; label: string; [key: string]: number | string } = { month: m, label: `${m}月` };
    for (const p of adPlatformKeys) {
      entry[p] = (monthlyTrend[m]?.[p]?.spend ?? 0) - (monthlyTrend[m]?.[p]?.refund ?? 0);
    }
    return entry;
  }).filter(r => adPlatformKeys.some(p => (r[p] as number) > 0));

  // 6. 最佳/最差平台（僅有數據的平台參與排名）
  const activeStats = platformStats.filter(p => p.spend > 0 || p.totalLeads > 0);
  const bestPlatform = activeStats.length > 0
    ? activeStats.reduce((best, p) => p.overallScore > best.overallScore ? p : best, activeStats[0])
    : null;
  const worstPlatform = activeStats.length > 1
    ? activeStats.reduce((worst, p) => p.overallScore < worst.overallScore ? p : worst, activeStats[0])
    : null;

  // 7. 未分類詢價（leadSource 為 null 或不在已知平台列表中）
  const knownSources = new Set(PLATFORM_DEFS.map(d => d.leadSource));
  let unclassifiedLeads = 0;
  let unclassifiedConversions = 0;
  let unclassifiedRevenue = 0;
  for (const [src, q] of Object.entries(quotesBySource)) {
    if (!knownSources.has(src) && src !== "unknown") {
      unclassifiedLeads += q.total;
      unclassifiedConversions += q.accepted;
      unclassifiedRevenue += q.revenue;
    } else if (src === "unknown") {
      unclassifiedLeads += q.total;
      unclassifiedConversions += q.accepted;
      unclassifiedRevenue += q.revenue;
    }
  }

  return {
    year,
    platformStats,
    trendByMonth,
    bestPlatform: bestPlatform?.platform ?? null,
    worstPlatform: worstPlatform?.platform ?? null,
    totalSpend: platformStats.reduce((s, p) => s + p.spend, 0),
    totalNetSpend: platformStats.reduce((s, p) => s + p.netSpend, 0),
    totalRevenue: platformStats.reduce((s, p) => s + p.revenue, 0),
    totalLeads: platformStats.reduce((s, p) => s + p.totalLeads, 0),
    totalConversions: platformStats.reduce((s, p) => s + p.conversions, 0),
    unclassifiedLeads,
    unclassifiedConversions,
    unclassifiedRevenue: Math.round(unclassifiedRevenue),
  };
}

// ─── Ad Transactions (廣告逐筆交易) ───────────────────────────────
export async function upsertAdTransaction(data: {
  platform: "hellotoby" | "360pro" | "freehunter" | "google_ads";
  transId: string;
  transDate: string;
  year: number;
  month: number;
  description?: string;
  coins?: number;
  hkdAmount: number;
  exchangeRate?: number;
  type: "expense" | "refund" | "topup";
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(adTransactions)
    .values({
      platform: data.platform,
      transId: data.transId,
      transDate: data.transDate,
      year: data.year,
      month: data.month,
      description: data.description ?? null,
      coins: data.coins != null ? String(data.coins) : null,
      hkdAmount: String(data.hkdAmount),
      exchangeRate: data.exchangeRate != null ? String(data.exchangeRate) : null,
      type: data.type,
    })
    .onDuplicateKeyUpdate({
      set: {
        transDate: data.transDate,
        description: data.description ?? null,
        coins: data.coins != null ? String(data.coins) : null,
        hkdAmount: String(data.hkdAmount),
        exchangeRate: data.exchangeRate != null ? String(data.exchangeRate) : null,
        type: data.type,
      },
    });
}

export async function getAdTransactions(opts: {
  platform?: string;
  year?: number;
  month?: number;
  type?: "expense" | "refund" | "topup";
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) return { rows: [], total: 0 };

  const conditions = [];
  if (opts.platform) conditions.push(eq(adTransactions.platform, opts.platform as any));
  if (opts.year) conditions.push(eq(adTransactions.year, opts.year));
  if (opts.month) conditions.push(eq(adTransactions.month, opts.month));
  if (opts.type) conditions.push(eq(adTransactions.type, opts.type));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, countResult] = await Promise.all([
    db
      .select()
      .from(adTransactions)
      .where(where)
      .orderBy(desc(adTransactions.transDate))
      .limit(opts.limit ?? 50)
      .offset(opts.offset ?? 0),
    db
      .select({ count: sql<number>`count(*)` })
      .from(adTransactions)
      .where(where),
  ]);

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function deleteAdTransactionsByPlatform(
  platform: "hellotoby" | "360pro" | "freehunter" | "google_ads"
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(adTransactions).where(eq(adTransactions.platform, platform));
}

// ─── Clients (客戶資料庫) ────────────────────────────────────────────
export async function getClients(opts: {
  search?: string;
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };

  const conditions = [];
  if (opts.search) {
    conditions.push(
      or(
        like(clients.name, `%${opts.search}%`),
        like(clients.company, `%${opts.search}%`),
        like(clients.email, `%${opts.search}%`),
        like(clients.phone, `%${opts.search}%`)
      )
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;

  const [data, countResult] = await Promise.all([
    db.select().from(clients).where(where).orderBy(desc(clients.updatedAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`COUNT(*)` }).from(clients).where(where),
  ]);

  return { data, total: Number(countResult[0]?.count ?? 0) };
}

export async function searchClients(query: string, limit = 10) {
  const db = await getDb();
  if (!db) return [];
  if (!query.trim()) {
    return db.select().from(clients).orderBy(desc(clients.updatedAt)).limit(limit);
  }
  return db
    .select()
    .from(clients)
    .where(
      or(
        like(clients.name, `%${query}%`),
        like(clients.company, `%${query}%`),
        like(clients.email, `%${query}%`),
        like(clients.phone, `%${query}%`)
      )
    )
    .orderBy(desc(clients.updatedAt))
    .limit(limit);
}

export async function getClientById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const [client] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
  if (!client) return null;
  // Fetch associated quotes
  const clientQuotes = await db
    .select()
    .from(quotes)
    .where(eq(quotes.clientId, id))
    .orderBy(desc(quotes.createdAt));
  return { ...client, quotes: clientQuotes };
}

export async function createClient(data: InsertClient) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(clients).values(data);
  const [newClient] = await db
    .select()
    .from(clients)
    .where(sql`id = LAST_INSERT_ID()`)
    .limit(1);
  return newClient;
}

export async function updateClient(id: number, data: Partial<InsertClient>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(clients).set(data).where(eq(clients.id, id));
  return getClientById(id);
}

export async function upsertClientFromQuote(data: {
  name: string;
  company?: string;
  email?: string;
  phone?: string;
}): Promise<{ id: number; isNew: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  // Try to find existing client by phone, then email, then name+company
  let existing: Client | undefined;
  if (data.phone) {
    const [found] = await db.select().from(clients).where(eq(clients.phone, data.phone)).limit(1);
    existing = found;
  }
  if (!existing && data.email) {
    const emailNorm = data.email.trim().toLowerCase();
    if (emailNorm) {
      const [found] = await db
        .select()
        .from(clients)
        .where(sql`LOWER(${clients.email}) = ${emailNorm}`)
        .limit(1);
      existing = found;
    }
  }
  if (!existing && data.name) {
    const conditions = [eq(clients.name, data.name)];
    if (data.company) conditions.push(eq(clients.company, data.company));
    const [found] = await db.select().from(clients).where(and(...conditions)).limit(1);
    existing = found;
  }

  if (existing) {
    // Update existing client with any new info
    const updateData: Partial<InsertClient> = {};
    if (data.company && !existing.company) updateData.company = data.company;
    if (data.email && !existing.email) updateData.email = data.email;
    if (data.phone && !existing.phone) updateData.phone = data.phone;
    if (Object.keys(updateData).length > 0) {
      await db.update(clients).set(updateData).where(eq(clients.id, existing.id));
    }
    return { id: existing.id, isNew: false };
  } else {
    // Create new client
    await db.insert(clients).values({
      name: data.name,
      company: data.company,
      email: data.email,
      phone: data.phone,
    });
    const [newClient] = await db.select().from(clients).where(sql`id = LAST_INSERT_ID()`).limit(1);
    return { id: newClient.id, isNew: true };
  }
}

export async function deleteClient(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  // Unlink quotes (set clientId to null)
  await db.update(quotes).set({ clientId: null }).where(eq(quotes.clientId, id));
  await db.delete(clients).where(eq(clients.id, id));
}

// ─── Email Logs (郵件發送記錄) ────────────────────────────────────────
export async function createEmailLog(data: InsertEmailLog): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(emailLogs).values(data);
  return (result as any)[0]?.insertId ?? 0;
}

export async function updateEmailLogOpenTracking(logId: number) {
  const db = await getDb();
  if (!db) return;
  const [existing] = await db.select().from(emailLogs).where(eq(emailLogs.id, logId)).limit(1);
  if (!existing) return;
  await db.update(emailLogs).set({
    openedAt: existing.openedAt ?? new Date(),
    openCount: (existing.openCount ?? 0) + 1,
  }).where(eq(emailLogs.id, logId));
}

export async function updateEmailLogTracking(resendMessageId: string, openedAt: Date) {
  const db = await getDb();
  if (!db) return;
  const [existing] = await db.select().from(emailLogs).where(eq(emailLogs.resendMessageId, resendMessageId)).limit(1);
  if (!existing) return;
  await db.update(emailLogs).set({
    openedAt: existing.openedAt ?? openedAt,
    openCount: (existing.openCount ?? 0) + 1,
  }).where(eq(emailLogs.resendMessageId, resendMessageId));
}

export async function getEmailLogsByQuote(quoteId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(emailLogs)
    .where(eq(emailLogs.quoteId, quoteId))
    .orderBy(desc(emailLogs.sentAt));
}

/**
 * Backfill quotes with leadSource = 'email_inquiry' (or empty) to a real PLATFORM_DEFS bucket.
 * Uses linked email_inquiry when available; otherwise → Other.
 */
export async function backfillEmailInquiryLeadSources(): Promise<{
  scanned: number;
  updated: number;
}> {
  const db = await getDb();
  if (!db) return { scanned: 0, updated: 0 };

  const { resolveQuoteLeadSource } = await import("./_core/leadSource");

  const badQuotes = await db
    .select()
    .from(quotes)
    .where(
      or(
        eq(quotes.leadSource, "email_inquiry"),
        sql`${quotes.leadSource} IS NULL OR TRIM(${quotes.leadSource}) = ''`
      )
    );

  let updated = 0;
  for (const q of badQuotes) {
    let inquiry =
      q.emailInquiryId != null
        ? (await db.select().from(emailInquiries).where(eq(emailInquiries.id, q.emailInquiryId)).limit(1))[0]
        : undefined;

    if (!inquiry) {
      const [byQuote] = await db
        .select()
        .from(emailInquiries)
        .where(eq(emailInquiries.quoteId, q.id))
        .limit(1);
      inquiry = byQuote;
    }

    const newSource = inquiry
      ? resolveQuoteLeadSource({
          fromEmail: inquiry.fromEmail,
          bodyText: inquiry.bodyText,
          subject: inquiry.subject,
          fhJobId: inquiry.fhJobId,
        })
      : "Other";

    if (newSource !== (q.leadSource ?? "")) {
      await db.update(quotes).set({ leadSource: newSource }).where(eq(quotes.id, q.id));
      updated++;
    }
  }

  return { scanned: badQuotes.length, updated };
}

// ─── Email Inquiries (郵件詢價) ──────────────────────────────────────────
export async function createEmailInquiry(data: InsertEmailInquiry) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(emailInquiries).values(data);
  const [row] = await db
    .select()
    .from(emailInquiries)
    .where(eq(emailInquiries.gmailMessageId, data.gmailMessageId))
    .limit(1);
  return row;
}

export async function getEmailInquiryById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(emailInquiries)
    .where(eq(emailInquiries.id, id))
    .limit(1);
  return row ?? null;
}
export async function getEmailInquiryByMessageId(messageId: string) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(emailInquiries)
    .where(eq(emailInquiries.gmailMessageId, messageId))
    .limit(1);
  return row ?? null;
}

/** 檢查是否已曾向某個 email 發送過高價值 meeting email 或第一封郵件（防止重複發送） */
export async function hasAlreadySentToEmail(fromEmail: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const [row] = await db
    .select({ id: emailInquiries.id })
    .from(emailInquiries)
    .where(
      and(
        eq(emailInquiries.fromEmail, fromEmail),
        or(
          eq(emailInquiries.meetingStatus, "meeting_scheduled"),
          isNotNull(emailInquiries.processedAt)
        )
      )
    )
    .limit(1);
  return !!row;
}

export async function getEmailInquiries(opts: { status?: string; limit?: number; offset?: number }) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };
  const conditions = [];
  if (opts.status && opts.status !== "all") {
    conditions.push(eq(emailInquiries.status, opts.status as any));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;
  const [data, countResult] = await Promise.all([
    db.select().from(emailInquiries).where(where).orderBy(desc(emailInquiries.receivedAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`COUNT(*)` }).from(emailInquiries).where(where),
  ]);
  return { data, total: Number(countResult[0]?.count ?? 0) };
}

export async function updateEmailInquiry(id: number, data: Partial<InsertEmailInquiry>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(emailInquiries).set(data as any).where(eq(emailInquiries.id, id));
  const [row] = await db.select().from(emailInquiries).where(eq(emailInquiries.id, id)).limit(1);
  return row;
}

// Known bot/preview User-Agent patterns
const BOT_UA_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // ── Search engine crawlers ──────────────────────────────────────────────
  { pattern: /Googlebot|Google-Read-Aloud|AdsBot-Google|GoogleImageProxy|Feedfetcher-Google/i, reason: "Googlebot / Gmail Image Proxy" },
  { pattern: /Bingbot|BingPreview|MicrosoftPreview/i, reason: "Bingbot" },
  { pattern: /facebookexternalhit|FacebookBot/i, reason: "Facebook crawler" },
  { pattern: /Twitterbot|Tweetmeme/i, reason: "Twitterbot" },
  { pattern: /LinkedInBot/i, reason: "LinkedInBot" },
  { pattern: /Slackbot|Slack-ImgProxy/i, reason: "Slackbot" },
  { pattern: /WhatsApp/i, reason: "WhatsApp preview" },
  // ── Microsoft / Outlook ─────────────────────────────────────────────────
  { pattern: /Outlook-iOS|Outlook-Android|microsoft.*office|OWA|SkypeUriPreview/i, reason: "Outlook / Microsoft preview" },
  // ── Apple ───────────────────────────────────────────────────────────────
  { pattern: /Apple.*Privacy.*Proxy|iCloud.*Private.*Relay|Applebot/i, reason: "Apple Privacy Relay / Applebot" },
  // ── Email security gateways ─────────────────────────────────────────────
  { pattern: /YahooMailProxy/i, reason: "Yahoo Mail proxy" },
  { pattern: /ProofpointPulsarProxy|Proofpoint/i, reason: "Proofpoint security" },
  { pattern: /Barracuda/i, reason: "Barracuda security" },
  { pattern: /mimecast/i, reason: "Mimecast security" },
  { pattern: /Cisco.*IronPort|Talos|CiscoEmailSecurity/i, reason: "Cisco IronPort / Talos" },
  { pattern: /Symantec|Broadcom.*Email/i, reason: "Symantec / Broadcom email gateway" },
  { pattern: /Sophos/i, reason: "Sophos email security" },
  { pattern: /TrendMicro|TMASE/i, reason: "Trend Micro email security" },
  { pattern: /Cloudflare-AMP|cloudflare.*email/i, reason: "Cloudflare email security" },
  { pattern: /MessageLabs|Symantec.*Cloud/i, reason: "MessageLabs / Symantec Cloud" },
  { pattern: /ESET.*Mail|Fortigate|FortiMail/i, reason: "ESET / Fortinet email gateway" },
  { pattern: /SpamAssassin|Postfix|Sendmail|Exim/i, reason: "Mail server scanner" },
  // ── HTTP clients / automation tools ────────────────────────────────────
  { pattern: /curl|wget|python-requests|axios|node-fetch|Go-http-client|Java\/|Ruby|PHP\/|libwww/i, reason: "HTTP client / automation" },
  // ── Generic bot patterns ────────────────────────────────────────────────
  { pattern: /bot|crawler|spider|scraper|preview|fetch|scan|check|monitor|validator/i, reason: "Generic bot / scanner" },
];

function detectBot(userAgent: string | undefined): { isBot: boolean; reason: string | null } {
  if (!userAgent) return { isBot: false, reason: null };
  for (const { pattern, reason } of BOT_UA_PATTERNS) {
    if (pattern.test(userAgent)) return { isBot: true, reason };
  }
  return { isBot: false, reason: null };
}

// In-memory cooldown store: key = `${inquiryId}:${ip}`, value = last open timestamp
const _openCooldown = new Map<string, number>();
const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes — same IP within 30 min counts as 1 open

export async function updateEmailInquiryOpenById(
  id: number,
  opts?: { ip?: string; userAgent?: string }
) {
  const db = await getDb();
  if (!db) return;
  const [existing] = await db.select().from(emailInquiries).where(eq(emailInquiries.id, id)).limit(1);
  if (!existing) return;

  const ip = opts?.ip ?? "unknown";
  const userAgent = opts?.userAgent ?? "";
  // Treat empty User-Agent as suspicious (many security scanners omit UA)
  const effectiveUA = userAgent.trim();
  const { isBot, reason: botReason } = detectBot(effectiveUA || undefined);
  // Empty UA: record the event but don't count as real open
  const isEmptyUA = !effectiveUA;

  // Cooldown dedup: same IP within 5 minutes counts as 1 open
  const cooldownKey = `${id}:${ip}`;
  const lastOpen = _openCooldown.get(cooldownKey) ?? 0;
  const now = Date.now();
  const isDuplicate = now - lastOpen < COOLDOWN_MS;
  if (!isDuplicate) {
    _openCooldown.set(cooldownKey, now);
    // Clean up old entries to prevent memory leak
    if (_openCooldown.size > 10000) {
      const cutoff = now - COOLDOWN_MS * 2;
      Array.from(_openCooldown.entries()).forEach(([k, v]) => {
        if (v < cutoff) _openCooldown.delete(k);
      });
    }
  }

  // Record every event to email_open_events (including bots and duplicates)
  await db.insert(emailOpenEvents).values({
    inquiryId: id,
    ip,
    userAgent: userAgent.slice(0, 512),
    isBot: isBot ? 1 : 0,
    botReason: botReason ?? undefined,
    openedAt: new Date(),
  } as any);

  // Only update counters if not a bot, not empty UA, and not a duplicate
  if (!isBot && !isEmptyUA && !isDuplicate) {
    await db.update(emailInquiries).set({
      replyOpenedAt: existing.replyOpenedAt ?? new Date(),
      replyOpenCount: (existing.replyOpenCount ?? 0) + 1,
      realOpenCount: (existing.realOpenCount ?? 0) + 1,
    } as any).where(eq(emailInquiries.id, id));
  } else if (!isBot && !isEmptyUA && isDuplicate) {
    // Still update total count but not realOpenCount
    await db.update(emailInquiries).set({
      replyOpenedAt: existing.replyOpenedAt ?? new Date(),
      replyOpenCount: (existing.replyOpenCount ?? 0) + 1,
    } as any).where(eq(emailInquiries.id, id));
  }
  // If isBot: don't update any counters
}
export async function updateEmailInquiryTracking(resendMessageId: string, openedAt: Date) {
  const db = await getDb();
  if (!db) return;
  const [existing] = await db.select().from(emailInquiries).where(eq(emailInquiries.replyResendMessageId, resendMessageId)).limit(1);
  if (!existing) return;
  await db.update(emailInquiries).set({
    replyOpenedAt: existing.replyOpenedAt ?? openedAt,
    replyOpenCount: (existing.replyOpenCount ?? 0) + 1,
  } as any).where(eq(emailInquiries.replyResendMessageId, resendMessageId));
}

// ─── FH Follow-up Email Helpers ────────────────────────────────────────────────

const MAX_FOLLOW_UP_RETRIES = 3;

/**
 * Returns FH email inquiries eligible for a follow-up email:
 * - First email sent >= 24 hours ago (freehunterJobs.firstEmailSentAt)
 * - No reply received (inquiry status still 'pending' or 'pending_send' or 'ignored')
 * - follow_up_sent_at is NULL (not yet sent)
 * - fh_job_id is NOT NULL (must be a FH-originated inquiry)
 * - followUpRetryCount < MAX_FOLLOW_UP_RETRIES (not exceeded retry limit)
 *
 * NOTE: We no longer require freehunterJobs.status = 'first_email_sent' because
 * the job status may change to 'imported' or 'ignored' after the first email was sent.
 * The key signal is firstEmailSentAt being set, not the job status.
 *
 * Includes detailed diagnostic logging to help debug why emails are not being sent.
 */
export async function getFHJobsPendingFollowUp(): Promise<Array<{
  inquiryId: number;
  clientEmail: string;
  clientName: string | null;
  jobTitle: string | null;
  jobDescription: string | null;
  fhJobId: number;
  firstEmailSentAt: Date | null;
}>> {
  const db = await getDb();
  if (!db) return [];

  const TWENTY_FOUR_HOURS_AGO = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Diagnostic logging: count how many records pass each filter
  const [totalFhInquiries] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(emailInquiries)
    .where(isNotNull(emailInquiries.fhJobId));

  const [notYetSent] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(emailInquiries)
    .where(and(
      isNotNull(emailInquiries.fhJobId),
      isNull((emailInquiries as any).followUpSentAt),
    ));

  const [withFirstEmail] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(emailInquiries)
    .innerJoin(freehunterJobs, eq(freehunterJobs.id, emailInquiries.fhJobId))
    .where(and(
      isNotNull(emailInquiries.fhJobId),
      isNull((emailInquiries as any).followUpSentAt),
      isNotNull(freehunterJobs.firstEmailSentAt),
    ));

  const [over24Hours] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(emailInquiries)
    .innerJoin(freehunterJobs, eq(freehunterJobs.id, emailInquiries.fhJobId))
    .where(and(
      isNotNull(emailInquiries.fhJobId),
      isNull((emailInquiries as any).followUpSentAt),
      isNotNull(freehunterJobs.firstEmailSentAt),
      lte(freehunterJobs.firstEmailSentAt, TWENTY_FOUR_HOURS_AGO),
    ));

  const [correctStatus] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(emailInquiries)
    .innerJoin(freehunterJobs, eq(freehunterJobs.id, emailInquiries.fhJobId))
    .where(and(
      isNotNull(emailInquiries.fhJobId),
      isNull((emailInquiries as any).followUpSentAt),
      isNotNull(freehunterJobs.firstEmailSentAt),
      lte(freehunterJobs.firstEmailSentAt, TWENTY_FOUR_HOURS_AGO),
      inArray(emailInquiries.status, ["pending", "pending_send", "ignored"]),
    ));

    const [withinRetryLimit] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(emailInquiries)
    .innerJoin(freehunterJobs, eq(freehunterJobs.id, emailInquiries.fhJobId))
    .where(and(
      isNotNull(emailInquiries.fhJobId),
      isNull((emailInquiries as any).followUpSentAt),
      isNotNull(freehunterJobs.firstEmailSentAt),
      lte(freehunterJobs.firstEmailSentAt, TWENTY_FOUR_HOURS_AGO),
      inArray(emailInquiries.status, ["pending", "pending_send", "ignored"]),
      sql`(${(emailInquiries as any).followUpRetryCount} IS NULL OR ${(emailInquiries as any).followUpRetryCount} < ${MAX_FOLLOW_UP_RETRIES})`,
    ));

  // Also count how many pass the NOT EXISTS filter (no non-FH reply from same email)
  const [passNotExists] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(emailInquiries)
    .innerJoin(freehunterJobs, eq(freehunterJobs.id, emailInquiries.fhJobId))
    .where(and(
      isNotNull(emailInquiries.fhJobId),
      isNull((emailInquiries as any).followUpSentAt),
      isNotNull(freehunterJobs.firstEmailSentAt),
      lte(freehunterJobs.firstEmailSentAt, TWENTY_FOUR_HOURS_AGO),
      inArray(emailInquiries.status, ["pending", "pending_send", "ignored"]),
      sql`(${(emailInquiries as any).followUpRetryCount} IS NULL OR ${(emailInquiries as any).followUpRetryCount} < ${MAX_FOLLOW_UP_RETRIES})`,
      sql`NOT EXISTS (
        SELECT 1 FROM email_inquiries AS reply
        WHERE reply.from_email = ${emailInquiries.fromEmail}
        AND reply.inq_created_at > ${freehunterJobs.firstEmailSentAt}
        AND reply.id != ${emailInquiries.id}
        AND reply.fh_job_id IS NULL
      )`,
    ));

  // Also get the actual from_email values of blocked records for debugging
  const blockedRows = await db
    .select({
      inquiryId: emailInquiries.id,
      fromEmail: emailInquiries.fromEmail,
      status: emailInquiries.status,
      replyCount: sql<number>`(
        SELECT COUNT(*) FROM email_inquiries AS reply
        WHERE reply.from_email = ${emailInquiries.fromEmail}
        AND reply.inq_created_at > ${freehunterJobs.firstEmailSentAt}
        AND reply.id != ${emailInquiries.id}
        AND reply.fh_job_id IS NULL
      )`,
    })
    .from(emailInquiries)
    .innerJoin(freehunterJobs, eq(freehunterJobs.id, emailInquiries.fhJobId))
    .where(and(
      isNotNull(emailInquiries.fhJobId),
      isNull((emailInquiries as any).followUpSentAt),
      isNotNull(freehunterJobs.firstEmailSentAt),
      lte(freehunterJobs.firstEmailSentAt, TWENTY_FOUR_HOURS_AGO),
      inArray(emailInquiries.status, ["pending", "pending_send", "ignored"]),
      sql`(${(emailInquiries as any).followUpRetryCount} IS NULL OR ${(emailInquiries as any).followUpRetryCount} < ${MAX_FOLLOW_UP_RETRIES})`,
    ))
    .limit(10);

  console.log(`[FH Follow-up] Diagnostic stats (${new Date().toISOString()}):
  - Total FH inquiries: ${totalFhInquiries?.count ?? 0}
  - Not yet sent (followUpSentAt IS NULL): ${notYetSent?.count ?? 0}
  - Has firstEmailSentAt: ${withFirstEmail?.count ?? 0}
  - Over 24 hours since first email: ${over24Hours?.count ?? 0}
  - Correct inquiry status (pending/pending_send/ignored): ${correctStatus?.count ?? 0}
  - Within retry limit (<${MAX_FOLLOW_UP_RETRIES}): ${withinRetryLimit?.count ?? 0}
  - Pass NOT EXISTS filter: ${passNotExists?.count ?? 0}
  - Blocked details: ${JSON.stringify(blockedRows.map(r => ({ id: r.inquiryId, from: r.fromEmail, status: r.status, replyCount: r.replyCount })))}`);

  // Step 1: Select eligible inquiry IDs (plain SELECT, safe for concurrent reads)
  const candidateRows = await db
    .select({ inquiryId: emailInquiries.id })
    .from(emailInquiries)
    .innerJoin(freehunterJobs, eq(freehunterJobs.id, emailInquiries.fhJobId))
    .where(
      and(
        isNotNull(emailInquiries.fhJobId),
        isNull((emailInquiries as any).followUpSentAt),
        isNotNull(freehunterJobs.firstEmailSentAt),
        lte(freehunterJobs.firstEmailSentAt, TWENTY_FOUR_HOURS_AGO),
        inArray(emailInquiries.status, ["pending", "pending_send", "ignored"]),
        // Not exceeded retry limit
        sql`(${(emailInquiries as any).followUpRetryCount} IS NULL OR ${(emailInquiries as any).followUpRetryCount} < ${MAX_FOLLOW_UP_RETRIES})`,
        // NOTE: We rely on the status filter (pending/pending_send/ignored) to exclude replied inquiries.
        // The NOT EXISTS approach was removed because it incorrectly blocked follow-ups when the same
        // client had previously sent a direct inquiry (non-FH), causing false positives.
        // When a client replies, the admin manually updates the status to 'approved'/'rejected',
        // which already prevents follow-ups from being sent.
      )
    )
    .limit(20);

  if (candidateRows.length === 0) {
    console.log(`[FH Follow-up] No candidates after all filters.`);
    return [];
  }

  console.log(`[FH Follow-up] ${candidateRows.length} candidate(s) passed all filters, claiming with SENTINEL...`);

  const candidateIds = candidateRows.map((r) => r.inquiryId);

  // Step 2: Atomic claim - UPDATE with sentinel only for rows still NULL
  // (concurrent runners that lost the race will update 0 rows for those IDs)
  // Always use the same UTC Date for write + read (avoid string/TZ mismatch).
  const SENTINEL = new Date("1970-01-01T00:00:01.000Z");
  await db.execute(sql`
    UPDATE email_inquiries
    SET follow_up_sent_at = ${SENTINEL}
    WHERE id IN (${sql.join(candidateIds.map((id) => sql`${id}`), sql`, `)})
      AND follow_up_sent_at IS NULL
  `);

  // Step 3: Fetch only the rows we successfully claimed
  const rows = await db
    .select({
      inquiryId: emailInquiries.id,
      clientEmail: freehunterJobs.clientEmail,  // Use actual client email from FH job, not the notification sender
      clientName: freehunterJobs.clientName,    // Use client name from FH job
      jobTitle: freehunterJobs.title,
      jobDescription: freehunterJobs.description,
      fhJobId: freehunterJobs.id,
      firstEmailSentAt: freehunterJobs.firstEmailSentAt,
    })
    .from(emailInquiries)
    .innerJoin(freehunterJobs, eq(freehunterJobs.id, emailInquiries.fhJobId))
    .where(
      and(
        inArray(emailInquiries.id, candidateIds),
        eq((emailInquiries as any).followUpSentAt, SENTINEL),
      )
    )
    .limit(20);

  console.log(`[FH Follow-up] Claimed ${rows.length} row(s) for sending.`);
  return rows as any;
}

/**
 * Reset the sentinel value (1970-01-01) back to NULL so the next scheduler run
 * can retry the follow-up email if sending failed.
 * Also increments the retry count and saves the error message for diagnostics.
 */
export async function resetFollowUpSentinel(inquiryId: number, errorMessage?: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const SENTINEL = new Date('1970-01-01T00:00:01.000Z');
  const errMsg = errorMessage ? errorMessage.substring(0, 512) : 'Unknown error';
  await db.execute(sql`
    UPDATE email_inquiries
    SET follow_up_sent_at = NULL,
        follow_up_retry_count = COALESCE(follow_up_retry_count, 0) + 1,
        follow_up_last_error = ${errMsg}
    WHERE id = ${inquiryId}
      AND follow_up_sent_at = ${SENTINEL}
  `);
  console.log(`[FH Follow-up] Reset SENTINEL for inquiryId=${inquiryId}, retries incremented. Error: ${errMsg}`);
}

/**
 * Mark a follow-up email as sent for the given emailInquiry.
 * Also updates the linked freehunterJob's followUpSentAt.
 */
export async function markFollowUpSent(inquiryId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const now = new Date();

  // Update emailInquiries
  await db.execute(sql`
    UPDATE email_inquiries
    SET follow_up_sent_at = ${now},
        follow_up_retry_count = 0,
        follow_up_last_error = NULL
    WHERE id = ${inquiryId}
  `);

  // Also update freehunterJobs if this inquiry is linked to one
  const inquiry = await db.select().from(emailInquiries).where(eq(emailInquiries.id, inquiryId)).limit(1).then(rows => rows[0]);
  if (inquiry?.fhJobId) {
    await db.update(freehunterJobs).set({
      followUpSentAt: now,
    }).where(eq(freehunterJobs.id, inquiry.fhJobId));
  }
}

// ─── Service Type Profitability Analysis ─────────────────────────────────────
/**
 * 服務類型盈利分析：按服務類型統計詢價數、成交數、成交率、平均成交金額
 * 用於找出最有利可圖的服務類型
 */
export async function getServiceTypeProfitability(year: number) {
  const db = await getDb();
  if (!db) return [];

  const yearStart = `${year}-01-01 00:00:00`;
  const yearEnd = `${year + 1}-01-01 00:00:00`;

  // 按服務類型統計：詢價數、成交數、總收入
  const rows = await db
    .select({
      serviceType: quotes.serviceType,
      totalQuotes: sql<number>`COUNT(*)`,
      acceptedQuotes: sql<number>`SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END)`,
      totalRevenue: sql<number>`SUM(CASE WHEN status = 'accepted' THEN CAST(total AS DECIMAL(10,2)) ELSE 0 END)`,
      avgDeal: sql<number>`AVG(CASE WHEN status = 'accepted' THEN CAST(total AS DECIMAL(10,2)) ELSE NULL END)`,
    })
    .from(quotes)
    .where(
      and(
        sql`createdAt >= ${yearStart}`,
        sql`createdAt < ${yearEnd}`
      )
    )
    .groupBy(quotes.serviceType)
    .orderBy(sql`SUM(CASE WHEN status = 'accepted' THEN CAST(total AS DECIMAL(10,2)) ELSE 0 END) DESC`);

  return rows.map(r => ({
    serviceType: r.serviceType,
    totalQuotes: Number(r.totalQuotes),
    acceptedQuotes: Number(r.acceptedQuotes),
    conversionRate: r.totalQuotes > 0 ? Math.round((Number(r.acceptedQuotes) / Number(r.totalQuotes)) * 100) : 0,
    totalRevenue: Number(r.totalRevenue ?? 0),
    avgDeal: Number(r.avgDeal ?? 0),
  }));
}

// ─── Client LTV (Lifetime Value) ─────────────────────────────────────────────
/**
 * 客戶終身價值：為每個客戶計算歷史訂單總額、成交次數、最後成交日期
 */
export async function getClientsWithLTV(opts: {
  search?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'ltv' | 'orderCount' | 'lastOrder' | 'default';
}) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };

  const conditions = [];
  if (opts.search) {
    conditions.push(
      or(
        like(clients.name, `%${opts.search}%`),
        like(clients.company, `%${opts.search}%`),
        like(clients.email, `%${opts.search}%`),
        like(clients.phone, `%${opts.search}%`)
      )
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;

  // Get all clients
  const [clientData, countResult] = await Promise.all([
    db.select().from(clients).where(where).orderBy(desc(clients.updatedAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`COUNT(*)` }).from(clients).where(where),
  ]);

  if (clientData.length === 0) return { data: [], total: 0 };

  // Batch fetch LTV data for all returned clients
  const clientIds = clientData.map(c => c.id);
  const ltvRows = await db
    .select({
      clientId: quotes.clientId,
      orderCount: sql<number>`COUNT(*)`,
      totalRevenue: sql<number>`SUM(CAST(total AS DECIMAL(10,2)))`,
      lastOrderDate: sql<string>`MAX(shootingDate)`,
    })
    .from(quotes)
    .where(
      and(
        eq(quotes.status, 'accepted'),
        sql`clientId IN (${sql.join(clientIds.map(id => sql`${id}`), sql`, `)})`
      )
    )
    .groupBy(quotes.clientId);

  const ltvMap = new Map(ltvRows.map(r => [r.clientId, r]));

  const enriched = clientData.map(c => {
    const ltv = ltvMap.get(c.id);
    return {
      ...c,
      orderCount: ltv ? Number(ltv.orderCount) : 0,
      totalRevenue: ltv ? Number(ltv.totalRevenue ?? 0) : 0,
      lastOrderDate: ltv?.lastOrderDate ?? null,
    };
  });

  // Sort by LTV if requested
  if (opts.sortBy === 'ltv') enriched.sort((a, b) => b.totalRevenue - a.totalRevenue);
  else if (opts.sortBy === 'orderCount') enriched.sort((a, b) => b.orderCount - a.orderCount);

  return { data: enriched, total: Number(countResult[0]?.count ?? 0) };
}

// ─── Review Email Tracking ────────────────────────────────────────────────────
/**
 * 找出拍攝日期為今天、且當前 HKT 時間 >= 20:00、尚未發送評價邀請、且有 clientEmail 的已接受報價單
 * 即拍攝當天晚上 8 點後才發送
 */
export async function getQuotesPendingReviewEmail() {
  const db = await getDb();
  if (!db) return [];

  // Current HKT time
  const nowHKT = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const dateStr = nowHKT.toISOString().slice(0, 10); // YYYY-MM-DD (today in HKT)
  const hourHKT = nowHKT.getUTCHours(); // 0-23 in HKT (since we already added +8h)

  // Only send after 20:00 HKT
  if (hourHKT < 20) {
    return [];
  }

  const SENTINEL = new Date("1970-01-01T00:00:01.000Z");

  const candidates = await db
    .select()
    .from(quotes)
    .where(
      and(
        eq(quotes.status, 'accepted'),
        isNotNull(quotes.clientEmail),
        sql`clientEmail != ''`,
        sql`clientEmail LIKE '%@%.%'`,
        isNotNull(quotes.shootingDate),
        sql`shootingDate != ''`,
        sql`shootingDate = ${dateStr}`,
        isNull(sql`reviewEmailSentAt` as any),
      )
    )
    .limit(20);

  if (candidates.length === 0) return [];

  const ids = candidates.map((q) => q.id);
  await db.execute(sql`
    UPDATE quotes
    SET reviewEmailSentAt = ${SENTINEL}
    WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      AND reviewEmailSentAt IS NULL
  `);

  return db
    .select()
    .from(quotes)
    .where(
      and(
        inArray(quotes.id, ids),
        eq(quotes.reviewEmailSentAt, SENTINEL as any)
      )
    )
    .limit(20);
}

/**
 * 標記報價單的評價邀請已發送
 */
export async function markReviewEmailSent(quoteId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.execute(sql`UPDATE quotes SET reviewEmailSentAt = NOW() WHERE id = ${quoteId}`);
}

/** 評價邀請發送失敗時重置 SENTINEL，讓下次可重試 */
export async function resetReviewEmailSentinel(quoteId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const SENTINEL = new Date("1970-01-01T00:00:01.000Z");
  await db.execute(sql`
    UPDATE quotes
    SET reviewEmailSentAt = NULL
    WHERE id = ${quoteId}
      AND reviewEmailSentAt = ${SENTINEL}
  `);
}

// ─── AI Analysis Reports ──────────────────────────────────────────
/**
 * 儲存 AI 分析報告
 */
export async function saveAiAnalysisReport(data: InsertAiAnalysisReport): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(aiAnalysisReports).values(data);
  // 取得剛插入的記錄 ID
  const [latest] = await db
    .select({ id: aiAnalysisReports.id })
    .from(aiAnalysisReports)
    .where(and(eq(aiAnalysisReports.year, data.year), eq(aiAnalysisReports.month, data.month)))
    .orderBy(desc(aiAnalysisReports.generatedAt))
    .limit(1);
  return latest?.id ?? 0;
}

/**
 * 取得 AI 分析歷史記錄列表（按時間倒序）
 */
export async function getAiAnalysisHistory(opts: { year?: number; month?: number; limit?: number }): Promise<AiAnalysisReport[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (opts.year) conditions.push(eq(aiAnalysisReports.year, opts.year));
  if (opts.month) conditions.push(eq(aiAnalysisReports.month, opts.month));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return db
    .select()
    .from(aiAnalysisReports)
    .where(where)
    .orderBy(desc(aiAnalysisReports.generatedAt))
    .limit(opts.limit ?? 20);
}

/**
 * 取得指定月份最新的 AI 分析報告
 */
export async function getLatestAiAnalysis(year: number, month: number): Promise<AiAnalysisReport | null> {
  const db = await getDb();
  if (!db) return null;
  const [report] = await db
    .select()
    .from(aiAnalysisReports)
    .where(and(eq(aiAnalysisReports.year, year), eq(aiAnalysisReports.month, month)))
    .orderBy(desc(aiAnalysisReports.generatedAt))
    .limit(1);
  return report ?? null;
}

// ─── Client Memberships (會員方案) ────────────────────────────────────

// 等級門檻定義
export const LOYALTY_TIERS = {
  silver: { minSpend: 0, discount: 5, anniversaryDiscount: 5, label: "銀鏡 Silver Lens" },
  golden: { minSpend: 15000, discount: 10, anniversaryDiscount: 10, label: "金鏡 Golden Lens" },
  diamond: { minSpend: 40000, discount: 20, anniversaryDiscount: 20, label: "鑽石鏡 Diamond Lens" },
  black_diamond: { minSpend: 90000, discount: 60, anniversaryDiscount: 60, label: "黑鑽石鏡+ Black Diamond Lens" },
} as const;

export type LoyaltyTier = keyof typeof LOYALTY_TIERS;

/** 根據累計消費計算應有等級 */
export function calcTier(totalSpend: number): LoyaltyTier {
  if (totalSpend >= LOYALTY_TIERS.black_diamond.minSpend) return "black_diamond";
  if (totalSpend >= LOYALTY_TIERS.diamond.minSpend) return "diamond";
  if (totalSpend >= LOYALTY_TIERS.golden.minSpend) return "golden";
  return "silver";
}

/**
 * 會員制：指定年度已接受報價合計（預設今年）。
 * 有拍攝日按拍攝年；無拍攝日按開單年（與 Dashboard 成交歸屬一致）。
 */
export async function getClientMembershipYearSpend(
  clientId: number,
  year: number = new Date().getFullYear()
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const yearStart = `${year}-01-01 00:00:00`;
  const yearEnd = `${year + 1}-01-01 00:00:00`;
  const [row] = await db
    .select({
      total: sql<number>`COALESCE(SUM(CAST(${quotes.total} AS DECIMAL(12,2))), 0)`,
    })
    .from(quotes)
    .where(
      and(
        eq(quotes.clientId, clientId),
        eq(quotes.status, "accepted"),
        sql`(
          (shootingDate IS NOT NULL AND shootingDate != '' AND YEAR(STR_TO_DATE(shootingDate, '%Y-%m-%d')) = ${year})
          OR
          ((shootingDate IS NULL OR shootingDate = '') AND ${quotes.createdAt} >= ${yearStart} AND ${quotes.createdAt} < ${yearEnd})
        )`
      )
    );
  return Number(row?.total ?? 0);
}

/** 客戶終身已接受報價合計（Clients 頁 LTV 口徑） */
export async function getClientLifetimeAcceptedSpend(clientId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({
      total: sql<number>`COALESCE(SUM(CAST(${quotes.total} AS DECIMAL(12,2))), 0)`,
    })
    .from(quotes)
    .where(and(eq(quotes.clientId, clientId), eq(quotes.status, "accepted")));
  return Number(row?.total ?? 0);
}

/**
 * 用「當年」已成交金額重算會員 totalSpend + tier（會員制按年度）
 */
export async function resyncClientMembershipFromQuotes(
  clientId: number,
  year: number = new Date().getFullYear()
): Promise<ClientMembership> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const totalSpend = await getClientMembershipYearSpend(clientId, year);
  const newTier = calcTier(totalSpend);
  const existing = await getClientMembership(clientId);
  const tierChanged = existing ? existing.tier !== newTier : true;

  if (existing) {
    await db
      .update(clientMemberships)
      .set({
        totalSpend: String(totalSpend),
        tier: newTier,
        ...(tierChanged ? { tierUpgradedAt: new Date() } : {}),
      })
      .where(eq(clientMemberships.clientId, clientId));
  } else {
    await db.insert(clientMemberships).values({
      clientId,
      tier: newTier,
      totalSpend: String(totalSpend),
      joinedAt: new Date(),
      tierUpgradedAt: new Date(),
    });
  }

  const updated = await getClientMembership(clientId);
  if (!updated) throw new Error("Failed to resync membership");
  return updated;
}

/** 取得客戶的會員資料，不存在時回傳 null */
export async function getClientMembership(clientId: number): Promise<ClientMembership | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(clientMemberships)
    .where(eq(clientMemberships.clientId, clientId))
    .limit(1);
  return row ?? null;
}

/** 取得所有會員資料（含客戶名稱），用於管理頁面 */
export async function getAllMemberships() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      id: clientMemberships.id,
      clientId: clientMemberships.clientId,
      tier: clientMemberships.tier,
      totalSpend: clientMemberships.totalSpend,
      joinedAt: clientMemberships.joinedAt,
      tierUpgradedAt: clientMemberships.tierUpgradedAt,
      notes: clientMemberships.notes,
      clientName: clients.name,
      clientEmail: clients.email,
      clientPhone: clients.phone,
    })
    .from(clientMemberships)
    .leftJoin(clients, eq(clientMemberships.clientId, clients.id))
    .orderBy(desc(clientMemberships.totalSpend));
  return rows;
}

/** 新增或更新客戶會員資料，並自動升等 */
export async function upsertClientMembership(clientId: number, additionalSpend: number = 0): Promise<ClientMembership> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const existing = await getClientMembership(clientId);
  const currentSpend = existing ? parseFloat(String(existing.totalSpend)) : 0;
  const newSpend = currentSpend + additionalSpend;
  const newTier = calcTier(newSpend);
  const tierChanged = existing ? existing.tier !== newTier : false;

  if (existing) {
    await db
      .update(clientMemberships)
      .set({
        totalSpend: String(newSpend),
        tier: newTier,
        ...(tierChanged ? { tierUpgradedAt: new Date() } : {}),
      })
      .where(eq(clientMemberships.clientId, clientId));
  } else {
    await db.insert(clientMemberships).values({
      clientId,
      tier: newTier,
      totalSpend: String(newSpend),
      joinedAt: new Date(),
      tierUpgradedAt: new Date(),
    });
  }

  const updated = await getClientMembership(clientId);
  return updated!;
}

/** 取得會員統計（各等級人數） */
export async function getMembershipStats() {
  const db = await getDb();
  if (!db) return { total: 0, silver: 0, golden: 0, diamond: 0, black_diamond: 0 };
  const rows = await db
    .select({ tier: clientMemberships.tier, count: sql<number>`COUNT(*)` })
    .from(clientMemberships)
    .groupBy(clientMemberships.tier);
  const stats: Record<string, number> = { total: 0, silver: 0, golden: 0, diamond: 0, black_diamond: 0 };
  for (const row of rows) {
    const count = Number(row.count);
    stats[row.tier] = count;
    stats.total += count;
  }
  return stats;
}

// ─── Referral Codes (推薦碼) ──────────────────────────────────────────

/** 生成唯一推薦碼（6位英數） */
function generateReferralCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

/** 為客戶建立推薦碼 */
export async function createReferralCode(referrerId: number): Promise<ReferralCode> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  // 生成唯一碼
  let code = generateReferralCode();
  let attempts = 0;
  while (attempts < 10) {
    const existing = await db.select().from(referralCodes).where(eq(referralCodes.code, code)).limit(1);
    if (existing.length === 0) break;
    code = generateReferralCode();
    attempts++;
  }

  await db.insert(referralCodes).values({ code, referrerId, rewardAmount: "200" });
  const [newCode] = await db.select().from(referralCodes).where(eq(referralCodes.code, code)).limit(1);
  return newCode;
}

/** 查詢推薦碼 */
export async function getReferralCode(code: string): Promise<ReferralCode | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(referralCodes).where(eq(referralCodes.code, code)).limit(1);
  return row ?? null;
}

/** 取得客戶的所有推薦碼 */
export async function getClientReferralCodes(referrerId: number): Promise<ReferralCode[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(referralCodes).where(eq(referralCodes.referrerId, referrerId)).orderBy(desc(referralCodes.createdAt));
}

// ─── Loyalty Emails Log (再行銷郵件記錄) ──────────────────────────────

/** 記錄再行銷郵件發送 */
export async function recordLoyaltyEmail(data: InsertLoyaltyEmailLog): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(loyaltyEmailsLog).values(data);
}

/** 查詢客戶是否已發送過某類型郵件（避免重複發送） */
export async function hasLoyaltyEmailSent(clientId: number, emailType: InsertLoyaltyEmailLog["emailType"], afterDate?: Date): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const conditions = [
    eq(loyaltyEmailsLog.clientId, clientId),
    eq(loyaltyEmailsLog.emailType, emailType),
  ];
  if (afterDate) conditions.push(sql`${loyaltyEmailsLog.sentAt} >= ${afterDate}`);
  const [row] = await db.select({ id: loyaltyEmailsLog.id }).from(loyaltyEmailsLog).where(and(...conditions)).limit(1);
  return !!row;
}

/** 取得再行銷郵件統計 */
export async function getLoyaltyEmailStats() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ emailType: loyaltyEmailsLog.emailType, count: sql<number>`COUNT(*)` })
    .from(loyaltyEmailsLog)
    .groupBy(loyaltyEmailsLog.emailType);
}

/** 取得需要發送再行銷郵件的客戶（根據拍攝後天數） */
export async function getClientsForRemarketingEmail(daysAfterShoot: 90 | 180) {
  const db = await getDb();
  if (!db) return [];

  const emailTypeMap = { 90: "day90", 180: "day180" } as const;
  const emailType = emailTypeMap[daysAfterShoot];

  // 找出 N 天前成交的報價單（status = accepted），且客戶有 email，且尚未發送過此類型郵件
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() - daysAfterShoot);
  const windowStart = new Date(targetDate);
  windowStart.setDate(windowStart.getDate() - 1); // ±1 天容差

  const rows = await db
    .select({
      quoteId: quotes.id,
      clientId: quotes.clientId,
      clientName: quotes.clientName,
      clientEmail: quotes.clientEmail,
      total: quotes.total,
      shootingDate: quotes.shootingDate,
      updatedAt: quotes.updatedAt,
    })
    .from(quotes)
    .where(
      and(
        eq(quotes.status, "accepted"),
        isNotNull(quotes.clientEmail),
        sql`${quotes.clientEmail} != ''`,
        isNotNull(quotes.clientId),
        lte(quotes.updatedAt, targetDate),
        sql`${quotes.updatedAt} >= ${windowStart}`
      )
    );

  // 過濾已發送過的
  const result = [];
  for (const row of rows) {
    if (!row.clientId || !row.clientEmail) continue;
    const alreadySent = await hasLoyaltyEmailSent(row.clientId, emailType);
    if (!alreadySent) {
      result.push({ ...row, emailType });
    }
  }
  return result;
}

/** 取得合作週年的公司客戶（首次成交日期週年前 14 天）*/
export async function getClientsForAnniversaryEmail() {
  const db = await getDb();
  if (!db) return [];
  // 找出首次成交日期的月份和日期，與今天後 14 天相符的客戶
  const target = new Date();
  target.setDate(target.getDate() + 14);
  const targetMonth = target.getMonth() + 1;
  const targetDay = target.getDate();

  const rows = await db
    .select({
      clientId: quotes.clientId,
      clientName: sql<string>`MIN(${quotes.clientName})`,
      clientEmail: sql<string>`MIN(${quotes.clientEmail})`,
      firstDealAt: sql<Date>`MIN(${quotes.updatedAt})`,
    })
    .from(quotes)
    .where(
      and(
        eq(quotes.status, "accepted"),
        isNotNull(quotes.clientId),
        isNotNull(quotes.clientEmail),
        sql`${quotes.clientEmail} != ''`,
        sql`MONTH(${quotes.updatedAt}) = ${targetMonth}`,
        sql`DAY(${quotes.updatedAt}) = ${targetDay}`
      )
    )
    .groupBy(quotes.clientId);

  const result = [];
  for (const row of rows) {
    if (!row.clientId || !row.clientEmail) continue;
    // 只發送一次（每年）
    const thisYearStart = new Date(new Date().getFullYear(), 0, 1);
    const alreadySent = await hasLoyaltyEmailSent(row.clientId, "anniversary", thisYearStart);
    if (!alreadySent) result.push(row);
  }
  return result;
}

/** 取得需要發送季節性業務提醒的客戶（農曆新年前/夏季/年底）*/
export async function getClientsForSeasonalEmail(): Promise<Array<{ clientId: number; clientName: string | null; clientEmail: string }>> {
  const db = await getDb();
  if (!db) return [];
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();

  // 觸發時機：1月1-7日（農曆新年前）、6月1-7日（夏季）、11月1-7日（年底）
  const isSeasonalWindow = (
    (month === 1 && day <= 7) ||
    (month === 6 && day <= 7) ||
    (month === 11 && day <= 7)
  );
  if (!isSeasonalWindow) return [];

  const seasonType = month === 1 ? "seasonal_cny" : month === 6 ? "seasonal_summer" : "seasonal_yearend";

  // 找出所有有 email 的成交客戶
  const rows = await db
    .select({
      clientId: quotes.clientId,
      clientName: sql<string>`MIN(${quotes.clientName})`,
      clientEmail: sql<string>`MIN(${quotes.clientEmail})`,
    })
    .from(quotes)
    .where(
      and(
        eq(quotes.status, "accepted"),
        isNotNull(quotes.clientId),
        isNotNull(quotes.clientEmail),
        sql`${quotes.clientEmail} != ''`
      )
    )
    .groupBy(quotes.clientId);

  const result = [];
  for (const row of rows) {
    if (!row.clientId || !row.clientEmail) continue;
    const thisYearStart = new Date(now.getFullYear(), 0, 1);
    const alreadySent = await hasLoyaltyEmailSent(row.clientId, seasonType as any, thisYearStart);
    if (!alreadySent) result.push({ clientId: row.clientId, clientName: row.clientName, clientEmail: row.clientEmail });
  }
  return result;
}

/** 取得超過 12 個月未成交的客戶（長期未合作提醒）*/
export async function getClientsForWinbackEmail() {
  const db = await getDb();
  if (!db) return [];
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
  const thirteenMonthsAgo = new Date();
  thirteenMonthsAgo.setMonth(thirteenMonthsAgo.getMonth() - 13);

  // 找出最後成交日期在 12-13 個月前的客戶（只觸發一次窗口）
  const rows = await db
    .select({
      clientId: quotes.clientId,
      clientName: sql<string>`MIN(${quotes.clientName})`,
      clientEmail: sql<string>`MIN(${quotes.clientEmail})`,
      lastDealAt: sql<Date>`MAX(${quotes.updatedAt})`,
    })
    .from(quotes)
    .where(
      and(
        eq(quotes.status, "accepted"),
        isNotNull(quotes.clientId),
        isNotNull(quotes.clientEmail),
        sql`${quotes.clientEmail} != ''`
      )
    )
    .groupBy(quotes.clientId)
    .having(
      and(
        sql`MAX(${quotes.updatedAt}) <= ${twelveMonthsAgo}`,
        sql`MAX(${quotes.updatedAt}) >= ${thirteenMonthsAgo}`
      )
    );

  const result = [];
  for (const row of rows) {
    if (!row.clientId || !row.clientEmail) continue;
    const alreadySent = await hasLoyaltyEmailSent(row.clientId, "winback");
    if (!alreadySent) result.push(row);
  }
  return result;
}

// ─── WhatsApp Click Tracking ──────────────────────────────────────────────

/** 記錄一次 WhatsApp 點擊事件 */
export async function recordWhatsappClick(opts: {
  inquiryId?: number;
  fhJobId?: number;
  quoteId?: number;
  source: "fh_first_email" | "fh_follow_up" | "quote_email" | "review_invite" | "other";
  ip?: string;
  userAgent?: string;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(whatsappClickEvents).values({
    inquiryId: opts.inquiryId ?? null,
    fhJobId: opts.fhJobId ?? null,
    quoteId: opts.quoteId ?? null,
    source: opts.source,
    ip: opts.ip ?? null,
    userAgent: opts.userAgent ?? null,
  });
}

/** 取得 WhatsApp 轉化率統計（按 HKT 年月；業務儀表板用當月）*/
export async function getWhatsappClickStats(opts: { year: number; month?: number }) {
  const db = await getDb();
  if (!db) return { totalClicks: 0, fhClicks: 0, bySource: [], emailsSent: 0, conversionRate: 0, year: opts.year, month: opts.month ?? null };

  // Default to current HKT month so callers never accidentally get whole-year rates
  const hktNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const year = opts.year;
  const month = opts.month ?? hktNow.getUTCMonth() + 1;

  // Timestamps stored in UTC — shift +8h so YEAR/MONTH match 香港當月
  const clickYm = sql`YEAR(${whatsappClickEvents.clickedAt} + INTERVAL 8 HOUR) = ${year}
    AND MONTH(${whatsappClickEvents.clickedAt} + INTERVAL 8 HOUR) = ${month}`;
  const emailYm = sql`YEAR(${freehunterJobs.firstEmailSentAt} + INTERVAL 8 HOUR) = ${year}
    AND MONTH(${freehunterJobs.firstEmailSentAt} + INTERVAL 8 HOUR) = ${month}`;

  const clicksBySource = await db
    .select({
      source: whatsappClickEvents.source,
      count: sql<number>`COUNT(*)`,
    })
    .from(whatsappClickEvents)
    .where(clickYm)
    .groupBy(whatsappClickEvents.source);

  const totalClicks = clicksBySource.reduce((s, r) => s + Number(r.count), 0);
  // FH outreach clicks only (matches denominator below)
  const fhClicks = clicksBySource
    .filter((r) => r.source === "fh_first_email" || r.source === "fh_follow_up")
    .reduce((s, r) => s + Number(r.count), 0);

  // 分母：該月（HKT）FH 已發第一封郵件數
  const emailsSentResult = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(freehunterJobs)
    .where(and(isNotNull(freehunterJobs.firstEmailSentAt), emailYm));
  const emailsSent = Number(emailsSentResult[0]?.count ?? 0);
  const conversionRate = emailsSent > 0 ? Math.round((fhClicks / emailsSent) * 100) : 0;

  return {
    totalClicks,
    fhClicks,
    bySource: clicksBySource.map((r) => ({ source: r.source, count: Number(r.count) })),
    emailsSent,
    conversionRate,
    year,
    month,
  };
}

// ─── Average Response Time ────────────────────────────────────────────────

/**
 * 計算平均回覆時間：從詢價收到到建立報價單的時間差（小時）
 * 只計算有關聯報價單的詢價
 */
export async function getAvgResponseTimeHours(opts: { year: number; month?: number }) {
  const db = await getDb();
  if (!db) return null;

  const conditions = [sql`YEAR(${emailInquiries.createdAt}) = ${opts.year}`];
  if (opts.month) conditions.push(sql`MONTH(${emailInquiries.createdAt}) = ${opts.month}`);

  const rows = await db
    .select({
      avgHours: sql<number>`AVG(TIMESTAMPDIFF(MINUTE, ${emailInquiries.createdAt}, ${quotes.createdAt})) / 60.0`,
      count: sql<number>`COUNT(*)`,
    })
    .from(emailInquiries)
    .innerJoin(quotes, eq(emailInquiries.quoteId, quotes.id))
    .where(and(...conditions));

  const avgHours = rows[0]?.avgHours ? Math.round(Number(rows[0].avgHours) * 10) / 10 : null;
  const count = Number(rows[0]?.count ?? 0);
  return { avgHours, count };
}

// ─── Historical Pricing Query ─────────────────────────────────────────────
/**
 * 查詢指定服務類型的歷史成交報價數據
 * 返回：平均金額、最低/最高成交金額、最近 10 筆成交的項目明細
 */
export async function getHistoricalPricingByServiceType(serviceType: string) {
  const db = await getDb();
  if (!db) return null;

  // 查詢同類型服務的成交報價統計
  const stats = await db
    .select({
      avgTotal: sql<number>`AVG(CAST(${quotes.total} AS DECIMAL(10,2)))`,
      minTotal: sql<number>`MIN(CAST(${quotes.total} AS DECIMAL(10,2)))`,
      maxTotal: sql<number>`MAX(CAST(${quotes.total} AS DECIMAL(10,2)))`,
      count: sql<number>`COUNT(*)`,
      p25: sql<number>`PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY CAST(${quotes.total} AS DECIMAL(10,2)))`,
      p75: sql<number>`PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY CAST(${quotes.total} AS DECIMAL(10,2)))`,
    })
    .from(quotes)
    .where(
      and(
        eq(quotes.serviceType, serviceType as any),
        eq(quotes.status, "accepted"),
        sql`CAST(${quotes.total} AS DECIMAL(10,2)) > 0`
      )
    );

  // 查詢最近 10 筆成交報價的項目明細（用於 AI 參考）
  const recentQuotes = await db
    .select({
      id: quotes.id,
      total: quotes.total,
      createdAt: quotes.createdAt,
    })
    .from(quotes)
    .where(
      and(
        eq(quotes.serviceType, serviceType as any),
        eq(quotes.status, "accepted"),
        sql`CAST(${quotes.total} AS DECIMAL(10,2)) > 0`
      )
    )
    .orderBy(desc(quotes.createdAt))
    .limit(10);

  if (recentQuotes.length === 0) return null;

  // 取得這些報價的項目明細
  const quoteIds = recentQuotes.map(q => q.id);
  const items = await db
    .select({
      quoteId: quoteItems.quoteId,
      description: quoteItems.description,
      quantity: quoteItems.quantity,
      unitPrice: quoteItems.unitPrice,
      amount: quoteItems.amount,
    })
    .from(quoteItems)
    .where(inArray(quoteItems.quoteId, quoteIds));

  // 整理成 AI 可讀的格式
  const quotesWithItems = recentQuotes.map(q => ({
    total: Number(q.total),
    items: items
      .filter(i => i.quoteId === q.id)
      .map(i => ({
        description: i.description,
        quantity: Number(i.quantity),
        unitPrice: Number(i.unitPrice),
      })),
  }));

  const avgTotal = Math.round(Number(stats[0]?.avgTotal ?? 0));
  const minTotal = Math.round(Number(stats[0]?.minTotal ?? 0));
  const maxTotal = Math.round(Number(stats[0]?.maxTotal ?? 0));
  const count = Number(stats[0]?.count ?? 0);

  // 計算 P25/P75（如果資料庫不支援 PERCENTILE_CONT，用簡單排序代替）
  const sortedTotals = quotesWithItems.map(q => q.total).sort((a, b) => a - b);
  const p25 = sortedTotals[Math.floor(sortedTotals.length * 0.25)] ?? minTotal;
  const p75 = sortedTotals[Math.floor(sortedTotals.length * 0.75)] ?? maxTotal;

  return {
    serviceType,
    count,
    avgTotal,
    minTotal,
    maxTotal,
    p25: Math.round(p25),
    p75: Math.round(p75),
    recentQuotes: quotesWithItems,
  };
}

// ─── Quote Costs (項目直接成本) ──────────────────────────────────────────
export async function getQuoteCosts(quoteId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(quoteCosts)
    .where(eq(quoteCosts.quoteId, quoteId))
    .orderBy(quoteCosts.createdAt);
}

export async function createQuoteCost(data: InsertQuoteCost) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(quoteCosts).values(data);
  const [created] = await db
    .select()
    .from(quoteCosts)
    .where(eq(quoteCosts.quoteId, data.quoteId))
    .orderBy(desc(quoteCosts.createdAt))
    .limit(1);
  return created;
}

export async function deleteQuoteCost(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(quoteCosts).where(eq(quoteCosts.id, id));
}

export async function getQuoteCostSummary(quoteId: number) {
  const db = await getDb();
  if (!db) return { totalCost: 0, costs: [] };
  const costs = await db
    .select()
    .from(quoteCosts)
    .where(eq(quoteCosts.quoteId, quoteId))
    .orderBy(quoteCosts.createdAt);
  const totalCost = costs.reduce((sum, c) => sum + Number(c.amount), 0);
  return { totalCost, costs };
}

// Monthly total costs for dashboard (sum of quote_costs for accepted quotes in a month)
export async function getMonthlyQuoteCosts(year: number, month: number) {
  const db = await getDb();
  if (!db) return 0;
  // Join quote_costs with quotes to filter by accepted status and shootingDate month
  const result = await db
    .select({ total: sql<number>`SUM(qc.amount)` })
    .from(sql`quote_costs qc`)
    .innerJoin(quotes, sql`qc.quote_id = ${quotes.id}`)
    .where(
      and(
        eq(quotes.status, "accepted"),
        sql`shootingDate IS NOT NULL AND shootingDate != ''`,
        sql`YEAR(STR_TO_DATE(${quotes.shootingDate}, '%Y-%m-%d')) = ${year}`,
        sql`MONTH(STR_TO_DATE(${quotes.shootingDate}, '%Y-%m-%d')) = ${month}`
      )
    );
  return Number(result[0]?.total ?? 0);
}

// ─── AI Quote Learning: Item-level Frequency (A) ─────────────────────────────
// 統計成交報價中最常用的項目描述和平均單價（按服務類型）
export async function getFrequentItemsByServiceType(serviceType: string) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      description: quoteItems.description,
      usageCount: sql<number>`COUNT(*)`,
      avgUnitPrice: sql<number>`ROUND(AVG(CAST(${quoteItems.unitPrice} AS DECIMAL(10,2))), 0)`,
      minUnitPrice: sql<number>`MIN(CAST(${quoteItems.unitPrice} AS DECIMAL(10,2)))`,
      maxUnitPrice: sql<number>`MAX(CAST(${quoteItems.unitPrice} AS DECIMAL(10,2)))`,
    })
    .from(quoteItems)
    .innerJoin(quotes, eq(quoteItems.quoteId, quotes.id))
    .where(
      and(
        eq(quotes.serviceType, serviceType as any),
        eq(quotes.status, "accepted"),
        sql`CAST(${quoteItems.unitPrice} AS DECIMAL(10,2)) > 0`
      )
    )
    .groupBy(quoteItems.description)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(10);
  return rows.map(r => ({
    description: r.description,
    usageCount: Number(r.usageCount),
    avgUnitPrice: Math.round(Number(r.avgUnitPrice)),
    minUnitPrice: Math.round(Number(r.minUnitPrice)),
    maxUnitPrice: Math.round(Number(r.maxUnitPrice)),
  }));
}

// ─── AI Quote Learning: Win-rate by Price Tier (B) ───────────────────────────
// 分析不同價格區間的成交率（按服務類型）
export async function getWinRateByPriceTier(serviceType: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ total: quotes.total, status: quotes.status })
    .from(quotes)
    .where(
      and(
        eq(quotes.serviceType, serviceType as any),
        sql`${quotes.status} IN ('accepted', 'rejected')`,
        sql`CAST(${quotes.total} AS DECIMAL(10,2)) > 0`
      )
    );
  if (rows.length < 5) return null;
  const totals = rows.map(r => ({ total: Number(r.total), accepted: r.status === "accepted" }));
  const allTotals = totals.map(r => r.total).sort((a, b) => a - b);
  const p33 = allTotals[Math.floor(allTotals.length * 0.33)] ?? 0;
  const p66 = allTotals[Math.floor(allTotals.length * 0.66)] ?? 0;
  const low = totals.filter(r => r.total <= p33);
  const mid = totals.filter(r => r.total > p33 && r.total <= p66);
  const high = totals.filter(r => r.total > p66);
  const winRate = (arr: typeof totals) =>
    arr.length === 0 ? 0 : Math.round((arr.filter(r => r.accepted).length / arr.length) * 100);
  return {
    lowTier: { maxPrice: Math.round(p33), winRate: winRate(low), count: low.length },
    midTier: { minPrice: Math.round(p33), maxPrice: Math.round(p66), winRate: winRate(mid), count: mid.length },
    highTier: { minPrice: Math.round(p66), winRate: winRate(high), count: high.length },
    overallWinRate: winRate(totals),
    totalQuotes: totals.length,
  };
}

// ─── AI Quote Learning: Client Quote History (C) ─────────────────────────────
// 查詢同一客戶的歷史成交報價（用於回頭客定價參考）
export async function getClientQuoteHistory(clientEmail: string) {
  const db = await getDb();
  if (!db) return null;
  if (!clientEmail) return null;
  const recentAccepted = await db
    .select({ id: quotes.id, serviceType: quotes.serviceType, total: quotes.total, createdAt: quotes.createdAt })
    .from(quotes)
    .where(
      and(
        eq(quotes.clientEmail, clientEmail),
        eq(quotes.status, "accepted"),
        sql`CAST(${quotes.total} AS DECIMAL(10,2)) > 0`
      )
    )
    .orderBy(desc(quotes.createdAt))
    .limit(5);
  if (recentAccepted.length === 0) return null;
  const quoteIds = recentAccepted.map(q => q.id);
  const items = await db
    .select({ quoteId: quoteItems.quoteId, description: quoteItems.description, quantity: quoteItems.quantity, unitPrice: quoteItems.unitPrice })
    .from(quoteItems)
    .where(inArray(quoteItems.quoteId, quoteIds));
  const quotesWithItems = recentAccepted.map(q => ({
    serviceType: q.serviceType,
    total: Number(q.total),
    createdAt: q.createdAt,
    items: items.filter(i => i.quoteId === q.id).map(i => ({
      description: i.description,
      quantity: Number(i.quantity),
      unitPrice: Number(i.unitPrice),
    })),
  }));
  return {
    email: clientEmail,
    totalAccepted: recentAccepted.length,
    avgTotal: Math.round(quotesWithItems.reduce((s, q) => s + q.total, 0) / quotesWithItems.length),
    recentQuotes: quotesWithItems,
  };
}

// ─── AI Quote Learning: Time-weighted Historical Pricing (D) ─────────────────
// 最近 3 個月的成交報價加倍權重，讓定價更貼近市場現況
export async function getTimeWeightedHistoricalPricing(serviceType: string) {
  const db = await getDb();
  if (!db) return null;
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const recentQuotes = await db
    .select({ id: quotes.id, total: quotes.total, createdAt: quotes.createdAt })
    .from(quotes)
    .where(
      and(
        eq(quotes.serviceType, serviceType as any),
        eq(quotes.status, "accepted"),
        sql`CAST(${quotes.total} AS DECIMAL(10,2)) > 0`
      )
    )
    .orderBy(desc(quotes.createdAt))
    .limit(20);
  if (recentQuotes.length === 0) return null;
  const weighted: number[] = [];
  for (const q of recentQuotes) {
    const total = Number(q.total);
    const isRecent = q.createdAt && q.createdAt.getTime() >= threeMonthsAgo.getTime();
    weighted.push(total);
    if (isRecent) weighted.push(total); // 最近 3 個月加倍
  }
  weighted.sort((a, b) => a - b);
  const avg = Math.round(weighted.reduce((s, v) => s + v, 0) / weighted.length);
  const p25 = weighted[Math.floor(weighted.length * 0.25)] ?? weighted[0];
  const p75 = weighted[Math.floor(weighted.length * 0.75)] ?? weighted[weighted.length - 1];
  const recentCount = recentQuotes.filter(q => q.createdAt && q.createdAt.getTime() >= threeMonthsAgo.getTime()).length;
  return {
    serviceType,
    count: recentQuotes.length,
    recentCount,
    weightedAvg: avg,
    p25: Math.round(p25),
    p75: Math.round(p75),
    note: recentCount > 0 ? `最近 3 個月有 ${recentCount} 筆成交，定價趨勢更準確` : "數據較舊，僅供參考",
  };
}

// ─── AI Quote Learning: Deviation Correction Factor (E) ──────────────────────
// 計算各服務類型的歷史偏差修正係數
// correctionFactor = avg(actual / estimated) — 基於最近 20 筆成交對比
// 若 correctionFactor = 1.2，代表 AI 一直低估 20%，下次估價應乘以 1.2
// 限制修正係數在 0.5–2.0 之間，偏差 < 5% 時返回 1.0（不修正）
export async function getDeviationCorrectionFactor(serviceType: string): Promise<{
  correctionFactor: number;
  sampleCount: number;
  avgDeviation: number;
  confidence: "high" | "medium" | "low";
  note: string;
} | null> {
  const db = await getDb();
  if (!db) return null;

  const CUSTOM_SERVICE_TYPES = ["kol_mi", "video_production", "menu_design", "ad_video", "graphic_design"];
  if (CUSTOM_SERVICE_TYPES.includes(serviceType)) return null;

  try {
    const rows = await db.execute(
      sql`SELECT
        ei.estimated_total,
        CAST(q.total AS DECIMAL(10,2)) as actual_total
       FROM email_inquiries ei
       INNER JOIN quotes q ON q.email_inquiry_id = ei.id
       WHERE ei.estimated_total IS NOT NULL AND ei.estimated_total > 0
         AND q.total IS NOT NULL AND CAST(q.total AS DECIMAL(10,2)) > 0
         AND q.status = 'accepted'
         AND JSON_UNQUOTE(JSON_EXTRACT(ei.ai_parsed, '$.serviceType')) = ${serviceType}
       ORDER BY ei.id DESC
       LIMIT 20`
    );

    const data = (rows[0] as unknown as any[]);
    if (!data || data.length < 3) return null;

    const ratios = data
      .map((r: any) => Number(r.actual_total) / Number(r.estimated_total))
      .filter(ratio => ratio >= 0.2 && ratio <= 5.0);

    if (ratios.length < 3) return null;

    const avgRatio = ratios.reduce((sum, r) => sum + r, 0) / ratios.length;
    const correctionFactor = Math.max(0.5, Math.min(2.0, avgRatio));
    const avgDeviation = Math.round((avgRatio - 1) * 100);

    const confidence: "high" | "medium" | "low" =
      ratios.length >= 10 ? "high" :
      ratios.length >= 5 ? "medium" : "low";

    if (Math.abs(avgDeviation) < 5) {
      return {
        correctionFactor: 1.0,
        sampleCount: ratios.length,
        avgDeviation,
        confidence,
        note: `偏差 ${avgDeviation > 0 ? "+" : ""}${avgDeviation}%，在 ±5% 範圍內，無需修正`,
      };
    }

    const direction = avgDeviation > 0 ? "低估" : "高估";
    return {
      correctionFactor: Math.round(correctionFactor * 100) / 100,
      sampleCount: ratios.length,
      avgDeviation,
      confidence,
      note: `基於 ${ratios.length} 筆成交對比，AI 平均${direction} ${Math.abs(avgDeviation)}%，已自動修正`,
    };
  } catch {
    return null;
  }
}

// ─── Quote Follow-Up ──────────────────────────────────────────────────────

/** 取得 follow up 設定（只有一行，id=1；若不存在則返回預設值） */
export async function getFollowUpSettings(): Promise<FollowUpSettings> {
  const db = await getDb();
  const defaults: FollowUpSettings = {
    id: 1,
    enabled: true,
    daysAfterSent: 3,
    emailSubjectTemplate: "Re: {{original_subject}}",
    emailBodyTemplate: `Hi {{client_name}},\n\nI hope you're doing well!\n\nI just wanted to follow up on the quotation I sent on {{sent_date}}. Please let me know if you've had a chance to review it, or if you have any questions — I'd be happy to help.\n\nCheers!\n\nDerek\nJD STUDIO HK\nTel No: (852) 9153 1976\nWeb: https://jdstudiohk.com/`,
    sendTimeHktStart: 10,
    sendTimeHktEnd: 18,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  if (!db) return defaults;
  const rows = await db.select().from(followUpSettings).limit(1);
  return rows[0] ?? defaults;
}

/** 更新 follow up 設定 */
export async function updateFollowUpSettings(
  data: Partial<Omit<FollowUpSettings, "id" | "createdAt" | "updatedAt">>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select({ id: followUpSettings.id }).from(followUpSettings).limit(1);
  if (existing.length > 0) {
    await db.update(followUpSettings).set(data).where(eq(followUpSettings.id, existing[0].id));
  } else {
    await db.insert(followUpSettings).values({ ...data } as any);
  }
}

/** 插入或忽略（已存在則跳過）一個 follow up 追蹤記錄 */
export async function upsertQuoteFollowUp(data: InsertQuoteFollowUp): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // 用 to_email 作為唯一識別：同一個客人 email 只保留一筆記錄
  // 這樣無論 gmailMessageId 是否相同，都不會重複建立記錄
  const existing = await db
    .select({ id: quoteFollowUps.id, status: quoteFollowUps.status, quoteId: quoteFollowUps.quoteId })
    .from(quoteFollowUps)
    .where(eq(quoteFollowUps.toEmail, data.toEmail))
    .orderBy(quoteFollowUps.id)
    .limit(1);

  // Try to find the quote ID from the email address if not already set
  let quoteId = data.quoteId;
  if (!quoteId) {
    const quote = await db
      .select({ id: quotes.id })
      .from(quotes)
      .where(eq(quotes.clientEmail, data.toEmail))
      .orderBy(quotes.id)
      .limit(1);
    if (quote.length > 0) {
      quoteId = quote[0].id;
    }
  }

  if (existing.length > 0) {
    const current = existing[0];
    // 已回覆的記錄不更動（客人已回覆，不需要再跟進）
    if (current.status === "replied") {
      return;
    }
    // 已發送跟進的記錄不重置為 pending（防止重複發送）
    // 只允許更新 gmailMessageId、subject、sentAt 和 quoteId（不改變狀態）
    if (current.status === "sent") {
      await db.update(quoteFollowUps).set({
        gmailMessageId: data.gmailMessageId,
        subject: data.subject,
        sentAt: data.sentAt,
        quoteId: quoteId ?? current.quoteId,
        updatedAt: new Date(),
      }).where(eq(quoteFollowUps.id, current.id));
      return;
    }
    // 允許 pending/skipped 記錄更新狀態和最新的 gmailMessageId（anchor 可能更新）
    await db.update(quoteFollowUps).set({
      gmailMessageId: data.gmailMessageId,
      subject: data.subject,
      sentAt: data.sentAt,
      status: data.status,
      repliedAt: data.repliedAt ?? null,
      quoteId: quoteId ?? current.quoteId, // Update quoteId if found
      updatedAt: new Date(),
    }).where(eq(quoteFollowUps.id, current.id));
  } else {
    // 新建記錄時，如果是 pending 狀態，設置 followUpSentAt 為當前時間
    const insertData = {
      ...data,
      quoteId,
      followUpSentAt: data.status === 'pending' ? new Date() : null,
    };
    await db.insert(quoteFollowUps).values(insertData);
  }
}

/** 取得所有 pending 狀態且已超過 daysAfterSent 天的記錄（原子佔位，防重複發送） */
export async function getPendingFollowUps(daysAfterSent: number): Promise<QuoteFollowUp[]> {
  const db = await getDb();
  if (!db) return [];

  // Adaptive per leadSource (Google/HelloToby faster; Repeat slower). Use widest window then filter.
  const { FOLLOW_UP_DAYS_BY_SOURCE, followUpDaysForSource } = await import("./followUpPolicy");
  const maxDays = Math.max(daysAfterSent, ...Object.values(FOLLOW_UP_DAYS_BY_SOURCE));
  const cutoff = new Date(Date.now() - maxDays * 24 * 60 * 60 * 1000);
  const SENTINEL = new Date("1970-01-01T00:00:01.000Z");
  const now = Date.now();

  const candidates = await db
    .select({
      followUp: quoteFollowUps,
      leadSource: quotes.leadSource,
    })
    .from(quoteFollowUps)
    .leftJoin(quotes, eq(quoteFollowUps.quoteId, quotes.id))
    .where(
      and(
        eq(quoteFollowUps.status, "pending"),
        lte(quoteFollowUps.sentAt, cutoff),
        eq(quoteFollowUps.stopFollowUp, false),
        isNull(quoteFollowUps.followUpSentAt)
      )
    )
    .orderBy(quoteFollowUps.sentAt)
    .limit(80);

  const due = candidates.filter((row) => {
    const needed = followUpDaysForSource(row.leadSource, daysAfterSent);
    const sentAt = new Date(row.followUp.sentAt).getTime();
    return now - sentAt >= needed * 24 * 60 * 60 * 1000;
  }).slice(0, 50);

  if (due.length === 0) return [];

  const ids = due.map((c) => c.followUp.id);
  await db.execute(sql`
    UPDATE quote_follow_ups
    SET follow_up_sent_at = ${SENTINEL}
    WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      AND status = 'pending'
      AND follow_up_sent_at IS NULL
  `);

  return await db
    .select()
    .from(quoteFollowUps)
    .where(
      and(
        inArray(quoteFollowUps.id, ids),
        eq(quoteFollowUps.followUpSentAt, SENTINEL)
      )
    )
    .orderBy(quoteFollowUps.sentAt);
}

/** 發送失敗時重置 quote follow-up SENTINEL，讓下次排程可重試 */
export async function resetQuoteFollowUpSentinel(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const SENTINEL = new Date("1970-01-01T00:00:01.000Z");
  await db.execute(sql`
    UPDATE quote_follow_ups
    SET follow_up_sent_at = NULL
    WHERE id = ${id}
      AND follow_up_sent_at = ${SENTINEL}
  `);
}

/** 標記 follow up 已發送 */
export async function markFollowUpEmailSent(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  
  // Get the quoteFollowUp record to find the gmailMessageId
  const followUp = await db
    .select()
    .from(quoteFollowUps)
    .where(eq(quoteFollowUps.id, id))
    .limit(1)
    .then(rows => rows[0]);
  
  if (!followUp) return;
  
  const now = new Date();
  
  // Update quoteFollowUps
  await db
    .update(quoteFollowUps)
    .set({ status: "sent", followUpSentAt: now })
    .where(eq(quoteFollowUps.id, id));
  
  // Sync to emailInquiries table using gmailMessageId
  await db
    .update(emailInquiries)
    .set({ followUpSentAt: now })
    .where(eq(emailInquiries.gmailMessageId, followUp.gmailMessageId));
}

/** 標記 follow up 為已回覆（客人已回覆，不需要再 follow up） */
export async function markFollowUpReplied(gmailMessageId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(quoteFollowUps)
    .set({ status: "replied", repliedAt: new Date() })
    .where(eq(quoteFollowUps.gmailMessageId, gmailMessageId));
}

/** 手動跳過某個 follow up */
export async function skipFollowUp(id: number, notes?: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(quoteFollowUps)
    .set({ status: "skipped", notes: notes ?? null })
    .where(eq(quoteFollowUps.id, id));
}

/** 取得所有已發送跟進郵件的 Message-ID 集合（用於過濾 Sent Box 掃描） */
export async function getSentFollowUpMessageIds(): Promise<Set<string>> {
  const db = await getDb();
  if (!db) return new Set();
  const rows = await db
    .select({ gmailMessageId: quoteFollowUps.gmailMessageId })
    .from(quoteFollowUps)
    .where(
      and(
        isNotNull(quoteFollowUps.followUpSentAt),
        isNotNull(quoteFollowUps.gmailMessageId)
      )
    );
  return new Set(rows.map(r => r.gmailMessageId!).filter(Boolean));
}

/** 取得所有 follow up 記錄（用於前端顯示） */
export async function getQuoteFollowUps(opts: {
  status?: "pending" | "sent" | "replied" | "skipped";
  limit?: number;
  offset?: number;
}): Promise<{ data: (QuoteFollowUp & { stopFollowUp?: boolean })[]; total: number }> {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };
  const conditions = [];
  if (opts.status) conditions.push(eq(quoteFollowUps.status, opts.status));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;
  const [rows, countResult] = await Promise.all([
    db
      .select({
        id: quoteFollowUps.id,
        gmailMessageId: quoteFollowUps.gmailMessageId,
        gmailThreadId: quoteFollowUps.gmailThreadId,
        toEmail: quoteFollowUps.toEmail,
        toName: quoteFollowUps.toName,
        subject: quoteFollowUps.subject,
        sentAt: quoteFollowUps.sentAt,
        status: quoteFollowUps.status,
        followUpSentAt: quoteFollowUps.followUpSentAt,
        repliedAt: quoteFollowUps.repliedAt,
        notes: quoteFollowUps.notes,
        quoteId: quoteFollowUps.quoteId,
        createdAt: quoteFollowUps.createdAt,
        updatedAt: quoteFollowUps.updatedAt,
        stopFollowUp: quoteFollowUps.stopFollowUp,
      })
      .from(quoteFollowUps)
      .where(where)
      .orderBy(desc(quoteFollowUps.sentAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`COUNT(*)` }).from(quoteFollowUps).where(where),
  ]);
  const data = rows.map((r) => ({ ...r, stopFollowUp: r.stopFollowUp ?? false }));
  return { data, total: Number(countResult[0]?.count ?? 0) };
}
