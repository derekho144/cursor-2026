/**
 * FreelanceHunter Job Board tRPC Router
 *
 * Provides procedures for:
 * - Manually triggering a scrape of the Freehunter job board
 * - Listing scraped jobs
 * - Fetching client email for a specific job
 * - Importing a job as an email inquiry
 * - Ignoring a job
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { freehunterJobs, emailInquiries } from "../../drizzle/schema";
import { eq, desc, inArray, sql } from "drizzle-orm";
import { scrapeFreehunterBoard, fetchEmailForJob } from "../scrapers/freehunterBoard";
import { getFreehunterStatus, getOrLoginFreehunter } from "../freehunter";
import { sendFHFirstEmail, translateJobTitleToEnglish, cleanClientName } from "./emailInquiries";
import { invokeLLM } from "../_core/llm";
import { sendEmail } from "../resendEmail";

export const freehunterBoardRouter = router({
  /**
   * Get scrape status and recent jobs
   */
  getStatus: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });

    // Run DB query and session status check in parallel
    const [rawJobs, sessionStatus] = await Promise.all([
      db
        .select({
          id: freehunterJobs.id,
          jobId: freehunterJobs.jobId,
          title: freehunterJobs.title,
          budget: freehunterJobs.budget,
          categories: freehunterJobs.categories,
          location: freehunterJobs.location,
          description: freehunterJobs.description,
          clientName: freehunterJobs.clientName,
          clientEmail: freehunterJobs.clientEmail,
          jobUrl: freehunterJobs.jobUrl,
          status: freehunterJobs.status,
          scrapedAt: freehunterJobs.scrapedAt,
          firstEmailSentAt: freehunterJobs.firstEmailSentAt,
          emailInquiryId: freehunterJobs.emailInquiryId,
          aiScore: freehunterJobs.aiScore,
          aiScoreReason: freehunterJobs.aiScoreReason,
          postedAt: freehunterJobs.postedAt,
          // Reply tracking from linked email_inquiry (via fh_job_id)
          replyTrackingId: emailInquiries.replyTrackingId,
          replyOpenedAt: emailInquiries.replyOpenedAt,
          replyOpenCount: emailInquiries.replyOpenCount,
          realOpenCount: emailInquiries.realOpenCount,
          followUpSentAt: (emailInquiries as any).followUpSentAt,
          // Quote linked to this FH job (via email_inquiry)
          quoteId: emailInquiries.quoteId,
          // Used for deduplication: keep highest inquiry id (latest tracking record)
          _inquiryId: emailInquiries.id,
        })
        .from(freehunterJobs)
        .leftJoin(emailInquiries, eq(emailInquiries.fhJobId, freehunterJobs.id))
        .orderBy(desc(freehunterJobs.scrapedAt))
        .limit(200), // fetch more to allow dedup
      getFreehunterStatus(),
    ]);

    // If session is expired/missing, trigger background re-login (fire-and-forget)
    if (!sessionStatus.connected) {
      getOrLoginFreehunter().catch((e) =>
        console.warn("[FH Board] Background auto-login failed:", e)
      );
    }

    // Deduplicate: LEFT JOIN can produce multiple rows per job when a job has
    // multiple email_inquiries records. Keep the row with the highest _inquiryId
    // (latest tracking record) so reply-tracking data is up to date.
    const jobMap = new Map<string, (typeof rawJobs)[0]>();
    for (const row of rawJobs) {
      const existing = jobMap.get(row.jobId);
      if (!existing) {
        jobMap.set(row.jobId, row);
      } else {
        const existingInqId = existing._inquiryId ?? 0;
        const rowInqId = row._inquiryId ?? 0;
        if (rowInqId > existingInqId) jobMap.set(row.jobId, row);
      }
    }
    const jobs = Array.from(jobMap.values()).slice(0, 50);

    const stats = {
      total: jobs.length,
      new: jobs.filter((j) => j.status === "new").length,
      emailFetched: jobs.filter((j) => j.status === "email_fetched").length,
      firstEmailSent: jobs.filter((j) => j.status === "first_email_sent").length,
      followUpSent: jobs.filter((j) => !!(j as any).followUpSentAt).length,
      imported: jobs.filter((j) => j.status === "imported").length,
      ignored: jobs.filter((j) => j.status === "ignored").length,
    };

    return {
      jobs,
      stats,
      session: sessionStatus,
    };
  }),

  /**
   * List scraped jobs with optional filter
   */
  listJobs: protectedProcedure
    .input(
      z.object({
        status: z.enum(["new", "email_fetched", "first_email_sent", "imported", "ignored", "all"]).default("all"),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });

      // LEFT JOIN email_inquiries to get reply tracking status for jobs with emailInquiryId
      const selectFields = {
        id: freehunterJobs.id,
        jobId: freehunterJobs.jobId,
        title: freehunterJobs.title,
        budget: freehunterJobs.budget,
        categories: freehunterJobs.categories,
        location: freehunterJobs.location,
        description: freehunterJobs.description,
        clientName: freehunterJobs.clientName,
        clientEmail: freehunterJobs.clientEmail,
        jobUrl: freehunterJobs.jobUrl,
        status: freehunterJobs.status,
        scrapedAt: freehunterJobs.scrapedAt,
        firstEmailSentAt: freehunterJobs.firstEmailSentAt,
        emailInquiryId: freehunterJobs.emailInquiryId,
        aiScore: freehunterJobs.aiScore,
        aiScoreReason: freehunterJobs.aiScoreReason,
        postedAt: freehunterJobs.postedAt,
        // Follow-up tracking
        followUpSentAt: freehunterJobs.followUpSentAt,
        // Reply tracking from linked email_inquiry
        replyTrackingId: emailInquiries.replyTrackingId,
        replyOpenedAt: emailInquiries.replyOpenedAt,
        replyOpenCount: emailInquiries.replyOpenCount,
        realOpenCount: emailInquiries.realOpenCount,
        // Quote linked to this FH job (via email_inquiry)
        quoteId: emailInquiries.quoteId,
        // Used for deduplication
        _inquiryId: emailInquiries.id,
      };

      // Fetch with extra limit to allow dedup (LEFT JOIN can produce multiple rows per job)
      let rawRows;
      if (input.status !== "all") {
        rawRows = await db
          .select(selectFields)
          .from(freehunterJobs)
          .leftJoin(emailInquiries, eq(emailInquiries.fhJobId, freehunterJobs.id))
          .where(eq(freehunterJobs.status, input.status as any))
          .orderBy(desc(freehunterJobs.scrapedAt))
          .limit(input.limit * 4);
      } else {
        rawRows = await db
          .select(selectFields)
          .from(freehunterJobs)
          .leftJoin(emailInquiries, eq(emailInquiries.fhJobId, freehunterJobs.id))
          .orderBy(desc(freehunterJobs.scrapedAt))
          .limit(input.limit * 4);
      }

      // Deduplicate by jobId, keeping the row with the highest _inquiryId
      const seen = new Map<string, (typeof rawRows)[0]>();
      for (const row of rawRows) {
        const existing = seen.get(row.jobId);
        if (!existing) {
          seen.set(row.jobId, row);
        } else {
          const existingInqId = existing._inquiryId ?? 0;
          const rowInqId = row._inquiryId ?? 0;
          if (rowInqId > existingInqId) seen.set(row.jobId, row);
        }
      }
      return Array.from(seen.values()).slice(0, input.limit);
    }),

  /**
   * Manually trigger a scrape of the Freehunter job board
   */
  scrapeNow: protectedProcedure
    .input(
      z.object({
        fetchEmails: z.boolean().default(true),
        maxJobs: z.number().min(1).max(50).default(20),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await scrapeFreehunterBoard(input.fetchEmails, input.maxJobs);
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }
    }),

  /**
   * Fetch client email for a specific job
   */
  fetchEmail: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .mutation(async ({ input }) => {
      const email = await fetchEmailForJob(input.jobId);
      if (!email) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "無法取得客戶電郵，可能需要 Premium 帳號或工作已過期",
        });
      }
      return { email };
    }),

  /**
   * Import a scraped job as an email inquiry
   */
  importAsInquiry: protectedProcedure
    .input(
      z.object({
        jobId: z.string(),
        clientEmail: z.string().email().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });

      // Get the job
      const [job] = await db
        .select()
        .from(freehunterJobs)
        .where(eq(freehunterJobs.jobId, input.jobId))
        .limit(1);

      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "找不到此工作記錄" });
      }

      const clientEmail = input.clientEmail || job.clientEmail || "";
      const fromEmail = clientEmail || "freehunter@freehunter.hk";

      // Create email inquiry record
      const gmailMessageId = `fh-job-${job.jobId}-${Date.now()}`;
      const bodyText = [
        `工作標題: ${job.title}`,
        job.clientName ? `客戶姓名: ${job.clientName}` : "",
        job.budget ? `預算: ${job.budget}` : "",
        job.location ? `地點: ${job.location}` : "",
        job.description ? `\n詳情:\n${job.description}` : "",
        `\n工作連結: ${job.jobUrl}`,
      ]
        .filter(Boolean)
        .join("\n");

      const [existing] = await db
        .select({ id: emailInquiries.id })
        .from(emailInquiries)
        .where(eq(emailInquiries.gmailMessageId, gmailMessageId))
        .limit(1);

      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "此工作已匯入為詢價記錄" });
      }

      const [inserted] = await db
        .insert(emailInquiries)
        .values({
          gmailMessageId,
          fromEmail,
          fromName: job.clientName || "FreelanceHunter 客戶",
          subject: job.title,
          bodyText,
          receivedAt: job.postedAt || job.scrapedAt,
          aiConfidence: "medium",
          externalLink: job.jobUrl,
          status: "pending",
        })
        .$returningId();

      // Update job status
      await db
        .update(freehunterJobs)
        .set({
          status: "imported",
          emailInquiryId: inserted.id,
          updatedAt: new Date(),
        })
        .where(eq(freehunterJobs.jobId, input.jobId));

      return { inquiryId: inserted.id };
    }),

  /**
   * Ignore a scraped job (mark as ignored)
   */
  ignoreJob: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });

      await db
        .update(freehunterJobs)
        .set({ status: "ignored", updatedAt: new Date() })
        .where(eq(freehunterJobs.jobId, input.jobId));

      return { success: true };
    }),

  /**
   * Create a tracking record (emailInquiry with replyTrackingId) for a job that was sent without tracking.
   * Allows older first_email_sent jobs to gain open-tracking capability.
   */
  createTrackingRecord: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });

      const [job] = await db
        .select()
        .from(freehunterJobs)
        .where(eq(freehunterJobs.jobId, input.jobId))
        .limit(1);

      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此工作記錄" });
      if (job.status !== "first_email_sent") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "只有已發送第一封郵件的工作才能建立追蹤記錄" });
      }

      // Check if tracking record already exists via fh_job_id
      const [existing] = await db
        .select({ id: emailInquiries.id, replyTrackingId: emailInquiries.replyTrackingId })
        .from(emailInquiries)
        .where(eq(emailInquiries.fhJobId, job.id))
        .limit(1);

      if (existing?.replyTrackingId) {
        return { inquiryId: existing.id, replyTrackingId: existing.replyTrackingId, alreadyExists: true };
      }

      const replyTrackingId = `fh-${job.jobId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      if (existing) {
        // Update existing inquiry with a new tracking ID
        await db
          .update(emailInquiries)
          .set({ replyTrackingId } as any)
          .where(eq(emailInquiries.id, existing.id));
        return { inquiryId: existing.id, replyTrackingId, alreadyExists: false };
      }

      // Create a new emailInquiry record for tracking only
      const gmailMessageId = `fh-track-${job.jobId}-${Date.now()}`;
      const [inserted] = await db
        .insert(emailInquiries)
        .values({
          gmailMessageId,
          fromEmail: job.clientEmail || "freehunter@freehunter.hk",
          fromName: job.clientName || "FreelanceHunter 客戶",
          subject: job.title,
          bodyText: job.description || "",
          receivedAt: job.postedAt || job.scrapedAt,
          aiConfidence: "high",
          externalLink: job.jobUrl,
          status: "ignored",
          fhJobId: job.id,
          replyTrackingId,
        } as any)
        .$returningId();

      return { inquiryId: inserted.id, replyTrackingId, alreadyExists: false };
    }),

  /**
   * Bulk ignore multiple jobs
   */
  bulkIgnore: protectedProcedure
    .input(z.object({ jobIds: z.array(z.string()).min(1) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });

      await db
        .update(freehunterJobs)
        .set({ status: "ignored", updatedAt: new Date() })
        .where(inArray(freehunterJobs.jobId, input.jobIds));

      return { success: true, count: input.jobIds.length };
    }),

  /**
   * Bulk send first email to all email_fetched jobs.
   * Processes jobs one by one, creating tracking records and sending personalised emails.
   * Returns per-job results so the frontend can show a progress summary.
   */
  bulkSendFirstEmail: protectedProcedure
    .input(
      z.object({
        // Optional: limit to specific jobIds; if empty, sends to ALL email_fetched jobs
        jobIds: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });

      // Fetch all email_fetched jobs (or the specified subset)
      let jobs;
      if (input.jobIds && input.jobIds.length > 0) {
        jobs = await db
          .select()
          .from(freehunterJobs)
          .where(inArray(freehunterJobs.jobId, input.jobIds));
      } else {
        jobs = await db
          .select()
          .from(freehunterJobs)
          .where(eq(freehunterJobs.status, "email_fetched"))
          .orderBy(desc(freehunterJobs.scrapedAt));
      }

      // Filter: only email_fetched jobs with a client email
      const eligible = jobs.filter(
        (j) => j.status === "email_fetched" && j.clientEmail && j.clientEmail.trim()
      );

      if (eligible.length === 0) {
        return { sent: 0, failed: 0, skipped: 0, results: [] };
      }

      const results: Array<{
        jobId: string;
        title: string;
        clientEmail: string;
        status: "sent" | "failed" | "skipped";
        reason?: string;
      }> = [];

      let sent = 0;
      let failed = 0;
      let skipped = 0;

      for (const job of eligible) {
        const clientEmail = job.clientEmail!;
        try {
          // Check if a tracking record already exists (avoid double-sending)
          const [existingInquiry] = await db
            .select({ id: emailInquiries.id, replyTrackingId: emailInquiries.replyTrackingId })
            .from(emailInquiries)
            .where(eq(emailInquiries.fhJobId, job.id))
            .limit(1);

          if (existingInquiry) {
            // Already has a tracking record — skip (already sent or tracking exists)
            results.push({ jobId: job.jobId, title: job.title, clientEmail, status: "skipped", reason: "已有追蹤記錄" });
            skipped++;
            continue;
          }

          // Create emailInquiry with tracking ID
          const replyTrackingId = `fh-${job.jobId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const gmailMessageId = `fh-bulk-${job.jobId}-${Date.now()}`;

          const [inserted] = await db
            .insert(emailInquiries)
            .values({
              gmailMessageId,
              fromEmail: clientEmail,
              fromName: job.clientName || "FreelanceHunter 客戶",
              subject: job.title,
              bodyText: job.description || "",
              receivedAt: job.postedAt || job.scrapedAt,
              aiConfidence: "high",
              externalLink: job.jobUrl,
              status: "ignored", // tracking-only record
              fhJobId: job.id,
              replyTrackingId,
            } as any)
            .$returningId();

          const fhInquiryId = inserted.id;

          // Send the first email with tracking pixel
          const emailResult = await sendFHFirstEmail(
            clientEmail,
            job.clientName || "",
            job.title,
            fhInquiryId,
            job.description || ""
          );

          if (emailResult.success) {
            // Update job status to first_email_sent
            await db
              .update(freehunterJobs)
              .set({
                status: "first_email_sent",
                firstEmailSentAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(freehunterJobs.jobId, job.jobId));

            results.push({ jobId: job.jobId, title: job.title, clientEmail, status: "sent" });
            sent++;
          } else {
            // Email failed — clean up the tracking record
            await db.delete(emailInquiries).where(eq(emailInquiries.id, fhInquiryId));
            results.push({ jobId: job.jobId, title: job.title, clientEmail, status: "failed", reason: "郵件發送失敗" });
            failed++;
          }

          // Small delay between sends to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 800));
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Unknown error";
          results.push({ jobId: job.jobId, title: job.title, clientEmail, status: "failed", reason: msg });
          failed++;
        }
      }

      console.log(`[FH BulkSend] Done: ${sent} sent, ${failed} failed, ${skipped} skipped`);
      return { sent, failed, skipped, results };
    }),

  /**
   * AI-compose a personalised email for a specific job (preview only, no send)
   */
  aiComposeEmail: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });

      const [job] = await db
        .select()
        .from(freehunterJobs)
        .where(eq(freehunterJobs.jobId, input.jobId))
        .limit(1);

      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      if (!job.clientEmail) throw new TRPCError({ code: "BAD_REQUEST", message: "\u5c1a\u672a\u53d6\u5f97\u5ba2\u6236\u96fb\u90f5\uff0c\u8acb\u5148\u9ede\u64ca\u300e\u53d6\u5f97\u96fb\u90f5\u300f" });

            const description = (job.description || "").slice(0, 1200);
      // Clean client name using shared cleanClientName() helper
      const displayName = cleanClientName(job.clientName || "");

      // Run all 3 LLM calls in parallel to reduce total latency
      const [englishJobTitle, rawEN, rawCN] = await Promise.all([
        translateJobTitleToEnglish(job.title),
        // AI: generate personalised email body (English section)
        invokeLLM({
          messages: [
            {
              role: "system",
              content: `You are a professional business development writer for JD STUDIO HK, a Hong Kong photography and video production company.\nWrite a short, warm, and professional cold outreach email body (NOT including greeting or sign-off) to a potential client who posted a job on FreelanceHunter.\nRules:\n- 2-3 short paragraphs maximum\n- Reference specific details from the job description to show you have read it\n- Mention JD STUDIO HK expertise in photography/video\n- Include a call-to-action to connect via WhatsApp\n- Do NOT include "Dear ...", "Cheers!", or signature\n- Write in English only\n- Keep it under 120 words`,
            },
            {
              role: "user",
              content: `Job title: ${job.title}\n\nJob description:\n${description}`,
            },
          ],
        }).then((r) => r?.choices?.[0]?.message?.content).catch((e) => { console.warn("[FH aiComposeEmail] LLM EN failed:", e); return null; }),
        // AI: generate personalised Chinese section
        invokeLLM({
          messages: [
            {
              role: "system",
              content: `你是 JD STUDIO HK（香港專業攝影及影片製作公司）的業務開發寫手。\n請根據以下工作描述，用繁體中文撰寫一段簡短、親切、專業的開發郵件正文（不包括稱呼和結尾簽名）。\n要求：\n- 最多 2-3 短段\n- 提及工作描述中的具體細節，顯示你已仔細閱讀\n- 提及 JD STUDIO HK 在攝影/影片方面的專業\n- 加入透過 WhatsApp 聯絡的行動呼籲\n- 不要包含「您好」稱呼或結尾\n- 只用繁體中文\n- 控制在 100 字以內`,
            },
            {
              role: "user",
              content: `工作標題：${job.title}\n\n工作描述：\n${description}`,
            },
          ],
        }).then((r) => r?.choices?.[0]?.message?.content).catch((e) => { console.warn("[FH aiComposeEmail] LLM CN failed:", e); return null; }),
      ]);

      // Extract text (handles Gemini thinking mode where content may be an array)
      const { extractLLMText } = await import("../_core/llm");
      let aiBodyEN = typeof rawEN === "string" ? rawEN.trim() : extractLLMText(rawEN);
      let aiBodyCN = typeof rawCN === "string" ? rawCN.trim() : extractLLMText(rawCN);
      if (aiBodyEN.length < 20) aiBodyEN = "";
      if (aiBodyCN.length < 10) aiBodyCN = "";

      if (!aiBodyEN) {
        aiBodyEN = `We noticed your posting on Freehunter regarding the ${englishJobTitle} opportunity and are very interested in this project. We would welcome the chance to discuss how JD STUDIO HK can bring your vision to life.`;
      }
      if (!aiBodyCN) {
        aiBodyCN = `我們留意到您在 Freehunter 上的工作邀請，非常有興趣參與這個項目。期待有機會與您合作，為您提供專業的攝影及影片製作服務。`;
      }

      const whatsappLine = `We would love to connect with you via WhatsApp to better understand your requirements and provide an accurate quote: https://wa.me/85291531976`;
      const whatsappLineCN = `歡迎透過 WhatsApp 聯絡我們，以便更深入了解您的需求並提供準確報價：https://wa.me/85291531976`;
      const fullBody = `Dear ${displayName},\n\nWe are JD STUDIO HK, a production company providing professional photography and video services. ${aiBodyEN}\n\n${whatsappLine}\n\n---\n\n您好 ${displayName}，\n\n我們是 JD STUDIO HK，專業攝影及影片製作公司。${aiBodyCN}\n\n${whatsappLineCN}\n\nCheers!\n\nDerek\nJD STUDIO HK\nTel No: (852) 9153 1976\nWeb: https://jdstudiohk.com/`;

      return {
        subject: `Re: ${job.title}`,
        body: fullBody,
        clientEmail: job.clientEmail,
        clientName: displayName,
        englishJobTitle,
      };
    }),

  /**
   * Manually send an email to a FH job client (after AI preview confirmation)
   */
  manualSendEmail: protectedProcedure
    .input(z.object({
      jobId: z.string(),
      body: z.string().min(10),
      subject: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });

      const [job] = await db
        .select()
        .from(freehunterJobs)
        .where(eq(freehunterJobs.jobId, input.jobId))
        .limit(1);

      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      if (!job.clientEmail) throw new TRPCError({ code: "BAD_REQUEST", message: "\u5c1a\u672a\u53d6\u5f97\u5ba2\u6236\u96fb\u90f5" });

      // Get or create tracking record
      const [existingInquiry] = await db
        .select({ id: emailInquiries.id })
        .from(emailInquiries)
        .where(eq(emailInquiries.fhJobId, job.id))
        .limit(1);

      let fhInquiryId: number;
      if (existingInquiry) {
        fhInquiryId = existingInquiry.id;
      } else {
        const replyTrackingId = `fh-${job.jobId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const gmailMessageId = `fh-manual-${job.jobId}-${Date.now()}`;
        const [inserted] = await db
          .insert(emailInquiries)
          .values({
            gmailMessageId,
            fromEmail: job.clientEmail,
            fromName: job.clientName || "FreelanceHunter \u5ba2\u6236",
            subject: input.subject,
            bodyText: job.description || "",
            receivedAt: job.postedAt || job.scrapedAt,
            aiConfidence: "high",
            externalLink: job.jobUrl,
            status: "ignored",
            fhJobId: job.id,
            replyTrackingId,
          } as any)
          .$returningId();
        fhInquiryId = inserted.id;
      }

      // Build HTML email
      const trackingPixel = `<img src="https://jdsys.manus.space/api/track/fh/${fhInquiryId}" width="1" height="1" style="display:none" alt="" />`;
      const htmlContent = input.body
        .replace(/\n/g, "<br>")
        .replace(
          "https://wa.me/85291531976",
          '<a href="https://wa.me/85291531976" style="color:#25D366;font-weight:bold">wa.me/85291531976</a>'
        );
      const htmlBody = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
<div style="background:#1a1a1a;padding:20px 30px"><h2 style="color:#fff;margin:0;font-size:18px;letter-spacing:2px">JD STUDIO HK</h2></div>
<div style="padding:30px;line-height:1.6">${htmlContent}</div>
<div style="background:#f5f5f5;padding:15px 30px;font-size:12px;color:#888"><p style="margin:0">JD Studio &middot; Hong Kong &nbsp;|&nbsp; info.exposurehk@gmail.com &nbsp;|&nbsp; www.jdstudiohk.com</p></div>
${trackingPixel}
</div>`;

      const result = await sendEmail({
        to: job.clientEmail,
        subject: input.subject,
        html: htmlBody,
        text: input.body,
        tags: [{ name: "type", value: "fh_manual_send" }],
      });

      if (!result.success) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "\u90f5\u4ef6\u767c\u9001\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66" });
      }

      // Update job status
      await db
        .update(freehunterJobs)
        .set({ status: "first_email_sent", firstEmailSentAt: new Date(), updatedAt: new Date() })
        .where(eq(freehunterJobs.jobId, input.jobId));

      console.log(`[FH ManualSend] Email sent to ${job.clientEmail} for job: ${job.title}`);
      return { success: true, messageId: result.messageId };
    }),

  /**
   * Backfill: fetch emails and auto-send for existing 'new' jobs with aiScore >= 80
   * Also handles 'new' jobs with aiScore < 80 by fetching email and stopping at email_fetched
   */
  backfillHighConfidenceEmails: protectedProcedure
    .mutation(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });

      // Find all 'new' jobs with no clientEmail yet, prioritising high-confidence jobs (ai_score >= 80)
      // Also include 'email_fetched' jobs that have an email but haven't sent the first email yet
      const pendingJobs = await db
        .select()
        .from(freehunterJobs)
        .where(
          sql`(${freehunterJobs.status} = 'new' AND (${freehunterJobs.clientEmail} IS NULL OR ${freehunterJobs.clientEmail} = '')) OR (${freehunterJobs.status} = 'email_fetched' AND ${freehunterJobs.aiScore} >= 80 AND (${freehunterJobs.clientEmail} IS NOT NULL AND ${freehunterJobs.clientEmail} != ''))`
        )
        .orderBy(desc(freehunterJobs.aiScore)) // Process highest-confidence jobs first
        .limit(50);

      let processed = 0;
      let emailsFetched = 0;
      let emailsSent = 0;
      const errors: string[] = [];

      for (const job of pendingJobs) {
        processed++;
        try {
          const isHighConfidence = (job.aiScore ?? 0) >= 80;

          // Case 1: job already has email (email_fetched status) — just send the first email
          if (job.status === "email_fetched" && job.clientEmail) {
            if (isHighConfidence) {
              const jobTitle = job.title || "your project";
              const clientName = job.clientName || "";
              try {
                console.log(`[FH Backfill] Sending first email for email_fetched job ${job.jobId} (score: ${job.aiScore}) to ${job.clientEmail}`);
                const sendResult = await sendFHFirstEmail(job.clientEmail, clientName, jobTitle);
                if (sendResult.success) {
                  emailsSent++;
                  await db
                    .update(freehunterJobs)
                    .set({ status: "first_email_sent", firstEmailSentAt: new Date(), updatedAt: new Date() })
                    .where(eq(freehunterJobs.jobId, job.jobId));
                }
              } catch (sendErr) {
                const errMsg = sendErr instanceof Error ? sendErr.message : String(sendErr);
                console.warn(`[FH Backfill] Failed to send email for job ${job.jobId}:`, sendErr);
                errors.push(`Job ${job.jobId}: 發送失敗 - ${errMsg}`);
              }
            }
            continue; // skip fetchEmailForJob for this job
          }

          // Case 2: job has no email yet — fetch it first
          await new Promise((r) => setTimeout(r, 1500)); // Rate limit
          const email = await fetchEmailForJob(job.jobId);
          if (email) {
            emailsFetched++;
            if (isHighConfidence) {
              // Auto-send first email for high-confidence jobs
              const jobTitle = job.title || "your project";
              const clientName = job.clientName || "";
              try {
                console.log(`[FH Backfill] Auto-sending first email for new job ${job.jobId} (score: ${job.aiScore}) to ${email}`);
                const sendResult = await sendFHFirstEmail(email, clientName, jobTitle);
                if (sendResult.success) {
                  emailsSent++;
                  await db
                    .update(freehunterJobs)
                    .set({ status: "first_email_sent", firstEmailSentAt: new Date(), updatedAt: new Date() })
                    .where(eq(freehunterJobs.jobId, job.jobId));
                }
              } catch (sendErr) {
                const errMsg = sendErr instanceof Error ? sendErr.message : String(sendErr);
                console.warn(`[FH Backfill] Failed to send email for job ${job.jobId}:`, sendErr);
                errors.push(`Job ${job.jobId}: 發送失敗 - ${errMsg}`);
              }
            }
            // Low-confidence jobs already updated to email_fetched by fetchEmailForJob
          }
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          console.warn(`[FH Backfill] Error processing job ${job.jobId}:`, e);
          errors.push(`Job ${job.jobId}: ${errMsg}`);
          // If login failed, stop processing remaining jobs to avoid repeated login attempts
          if (errMsg.includes('登入失敗') || errMsg.includes('Login') || errMsg.includes('session expired') || errMsg.includes('FREEHUNTER_EMAIL')) {
            console.warn('[FH Backfill] Login failure detected, stopping batch to avoid repeated login attempts.');
            break;
          }
        }
      }

      if (errors.length > 0) {
        console.warn(`[FH Backfill] Completed with ${errors.length} errors:`, errors.slice(0, 3).join('; '));
      }
      return { processed, emailsFetched, emailsSent, errors };
    }),
});
