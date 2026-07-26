/**
 * pitchOutreach.ts — tRPC router
 * 客戶開拓系統的後端 API
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { pitchLeads, pitchSendLog } from "../../drizzle/schema";
import { eq, and, desc, count, gte, lte, like, or, inArray } from "drizzle-orm";
import { runOutreachPipeline, getTodayContactedCount, generatePitchEmail, linkedInPeopleSearchUrl, linkedInCompanySearchUrl, expireStaleLeads, isLeadExpired, JOB_LISTING_MAX_AGE_DAYS, fallbackJobSearchUrl } from "../scrapers/pitchOutreach";
import { extractEmailFromCompanyWebsite, extractEmailFromJobPage } from "../scrapers/emailFinder";
import { extractDomain } from "../scrapers/jobScraper";
import { multiLayerEmailSearch } from "../scrapers/multiLayerEmailFinder";
import { sendViaGmail } from "../resendEmail";
import { ENV } from "../_core/env";
import axios from "axios";

export const pitchOutreachRouter = router({
  // ─── 取得 leads 清單 ───────────────────────────────────────────────
  listLeads: protectedProcedure
    .input(
      z.object({
        status: z
          .enum(["all", "pending_email", "pending_review", "approved", "sent", "skipped", "bounced", "replied"])
          .optional()
          .default("all"),
        source: z.enum(["all", "jobsdb", "linkedin", "indeed", "ctgoodjobs"]).optional().default("all"),
        search: z.string().optional(),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // 開頁時順便清理過期待跟進
      if (input.status === "pending_review" || input.status === "all") {
        await expireStaleLeads();
      }

      const offset = (input.page - 1) * input.pageSize;

      const conditions = [];
      if (input.status === "pending_review") {
        // 待跟進：包含舊 pending_email，並排除已過期（雙保險）
        conditions.push(inArray(pitchLeads.status, ["pending_review", "pending_email"]));
        const cutoff = new Date(Date.now() - JOB_LISTING_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
        conditions.push(
          sql`COALESCE(${pitchLeads.jobPostedAt}, ${pitchLeads.createdAt}) >= ${cutoff}`
        );
      } else if (input.status !== "all") {
        conditions.push(eq(pitchLeads.status, input.status));
      }
      if (input.source !== "all") {
        conditions.push(eq(pitchLeads.source, input.source));
      }
      if (input.search) {
        conditions.push(
          or(
            like(pitchLeads.companyName, `%${input.search}%`),
            like(pitchLeads.jobTitle, `%${input.search}%`),
            like(pitchLeads.contactEmail, `%${input.search}%`)
          )
        );
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const [leads, totalResult] = await Promise.all([
        db
          .select()
          .from(pitchLeads)
          .where(whereClause)
          .orderBy(desc(pitchLeads.createdAt))
          .limit(input.pageSize)
          .offset(offset),
        db.select({ cnt: count() }).from(pitchLeads).where(whereClause),
      ]);

      return {
        leads: leads.map((lead) => ({
          ...lead,
          isExpired: isLeadExpired(lead),
          jobLinkUrl: isLeadExpired(lead)
            ? fallbackJobSearchUrl(lead)
            : lead.jobUrl,
        })),
        total: totalResult[0]?.cnt ?? 0,
        page: input.page,
        pageSize: input.pageSize,
        maxAgeDays: JOB_LISTING_MAX_AGE_DAYS,
      };
    }),

  // ─── 取得統計數據 ──────────────────────────────────────────────────
  getStats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    await expireStaleLeads();

    const todayContacted = await getTodayContactedCount();

    const statusCounts = await db
      .select({ status: pitchLeads.status, cnt: count() })
      .from(pitchLeads)
      .groupBy(pitchLeads.status);

    const counts: Record<string, number> = {};
    for (const row of statusCounts) {
      counts[row.status] = row.cnt;
    }

    // 待跟進：只計未過期
    const cutoff = new Date(Date.now() - JOB_LISTING_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
    const [toContactRow] = await db
      .select({ cnt: count() })
      .from(pitchLeads)
      .where(
        and(
          inArray(pitchLeads.status, ["pending_review", "pending_email"]),
          sql`COALESCE(${pitchLeads.jobPostedAt}, ${pitchLeads.createdAt}) >= ${cutoff}`
        )
      );

    // 最新 lead 建立時間（代表最後一次爬蟲成功抓到新資料的時間）
    const [latestLead] = await db
      .select({ createdAt: pitchLeads.createdAt })
      .from(pitchLeads)
      .orderBy(desc(pitchLeads.createdAt))
      .limit(1);

    const toContact = toContactRow?.cnt ?? 0;

    return {
      todayContacted,
      todaySent: todayContacted, // backward compat for older UI
      dailyLimit: null,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      toContact,
      pendingEmail: counts["pending_email"] ?? 0,
      pendingReview: toContact,
      contacted: counts["sent"] ?? 0,
      sent: counts["sent"] ?? 0,
      won: counts["approved"] ?? 0,
      skipped: counts["skipped"] ?? 0,
      replied: counts["replied"] ?? 0,
      lastLeadCreatedAt: latestLead?.createdAt ?? null,
      maxAgeDays: JOB_LISTING_MAX_AGE_DAYS,
    };
  }),

  // ─── 手動觸發爬蟲 + 發送流程 ──────────────────────────────────────
  runPipeline: protectedProcedure.mutation(async () => {
    const hunterApiKey = process.env.HUNTER_API_KEY;
    try {
      const result = await runOutreachPipeline(hunterApiKey);
      return { success: true, ...result };
    } catch (err: any) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: err?.message ?? "Pipeline failed",
      });
    }
  }),

  // ─── 更新 lead 狀態（LinkedIn 跟進） ──────────────────────────────
  updateLeadStatus: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        status: z.enum(["pending_email", "pending_review", "approved", "sent", "skipped", "bounced", "replied"]),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const patch: Record<string, unknown> = { status: input.status };
      if (input.notes !== undefined) patch.notes = input.notes;
      // 「已聯絡」＝ LinkedIn DM 已發，記時間
      if (input.status === "sent") {
        patch.pitchSentAt = new Date();
      }

      await db.update(pitchLeads).set(patch).where(eq(pitchLeads.id, input.id));

      return { success: true };
    }),

  // ─── LinkedIn 搜尋連結 ─────────────────────────────────────────────
  getLinkedInLinks: protectedProcedure
    .input(z.object({ companyName: z.string().min(1) }))
    .query(({ input }) => ({
      peopleUrl: linkedInPeopleSearchUrl(input.companyName),
      companyUrl: linkedInCompanySearchUrl(input.companyName),
    })),

  // ─── 更新 lead 聯絡 email ──────────────────────────────────────────
  updateLeadEmail: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        contactEmail: z.string().email(),
        contactName: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await db
        .update(pitchLeads)
        .set({
          contactEmail: input.contactEmail,
          contactName: input.contactName,
          emailFoundVia: "manual",
          // 手動填電郵仍保持待跟進；唔自動改寄信流程
          status: "pending_review",
        })
        .where(eq(pitchLeads.id, input.id));

      return { success: true };
    }),

  // ─── 重新生成 AI pitch 內容 ────────────────────────────────────────
  regeneratePitch: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const lead = await db
        .select()
        .from(pitchLeads)
        .where(eq(pitchLeads.id, input.id))
        .limit(1);

      if (!lead[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Lead not found" });

      const generated = await generatePitchEmail({
        companyName: lead[0].companyName,
        jobTitle: lead[0].jobTitle,
        jobDescription: lead[0].jobDescription ?? undefined,
        industry: lead[0].industry ?? undefined,
        contactName: lead[0].contactName ?? undefined,
        source: lead[0].source ?? undefined,
      });

      await db
        .update(pitchLeads)
        .set({
          aiPitchSubject: generated.subject,
          aiPitchBody: generated.body,
        })
        .where(eq(pitchLeads.id, input.id));

      return { success: true, subject: generated.subject, body: generated.body };
    }),

  // ─── 手動發送 pitch email ──────────────────────────────────────────
  sendPitch: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const lead = await db
        .select()
        .from(pitchLeads)
        .where(eq(pitchLeads.id, input.id))
        .limit(1);

      if (!lead[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Lead not found" });
      if (!lead[0].contactEmail) throw new TRPCError({ code: "BAD_REQUEST", message: "No contact email" });

      // 確保有 AI 內容
      let subject = lead[0].aiPitchSubject;
      let body = lead[0].aiPitchBody;

      if (!subject || !body) {
        const generated = await generatePitchEmail({
          companyName: lead[0].companyName,
          jobTitle: lead[0].jobTitle,
          jobDescription: lead[0].jobDescription ?? undefined,
          industry: lead[0].industry ?? undefined,
          contactName: lead[0].contactName ?? undefined,
          source: lead[0].source ?? undefined,
        });
        subject = generated.subject;
        body = generated.body;
        await db
          .update(pitchLeads)
          .set({ aiPitchSubject: subject, aiPitchBody: body })
          .where(eq(pitchLeads.id, input.id));
      }

      const greeting = lead[0].contactName ? `Dear ${lead[0].contactName},` : `Dear Hiring Manager,`;
      const bodyHtml = (body ?? "")
        .split("\n\n")
        .map((p: string) => `<p style="margin:0 0 12px 0;">${p.replace(/\n/g, "<br>")}</p>`)
        .join("");

      const htmlBody = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:600px;margin:0 auto;">
<p style="margin:0 0 12px 0;">${greeting}</p>
${bodyHtml}
<p style="margin:16px 0 4px 0;">Cheers!</p>
<p style="margin:0;font-weight:bold;">Derek</p>
<p style="margin:0;">JD STUDIO HK</p>
<p style="margin:0;">Tel No: (852) 9153 1976</p>
<p style="margin:0;">Web: <a href="https://jdstudiohk.com/" style="color:#1a73e8;">https://jdstudiohk.com/</a></p>
<div style="background:#f5f5f5;padding:12px 20px;font-size:11px;color:#888;margin-top:20px;">
  <p style="margin:0;">JD Studio · Hong Kong &nbsp;|&nbsp; info.exposurehk@gmail.com &nbsp;|&nbsp; www.jdstudiohk.com</p>
</div>
</div>`;

      const result = await sendViaGmail({
        to: lead[0].contactEmail,
        subject: subject ?? "Photography & Video Production Services — JD STUDIO HK",
        html: htmlBody,
      });

      await db.insert(pitchSendLog).values({
        leadId: lead[0].id,
        emailSubject: subject ?? "",
        emailBody: body ?? "",
        toEmail: lead[0].contactEmail,
        result: result.success ? "success" : "failed",
        errorMessage: result.error,
        gmailMessageId: result.messageId,
      });

      if (result.success) {
        await db
          .update(pitchLeads)
          .set({ status: "sent", pitchSentAt: new Date(), gmailMessageId: result.messageId })
          .where(eq(pitchLeads.id, input.id));
        return { success: true };
      } else {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: result.error ?? "Send failed",
        });
      }
    }),

  // ─── 設置 Heartbeat 排程 ────────────────────────────────────────────
  setupHeartbeat: protectedProcedure.mutation(async ({ ctx }) => {
    const { createHeartbeatJob } = await import("../_core/heartbeat");
    const { parse: parseCookie } = await import("cookie");
    const { COOKIE_NAME } = await import("@shared/const");
    
    try {
      // 從 cookie 中提取 session token
      const sessionToken = parseCookie(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "";
      if (!sessionToken) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "No session token" });
      }

      // 建立 Heartbeat 排程（每天 02:00 UTC = 10:00 HKT）
      const job = await createHeartbeatJob({
        name: `pitch-outreach-daily`,
        cron: "0 2 * * *",  // 每天 02:00 UTC = 10:00 HKT
        path: "/api/scheduled/pitch-outreach",
        description: "Daily automated pitch outreach - sends up to 10 emails at 10:00 HKT",
      }, sessionToken);

      console.log(`[Heartbeat] Pitch outreach job created: ${job.taskUid}`);
      return { success: true, taskUid: job.taskUid, nextExecutionAt: job.nextExecutionAt };
    } catch (err: any) {
      console.error("[Heartbeat] Setup error:", err);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: err?.message ?? "Failed to setup heartbeat",
      });
    }
  }),

  // ─── 為單個 lead 搜尋電郵（HR/CEO/Marketing 等決策者） ────────────────────────
  findEmailForLead: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const leads = await db.select().from(pitchLeads).where(eq(pitchLeads.id, input.id)).limit(1);
      if (!leads.length) throw new TRPCError({ code: "NOT_FOUND", message: "Lead not found" });
      const lead = leads[0];

      const hunterApiKey = process.env.HUNTER_API_KEY;

      // 先嘗試從職位廣告頁面提取（快速路徑）
      const directCandidates: Array<{ email: string; name?: string; position?: string; foundVia: string }> = [];
      try {
        const fromJob = await extractEmailFromJobPage(lead.jobUrl);
        if (fromJob.email) {
          directCandidates.push({ email: fromJob.email, name: fromJob.contactName, foundVia: "job_ad" });
        }
      } catch { /* ignore */ }

      // 多層次電郵搜尋（Hunter.io + Snov.io + 官網爬取 + SMTP 猜測）
      const multiResult = await multiLayerEmailSearch({
        companyName: lead.companyName,
        companyWebsite: lead.companyWebsite ?? undefined,
        hunterApiKey: hunterApiKey ?? undefined,
        jobUrl: lead.jobUrl,
      });

      // 如果找到了域名而 lead 原本沒有公司官網，儲存回資料庫避免重複搜尋
      if (multiResult.domain && !lead.companyWebsite) {
        try {
          await db.update(pitchLeads)
            .set({ companyWebsite: 'https://' + multiResult.domain })
            .where(eq(pitchLeads.id, input.id));
        } catch { /* ignore domain save error */ }
      }

      // 合併結果（直接找到的優先）
      const seen = new Set<string>();
      const candidates: Array<{ email: string; name?: string; position?: string; foundVia: string; confidence?: number }> = [];

      for (const c of directCandidates) {
        if (!seen.has(c.email.toLowerCase())) {
          seen.add(c.email.toLowerCase());
          candidates.push(c);
        }
      }
      for (const c of multiResult.candidates) {
        if (!seen.has(c.email.toLowerCase())) {
          seen.add(c.email.toLowerCase());
          candidates.push({
            email: c.email,
            name: c.name,
            position: c.position,
            foundVia: c.source,
            confidence: c.confidence,
          });
        }
      }

      return {
        leadId: input.id,
        candidates,
        hasHunterKey: !!hunterApiKey,
        searchedLayers: multiResult.searchedLayers,
        domain: multiResult.domain,
      };
    }),

  // ─── 取得 lead 的發送記錄 ──────────────────────────────────────────
  getSendLogs: protectedProcedure
    .input(z.object({ leadId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const logs = await db
        .select()
        .from(pitchSendLog)
        .where(eq(pitchSendLog.leadId, input.leadId))
        .orderBy(desc(pitchSendLog.sentAt));

      return logs;
    }),
});
