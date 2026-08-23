/**
 * resendEmail.ts
 * Shared email helper for JD Studio.
 *
 * Deliverability rules:
 * - Never send as onboarding@resend.dev (shared domain → spam).
 * - Default From: GMAIL_USER (info.exposurehk@gmail.com) via Gmail SMTP.
 * - Optional RESEND_FROM_EMAIL for a verified custom domain later.
 * - Cold outreach stays on Gmail so it does not poison a future brand domain.
 */
import { Resend } from "resend";
import nodemailer from "nodemailer";
import { ENV } from "./_core/env";

let _resend: Resend | null = null;

export function getResend(): Resend {
  if (!_resend) {
    const apiKey = process.env.RESEND_API_KEY ?? ENV.resendApiKey;
    if (!apiKey) throw new Error("RESEND_API_KEY is not configured");
    _resend = new Resend(apiKey);
  }
  return _resend;
}

export type EmailPurpose = "transactional" | "outreach";

export interface SendEmailOptions {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  /** Optional: from address. Defaults to GMAIL_USER (info.exposurehk@gmail.com). */
  from?: string;
  /** Reply-To (defaults to EMAIL_REPLY_TO or Gmail user). */
  replyTo?: string;
  /**
   * transactional = quotes / receipts / client follow-ups.
   * outreach = Freehunter / pitch / cold mail.
   */
  purpose?: EmailPurpose;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType?: string;
  }>;
  /** Optional: tags for tracking/filtering in Resend dashboard */
  tags?: Array<{ name: string; value: string }>;
  /** Optional: Message-ID of the original email to reply in the same thread */
  inReplyTo?: string;
  /** Optional: References header (space-separated Message-IDs) for thread continuity */
  references?: string;
}

export interface SendEmailResult {
  success: boolean;
  /** Resend / Gmail message ID */
  messageId?: string;
  error?: string;
  /** Which provider was used */
  provider?: "resend" | "gmail";
}

const BLOCKED_SHARED_FROM = /@resend\.dev\b/i;

function gmailMailbox(): string {
  return process.env.GMAIL_USER || ENV.gmailUser || "info.exposurehk@gmail.com";
}

function formatGmailFrom(email: string): string {
  if (email.includes("<")) return email;
  return `JD Studio HK <${email}>`;
}

function isGmailFrom(from: string): boolean {
  return /@gmail\.com\b/i.test(from);
}

/** Resolve From address — never use Resend's shared onboarding domain. */
export function resolveFromAddress(
  opts: Pick<SendEmailOptions, "from" | "purpose">
): string {
  if (opts.from && !BLOCKED_SHARED_FROM.test(opts.from)) return opts.from;

  const purpose = opts.purpose ?? "transactional";
  if (purpose === "outreach") {
    const outreach = process.env.RESEND_FROM_OUTREACH || ENV.resendFromOutreach || "";
    if (outreach && !BLOCKED_SHARED_FROM.test(outreach)) return outreach;
    return formatGmailFrom(gmailMailbox());
  }

  // Quotes / transactional: prefer explicit env, else Gmail mailbox
  const configured = process.env.RESEND_FROM_EMAIL || ENV.resendFromEmail || "";
  if (configured && !BLOCKED_SHARED_FROM.test(configured)) return configured;
  return formatGmailFrom(gmailMailbox());
}

export function resolveReplyTo(
  opts: Pick<SendEmailOptions, "replyTo">
): string | undefined {
  const reply =
    opts.replyTo ||
    process.env.EMAIL_REPLY_TO ||
    ENV.emailReplyTo ||
    gmailMailbox();
  return reply || undefined;
}

/**
 * Send an email via Gmail SMTP (Nodemailer).
 * Primary path while From is info.exposurehk@gmail.com.
 */
export async function sendViaGmail(opts: SendEmailOptions): Promise<SendEmailResult> {
  const gmailUser = process.env.GMAIL_USER || ENV.gmailUser;
  const gmailPass = process.env.GMAIL_APP_PASSWORD || ENV.gmailAppPassword;
  if (!gmailUser || !gmailPass) {
    console.error("[Gmail] Missing credentials: GMAIL_USER or GMAIL_APP_PASSWORD not set");
    return { success: false, error: "Gmail credentials not configured" };
  }
  console.log(`[Gmail] Preparing to send email to: ${opts.to}`);
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser, pass: gmailPass },
  });
  // Gmail SMTP must send as the authenticated mailbox (or an allowed alias)
  const gmailFrom = formatGmailFrom(gmailUser);
  const replyTo = resolveReplyTo(opts);
  try {
    console.log(`[Gmail] Sending email with subject: ${opts.subject}`);
    const info = await transporter.sendMail({
      from: gmailFrom,
      to: opts.to,
      subject: opts.subject,
      html: opts.html ?? "<p></p>",
      ...(opts.text ? { text: opts.text } : {}),
      ...(replyTo ? { replyTo } : {}),
      ...(opts.inReplyTo ? { inReplyTo: opts.inReplyTo } : {}),
      ...(opts.references ? { references: opts.references } : {}),
      ...(opts.attachments && opts.attachments.length > 0
        ? {
            attachments: opts.attachments.map((a) => ({
              filename: a.filename,
              content: a.content,
              contentType: a.contentType,
            })),
          }
        : {}),
    });
    const logMsg = `[Gmail] ✅ Successfully sent to ${opts.to}: ${info.messageId}`;
    console.log(logMsg);
    process.stderr.write(`${logMsg}\n`);
    return { success: true, messageId: info.messageId, provider: "gmail" };
  } catch (err: any) {
    const errMsg = `[Gmail] ❌ Send error to ${opts.to}: ${err?.message ?? "Unknown error"}`;
    console.error(errMsg, err);
    process.stderr.write(`${errMsg}\n`);
    return { success: false, error: err?.message ?? "Gmail send failed" };
  }
}

/**
 * Send email. Uses Gmail SMTP when From is @gmail.com (current production).
 * Uses Resend only when From is a verified custom domain.
 */
export async function sendEmail(opts: SendEmailOptions): Promise<SendEmailResult> {
  const purpose = opts.purpose ?? "transactional";
  const from = resolveFromAddress({ ...opts, purpose });
  const replyTo = resolveReplyTo(opts);

  // Gmail From (info.exposurehk@gmail.com) → always Gmail SMTP
  if (isGmailFrom(from) || purpose === "outreach") {
    process.stderr.write(`[Email] Using Gmail SMTP from=${from} purpose=${purpose}\n`);
    return sendViaGmail({ ...opts, purpose, from, replyTo });
  }

  if (!process.env.RESEND_API_KEY && !ENV.resendApiKey) {
    process.stderr.write(`[Resend] No API key — using Gmail SMTP\n`);
    return sendViaGmail({ ...opts, purpose, from, replyTo });
  }

  const resend = getResend();

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html ?? "<p></p>",
      ...(opts.text ? { text: opts.text } : {}),
      ...(replyTo ? { replyTo } : {}),
      ...(opts.tags ? { tags: opts.tags } : {}),
      ...(opts.attachments && opts.attachments.length > 0
        ? {
            attachments: opts.attachments.map((a) => ({
              filename: a.filename,
              content: a.content,
            })),
          }
        : {}),
    });

    if (error) {
      const errMsg = (error as any).message ?? JSON.stringify(error);
      if (
        errMsg.includes("domain is not verified") ||
        errMsg.includes("testing emails") ||
        errMsg.includes("Invalid `from`") ||
        errMsg.includes("not verified")
      ) {
        process.stderr.write(`[Resend] Domain/from not ready, falling back to Gmail SMTP: ${errMsg}\n`);
        return sendViaGmail({ ...opts, purpose, replyTo });
      }
      console.error("[Resend] Send error:", error);
      return { success: false, error: errMsg };
    }

    process.stderr.write(`[Resend] Sent to ${opts.to} from=${from}: ${data?.id}\n`);
    return { success: true, messageId: data?.id, provider: "resend" };
  } catch (err: any) {
    console.error("[Resend] Unexpected error:", err);
    process.stderr.write(`[Resend] Unexpected error, falling back to Gmail SMTP: ${err?.message}\n`);
    return sendViaGmail({ ...opts, purpose, replyTo });
  }
}

/**
 * Create a shared Gmail SMTP transporter (for quote/signature emails).
 * Single source of truth for Gmail credentials.
 */
export function createEmailTransporter() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER || ENV.gmailUser,
      pass: process.env.GMAIL_APP_PASSWORD || ENV.gmailAppPassword,
    },
  });
}
