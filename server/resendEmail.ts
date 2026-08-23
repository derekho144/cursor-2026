/**
 * resendEmail.ts
 * Shared email helper for JD Studio.
 *
 * Deliverability rules:
 * - Never send as onboarding@resend.dev (shared domain → spam).
 * - Prefer verified @jdstudiohk.com via Resend (RESEND_FROM_EMAIL).
 * - If Resend domain is not verified, fall back to Gmail SMTP.
 * - Keep cold outreach on a separate From (RESEND_FROM_OUTREACH / Gmail)
 *   so quote reputation is not mixed with pitch/FH mail.
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
  /** Optional: from address. Defaults by purpose (quotes vs outreach). */
  from?: string;
  /** Reply-To (defaults to EMAIL_REPLY_TO or Gmail user). */
  replyTo?: string;
  /**
   * transactional = quotes / receipts / client follow-ups (brand domain).
   * outreach = Freehunter / pitch / cold mail (separate From to protect reputation).
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
  /** Resend message ID — used to correlate with webhook events */
  messageId?: string;
  error?: string;
  /** Which provider was used */
  provider?: "resend" | "gmail";
}

const DEFAULT_TRANSACTIONAL_FROM = "JD Studio HK <info@jdstudiohk.com>";
const BLOCKED_SHARED_FROM = /@resend\.dev\b/i;

/** Resolve From address — never use Resend's shared onboarding domain. */
export function resolveFromAddress(
  opts: Pick<SendEmailOptions, "from" | "purpose">
): string {
  if (opts.from && !BLOCKED_SHARED_FROM.test(opts.from)) return opts.from;

  const purpose = opts.purpose ?? "transactional";
  if (purpose === "outreach") {
    const outreach =
      process.env.RESEND_FROM_OUTREACH ||
      ENV.resendFromOutreach ||
      "";
    if (outreach && !BLOCKED_SHARED_FROM.test(outreach)) return outreach;
    // Prefer Gmail identity for cold outreach until a dedicated subdomain is verified
    const gmailUser = process.env.GMAIL_USER || ENV.gmailUser;
    if (gmailUser) return `"JD Studio HK" <${gmailUser}>`;
  }

  const transactional =
    process.env.RESEND_FROM_EMAIL ||
    ENV.resendFromEmail ||
    DEFAULT_TRANSACTIONAL_FROM;
  if (BLOCKED_SHARED_FROM.test(transactional)) return DEFAULT_TRANSACTIONAL_FROM;
  return transactional;
}

export function resolveReplyTo(
  opts: Pick<SendEmailOptions, "replyTo">
): string | undefined {
  const reply =
    opts.replyTo ||
    process.env.EMAIL_REPLY_TO ||
    ENV.emailReplyTo ||
    process.env.GMAIL_USER ||
    ENV.gmailUser ||
    "";
  return reply || undefined;
}

/**
 * Send an email via Gmail SMTP (Nodemailer).
 * Used as fallback when Resend domain is not verified, and for outreach.
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
  const from = resolveFromAddress({ ...opts, purpose: opts.purpose ?? "outreach" });
  // If From is @jdstudiohk.com, Gmail SMTP cannot send as that address unless alias is configured —
  // fall back to authenticated Gmail mailbox while keeping Reply-To on brand address.
  const gmailFrom = from.includes("@gmail.com") || from.includes(gmailUser)
    ? from.startsWith('"') || from.includes("<")
      ? from
      : `"JD Studio HK" <${gmailUser}>`
    : `"JD Studio HK" <${gmailUser}>`;
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
 * Send an email via Resend API (preferred for transactional / quotes).
 * Falls back to Gmail when the sending domain is not verified.
 */
export async function sendEmail(opts: SendEmailOptions): Promise<SendEmailResult> {
  const purpose = opts.purpose ?? "transactional";
  const from = resolveFromAddress({ ...opts, purpose });
  const replyTo = resolveReplyTo(opts);

  // Outreach: prefer Gmail to avoid mixing cold-mail reputation with quote domain
  if (purpose === "outreach" && !opts.from) {
    process.stderr.write(`[Email] Outreach → Gmail SMTP (protects @jdstudiohk.com reputation)\n`);
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
