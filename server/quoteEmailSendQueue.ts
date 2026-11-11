/**
 * Background quote-email send queue.
 *
 * Safari / reverse proxies often abort long Chromium-PDF + SMTP mutations and
 * surface "The string did not match the expected pattern" even when work would
 * succeed. Return immediately; client polls status.
 *
 * Job status lives in-process (shared via globalThis). Polls must tolerate
 * missing jobs after restarts; the worker also hard-times-out so UI never
 * spins forever on a hung Chromium/SMTP call.
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
  status: "queued" | "running" | "ok" | "error";
  sentTo?: string;
  error?: string;
  /** Enqueue time (for client UX). */
  startedAt: number;
  /** When the serial worker actually began PDF/SMTP for this job. */
  runStartedAt?: number;
  finishedAt?: number;
};

type InternalJob = QuoteEmailSendStatus & {
  /** Bumped when timed out so in-flight work stops before further side effects. */
  epoch: number;
};

const g = globalThis as typeof globalThis & {
  __jdQuoteEmailSendJobs?: Map<string, InternalJob>;
  __jdQuoteEmailSendChain?: Promise<void>;
};

const jobs: Map<string, InternalJob> =
  g.__jdQuoteEmailSendJobs ?? new Map<string, InternalJob>();
g.__jdQuoteEmailSendJobs = jobs;

let chain: Promise<void> = g.__jdQuoteEmailSendChain ?? Promise.resolve();
g.__jdQuoteEmailSendChain = chain;

const MAX_TRACKED = 40;
const STALE_MS = 30 * 60 * 1000;
/** Hard cap for PDF + SMTP once the worker starts the job (not while queued). */
export const QUOTE_EMAIL_JOB_TIMEOUT_MS = 120_000;

function prune(): void {
  const now = Date.now();
  for (const [id, j] of jobs) {
    if (j.status !== "queued" && j.status !== "running" && j.finishedAt && now - j.finishedAt > STALE_MS) {
      jobs.delete(id);
    }
  }
  if (jobs.size <= MAX_TRACKED) return;
  const finished = [...jobs.entries()]
    .filter(([, j]) => j.status !== "queued" && j.status !== "running")
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

function publicStatus(job: InternalJob): QuoteEmailSendStatus {
  const { epoch: _epoch, ...rest } = job;
  return rest;
}

function markJobError(job: InternalJob, message: string): void {
  if (job.status !== "queued" && job.status !== "running") return;
  job.epoch += 1;
  job.status = "error";
  job.error = message;
  job.finishedAt = Date.now();
}

function stillActive(job: InternalJob, epoch: number): boolean {
  return job.epoch === epoch && (job.status === "queued" || job.status === "running");
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  onTimeout: () => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new Error(`${label}逾時（${Math.round(ms / 1000)} 秒）。請查收件箱；若未收到再試，勿重複連按`));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * Read job status. Missing / timed-out jobs return an error payload so the
 * client can exit 「發送中」 instead of polling forever.
 */
export function getQuoteEmailSendStatus(jobId: string): QuoteEmailSendStatus {
  prune();
  const job = jobs.get(jobId);
  if (!job) {
    return {
      jobId,
      quoteId: 0,
      status: "error",
      error: "找不到發送任務（伺服器可能已重啟）。請查收件箱後再決定是否重發",
      startedAt: Date.now(),
      finishedAt: Date.now(),
    };
  }
  // Only count timeout from when the worker actually started (not queue wait).
  if (
    job.status === "running" &&
    job.runStartedAt != null &&
    Date.now() - job.runStartedAt > QUOTE_EMAIL_JOB_TIMEOUT_MS
  ) {
    markJobError(
      job,
      `郵件發送逾時（${Math.round(QUOTE_EMAIL_JOB_TIMEOUT_MS / 1000)} 秒）。請查收件箱；若未收到再試，勿重複連按`
    );
  }
  return publicStatus(job);
}

export function enqueueQuoteEmailSend(input: {
  quoteId: number;
  to: string;
  subject: string;
  body: string;
}): { jobId: string } {
  prune();
  const jobId = `qe-${input.quoteId}-${Date.now()}`;
  const job: InternalJob = {
    jobId,
    quoteId: input.quoteId,
    status: "queued",
    startedAt: Date.now(),
    epoch: 0,
  };
  jobs.set(jobId, job);

  chain = chain
    .then(async () => {
      if (job.status !== "queued") return;
      job.status = "running";
      job.runStartedAt = Date.now();
      const epoch = job.epoch;
      try {
        await withTimeout(
          runQuoteEmailSend(job, epoch, input),
          QUOTE_EMAIL_JOB_TIMEOUT_MS,
          "產生 PDF / 發送郵件",
          () => {
            markJobError(
              job,
              `郵件發送逾時（${Math.round(QUOTE_EMAIL_JOB_TIMEOUT_MS / 1000)} 秒）。請查收件箱；若未收到再試，勿重複連按`
            );
          }
        );
      } catch (err: any) {
        markJobError(job, err?.message ?? "郵件發送失敗");
        console.error(`[QuoteEmailQueue] job ${jobId} failed:`, err);
      }
    })
    .catch((err) => {
      console.error("[QuoteEmailQueue] chain error:", err);
    });
  g.__jdQuoteEmailSendChain = chain;

  return { jobId };
}

async function runQuoteEmailSend(
  job: InternalJob,
  epoch: number,
  input: { quoteId: number; to: string; subject: string; body: string }
): Promise<void> {
  if (!stillActive(job, epoch)) return;

  if (!ENV.gmailUser || !ENV.gmailAppPassword) {
    throw new Error("郵件設定未完成，請聯絡管理員");
  }

  const quote = await getQuoteById(input.quoteId);
  if (!quote) throw new Error("報價單不存在");
  if (!stillActive(job, epoch)) return;

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

  // Timed out / superseded during PDF — do not create log or SMTP.
  if (!stillActive(job, epoch)) return;

  const logId = await createEmailLog({
    quoteId: input.quoteId,
    to: input.to,
    subject: input.subject,
    body: input.body,
    status: "sent",
  });

  if (!stillActive(job, epoch)) {
    // Avoid sending after timeout; mark the premature log failed.
    const db = await getDb();
    if (db) {
      const { emailLogs } = await import("../drizzle/schema");
      await db
        .update(emailLogs)
        .set({ status: "failed", errorMessage: "cancelled after timeout" })
        .where(eq(emailLogs.id, logId));
    }
    return;
  }

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

  // SMTP already accepted — if we timed out mid-send, keep log as sent but do
  // not flip draft→sent / ok status (UI already showed timeout; avoid double UX).
  if (!stillActive(job, epoch)) {
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
    return;
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

  if (!stillActive(job, epoch)) return;
  job.status = "ok";
  job.sentTo = input.to;
  job.finishedAt = Date.now();
}
