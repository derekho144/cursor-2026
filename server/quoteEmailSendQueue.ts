/**
 * Background quote-email send queue.
 *
 * Safari / reverse proxies often abort long Chromium-PDF + SMTP mutations and
 * surface "The string did not match the expected pattern" even when work would
 * succeed. Return immediately; client polls status.
 */
import { eq } from "drizzle-orm";
import { ENV } from "./_core/env";
import {
  createEmailLog,
  getDb,
  getQuoteById,
  updateQuote,
} from "./db";
import { sendViaGmail } from "./resendEmail";

export type QuoteEmailSendStatus = {
  jobId: string;
  quoteId: number;
  status: "running" | "ok" | "error";
  sentTo?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
};

const jobs = new Map<string, QuoteEmailSendStatus>();
let chain: Promise<void> = Promise.resolve();

const MAX_TRACKED = 40;
const STALE_MS = 30 * 60 * 1000;

function prune(): void {
  const now = Date.now();
  for (const [id, j] of jobs) {
    if (j.status !== "running" && j.finishedAt && now - j.finishedAt > STALE_MS) {
      jobs.delete(id);
    }
  }
  if (jobs.size <= MAX_TRACKED) return;
  const finished = [...jobs.entries()]
    .filter(([, j]) => j.status !== "running")
    .sort((a, b) => (a[1].finishedAt ?? 0) - (b[1].finishedAt ?? 0));
  for (const [id] of finished.slice(0, Math.max(0, finished.length - MAX_TRACKED / 2))) {
    jobs.delete(id);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function getQuoteEmailSendStatus(jobId: string): QuoteEmailSendStatus | null {
  prune();
  return jobs.get(jobId) ?? null;
}

export function enqueueQuoteEmailSend(input: {
  quoteId: number;
  to: string;
  subject: string;
  body: string;
}): { jobId: string } {
  prune();
  const jobId = `qe-${input.quoteId}-${Date.now()}`;
  const job: QuoteEmailSendStatus = {
    jobId,
    quoteId: input.quoteId,
    status: "running",
    startedAt: Date.now(),
  };
  jobs.set(jobId, job);

  chain = chain
    .then(async () => {
      try {
        await runQuoteEmailSend(job, input);
      } catch (err: any) {
        job.status = "error";
        job.error = err?.message ?? "郵件發送失敗";
        job.finishedAt = Date.now();
        console.error(`[QuoteEmailQueue] job ${jobId} failed:`, err);
      }
    })
    .catch((err) => {
      console.error("[QuoteEmailQueue] chain error:", err);
    });

  return { jobId };
}

async function runQuoteEmailSend(
  job: QuoteEmailSendStatus,
  input: { quoteId: number; to: string; subject: string; body: string }
): Promise<void> {
  if (!ENV.gmailUser || !ENV.gmailAppPassword) {
    throw new Error("郵件設定未完成，請聯絡管理員");
  }

  const quote = await getQuoteById(input.quoteId);
  if (!quote) throw new Error("報價單不存在");

  const llmDescription =
    quote.llmDescription || "感謝您選擇 JD Studio HK 的專業攝影服務。";
  const signatureData = (quote as any).signatureData || null;
  // Dynamic import avoids circular dependency with routers/quotes.ts
  const { generateQuotePdfMatchingDownload } = await import("./routers/quotes");
  const pdfBuffer = await generateQuotePdfMatchingDownload(
    quote,
    llmDescription,
    "QUOTATION",
    signatureData
  );

  const logId = await createEmailLog({
    quoteId: input.quoteId,
    to: input.to,
    subject: input.subject,
    body: input.body,
    status: "sent",
  });

  const trackingPixelUrl = `https://jdsys.biz/api/track/open/${logId}`;
  const htmlBody = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
<div style="background:#1a1a1a;padding:20px 30px"><h2 style="color:#fff;margin:0;font-size:18px;letter-spacing:2px">JD STUDIO HK</h2></div>
<div style="padding:30px"><pre style="font-family:Arial,sans-serif;white-space:pre-wrap">${escapeHtml(input.body)}</pre></div>
<div style="background:#f5f5f5;padding:15px 30px;font-size:12px;color:#888"><p style="margin:0">JD Studio · Hong Kong &nbsp;|&nbsp; info.exposurehk@gmail.com &nbsp;|&nbsp; www.jdstudiohk.com</p></div>
<img src="${trackingPixelUrl}" width="1" height="1" style="display:block;width:1px;height:1px;border:0;" alt="" />
</div>`;

  // Quote PDFs: use Gmail SMTP directly. Resend/onboarding often rejects external
  // recipients or large attachments with opaque "pattern" validation errors.
  const result = await sendViaGmail({
    to: input.to,
    subject: input.subject,
    html: htmlBody,
    text: input.body,
    attachments: [
      {
        filename: `${quote.quoteNumber}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });

  if (!result.success) {
    const db = await getDb();
    if (db) {
      const { emailLogs } = await import("../drizzle/schema");
      await db
        .update(emailLogs)
        .set({ status: "failed", errorMessage: result.error ?? "Unknown error" })
        .where(eq(emailLogs.id, logId));
    }
    throw new Error(result.error ?? "郵件發送失敗");
  }

  if (result.messageId) {
    const db = await getDb();
    if (db) {
      const { emailLogs } = await import("../drizzle/schema");
      await db
        .update(emailLogs)
        .set({ resendMessageId: result.messageId })
        .where(eq(emailLogs.id, logId));
    }
  }

  if (quote.status === "draft") {
    await updateQuote(input.quoteId, { status: "sent" });
  }

  job.status = "ok";
  job.sentTo = input.to;
  job.finishedAt = Date.now();
}
