import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import {
  createQuote,
  createEmailLog,
  deleteQuote,
  getEmailLogsByQuote,
  getQuoteById,
  getQuotes,
  updateQuote,
  upsertClientFromQuote,
  searchClients,
  backfillEmailInquiryLeadSources,
} from "../db";
import { invokeLLM, extractLLMText } from "../_core/llm";
import { storagePut } from "../storage";
import { nanoid } from "nanoid";
import { desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { quotes as quotesTable, quoteFollowUps } from "../../drizzle/schema";
import { ENV } from "../_core/env";
import { sendEmail } from "../resendEmail";
import { resyncClientMembershipFromQuotes } from "../db";
import {
  SERVICE_TYPE_LABELS,
  generateQuotePdfHtml,
} from "./quotePdf";
import { generateQuotePdfBuffer } from "./quotePdfKit";

// ─── Background PDF Pre-generation ───────────────────────────────────
/**
 * Fire-and-forget: generates PDF in background after quote create/update.
 * Errors are logged but never surfaced to the caller.
 */
function triggerBackgroundPdfGeneration(quoteId: number): void {
  setImmediate(async () => {
    try {
      const quote = await getQuoteById(quoteId);
      if (!quote) return;
      const itemsText = quote.items
        .map((item, idx) => `${idx + 1}. ${item.description} × ${item.quantity}${item.unit ?? ''} @ HKD ${item.unitPrice} = HKD ${item.amount}`)
        .join("\n");
      const llmResponse = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是 JD Studio HK 的專業報價單撰寫助手。請根據報價單資料，生成一段專業、精鍌的服務說明文字（繁體中文），用於報價單PDF的服務描述部分，約60-80字。`,
          },
          {
            role: "user",
            content: `報價單資料：
客戶：${quote.clientName}${quote.clientCompany ? ` (${quote.clientCompany})` : ''}
服務類型：${SERVICE_TYPE_LABELS[quote.serviceType] || quote.serviceType}
服務項目：
${itemsText}
總金額：HKD ${quote.total}`,
          },
        ],
      });
      const llmDescription = extractLLMText(llmResponse.choices?.[0]?.message?.content)
        || `感謝您選擇 JD Studio HK。我們將為您提供專業的${SERVICE_TYPE_LABELS[quote.serviceType] || '攝影'}服務。`;
      const pdfBuffer = await generateQuotePdfBuffer(quote, llmDescription, SERVICE_TYPE_LABELS);
      const fileKey = `quotes/${quote.quoteNumber}-${nanoid(8)}.pdf`;
      const { url } = await storagePut(fileKey, pdfBuffer, "application/pdf");
      await updateQuote(quoteId, { pdfUrl: url, pdfKey: fileKey, llmDescription });
      console.log(`[BG-PDF] ✅ Pre-generated PDF for quote #${quoteId}: ${url}`);
    } catch (err) {
      console.error(`[BG-PDF] ❌ Failed to pre-generate PDF for quote #${quoteId}:`, err);
    }
  });
}

// Resend is used for all outbound emails (open tracking via webhook)

// ─── Zod schemas ───────────────────────────────────────────────────
const quoteItemSchema = z.object({
  description: z.string(),
  quantity: z.number(),
  unit: z.string().default("次").optional(),
  unitPrice: z.number(),
  amount: z.number(),
  isIncluded: z.boolean().optional(),
});

const serviceTypeEnum = z.enum([
  "corporate_event",
  "product",
  "food_beverage",
  "jewelry",
  "artwork",
  "interior",
  "video_production",
  "graphic_design",
  "ad_video",
  "web_development",
  "ai_photography",
  "menu_design",
  "portrait",
  "360_photography",
  "drone",
  "kol_mi",
  "other",
]);

const quoteStatusEnum = z.enum(["draft", "sent", "accepted", "rejected", "expired"]);

// ─── Router ────────────────────────────────────────────────────────
export const quotesRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        search: z.string().optional(),
        serviceType: z.string().optional(),
        status: z.string().optional(),
        leadSource: z.string().optional(),
        year: z.number().optional(),
        month: z.number().min(1).max(12).optional(),
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      return getQuotes(input);
    }),

  /** One-shot / on-demand: remap legacy email_inquiry leadSource → real platforms */
  backfillLeadSources: protectedProcedure.mutation(async () => {
    return backfillEmailInquiryLeadSources();
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const quote = await getQuoteById(input.id);
      if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "報價單不存在" });
      return quote;
    }),

  create: protectedProcedure
    .input(
      z.object({
        clientName: z.string(),
        clientEmail: z.string().optional(),
        clientPhone: z.string().optional(),
        clientCompany: z.string().optional(),
        serviceType: serviceTypeEnum,
        shootingDate: z.string().optional(),
        shootingLocation: z.string().optional(),
        notes: z.string().optional(),
        subtotal: z.number(),
        discountPercent: z.number().default(0),
        discountAmount: z.number().default(0),
        total: z.number(),
        depositPercent: z.number().default(50),
        depositMode: z.enum(["percent", "fixed"]).default("percent"),
        depositFixedAmount: z.number().optional(),
        currency: z.string().default("HKD"),
        validUntil: z.string().optional(),
        equipment: z.string().optional(),
        team: z.string().optional(),
        deliveryMethod: z.string().optional(),
        leadSource: z.string().optional(),
        items: z.array(quoteItemSchema),
        syncToClients: z.boolean().default(true),
        emailInquiryId: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { items, syncToClients, depositPercent: _dp, depositMode: _dm, depositFixedAmount: _dfa, ...quoteDataRest } = input;
      const quoteData = { ...quoteDataRest, depositPercent: input.depositPercent ?? 50, depositMode: input.depositMode ?? "percent", depositFixedAmount: input.depositFixedAmount };

      let clientId: number | undefined;
      if (syncToClients) {
        try {
          const result = await upsertClientFromQuote({
            name: quoteData.clientName,
            company: quoteData.clientCompany,
            email: quoteData.clientEmail,
            phone: quoteData.clientPhone,
          });
          clientId = result.id;
        } catch (err) {
          console.error("[Quote] Failed to sync client:", err);
        }
      }

      const newQuote = await createQuote({
        ...quoteData,
        clientId: clientId ?? null,
        emailInquiryId: quoteData.emailInquiryId ?? null,
        subtotal: String(quoteData.subtotal),
        discountPercent: String(quoteData.discountPercent ?? 0),
        discountAmount: String(quoteData.discountAmount),
        total: String(quoteData.total),
        depositPercent: String(quoteData.depositPercent ?? 50),
        depositMode: quoteData.depositMode ?? "percent",
        depositFixedAmount: quoteData.depositFixedAmount != null ? String(quoteData.depositFixedAmount) : null,
        items: items.map((item) => ({
          ...item,
          quantity: String(item.quantity),
          unitPrice: String(item.unitPrice),
          amount: String(item.amount),
        })),
      });
      // Fire-and-forget: pre-generate PDF in background
      triggerBackgroundPdfGeneration(newQuote.id);
      return newQuote;
    }),

  searchClientsForQuote: protectedProcedure
    .input(z.object({ query: z.string(), limit: z.number().min(1).max(10).default(5) }))
    .query(async ({ input }) => {
      return searchClients(input.query, input.limit);
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        clientName: z.string().optional(),
        clientEmail: z.string().optional(),
        clientPhone: z.string().optional(),
        clientCompany: z.string().optional(),
        serviceType: serviceTypeEnum.optional(),
        shootingDate: z.string().optional(),
        shootingLocation: z.string().optional(),
        notes: z.string().optional(),
        subtotal: z.number().optional(),
        discountPercent: z.number().optional(),
        discountAmount: z.number().optional(),
        total: z.number().optional(),
        depositPercent: z.number().optional(),
        depositMode: z.enum(["percent", "fixed"]).optional(),
        depositFixedAmount: z.number().nullable().optional(),
        status: quoteStatusEnum.optional(),
        validUntil: z.string().optional(),
        equipment: z.string().optional(),
        team: z.string().optional(),
        deliveryMethod: z.string().optional(),
        leadSource: z.string().optional(),
        rejectedReason: z.string().optional(),
        items: z.array(quoteItemSchema).optional(),
        emailInquiryId: z.number().nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      console.log('[Quotes.update] Input received:', JSON.stringify(input, null, 2));
      const { id, items, subtotal, discountPercent, discountAmount, total, depositPercent, depositMode, depositFixedAmount, ...rest } = input;
      // Check if content-affecting fields are being changed
      // If so, clear pdfUrl so the next download regenerates a fresh PDF
      const contentFields = ["clientName", "serviceType", "items", "subtotal", "discountPercent", "discountAmount", "total", "depositPercent", "equipment", "team", "deliveryMethod", "validUntil", "notes"];
      const hasContentChange = contentFields.some((f) => f in input);
      const result = await updateQuote(id, {
        ...rest,
        ...(subtotal !== undefined && { subtotal: String(subtotal) }),
        ...(discountPercent !== undefined && { discountPercent: String(discountPercent) }),
        ...(discountAmount !== undefined && { discountAmount: String(discountAmount) }),
        ...(total !== undefined && { total: String(total) }),
        ...(depositPercent !== undefined && { depositPercent: String(depositPercent) }),
        ...(depositMode !== undefined && { depositMode }),
        ...(depositFixedAmount !== undefined && { depositFixedAmount: depositFixedAmount != null ? String(depositFixedAmount) : null }),
        ...(items && {
          items: items.map((item) => ({
            ...item,
            quantity: String(item.quantity),
            unitPrice: String(item.unitPrice),
            amount: String(item.amount),
          })),
        }),
        // Auto-invalidate cached PDF when content changes
        ...(hasContentChange && { pdfUrl: null, pdfKey: null }),
      });

      // 當狀態改為 accepted 時，自動同步會員等級（本年累計；會員制按年度）
      if (input.status === "accepted") {
        const quote = await getQuoteById(id);
        const clientId = (quote as any)?.clientId;
        if (clientId) {
          try {
            const membership = await resyncClientMembershipFromQuotes(clientId);
            process.stderr.write(
              `[Loyalty] Auto-synced client ${clientId}: HKD ${membership.totalSpend} → ${membership.tier} (YTD)\n`
            );
          } catch (err) {
            console.error("[Loyalty] Auto-sync failed:", err);
          }
        }
      }

      return result;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteQuote(input.id);
      return { success: true };
    }),

  // ─── Generate Quote PDF (admin) ────────────────────────────────
  generatePdf: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const quote = await getQuoteById(input.id);
      if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "報價單不存在" });

      const itemsText = quote.items
        .map((item, idx) => `${idx + 1}. ${item.description} × ${item.quantity}${item.unit} @ HKD ${item.unitPrice} = HKD ${item.amount}`)
        .join("\n");

      const llmResponse = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是 JD Studio HK 的專業報價單撰寫助手。JD Studio 是香港頂尖的商業攝影與影片製作公司，成立於2014年，服務超過1,250間企業客戶。請根據報價單資料，生成一段專業、精煉的服務說明文字（繁體中文），用於報價單PDF的服務描述部分，約100-150字。`,
          },
          {
            role: "user",
            content: `報價單資料：
客戶：${quote.clientName}${quote.clientCompany ? ` (${quote.clientCompany})` : ""}
服務類型：${SERVICE_TYPE_LABELS[quote.serviceType] || quote.serviceType}
拍攝日期：${quote.shootingDate || "待定"}
拍攝地點：${quote.shootingLocation || "待定"}
服務項目：
${itemsText}
總金額：HKD ${quote.total}
備註：${quote.notes || "無"}`,
          },
        ],
      });

      const llmDescription = extractLLMText(llmResponse.choices?.[0]?.message?.content)
        || "感謝您選擇 JD Studio HK 的專業攝影服務。我們將以最高水準為您提供專業的視覺內容製作，確保每個細節都能完美呈現您的品牌形象。";
      const pdfBuffer = await generateQuotePdfBuffer(quote, llmDescription, SERVICE_TYPE_LABELS);
      const fileKey = `quotes/${quote.quoteNumber}-${nanoid(8)}.pdf`;
      const { url } = await storagePut(fileKey, pdfBuffer, "application/pdf");
      await updateQuote(input.id, { pdfUrl: url, pdfKey: fileKey, llmDescription });
      return { pdfUrl: url, llmDescription };
    }),

  getEmailLogs: protectedProcedure
    .input(z.object({ quoteId: z.number() }))
    .query(async ({ input }) => {
      return getEmailLogsByQuote(input.quoteId);
    }),

  // ─── Generate Receipt PDF (admin) ──────────────────────────────
  generateReceiptPdf: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const quote = await getQuoteById(input.id);
      if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "報價單不存在" });

      const llmDescription = quote.llmDescription || "感謝您選擇 JD Studio HK 的專業攝影服務。";
      const pdfBuffer = await generateQuotePdfBuffer(quote, llmDescription, SERVICE_TYPE_LABELS, "RECEIPT");
      const fileKey = `receipts/${quote.quoteNumber}-${nanoid(8)}.pdf`;
      const { url } = await storagePut(fileKey, pdfBuffer, "application/pdf");
      await updateQuote(input.id, { receiptUrl: url, receiptKey: fileKey } as any);
      return { receiptUrl: url };
    }),

  // ─── Send Quote Email with PDF (admin) ─────────────────────────
  sendQuoteEmail: protectedProcedure
    .input(z.object({
      id: z.number(),
      to: z.string(),
      subject: z.string(),
      body: z.string(),
    }))
    .mutation(async ({ input }) => {
      const quote = await getQuoteById(input.id);
      if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "報價單不存在" });
      if (!ENV.gmailUser || !ENV.gmailAppPassword) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "郵件設定未完成，請聯絡管理員" });
      }

      // Generate PDF using PDFKit (fast, no Chromium needed)
      const llmDescription = quote.llmDescription || "感謝您選擇 JD Studio HK 的專業攝影服務。";
      const signatureData = (quote as any).signatureData || null;
      const pdfBuffer = await generateQuotePdfBuffer(quote, llmDescription, SERVICE_TYPE_LABELS, "QUOTATION", signatureData);

      // Pre-create email log to get the ID for tracking pixel
      const logId = await createEmailLog({
        quoteId: input.id,
        to: input.to,
        subject: input.subject,
        body: input.body,
        status: "sent",
      });

      // Build the tracking pixel URL using the log ID
      // The pixel is a 1x1 transparent GIF served by our own server
      const trackingPixelUrl = `https://jdsys.manus.space/api/track/open/${logId}`;

      // Build HTML email body with tracking pixel
      const htmlBody = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
<div style="background:#1a1a1a;padding:20px 30px"><h2 style="color:#fff;margin:0;font-size:18px;letter-spacing:2px">JD STUDIO HK</h2></div>
<div style="padding:30px"><pre style="font-family:Arial,sans-serif;white-space:pre-wrap">${input.body}</pre></div>
<div style="background:#f5f5f5;padding:15px 30px;font-size:12px;color:#888"><p style="margin:0">JD Studio · Hong Kong &nbsp;|&nbsp; info.exposurehk@gmail.com &nbsp;|&nbsp; www.jdstudiohk.com</p></div>
<img src="${trackingPixelUrl}" width="1" height="1" style="display:block;width:1px;height:1px;border:0;" alt="" />
</div>`;

      const result = await sendEmail({
        to: input.to,
        subject: input.subject,
        html: htmlBody,
        text: input.body,
        attachments: [{
          filename: `${quote.quoteNumber}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf",
        }],
        tags: [{ name: "type", value: "quotation" }, { name: "quoteId", value: String(input.id) }],
      });

      if (!result.success) {
        // Update the pre-created log to failed status
        const db = await getDb();
        if (db) {
          const { emailLogs } = await import("../../drizzle/schema");
          await db.update(emailLogs).set({ status: "failed", errorMessage: result.error ?? "Unknown error" }).where(eq(emailLogs.id, logId));
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `郵件發送失敗：${result.error}` });
      }

      // Update with Resend message ID if available
      if (result.messageId) {
        const db = await getDb();
        if (db) {
          const { emailLogs } = await import("../../drizzle/schema");
          await db.update(emailLogs).set({ resendMessageId: result.messageId }).where(eq(emailLogs.id, logId));
        }
      }

      if (quote.status === "draft") await updateQuote(input.id, { status: "sent" });
      return { success: true, sentTo: input.to };
    }),

  // ─── Generate Sign Link (admin) ────────────────────────────────
  generateSignLink: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const quote = await getQuoteById(input.id);
      if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "報價單不存在" });
      if (quote.signToken) return { signToken: quote.signToken as string };
      const signToken = nanoid(32);
      await updateQuote(input.id, { signToken } as any);
      return { signToken };
    }),

  // ─── Upload Sign Attachment (admin) ────────────────────────────
  uploadSignAttachment: protectedProcedure
    .input(z.object({
      id: z.number(),
      fileName: z.string(),
      fileBase64: z.string(),
      mimeType: z.string(),
    }))
    .mutation(async ({ input }) => {
      const quote = await getQuoteById(input.id);
      if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "報價單不存在" });
      const fileBuffer = Buffer.from(input.fileBase64, "base64");
      const fileKey = `sign-attachments/${quote.quoteNumber}-${nanoid(8)}-${input.fileName}`;
      const { url } = await storagePut(fileKey, fileBuffer, input.mimeType);
      const existing: Array<{ name: string; url: string; key: string }> =
        quote.signAttachments ? JSON.parse(quote.signAttachments as string) : [];
      existing.push({ name: input.fileName, url, key: fileKey });
      await updateQuote(input.id, { signAttachments: JSON.stringify(existing) } as any);
      return { url, key: fileKey, attachments: existing };
    }),

  // ─── Remove Sign Attachment (admin) ────────────────────────────
  removeSignAttachment: protectedProcedure
    .input(z.object({ id: z.number(), key: z.string() }))
    .mutation(async ({ input }) => {
      const quote = await getQuoteById(input.id);
      if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "報價單不存在" });
      const existing: Array<{ name: string; url: string; key: string }> =
        quote.signAttachments ? JSON.parse(quote.signAttachments as string) : [];
      const updated = existing.filter((a) => a.key !== input.key);
      await updateQuote(input.id, { signAttachments: JSON.stringify(updated) } as any);
      return { attachments: updated };
    }),

  // ─── Reset Sign Link (admin) ────────────────────────────────────
  resetSignLink: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const signToken = nanoid(32);
      await updateQuote(input.id, { signToken, signedAt: null, signedByName: null, signatureData: null } as any);
      return { signToken };
    }),

  // ─── Get Quote by Sign Token (public) ──────────────────────────
  getBySignToken: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "資料庫連線失敗" });
      const [row] = await db
        .select({ id: quotesTable.id })
        .from(quotesTable)
        .where(eq(quotesTable.signToken, input.token))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "連結無效或已過期" });
      const fullQuote = await getQuoteById(row.id);
      if (!fullQuote) throw new TRPCError({ code: "NOT_FOUND", message: "報價單不存在" });
      return {
        id: fullQuote.id,
        quoteNumber: fullQuote.quoteNumber,
        clientName: fullQuote.clientName,
        clientEmail: fullQuote.clientEmail,
        clientPhone: fullQuote.clientPhone,
        serviceType: fullQuote.serviceType,
        shootingDate: fullQuote.shootingDate,
        shootingLocation: fullQuote.shootingLocation,
        notes: fullQuote.notes,
        subtotal: fullQuote.subtotal,
        discountAmount: fullQuote.discountAmount,
        total: fullQuote.total,
        currency: fullQuote.currency,
        validUntil: fullQuote.validUntil,
        equipment: fullQuote.equipment,
        team: fullQuote.team,
        deliveryMethod: fullQuote.deliveryMethod,
        llmDescription: fullQuote.llmDescription,
        items: (fullQuote as any).items ?? [],
        signedAt: fullQuote.signedAt,
        signedByName: fullQuote.signedByName,
        signAttachments: fullQuote.signAttachments
          ? JSON.parse(fullQuote.signAttachments as string)
          : [] as Array<{ name: string; url: string; key: string }>,
        createdAt: fullQuote.createdAt,
      };
    }),

  // ─── Submit Signature (public) ─────────────────────────────────
  submitSignature: publicProcedure
    .input(z.object({
      token: z.string(),
      signedByName: z.string().min(1, "請輸入姓名"),
      signatureData: z.string().min(1),
      origin: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "資料庫連線失敗" });
      const [row] = await db
        .select({ id: quotesTable.id, signedAt: quotesTable.signedAt })
        .from(quotesTable)
        .where(eq(quotesTable.signToken, input.token))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "連結無效或已過期" });
      if (row.signedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "此報價單已簽署" });

      const updatedQuote = await updateQuote(row.id, {
        signedAt: new Date(),
        signedByName: input.signedByName,
        signatureData: input.signatureData,
        status: "accepted",
      } as any);

      // Fire-and-forget: send confirmation email with print page link
      if (updatedQuote?.clientEmail) {
        (async () => {
          try {
            const signedDate = new Date().toLocaleString("zh-HK", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
            const origin = input.origin || "https://jdsys.manus.space";
            const printUrl = `${origin}/print/quote/${row.id}`;
            const emailBody = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
<div style="background:#1a1a1a;padding:20px 30px">
  <h2 style="color:#fff;margin:0;font-size:18px;letter-spacing:2px">JD STUDIO HK</h2>
</div>
<div style="padding:30px">
  <p>Dear <strong>${input.signedByName}</strong>,</p>
  <p>Thank you for signing the quotation <strong>${updatedQuote.quoteNumber}</strong>.</p>
  <p>Your signature has been recorded on <strong>${signedDate}</strong>.</p>
  <p>You can view and download your signed quotation by clicking the button below:</p>
  <div style="text-align:center;margin:24px 0">
    <a href="${printUrl}" style="background:#c9a84c;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:15px;display:inline-block">View &amp; Print Signed Quotation</a>
  </div>
  <p style="font-size:12px;color:#888">Or copy this link: <a href="${printUrl}" style="color:#c9a84c">${printUrl}</a></p>
  <p>We will be in touch shortly to confirm the next steps.</p>
  <p>If you have any questions, please feel free to contact us.</p>
  <br/>
  <p>Best regards,<br/><strong>Derek</strong><br/>JD Studio HK<br/>Tel: +852 9153 1976<br/><a href="https://www.jdstudiohk.com">www.jdstudiohk.com</a></p>
</div>
<div style="background:#f5f5f5;padding:15px 30px;font-size:12px;color:#888">
  <p style="margin:0">JD Studio · Hong Kong &nbsp;|&nbsp; info.exposurehk@gmail.com &nbsp;|&nbsp; www.jdstudiohk.com</p>
</div>
</div>`;
            const signResult = await sendEmail({
              to: updatedQuote.clientEmail!,
              subject: `[JD Studio HK] Quotation ${updatedQuote.quoteNumber} - Signed Confirmation`,
              html: emailBody,
              tags: [{ name: "type", value: "sign_confirmation" }],
            });
            if (signResult.success) {
              process.stderr.write(`[Sign] Email sent via Resend to ${updatedQuote.clientEmail} (id: ${signResult.messageId})\n`);
            } else {
              console.error(`[Sign] Resend failed: ${signResult.error}`);
            }
          } catch (err) {
            console.error("[Sign] Failed to send confirmation email:", err);
          }
        })();
      }

      // 簽署即代表已接受，自動同步會員等級（本年累計；會員制按年度）
      const clientId = (updatedQuote as any)?.clientId;
      if (clientId) {
        try {
          const membership = await resyncClientMembershipFromQuotes(clientId);
          process.stderr.write(
            `[Loyalty] Sign auto-synced client ${clientId}: HKD ${membership.totalSpend} → ${membership.tier} (YTD)\n`
          );
        } catch (err) {
          console.error("[Loyalty] Sign auto-sync failed:", err);
        }
      }

      return { success: true, clientEmail: updatedQuote?.clientEmail ?? null };
    }),

  // ─── updatePayment: 更新訂金/尾數付款記錄 ───────────────────────────
  updatePayment: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        paymentStatus: z.enum(["unpaid", "deposit_paid", "fully_paid"]),
        depositPaidAmount: z.number().nullable().optional(),
        depositPaidAt: z.string().nullable().optional(), // ISO date string or null
        balancePaidAmount: z.number().nullable().optional(),
        balancePaidAt: z.string().nullable().optional(), // ISO date string or null
        paymentNotes: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "資料庫連線失敗" });
      await db
        .update(quotesTable)
        .set({
          paymentStatus: input.paymentStatus,
          depositPaidAmount: input.depositPaidAmount != null ? String(input.depositPaidAmount) : null,
          depositPaidAt: input.depositPaidAt ? new Date(input.depositPaidAt) : null,
          balancePaidAmount: input.balancePaidAmount != null ? String(input.balancePaidAmount) : null,
          balancePaidAt: input.balancePaidAt ? new Date(input.balancePaidAt) : null,
          paymentNotes: input.paymentNotes ?? null,
        })
        .where(eq(quotesTable.id, input.id));
      return { success: true };
    }),

  // Stop/Resume Follow-up
  toggleStopFollowUp: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        stopFollowUp: z.boolean(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database connection failed" });
      const quote = await getQuoteById(input.id);
      if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "Quote not found" });
      // Update both quotes.stopFollowUp and all related quoteFollowUps.stopFollowUp
      // This ensures consistency between the quote detail page and quote follow-up page
      await db.update(quotesTable).set({ stopFollowUp: input.stopFollowUp }).where(eq(quotesTable.id, input.id));
      // Also update all associated follow-up records for this quote
      await db.update(quoteFollowUps).set({ stopFollowUp: input.stopFollowUp }).where(eq(quoteFollowUps.quoteId, input.id));
      return { success: true, stopFollowUp: input.stopFollowUp };
    }),

  /**
   * Bank-ready list of merchants/clients with at least one accepted quote.
   * Deduplicates by company (preferred) or client name.
   */
  acceptedMerchants: protectedProcedure
    .input(
      z
        .object({
          year: z.number().optional(),
          fromYear: z.number().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database connection failed" });

      const rows = await db
        .select({
          id: quotesTable.id,
          quoteNumber: quotesTable.quoteNumber,
          clientName: quotesTable.clientName,
          clientCompany: quotesTable.clientCompany,
          clientEmail: quotesTable.clientEmail,
          clientPhone: quotesTable.clientPhone,
          serviceType: quotesTable.serviceType,
          total: quotesTable.total,
          currency: quotesTable.currency,
          signedAt: quotesTable.signedAt,
          createdAt: quotesTable.createdAt,
          shootingDate: quotesTable.shootingDate,
        })
        .from(quotesTable)
        .where(eq(quotesTable.status, "accepted"))
        .orderBy(desc(quotesTable.createdAt));

      const year = input?.year;
      const fromYear = input?.fromYear;
      const filtered = rows.filter((r) => {
        const d = r.signedAt ?? r.createdAt;
        if (!d) return true;
        const y = new Date(d).getFullYear();
        if (year != null) return y === year;
        if (fromYear != null) return y >= fromYear;
        return true;
      });

      type Agg = {
        merchantName: string;
        contactName: string;
        email: string | null;
        phone: string | null;
        quoteCount: number;
        totalAmount: number;
        currency: string;
        firstAcceptedAt: Date | null;
        lastAcceptedAt: Date | null;
        serviceTypes: Set<string>;
        quoteNumbers: string[];
      };

      const map = new Map<string, Agg>();
      for (const r of filtered) {
        const company = (r.clientCompany || "").trim();
        const name = (r.clientName || "").trim();
        const merchantName = company || name || "（未命名）";
        const key = merchantName.toLowerCase().replace(/\s+/g, " ");
        const acceptedAt = r.signedAt ?? r.createdAt ?? null;
        const amount = Number(r.total || 0);
        const existing = map.get(key);
        if (!existing) {
          map.set(key, {
            merchantName,
            contactName: name || merchantName,
            email: r.clientEmail || null,
            phone: r.clientPhone || null,
            quoteCount: 1,
            totalAmount: amount,
            currency: r.currency || "HKD",
            firstAcceptedAt: acceptedAt,
            lastAcceptedAt: acceptedAt,
            serviceTypes: new Set([r.serviceType]),
            quoteNumbers: [r.quoteNumber],
          });
        } else {
          existing.quoteCount += 1;
          existing.totalAmount += amount;
          existing.serviceTypes.add(r.serviceType);
          existing.quoteNumbers.push(r.quoteNumber);
          if (!existing.email && r.clientEmail) existing.email = r.clientEmail;
          if (!existing.phone && r.clientPhone) existing.phone = r.clientPhone;
          if (name && existing.contactName === existing.merchantName) existing.contactName = name;
          if (acceptedAt) {
            if (!existing.firstAcceptedAt || acceptedAt < existing.firstAcceptedAt) {
              existing.firstAcceptedAt = acceptedAt;
            }
            if (!existing.lastAcceptedAt || acceptedAt > existing.lastAcceptedAt) {
              existing.lastAcceptedAt = acceptedAt;
            }
          }
        }
      }

      const merchants = Array.from(map.values())
        .map((m) => ({
          merchantName: m.merchantName,
          contactName: m.contactName,
          email: m.email,
          phone: m.phone,
          quoteCount: m.quoteCount,
          totalAmount: Math.round(m.totalAmount * 100) / 100,
          currency: m.currency,
          firstAcceptedAt: m.firstAcceptedAt,
          lastAcceptedAt: m.lastAcceptedAt,
          serviceTypes: Array.from(m.serviceTypes).map(
            (t) => SERVICE_TYPE_LABELS[t as keyof typeof SERVICE_TYPE_LABELS] || t
          ),
          quoteNumbers: m.quoteNumbers,
        }))
        .sort((a, b) => a.merchantName.localeCompare(b.merchantName, "zh-HK"));

      return {
        generatedAt: new Date().toISOString(),
        acceptedQuoteCount: filtered.length,
        merchantCount: merchants.length,
        grandTotal: Math.round(merchants.reduce((s, m) => s + m.totalAmount, 0) * 100) / 100,
        merchants,
      };
    }),
});

// Re-export for use in other modules (e.g. tests)
export { generateQuotePdfHtml } from "./quotePdf";
