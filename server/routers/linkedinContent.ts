/**
 * linkedinContent.ts — 內容工廠 API（含圖片庫）
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  linkedinContentPosts,
  linkedinContentAssets,
  linkedinAssetCategories,
  linkedinAssetPreferredFor,
} from "../../drizzle/schema";
import { eq, and, desc, count, gte, lte, inArray } from "drizzle-orm";
import { storagePut } from "../storage";
import { nanoid } from "nanoid";
import {
  ensureContentPostsTable,
  generateWeeklyContentBatch,
  getHktWeekKey,
  CONTENT_TYPE_LABELS,
  CONTENT_TYPE_BLURBS,
  notifyDuePublishes,
} from "../linkedinContentFactory";
import {
  getBufferLinkedInMeta,
  isBufferConfigured,
  schedulePostToBuffer,
} from "../bufferClient";

const STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  pending_review: "待批核",
  approved: "已批准",
  scheduled: "已排程",
  published: "已發佈",
  rejected: "已拒絕",
};

const BUFFER_STATUS_LABELS: Record<string, string> = {
  none: "未推送",
  queued: "已排程 Buffer",
  failed: "Buffer 失敗",
  sent: "已發 LinkedIn",
};

const CATEGORY_LABELS: Record<string, string> = {
  food: "食物",
  jewellery: "珠寶",
  product: "產品",
  fashion: "時裝",
  commercial: "商業／人像",
  before_after: "前後對比",
  other: "其他",
};

const PREFERRED_LABELS: Record<string, string> = {
  any: "全部主題",
  carousel: "輪播案例",
  debate: "外包辯論",
  contrarian: "反常識",
};

function parseSelectedMedia(raw: string | null | undefined) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function pushPostToBuffer(postId: number): Promise<{
  success: boolean;
  bufferPostId?: string;
  bufferStatus: string;
  error?: string;
}> {
  const db = await getDb();
  if (!db) return { success: false, bufferStatus: "failed", error: "Database unavailable" };

  const [post] = await db
    .select()
    .from(linkedinContentPosts)
    .where(eq(linkedinContentPosts.id, postId))
    .limit(1);
  if (!post) return { success: false, bufferStatus: "failed", error: "帖文不存在" };

  if (post.bufferPostId && post.bufferStatus === "queued") {
    return {
      success: true,
      bufferPostId: post.bufferPostId,
      bufferStatus: "queued",
    };
  }

  if (!post.scheduledFor) {
    const err = "未設定排程時間（scheduledFor）";
    await db
      .update(linkedinContentPosts)
      .set({ bufferStatus: "failed", bufferError: err })
      .where(eq(linkedinContentPosts.id, postId));
    return { success: false, bufferStatus: "failed", error: err };
  }

  const media = parseSelectedMedia(post.selectedMedia);
  const imageUrls = media.map((m: any) => m?.url).filter(Boolean) as string[];

  const result = await schedulePostToBuffer({
    text: post.body,
    dueAt: new Date(post.scheduledFor),
    imageUrls,
  });

  if (result.ok) {
    await db
      .update(linkedinContentPosts)
      .set({
        bufferPostId: result.postId,
        bufferStatus: "queued",
        bufferError: null,
      })
      .where(eq(linkedinContentPosts.id, postId));
    return { success: true, bufferPostId: result.postId, bufferStatus: "queued" };
  }

  await db
    .update(linkedinContentPosts)
    .set({ bufferStatus: "failed", bufferError: result.error })
    .where(eq(linkedinContentPosts.id, postId));
  return { success: false, bufferStatus: "failed", error: result.error };
}

function mapPostRow(p: typeof linkedinContentPosts.$inferSelect) {
  return {
    ...p,
    selectedMedia: parseSelectedMedia(p.selectedMedia),
    typeLabel: CONTENT_TYPE_LABELS[p.contentType],
    statusLabel: STATUS_LABELS[p.status] ?? p.status,
    bufferStatusLabel:
      BUFFER_STATUS_LABELS[p.bufferStatus || "none"] ?? p.bufferStatus ?? "未推送",
  };
}

export const linkedinContentRouter = router({
  meta: protectedProcedure.query(async () => {
    const buffer = await getBufferLinkedInMeta().catch((err: any) => ({
      configured: isBufferConfigured(),
      channelId: null,
      displayName: null,
      type: null,
      error: err?.message || String(err),
    }));
    return {
      typeLabels: CONTENT_TYPE_LABELS,
      typeBlurbs: CONTENT_TYPE_BLURBS,
      statusLabels: STATUS_LABELS,
      categoryLabels: CATEGORY_LABELS,
      preferredLabels: PREFERRED_LABELS,
      bufferStatusLabels: BUFFER_STATUS_LABELS,
      buffer,
      scheduleNote:
        "每週自動（HKT）：Tue 16:00 外包 vs 自聘 · Wed 16:00 輪播案例 · Thu 17:00 反常識。批准後推去 Buffer，到點自動發 LinkedIn。",
    };
  }),

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

    const [assetCount] = await db
      .select({ cnt: count() })
      .from(linkedinContentAssets)
      .where(eq(linkedinContentAssets.active, 1));

    return {
      weekKey,
      pendingReview: counts["pending_review"] ?? 0,
      weekPending: weekPending?.cnt ?? 0,
      dueToday: dueToday?.cnt ?? 0,
      published: counts["published"] ?? 0,
      approved: (counts["approved"] ?? 0) + (counts["scheduled"] ?? 0),
      byStatus: counts,
      libraryCount: assetCount?.cnt ?? 0,
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
        posts: posts.map(mapPostRow),
      };
    }),

  generateThisWeek: protectedProcedure
    .input(z.object({ force: z.boolean().optional() }).optional())
    .mutation(async ({ input }) => {
      const result = await generateWeeklyContentBatch({ force: input?.force });
      return result;
    }),

  listAssets: protectedProcedure
    .input(z.object({ includeArchived: z.boolean().optional() }).optional())
    .query(async ({ input }) => {
      await ensureContentPostsTable();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const rows = input?.includeArchived
        ? await db.select().from(linkedinContentAssets).orderBy(desc(linkedinContentAssets.id)).limit(200)
        : await db
            .select()
            .from(linkedinContentAssets)
            .where(eq(linkedinContentAssets.active, 1))
            .orderBy(desc(linkedinContentAssets.id))
            .limit(200);

      return rows.map((r) => ({
        ...r,
        categoryLabel: CATEGORY_LABELS[r.category] ?? r.category,
        preferredLabel: PREFERRED_LABELS[r.preferredFor] ?? r.preferredFor,
      }));
    }),

  uploadAsset: protectedProcedure
    .input(
      z.object({
        fileName: z.string().min(1).max(255),
        fileBase64: z.string().min(1),
        mimeType: z.string().regex(/^image\//),
        category: z.enum(linkedinAssetCategories).default("other"),
        preferredFor: z.enum(linkedinAssetPreferredFor).default("any"),
        caption: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ input }) => {
      await ensureContentPostsTable();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const raw = input.fileBase64.includes(",")
        ? input.fileBase64.split(",")[1]
        : input.fileBase64;
      const buf = Buffer.from(raw, "base64");
      if (buf.length > 12 * 1024 * 1024) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "圖片請小於 12MB" });
      }

      const safeName = input.fileName.replace(/[^\w.\-]+/g, "_").slice(0, 120);
      const fileKey = `linkedin-content/${Date.now()}-${nanoid(8)}-${safeName}`;
      let url: string;
      try {
        ({ url } = await storagePut(fileKey, buf, input.mimeType));
      } catch (err: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `上傳失敗：${err?.message || "storage error"}`,
        });
      }

      await db.insert(linkedinContentAssets).values({
        url,
        storageKey: fileKey,
        fileName: input.fileName,
        mimeType: input.mimeType,
        category: input.category,
        preferredFor: input.preferredFor,
        caption: input.caption || null,
        active: 1,
      });

      return { url, key: fileKey };
    }),

  updateAsset: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        category: z.enum(linkedinAssetCategories).optional(),
        preferredFor: z.enum(linkedinAssetPreferredFor).optional(),
        caption: z.string().max(1000).optional().nullable(),
        active: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await ensureContentPostsTable();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const patch: Record<string, unknown> = {};
      if (input.category !== undefined) patch.category = input.category;
      if (input.preferredFor !== undefined) patch.preferredFor = input.preferredFor;
      if (input.caption !== undefined) patch.caption = input.caption;
      if (input.active !== undefined) patch.active = input.active ? 1 : 0;
      await db.update(linkedinContentAssets).set(patch).where(eq(linkedinContentAssets.id, input.id));
      return { success: true };
    }),

  archiveAsset: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await ensureContentPostsTable();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await db
        .update(linkedinContentAssets)
        .set({ active: 0 })
        .where(eq(linkedinContentAssets.id, input.id));
      return { success: true };
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

      const buffer = await pushPostToBuffer(input.id);
      return {
        success: true,
        bufferPushed: buffer.success,
        bufferPostId: buffer.bufferPostId,
        bufferStatus: buffer.bufferStatus,
        bufferError: buffer.error,
      };
    }),

  /** 重試推去 Buffer（已批准／已排程、未成功 queued 嘅帖） */
  pushToBuffer: protectedProcedure
    .input(z.object({ id: z.number(), force: z.boolean().optional() }))
    .mutation(async ({ input }) => {
      await ensureContentPostsTable();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [post] = await db
        .select()
        .from(linkedinContentPosts)
        .where(eq(linkedinContentPosts.id, input.id))
        .limit(1);
      if (!post) throw new TRPCError({ code: "NOT_FOUND", message: "帖文不存在" });

      if (!["approved", "scheduled"].includes(post.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "只可對已批准／已排程帖推 Buffer",
        });
      }

      if (post.bufferPostId && post.bufferStatus === "queued" && !input.force) {
        return {
          success: true,
          bufferPostId: post.bufferPostId,
          bufferStatus: "queued",
          alreadyQueued: true,
        };
      }

      if (input.force) {
        await db
          .update(linkedinContentPosts)
          .set({ bufferPostId: null, bufferStatus: null, bufferError: null })
          .where(eq(linkedinContentPosts.id, input.id));
      }

      const buffer = await pushPostToBuffer(input.id);
      if (!buffer.success) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: buffer.error || "推 Buffer 失敗",
        });
      }
      return {
        success: true,
        bufferPostId: buffer.bufferPostId,
        bufferStatus: buffer.bufferStatus,
        alreadyQueued: false,
      };
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

    return posts.map(mapPostRow);
  }),

  nudgeDue: protectedProcedure.mutation(async () => {
    await notifyDuePublishes();
    return { success: true };
  }),
});
