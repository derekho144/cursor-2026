import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, publicProcedure } from "../_core/trpc";
import { getDb, getQuoteById } from "../db";
import { deliveries } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import crypto from "crypto";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

// Convert Google Drive share URL to embeddable preview URL
function toGoogleDriveEmbedUrl(url: string): string {
  // Folder: https://drive.google.com/drive/folders/{id}
  const folderMatch = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) {
    return `https://drive.google.com/embeddedfolderview?id=${folderMatch[1]}#grid`;
  }
  // File: https://drive.google.com/file/d/{id}/view
  const fileMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) {
    return `https://drive.google.com/file/d/${fileMatch[1]}/preview`;
  }
  return url;
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const deliveriesRouter = router({
  // Admin: list all deliveries
  list: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "資料庫連線失敗" });
    return db.select().from(deliveries).orderBy(desc(deliveries.createdAt));
  }),

  // Admin: get single delivery by id
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "資料庫連線失敗" });
      const [delivery] = await db
        .select()
        .from(deliveries)
        .where(eq(deliveries.id, input.id))
        .limit(1);
      if (!delivery) throw new TRPCError({ code: "NOT_FOUND", message: "交付記錄不存在" });
      return delivery;
    }),

  // Admin: create new delivery
  create: protectedProcedure
    .input(
      z.object({
        clientName: z.string().min(1),
        title: z.string().min(1),
        googleDriveUrl: z.string().min(1),
        message: z.string().optional(),
        password: z.string().optional(),
        quoteId: z.number().optional(),
        expiresAt: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "資料庫連線失敗" });
      const token = generateToken();
      const embedUrl = toGoogleDriveEmbedUrl(input.googleDriveUrl);
      const [result] = await db.insert(deliveries).values({
        token,
        clientName: input.clientName,
        title: input.title,
        googleDriveUrl: embedUrl,
        message: input.message ?? null,
        password: input.password?.trim() || null,
        quoteId: input.quoteId ?? null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        status: "active",
        downloadCount: 0,
      });
      const id = (result as any).insertId as number;
      return { id, token };
    }),

  // Admin: update delivery
  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        clientName: z.string().min(1).optional(),
        title: z.string().min(1).optional(),
        googleDriveUrl: z.string().optional(),
        message: z.string().optional(),
        password: z.string().optional().nullable(),
        status: z.enum(["active", "expired", "archived"]).optional(),
        expiresAt: z.string().optional(),
        quoteId: z.number().optional().nullable(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "資料庫連線失敗" });
      const { id, googleDriveUrl, expiresAt, password, quoteId, ...rest } = input;
      await db.update(deliveries).set({
        ...rest,
        ...(googleDriveUrl && { googleDriveUrl: toGoogleDriveEmbedUrl(googleDriveUrl) }),
        ...(expiresAt && { expiresAt: new Date(expiresAt) }),
        // Allow clearing password by passing null or empty string
        ...(password !== undefined && { password: password?.trim() || null }),
        // Allow updating quoteId (null to unlink)
        ...(quoteId !== undefined && { quoteId: quoteId ?? null }),
      }).where(eq(deliveries.id, id));
      return { success: true };
    }),

  // Admin: delete delivery
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "資料庫連線失敗" });
      await db.delete(deliveries).where(eq(deliveries.id, input.id));
      return { success: true };
    }),

  // Public: get delivery metadata by token (does NOT return content if password protected)
  getByToken: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "資料庫連線失敗" });
      const [delivery] = await db
        .select()
        .from(deliveries)
        .where(eq(deliveries.token, input.token))
        .limit(1);
      if (!delivery) throw new TRPCError({ code: "NOT_FOUND", message: "連結無效或已過期" });
      if (delivery.status !== "active") {
        throw new TRPCError({ code: "FORBIDDEN", message: "此交付連結已停用" });
      }
      if (delivery.expiresAt && new Date() > delivery.expiresAt) {
        throw new TRPCError({ code: "FORBIDDEN", message: "此交付連結已過期" });
      }
      // Return metadata only; content gated behind password if set
      return {
        id: delivery.id,
        clientName: delivery.clientName,
        title: delivery.title,
        hasPassword: !!delivery.password,
        createdAt: delivery.createdAt,
      };
    }),

  // Public: get full delivery in ONE request (no password required)
  // Replaces the 2-step getByToken → accessDelivery waterfall for faster mobile loading
  getByTokenFull: publicProcedure
    .input(z.object({ token: z.string(), password: z.string().optional() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "資料庫連線失敗" });
      const [delivery] = await db
        .select()
        .from(deliveries)
        .where(eq(deliveries.token, input.token))
        .limit(1);
      if (!delivery) throw new TRPCError({ code: "NOT_FOUND", message: "連結無效或已過期" });
      if (delivery.status !== "active") {
        throw new TRPCError({ code: "FORBIDDEN", message: "此交付連結已停用" });
      }
      if (delivery.expiresAt && new Date() > delivery.expiresAt) {
        throw new TRPCError({ code: "FORBIDDEN", message: "此交付連結已過期" });
      }
      // If password protected and no password provided, return meta only
      if (delivery.password && !input.password) {
        return {
          hasPassword: true as const,
          id: delivery.id,
          clientName: delivery.clientName,
          title: delivery.title,
          createdAt: delivery.createdAt,
          googleDriveUrl: null,
          message: null,
          quoteId: null,
        };
      }
      // If password provided, verify it
      if (delivery.password && input.password) {
        if (delivery.password !== input.password.trim()) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "密碼錯誤，請重試" });
        }
      }
      // Increment view count (fire-and-forget, don't await)
      db.update(deliveries)
        .set({ downloadCount: delivery.downloadCount + 1 })
        .where(eq(deliveries.id, delivery.id))
        .catch(() => {});
      return {
        hasPassword: false as const,
        id: delivery.id,
        clientName: delivery.clientName,
        title: delivery.title,
        googleDriveUrl: toGoogleDriveEmbedUrl(delivery.googleDriveUrl),
        message: delivery.message,
        createdAt: delivery.createdAt,
        quoteId: delivery.quoteId ?? null,
      };
    }),

  // Public: verify password and return full delivery content
  verifyPassword: publicProcedure
    .input(z.object({ token: z.string(), password: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "資料庫連線失敗" });
      const [delivery] = await db
        .select()
        .from(deliveries)
        .where(eq(deliveries.token, input.token))
        .limit(1);
      if (!delivery) throw new TRPCError({ code: "NOT_FOUND", message: "連結無效或已過期" });
      if (delivery.status !== "active") {
        throw new TRPCError({ code: "FORBIDDEN", message: "此交付連結已停用" });
      }
      if (delivery.expiresAt && new Date() > delivery.expiresAt) {
        throw new TRPCError({ code: "FORBIDDEN", message: "此交付連結已過期" });
      }
      // Check password
      if (delivery.password && delivery.password !== input.password.trim()) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "密碼錯誤，請重試" });
      }
      // Increment view count
      await db.update(deliveries)
        .set({ downloadCount: delivery.downloadCount + 1 })
        .where(eq(deliveries.id, delivery.id));
      return {
        id: delivery.id,
        clientName: delivery.clientName,
        title: delivery.title,
        googleDriveUrl: delivery.googleDriveUrl,
        message: delivery.message,
        createdAt: delivery.createdAt,
        quoteId: delivery.quoteId ?? null,
      };
    }),

  // Public: access delivery without password (for non-password-protected links)
  accessDelivery: publicProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "資料庫連線失敗" });
      const [delivery] = await db
        .select()
        .from(deliveries)
        .where(eq(deliveries.token, input.token))
        .limit(1);
      if (!delivery) throw new TRPCError({ code: "NOT_FOUND", message: "連結無效或已過期" });
      if (delivery.status !== "active") {
        throw new TRPCError({ code: "FORBIDDEN", message: "此交付連結已停用" });
      }
      if (delivery.expiresAt && new Date() > delivery.expiresAt) {
        throw new TRPCError({ code: "FORBIDDEN", message: "此交付連結已過期" });
      }
      if (delivery.password) {
        throw new TRPCError({ code: "FORBIDDEN", message: "此連結需要密碼" });
      }
      // Increment view count
      await db.update(deliveries)
        .set({ downloadCount: delivery.downloadCount + 1 })
        .where(eq(deliveries.id, delivery.id));
      return {
        id: delivery.id,
        clientName: delivery.clientName,
        title: delivery.title,
        googleDriveUrl: delivery.googleDriveUrl,
        message: delivery.message,
        createdAt: delivery.createdAt,
        quoteId: delivery.quoteId ?? null,
      };
    }),

  // Public: get full quote data by delivery token (for browser-side receipt rendering)
  // Used by /receipt/:token page — renders receipt in browser, no server-side PDF needed
  getQuoteByDeliveryToken: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "資料庫連線失敗" });
      const [delivery] = await db
        .select()
        .from(deliveries)
        .where(eq(deliveries.token, input.token))
        .limit(1);
      if (!delivery) throw new TRPCError({ code: "NOT_FOUND", message: "連結無效" });
      if (delivery.status !== "active") throw new TRPCError({ code: "FORBIDDEN", message: "此交付連結已停用" });
      if (!delivery.quoteId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "此交付連結尚未連結報價單，請聯絡 JD Studio 設定" });
      }
      const quote = await getQuoteById(delivery.quoteId);
      if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "報價單不存在" });
      // Return full quote data for browser-side receipt rendering
      return {
        quoteNumber: quote.quoteNumber,
        clientName: quote.clientName,
        clientCompany: quote.clientCompany,
        clientEmail: quote.clientEmail,
        clientPhone: quote.clientPhone,
        serviceType: quote.serviceType,
        shootingDate: quote.shootingDate,
        shootingLocation: quote.shootingLocation,
        notes: quote.notes,
        subtotal: quote.subtotal,
        discountAmount: quote.discountAmount,
        discountPercent: (quote as any).discountPercent ?? null,
        depositPercent: (quote as any).depositPercent ?? 50,
        total: quote.total,
        currency: quote.currency,
        equipment: quote.equipment,
        team: quote.team,
        deliveryMethod: quote.deliveryMethod,
        llmDescription: quote.llmDescription,
        items: (quote as any).items ?? [],
        createdAt: quote.createdAt,
      };
    }),
});
