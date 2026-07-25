import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getAllMemberships,
  getClientMembership,
  getMembershipStats,
  upsertClientMembership,
  createReferralCode,
  getReferralCode,
  getClientReferralCodes,
  getLoyaltyEmailStats,
  LOYALTY_TIERS,
  calcTier,
} from "../db";
import { getDb } from "../db";
import { clients, quotes, clientMemberships } from "../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export const loyaltyRouter = router({
  /** 取得所有會員列表（管理員用） */
  getAll: protectedProcedure.query(async () => {
    return getAllMemberships();
  }),

  /** 取得會員統計 */
  getStats: protectedProcedure.query(async () => {
    const stats = await getMembershipStats();
    const emailStats = await getLoyaltyEmailStats();
    return { memberStats: stats, emailStats };
  }),

  /** 取得單一客戶的會員資料 */
  getByClientId: protectedProcedure
    .input(z.object({ clientId: z.number() }))
    .query(async ({ input }) => {
      const membership = await getClientMembership(input.clientId);
      const db = await getDb();
      if (!db) return null;

      // 取得客戶的成交報價單歷史
      const acceptedQuotes = await db
        .select({
          id: quotes.id,
          quoteNumber: quotes.quoteNumber,
          total: quotes.total,
          serviceType: quotes.serviceType,
          updatedAt: quotes.updatedAt,
        })
        .from(quotes)
        .where(and(eq(quotes.clientId, input.clientId), eq(quotes.status, "accepted")))
        .orderBy(desc(quotes.updatedAt))
        .limit(10);

      return { membership, acceptedQuotes };
    }),

  /** 手動更新客戶會員資料（管理員） */
  updateMembership: protectedProcedure
    .input(z.object({
      clientId: z.number(),
      additionalSpend: z.number().optional(),
      forceSync: z.boolean().optional(), // 重新從報價單計算總消費
    }))
    .mutation(async ({ input }) => {
      if (input.forceSync) {
        // 重新計算客戶的總消費
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const result = await db
          .select({ total: sql<number>`SUM(${quotes.total})` })
          .from(quotes)
          .where(and(eq(quotes.clientId, input.clientId), eq(quotes.status, "accepted")));
        const totalSpend = Number(result[0]?.total ?? 0);
        const tier = calcTier(totalSpend);
        const existing = await getClientMembership(input.clientId);
        if (existing) {
          await db
            .update(clientMemberships)
            .set({ totalSpend: String(totalSpend), tier })
            .where(eq(clientMemberships.clientId, input.clientId));
        } else {
          await upsertClientMembership(input.clientId, totalSpend);
        }
        return getClientMembership(input.clientId);
      }
      return upsertClientMembership(input.clientId, input.additionalSpend ?? 0);
    }),

  /** 同步所有客戶的會員資料（從報價單重新計算） */
  syncAll: protectedProcedure.mutation(async () => {
    const db = await getDb();
    if (!db) throw new Error("DB not available");

    // 只計算當年度（1月1日至12月31日）的已接受報價單
    const currentYear = new Date().getFullYear();
    const yearStart = `${currentYear}-01-01 00:00:00`;
    const yearEnd = `${currentYear + 1}-01-01 00:00:00`;

    const clientTotals = await db
      .select({
        clientId: quotes.clientId,
        totalSpend: sql<number>`SUM(${quotes.total})`,
      })
      .from(quotes)
      .where(
        and(
          eq(quotes.status, "accepted"),
          sql`${quotes.clientId} IS NOT NULL`,
          sql`${quotes.createdAt} >= ${yearStart}`,
          sql`${quotes.createdAt} < ${yearEnd}`
        )
      )
      .groupBy(quotes.clientId);

    let synced = 0;
    for (const row of clientTotals) {
      if (!row.clientId) continue;
      const totalSpend = Number(row.totalSpend ?? 0);
      const newTier = calcTier(totalSpend);
      // 先確保記錄存在，再更新正確的年度總消費
      await upsertClientMembership(row.clientId, 0);
      await db
        .update(clientMemberships)
        .set({ totalSpend: String(totalSpend), tier: newTier })
        .where(eq(clientMemberships.clientId, row.clientId));
      synced++;
    }
    return { synced, year: currentYear };
  }),

  /** 取得等級定義 */
  getTierConfig: protectedProcedure.query(() => {
    return LOYALTY_TIERS;
  }),

  /** 為客戶生成推薦碼 */
  generateReferralCode: protectedProcedure
    .input(z.object({ clientId: z.number() }))
    .mutation(async ({ input }) => {
      return createReferralCode(input.clientId);
    }),

  /** 取得客戶的會員折扣（用於報價單自動填入） */
  getClientDiscount: protectedProcedure
    .input(z.object({ clientId: z.number() }))
    .query(async ({ input }) => {
      const membership = await getClientMembership(input.clientId);
      if (!membership) return null;
      const tierConfig = LOYALTY_TIERS[membership.tier as keyof typeof LOYALTY_TIERS];
      return {
        tier: membership.tier,
        tierLabel: tierConfig?.label ?? membership.tier,
        discount: tierConfig?.discount ?? 0,
        totalSpend: Number(membership.totalSpend),
      };
    }),

  /** 查詢推薦碼 */
  lookupReferralCode: protectedProcedure
    .input(z.object({ code: z.string() }))
    .query(async ({ input }) => {
      return getReferralCode(input.code);
    }),

  /** 取得客戶的推薦碼列表 */
  getClientReferralCodes: protectedProcedure
    .input(z.object({ clientId: z.number() }))
    .query(async ({ input }) => {
      return getClientReferralCodes(input.clientId);
    }),
});
