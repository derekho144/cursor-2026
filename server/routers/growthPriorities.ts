import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getGrowthPriorities } from "../seoAdsAeo";
import { executeApprovedAdsAction } from "../adsActionExecutor";
import { buildSeoToAdsPlan, verifySeoToAdsPlan } from "../seoToAdsAgent";
import { runSeoToAdsPipeline } from "../seoToAdsPipeline";
import { blockedExecutionResult } from "@shared/adsActionExecution";
import { getDb } from "../db";
import { adSyncLogs } from "../../drizzle/schema";

const actionInput = z.object({
  id: z.string().min(1).max(240),
  backlogId: z.string().min(1).max(240),
  actionType: z.enum(["quality_review", "landing_page_review", "keyword_review"]),
  query: z.string().max(240),
  targetPath: z.string().max(240),
  title: z.string().min(1).max(240),
  rationale: z.string().max(2000),
  expectedImpact: z.string().max(1000),
  risk: z.enum(["low", "medium", "high"]),
  proposedScope: z.string().max(2000),
  status: z.enum(["pending", "approved", "rejected", "completed"]),
  baselineFingerprint: z.string().length(16).optional(),
});

export const growthPrioritiesRouter = router({
  overview: protectedProcedure
    .input(z.object({ days: z.number().min(14).max(90).default(28) }).optional())
    .query(async ({ input }) => getGrowthPriorities(input?.days ?? 28)),

  dryRunApproved: protectedProcedure
    .input(actionInput)
    .mutation(async ({ input }) => executeApprovedAdsAction(input, { dryRunOnly: true, baselineFingerprint: input.baselineFingerprint })),

  executeApproved: protectedProcedure
    .input(actionInput)
    .mutation(async ({ input }) => executeApprovedAdsAction(input, { baselineFingerprint: input.baselineFingerprint })),

  runSeoToAdsPipeline: protectedProcedure
    .input(actionInput)
    .mutation(async ({ input }) => runSeoToAdsPipeline(input, { baselineFingerprint: input.baselineFingerprint })),

  runApprovedAdsBatch: protectedProcedure
    .input(z.object({ items: z.array(actionInput).min(1).max(20) }))
    .mutation(async ({ input }) => {
      const approved = input.items.filter((item) => item.status === "approved");
      const db = await getDb();
      const completedIds = new Set<string>();
      if (db) {
        const priorLogs = await db.select({ message: adSyncLogs.message })
          .from(adSyncLogs)
          .where(eq(adSyncLogs.platform, "google_ads"))
          .orderBy(desc(adSyncLogs.syncedAt))
          .limit(500);
        for (const row of priorLogs) {
          try {
            const payload = row.message ? JSON.parse(row.message) as { actionId?: string; state?: string } : null;
            if (payload?.actionId && payload.state === "executed") completedIds.add(payload.actionId);
          } catch { /* legacy/non-JSON sync log */ }
        }
      }
      const results = [];
      for (const item of approved) {
        if (completedIds.has(item.id)) {
          results.push(blockedExecutionResult(item.id, "此 Action 已有 completed audit log；為避免重複 mutation，本次跳過。"));
          continue;
        }
        const result = item.id.startsWith("trusted-negative:")
          ? await executeApprovedAdsAction(item, { baselineFingerprint: item.baselineFingerprint })
          : await runSeoToAdsPipeline(item, { baselineFingerprint: item.baselineFingerprint });
        results.push(result);
        if (result.state === "executed") completedIds.add(item.id);
      }
      return {
        requested: input.items.length,
        approved: approved.length,
        skipped: input.items.length - approved.length,
        results,
      };
    }),

  seoToAdsPlan: protectedProcedure
    .input(actionInput)
    .mutation(async ({ input }) => buildSeoToAdsPlan(input)),

  verifySeoToAdsPlan: protectedProcedure
    .input(actionInput.extend({ baselineFingerprint: z.string().length(16) }))
    .mutation(async ({ input }) => verifySeoToAdsPlan(input, input.baselineFingerprint)),

  executionLogs: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select({ id: adSyncLogs.id, status: adSyncLogs.status, message: adSyncLogs.message, recordsUpdated: adSyncLogs.recordsUpdated, syncedAt: adSyncLogs.syncedAt })
      .from(adSyncLogs)
      .where(eq(adSyncLogs.platform, "google_ads"))
      .orderBy(desc(adSyncLogs.syncedAt))
      .limit(20);
  }),

  dailyExecutionReport: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select({ message: adSyncLogs.message, status: adSyncLogs.status, syncedAt: adSyncLogs.syncedAt })
      .from(adSyncLogs).where(eq(adSyncLogs.platform, "google_ads"))
      .orderBy(desc(adSyncLogs.syncedAt)).limit(200);
    const byDay = new Map<string, { date: string; runs: number; success: number; failed: number; added: number; alreadyExisted: number; skipped: number; verified: number }>();
    for (const row of rows) {
      let payload: any = null;
      try { payload = row.message ? JSON.parse(row.message) : null; } catch { /* legacy sync log */ }
      if (!payload?.actionId) continue;
      const date = new Date(new Date(row.syncedAt).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const current = byDay.get(date) ?? { date, runs: 0, success: 0, failed: 0, added: 0, alreadyExisted: 0, skipped: 0, verified: 0 };
      current.runs += 1;
      if (row.status === "success") current.success += 1; else current.failed += 1;
      const verification = String(payload.verification ?? "");
      const addedMatch = verification.match(/GAQL after: (\d+)\/(\d+) verified/);
      const existingMatch = verification.match(/(\d+) existing PHRASE negatives/);
      const pendingMatch = verification.match(/(\d+) new candidates/);
      if (addedMatch) { current.verified += Number(addedMatch[1]); current.added += Number(addedMatch[1]); }
      if (existingMatch) current.alreadyExisted += Number(existingMatch[1]);
      if (pendingMatch && Number(pendingMatch[1]) === 0) current.skipped += 1;
      byDay.set(date, current);
    }
    return Array.from(byDay.values()).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);
  }),
});
