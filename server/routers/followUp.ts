import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getFollowUpSettings,
  updateFollowUpSettings,
  getQuoteFollowUps,
  skipFollowUp,
  getDb,
} from "../db";
import { scanSentBoxForFollowUps, runQuoteFollowUps } from "../gmailFollowUp";
import { quoteFollowUps } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

export const followUpRouter = router({
  /** 取得 follow up 設定 */
  getSettings: protectedProcedure.query(async () => {
    return getFollowUpSettings();
  }),

  /** 更新 follow up 設定 */
  updateSettings: protectedProcedure
    .input(
      z.object({
        enabled: z.boolean().optional(),
        daysAfterSent: z.number().min(1).max(30).optional(),
        emailSubjectTemplate: z.string().min(1).optional(),
        emailBodyTemplate: z.string().min(10).optional(),
        sendTimeHktStart: z.number().min(0).max(23).optional(),
        sendTimeHktEnd: z.number().min(1).max(24).optional(),
      })
    )
    .mutation(async ({ input }) => {
      await updateFollowUpSettings(input);
      return { success: true };
    }),

  /** 取得 follow up 記錄列表 */
  getList: protectedProcedure
    .input(
      z.object({
        status: z.enum(["pending", "sent", "replied", "skipped"]).optional(),
        limit: z.number().min(1).max(100).optional(),
        offset: z.number().min(0).optional(),
      })
    )
    .query(async ({ input }) => {
      return getQuoteFollowUps({
        status: input.status,
        limit: input.limit ?? 20,
        offset: input.offset ?? 0,
      });
    }),

  /** 手動跳過某個 follow up */
  skip: protectedProcedure
    .input(z.object({ id: z.number(), notes: z.string().optional() }))
    .mutation(async ({ input }) => {
      await skipFollowUp(input.id, input.notes);
      return { success: true };
    }),

  /** 手動觸發掃描 Sent Box */
  triggerScan: protectedProcedure.mutation(async () => {
    const result = await scanSentBoxForFollowUps();
    return result;
  }),

  /** 手動觸發 follow up 發送（測試用） */
  triggerSend: protectedProcedure.mutation(async () => {
    const result = await runQuoteFollowUps();
    return result;
  }),

  /** 切換報價單的停止跟進狀態（透過 quoteFollowUp 記錄的 quoteId，或透過 email 查找報價單） */
  toggleStopFollowUp: protectedProcedure
    .input(z.object({ followUpId: z.number(), stopFollowUp: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Directly update the stopFollowUp flag on the follow-up record itself
      // No need to find a linked quote - the flag lives on the follow-up record
      const result = await db
        .update(quoteFollowUps)
        .set({ stopFollowUp: input.stopFollowUp })
        .where(eq(quoteFollowUps.id, input.followUpId));

      if (!result[0] || result[0].affectedRows === 0) {
        throw new Error("找不到跟進記錄");
      }

      return { success: true, stopFollowUp: input.stopFollowUp };
    }),
});
