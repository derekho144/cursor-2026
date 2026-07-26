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
  resyncClientMembershipFromQuotes,
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
        // 重新計算客戶「本年」累計消費（會員制按年度）
        return resyncClientMembershipFromQuotes(input.clientId);
      }
      return upsertClientMembership(input.clientId, input.additionalSpend ?? 0);
    }),

  /** 同步所有客戶的會員資料（本年已成交合計；會員制按年度重置） */
  syncAll: protectedProcedure.mutation(async () => {
    const db = await getDb();
    if (!db) throw new Error("DB not available");

    const year = new Date().getFullYear();
    const yearStart = `${year}-01-01 00:00:00`;
    const yearEnd = `${year + 1}-01-01 00:00:00`;

    // 本年有成交歸屬嘅客戶（拍攝年或無拍攝日嘅開單年）
    const clientRows = await db
      .select({ clientId: quotes.clientId })
      .from(quotes)
      .where(
        and(
          eq(quotes.status, "accepted"),
          sql`${quotes.clientId} IS NOT NULL`,
          sql`(
            (shootingDate IS NOT NULL AND shootingDate != '' AND YEAR(STR_TO_DATE(shootingDate, '%Y-%m-%d')) = ${year})
            OR
            ((shootingDate IS NULL OR shootingDate = '') AND ${quotes.createdAt} >= ${yearStart} AND ${quotes.createdAt} < ${yearEnd})
          )`
        )
      )
      .groupBy(quotes.clientId);

    let synced = 0;
    for (const row of clientRows) {
      if (!row.clientId) continue;
      await resyncClientMembershipFromQuotes(row.clientId, year);
      synced++;
    }
    return { synced, year, basis: "calendar_year" as const };
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
