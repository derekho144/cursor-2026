/**
 * linkedinContent.ts — 內容工廠 API
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { linkedinContentPosts } from "../../drizzle/schema";
import { eq, and, desc, count, gte, lte, inArray } from "drizzle-orm";
import {
  ensureContentPostsTable,
  generateWeeklyContentBatch,
  getHktWeekKey,
  CONTENT_TYPE_LABELS,
  notifyDuePublishes,
} from "../linkedinContentFactory";

const STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  pending_review: "待批核",
  approved: "已批准",
  scheduled: "已排程",
  published: "已發佈",
  rejected: "已拒絕",
};

export const linkedinContentRouter = router({
  meta: protectedProcedure.query(() => ({
    typeLabels: CONTENT_TYPE_LABELS,
    statusLabels: STATUS_LABELS,
    scheduleNote: "每週自動：Tue 作品案例 · Thu 外判 vs In-house · Sat 行業觀察（HKT）",
  })),

  getStats: protectedProcedure.query(async () => {
    await ensureContentPostsTable();
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const weekKey = getHktWeekKey();
    const rows = await db
      .select({ status: linkedinContentPosts.status, cnt: count() })
      .from(linkedinContentPosts)
      .groupBy(linkedinContentPosts.status);

    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = r.cnt;

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const [dueToday] = await db
      .select({ cnt: count() })
      .from(linkedinContentPosts)
      .where(
        and(
          inArray(linkedinContentPosts.status, ["approved", "scheduled"]),
          gte(linkedinContentPosts.scheduledFor, start),
          lte(linkedinContentPosts.scheduledFor, end)
        )
      );

    const [weekPending] = await db
      .select({ cnt: count() })
      .from(linkedinContentPosts)
      .where(
        and(
          eq(linkedinContentPosts.weekKey, weekKey),
          eq(linkedinContentPosts.status, "pending_review")
        )
      );

    return {
      weekKey,
      pendingReview: counts["pending_review"] ?? 0,
      weekPending: weekPending?.cnt ?? 0,
      dueToday: dueToday?.cnt ?? 0,
      published: counts["published"] ?? 0,
      approved: (counts["approved"] ?? 0) + (counts["scheduled"] ?? 0),
      byStatus: counts,
    };
  }),

  listPosts: protectedProcedure
    .input(
      z.object({
        weekKey: z.string().optional(),
        status: z
          .enum(["all", "draft", "pending_review", "approved", "scheduled", "published", "rejected"])
          .default("all"),
        limit: z.number().min(1).max(50).default(20),
      })
    )
    .query(async ({ input }) => {
      await ensureContentPostsTable();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const conditions = [];
      if (input.weekKey) conditions.push(eq(linkedinContentPosts.weekKey, input.weekKey));
      if (input.status !== "all") conditions.push(eq(linkedinContentPosts.status, input.status));
      const where = conditions.length ? and(...conditions) : undefined;

      const posts = await db
        .select()
        .from(linkedinContentPosts)
        .where(where)
        .orderBy(desc(linkedinContentPosts.scheduledFor), desc(linkedinContentPosts.createdAt))
        .limit(input.limit);

      return {
        weekKey: input.weekKey ?? getHktWeekKey(),
        posts: posts.map((p) => ({
          ...p,
          typeLabel: CONTENT_TYPE_LABELS[p.contentType],
          statusLabel: STATUS_LABELS[p.status] ?? p.status,
        })),
      };
    }),

  generateThisWeek: protectedProcedure
    .input(z.object({ force: z.boolean().optional() }).optional())
    .mutation(async ({ input }) => {
      const result = await generateWeeklyContentBatch({ force: input?.force });
      return result;
    }),

  updatePost: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        title: z.string().optional(),
        body: z.string().optional(),
        mediaHint: z.string().optional(),
        notes: z.string().optional(),
        scheduledFor: z.string().datetime().optional().nullable(),
      })
    )
    .mutation(async ({ input }) => {
      await ensureContentPostsTable();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const { id, scheduledFor, ...rest } = input;
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined) patch[k] = v;
      }
      if (scheduledFor !== undefined) {
        patch.scheduledFor = scheduledFor ? new Date(scheduledFor) : null;
      }
      await db.update(linkedinContentPosts).set(patch).where(eq(linkedinContentPosts.id, id));
      return { success: true };
    }),

  approve: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await ensureContentPostsTable();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await db
        .update(linkedinContentPosts)
        .set({
          status: "scheduled",
          approvedAt: new Date(),
        })
        .where(eq(linkedinContentPosts.id, input.id));

      return { success: true };
    }),

  reject: protectedProcedure
    .input(z.object({ id: z.number(), notes: z.string().optional() }))
    .mutation(async ({ input }) => {
      await ensureContentPostsTable();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await db
        .update(linkedinContentPosts)
        .set({ status: "rejected", notes: input.notes })
        .where(eq(linkedinContentPosts.id, input.id));

      return { success: true };
    }),

  markPublished: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await ensureContentPostsTable();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await db
        .update(linkedinContentPosts)
        .set({ status: "published", publishedAt: new Date() })
        .where(eq(linkedinContentPosts.id, input.id));

      return { success: true };
    }),

  /** 今日應發（已批准／已排程） */
  dueToday: protectedProcedure.query(async () => {
    await ensureContentPostsTable();
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const posts = await db
      .select()
      .from(linkedinContentPosts)
      .where(
        and(
          inArray(linkedinContentPosts.status, ["approved", "scheduled"]),
          gte(linkedinContentPosts.scheduledFor, start),
          lte(linkedinContentPosts.scheduledFor, end)
        )
      )
      .orderBy(linkedinContentPosts.scheduledFor);

    return posts.map((p) => ({
      ...p,
      typeLabel: CONTENT_TYPE_LABELS[p.contentType],
      statusLabel: STATUS_LABELS[p.status],
    }));
  }),

  nudgeDue: protectedProcedure.mutation(async () => {
    await notifyDuePublishes();
    return { success: true };
  }),
});
