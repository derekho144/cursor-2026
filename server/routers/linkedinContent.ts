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
  linkedinWeekScoreboards,
  quotes,
} from "../../drizzle/schema";
import { eq, and, desc, count, gte, lte, inArray, like, or } from "drizzle-orm";
import { storagePut } from "../storage";
import { nanoid } from "nanoid";
import {
  ensureContentPostsTable,
  generateWeeklyContentBatch,
  getHktWeekKey,
  resolveContentWeek,
  resetSchedulesAndRegenerate,
  ensureSelectedMediaForType,
  CONTENT_TYPE_LABELS,
  CONTENT_TYPE_BLURBS,
  notifyDuePublishes,
  getWeekRangeUtc,
} from "../linkedinContentFactory";
import { harvestJdStudioWebsiteImages } from "../jdStudioWebsiteImages";
import {
  getBufferLinkedInMeta,
  isBufferConfigured,
  schedulePostToBuffer,
  deleteBufferPost,
  publicLinkedInAssetUrl,
  fetchBufferPostMetrics,
  fetchAggregatedLinkedInMetrics,
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
  event: "活動攝影",
  other: "其他",
};

const PREFERRED_LABELS: Record<string, string> = {
  any: "全部主題",
  project: "項目＋幕後",
  education: "教育＋洞察",
  data: "數據＋視覺",
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

/** Buffer rejects past dueAt — bump overdue schedules to ~15 min from now. */
const BUFFER_PAST_GRACE_MS = 60_000;
const BUFFER_BUMP_AHEAD_MS = 15 * 60_000;

async function pushPostToBuffer(postId: number): Promise<{
  success: boolean;
  bufferPostId?: string;
  bufferStatus: string;
  error?: string;
  scheduledBumpedTo?: string;
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

  let dueAt = new Date(post.scheduledFor);
  let scheduledBumpedTo: string | undefined;
  if (dueAt.getTime() < Date.now() - BUFFER_PAST_GRACE_MS) {
    dueAt = new Date(Date.now() + BUFFER_BUMP_AHEAD_MS);
    scheduledBumpedTo = dueAt.toISOString();
    await db
      .update(linkedinContentPosts)
      .set({ scheduledFor: dueAt })
      .where(eq(linkedinContentPosts.id, postId));
  }

  let media = parseSelectedMedia(post.selectedMedia);
  if (!media.length) {
    try {
      media = await ensureSelectedMediaForType(post.contentType as any);
      if (media.length) {
        await db
          .update(linkedinContentPosts)
          .set({ selectedMedia: JSON.stringify(media) })
          .where(eq(linkedinContentPosts.id, postId));
      }
    } catch (err: any) {
      console.warn("[linkedinContent] ensure media failed:", err?.message);
    }
  }

  const imageUrls = media
    .map((m: any) => {
      const id = Number(m?.id);
      if (id > 0) return publicLinkedInAssetUrl(id);
      return typeof m?.url === "string" ? m.url : null;
    })
    .filter(Boolean) as string[];
  if (!imageUrls.length) {
    const err =
      "冇配圖：推 Buffer 前請先上傳／「從官網抽相」，或重新生成帶相嘅草稿";
    await db
      .update(linkedinContentPosts)
      .set({ bufferStatus: "failed", bufferError: err })
      .where(eq(linkedinContentPosts.id, postId));
    return { success: false, bufferStatus: "failed", error: err, scheduledBumpedTo };
  }

  const result = await schedulePostToBuffer({
    text: post.body,
    dueAt,
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
    return {
      success: true,
      bufferPostId: result.postId,
      bufferStatus: "queued",
      scheduledBumpedTo,
    };
  }

  await db
    .update(linkedinContentPosts)
    .set({ bufferStatus: "failed", bufferError: result.error })
    .where(eq(linkedinContentPosts.id, postId));
  return { success: false, bufferStatus: "failed", error: result.error, scheduledBumpedTo };
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
        "每週自動（HKT）：Tue 08:00 項目＋幕後 · Wed 12:00 教育＋洞察 · Fri 16:00 數據＋視覺。批准後推去 Buffer。抽相：每張最多用 2 次。超過 3 週嘅高表現帖可自動重發一次。",
    };
  }),

  getStats: protectedProcedure.query(async () => {
    await ensureContentPostsTable();
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const weekKey = resolveContentWeek().weekKey;
    const calendarWeekKey = getHktWeekKey();
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

    const [weekTotal] = await db
      .select({ cnt: count() })
      .from(linkedinContentPosts)
      .where(eq(linkedinContentPosts.weekKey, weekKey));

    const [weekScheduled] = await db
      .select({ cnt: count() })
      .from(linkedinContentPosts)
      .where(
        and(
          eq(linkedinContentPosts.weekKey, weekKey),
          inArray(linkedinContentPosts.status, ["approved", "scheduled"])
        )
      );

    const [assetCount] = await db
      .select({ cnt: count() })
      .from(linkedinContentAssets)
      .where(eq(linkedinContentAssets.active, 1));

    return {
      weekKey,
      calendarWeekKey,
      pendingReview: counts["pending_review"] ?? 0,
      weekPending: weekPending?.cnt ?? 0,
      weekTotal: weekTotal?.cnt ?? 0,
      weekScheduled: weekScheduled?.cnt ?? 0,
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
        weekKey: input.weekKey ?? resolveContentWeek().weekKey,
        posts: posts.map(mapPostRow),
      };
    }),

  generateThisWeek: protectedProcedure
    .input(z.object({ force: z.boolean().optional() }).optional())
    .mutation(async ({ input }) => {
      const result = await generateWeeklyContentBatch({ force: input?.force });
      return result;
    }),

  /** 取消全部未發佈排程（含 Buffer）並按時間表重新生成 */
  resetAndRegenerate: protectedProcedure.mutation(async () => {
    const result = await resetSchedulesAndRegenerate();
    return result;
  }),

  /** 刪除單篇（草稿／待批核／已拒絕；已推 Buffer 嘅要先手動處理） */
  deletePost: protectedProcedure
    .input(z.object({ id: z.number() }))
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
      if (["approved", "scheduled", "published"].includes(post.status) && post.bufferStatus === "queued") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "已推去 Buffer 嘅帖請先喺 Buffer 刪除／取消排程，或標記後再刪",
        });
      }
      if (!["draft", "pending_review", "rejected"].includes(post.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "只可刪草稿／待批核／已拒絕嘅帖",
        });
      }
      await db.delete(linkedinContentPosts).where(eq(linkedinContentPosts.id, input.id));
      return { success: true };
    }),

  /** 清空本週未發佈草稿，方便重新生成 */
  clearWeekDrafts: protectedProcedure
    .input(z.object({ weekKey: z.string().optional() }).optional())
    .mutation(async ({ input }) => {
      await ensureContentPostsTable();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const weekKey = input?.weekKey ?? getHktWeekKey();
      const rows = await db
        .select({ id: linkedinContentPosts.id })
        .from(linkedinContentPosts)
        .where(
          and(
            eq(linkedinContentPosts.weekKey, weekKey),
            inArray(linkedinContentPosts.status, ["draft", "pending_review", "rejected"])
          )
        );
      for (const r of rows) {
        await db.delete(linkedinContentPosts).where(eq(linkedinContentPosts.id, r.id));
      }
      return { success: true, weekKey, deleted: rows.length };
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

  /** 從 jdstudiohk.com 服務頁抽相入圖片庫 */
  harvestFromWebsite: protectedProcedure
    .input(
      z
        .object({
          maxNew: z.number().min(1).max(24).default(8),
          preferredFor: z.enum(linkedinAssetPreferredFor).default("any"),
        })
        .optional()
    )
    .mutation(async ({ input }) => {
      await ensureContentPostsTable();
      try {
        const imported = await harvestJdStudioWebsiteImages({
          maxNew: input?.maxNew ?? 8,
          preferredFor: input?.preferredFor ?? "any",
        });
        return {
          imported: imported.length,
          ids: imported.map((a) => a.id),
          fileNames: imported.map((a) => a.fileName),
        };
      } catch (err: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err?.message || "官網抽相失敗",
        });
      }
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
        // Client may send null from DB fields / empty inputs
        mediaHint: z.string().nullish(),
        notes: z.string().nullish(),
        // SuperJSON may revive scheduledFor as Date; also accept ISO strings
        scheduledFor: z
          .union([z.string(), z.date()])
          .nullish()
          .transform((v) => {
            if (v === undefined) return undefined;
            if (v == null || v === "") return null;
            if (v instanceof Date) {
              if (Number.isNaN(v.getTime())) return null;
              return v.toISOString();
            }
            const d = new Date(v);
            if (Number.isNaN(d.getTime())) return null;
            return d.toISOString();
          }),
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
        scheduledBumpedTo: buffer.scheduledBumpedTo,
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
        if (post.bufferPostId) {
          const del = await deleteBufferPost(post.bufferPostId);
          if (!del.ok) {
            console.warn("[linkedinContent] Buffer delete before re-push:", del.error);
          }
        }
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
        scheduledBumpedTo: buffer.scheduledBumpedTo,
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

  /** Weekly scoreboard: Buffer auto metrics + manual business fields + quote attribution */
  getWeeklyScoreboard: protectedProcedure
    .input(z.object({ weekKey: z.string().optional() }).optional())
    .query(async ({ input }) => {
      await ensureContentPostsTable();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const weekKey = input?.weekKey || resolveContentWeek().weekKey;
      const range = getWeekRangeUtc(weekKey);

      const [board] = await db
        .select()
        .from(linkedinWeekScoreboards)
        .where(eq(linkedinWeekScoreboards.weekKey, weekKey))
        .limit(1);

      const weekPosts = await db
        .select()
        .from(linkedinContentPosts)
        .where(eq(linkedinContentPosts.weekKey, weekKey))
        .orderBy(linkedinContentPosts.scheduledFor);

      let quotesFromLinkedInAuto = 0;
      if (range) {
        const quoteRows = await db
          .select({ cnt: count() })
          .from(quotes)
          .where(
            and(
              gte(quotes.createdAt, range.start),
              lte(quotes.createdAt, range.end),
              or(
                like(quotes.leadSource, "%LinkedIn%"),
                like(quotes.leadSource, "%linkedin%"),
                eq(quotes.leadSource, "LI")
              )
            )
          );
        quotesFromLinkedInAuto = quoteRows[0]?.cnt ?? 0;
      }

      const behavior = {
        planned: weekPosts.length,
        pendingReview: weekPosts.filter((p) => p.status === "pending_review").length,
        approvedOrScheduled: weekPosts.filter((p) =>
          ["approved", "scheduled", "published"].includes(p.status)
        ).length,
        bufferQueued: weekPosts.filter((p) => p.bufferStatus === "queued").length,
        bufferFailed: weekPosts.filter((p) => p.bufferStatus === "failed").length,
        withMetrics: weekPosts.filter((p) => p.impressions != null).length,
      };

      return {
        weekKey,
        range: range
          ? { start: range.start.toISOString(), end: range.end.toISOString() }
          : null,
        board: board ?? null,
        quotesFromLinkedInAuto,
        behavior,
        posts: weekPosts.map(mapPostRow),
        autoCollectable: {
          bufferConfigured: isBufferConfigured(),
          fromBuffer: [
            "impressions",
            "reactions",
            "comments",
            "reposts",
            "engagementRate",
            "postCount",
          ],
          fromJdSystem: ["weekPosts", "bufferStatus", "quotesFromLinkedIn (leadSource)"],
          manual: ["newFollowers", "linkedInInquiries", "dmConversations", "experimentNote"],
          note: "Buffer metrics 約每日更新；新 post 可能要最多 24 小時先有數。",
        },
      };
    }),

  syncWeeklyMetrics: protectedProcedure
    .input(z.object({ weekKey: z.string().optional() }).optional())
    .mutation(async ({ input }) => {
      await ensureContentPostsTable();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const weekKey = input?.weekKey || resolveContentWeek().weekKey;
      const range = getWeekRangeUtc(weekKey);
      if (!range) throw new TRPCError({ code: "BAD_REQUEST", message: "無效 weekKey" });

      const agg = await fetchAggregatedLinkedInMetrics({
        startDateTime: range.start,
        endDateTime: range.end,
      });

      const weekPosts = await db
        .select()
        .from(linkedinContentPosts)
        .where(eq(linkedinContentPosts.weekKey, weekKey));

      let postsSynced = 0;
      const postErrors: string[] = [];
      for (const post of weekPosts) {
        if (!post.bufferPostId) continue;
        const m = await fetchBufferPostMetrics(post.bufferPostId);
        if (!m.ok) {
          postErrors.push(`#${post.id}: ${m.error}`);
          continue;
        }
        await db
          .update(linkedinContentPosts)
          .set({
            impressions: m.metrics.impressions ?? null,
            reactions: m.metrics.reactions ?? null,
            comments: m.metrics.comments ?? null,
            reposts: m.metrics.reposts ?? null,
            engagementRate:
              m.metrics.engagementRate != null ? String(m.metrics.engagementRate) : null,
            metricsUpdatedAt: m.metricsUpdatedAt ? new Date(m.metricsUpdatedAt) : new Date(),
          })
          .where(eq(linkedinContentPosts.id, post.id));
        postsSynced++;
      }

      const patch = {
        weekKey,
        postCount: agg.ok ? agg.metrics.postCount ?? weekPosts.length : weekPosts.length,
        impressions: agg.ok ? Math.round(agg.metrics.impressions ?? 0) : null,
        reactions: agg.ok ? Math.round(agg.metrics.reactions ?? 0) : null,
        comments: agg.ok ? Math.round(agg.metrics.comments ?? 0) : null,
        reposts: agg.ok ? Math.round(agg.metrics.reposts ?? 0) : null,
        engagementRate:
          agg.ok && agg.metrics.engagementRate != null
            ? String(agg.metrics.engagementRate)
            : null,
        metricsSyncedAt: new Date(),
        metricsSyncError: agg.ok
          ? postErrors.length
            ? postErrors.slice(0, 5).join(" | ")
            : null
          : agg.error,
      };

      await db
        .insert(linkedinWeekScoreboards)
        .values(patch)
        .onDuplicateKeyUpdate({
          set: {
            postCount: patch.postCount,
            impressions: patch.impressions,
            reactions: patch.reactions,
            comments: patch.comments,
            reposts: patch.reposts,
            engagementRate: patch.engagementRate,
            metricsSyncedAt: patch.metricsSyncedAt,
            metricsSyncError: patch.metricsSyncError,
          },
        });

      return {
        success: agg.ok,
        weekKey,
        postsSynced,
        aggregate: agg.ok ? agg.metrics : null,
        error: agg.ok ? null : agg.error,
        postErrors,
      };
    }),

  saveWeeklyScoreboard: protectedProcedure
    .input(
      z.object({
        weekKey: z.string(),
        newFollowers: z.number().int().nullable().optional(),
        linkedInInquiries: z.number().int().nullable().optional(),
        quotesFromLinkedIn: z.number().int().nullable().optional(),
        dmConversations: z.number().int().nullable().optional(),
        experimentNote: z.string().nullable().optional(),
        nextWeekPlan: z.string().nullable().optional(),
        verdict: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await ensureContentPostsTable();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const { weekKey, ...rest } = input;
      const patch: Record<string, unknown> = { weekKey };
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined) patch[k] = v;
      }

      await db
        .insert(linkedinWeekScoreboards)
        .values(patch as typeof linkedinWeekScoreboards.$inferInsert)
        .onDuplicateKeyUpdate({
          set: Object.fromEntries(
            Object.entries(rest).filter(([, v]) => v !== undefined)
          ) as Partial<typeof linkedinWeekScoreboards.$inferInsert>,
        });

      return { success: true };
    }),
});
