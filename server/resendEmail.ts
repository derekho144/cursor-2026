/**
 * resendEmail.ts
 * Shared email helper for JD Studio.
 * Primary: Resend API (when jdstudiohk.com domain is verified)
 * Fallback: Gmail SMTP via Nodemailer (always works)
 *
 * Resend requires a verified domain to send to external addresses.
 * Until jdstudiohk.com is verified in Resend, Gmail SMTP is used as fallback.
 */
import { Resend } from "resend";
import nodemailer from "nodemailer";

let _resend: Resend | null = null;

export function getResend(): Resend {
  if (!_resend) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("RESEND_API_KEY is not configured");
    _resend = new Resend(apiKey);
  }
  return _resend;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  /** Optional: from address. Defaults to JD Studio HK sender. */
  from?: string;
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

/**
 * Send an email via Gmail SMTP (Nodemailer).
 * Used as fallback when Resend domain is not verified.
 */
export async function sendViaGmail(opts: SendEmailOptions): Promise<SendEmailResult> {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPass) {
    console.error('[Gmail] Missing credentials: GMAIL_USER or GMAIL_APP_PASSWORD not set');
    return { success: false, error: "Gmail credentials not configured" };
  }
  console.log(`[Gmail] Preparing to send email to: ${opts.to}`);
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser, pass: gmailPass },
  });
  try {
    console.log(`[Gmail] Sending email with subject: ${opts.subject}`);
    const info = await transporter.sendMail({
      from: `"JD Studio HK" <${gmailUser}>`,
      to: opts.to,
      subject: opts.subject,
      html: opts.html ?? "<p></p>",
      ...(opts.text ? { text: opts.text } : {}),
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
    const errMsg = `[Gmail] ❌ Send error to ${opts.to}: ${err?.message ?? 'Unknown error'}`;
    console.error(errMsg, err);
    process.stderr.write(`${errMsg}\n`);
    return { success: false, error: err?.message ?? "Gmail send failed" };
  }
}

/**
 * Send an email via Resend API.
 * Resend automatically tracks opens when HTML emails are sent.
 * The messageId returned can be stored and matched with webhook events.
 *
 * NOTE: Resend requires a verified domain. Until jdstudiohk.com is verified,
 * this will fail for external recipients and fall back to Gmail SMTP.
 */
export async function sendEmail(opts: SendEmailOptions): Promise<SendEmailResult> {
  const resend = getResend();
  const gmailUser = process.env.GMAIL_USER;

  // Use verified Resend domain if available, otherwise use onboarding address
  // Once jdstudiohk.com is verified in Resend, change this to derek@jdstudiohk.com
  const from = opts.from ?? "JD Studio HK <onboarding@resend.dev>";

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html ?? "<p></p>",
      ...(opts.text ? { text: opts.text } : {}),
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
      // Resend domain not verified — fall back to Gmail SMTP
      if (errMsg.includes("domain is not verified") || errMsg.includes("testing emails")) {
        process.stderr.write(`[Resend] Domain not verified, falling back to Gmail SMTP: ${errMsg}\n`);
        return sendViaGmail(opts);
      }
      console.error("[Resend] Send error:", error);
      return { success: false, error: errMsg };
    }

    process.stderr.write(`[Resend] Sent to ${opts.to}: ${data?.id}\n`);
    return { success: true, messageId: data?.id, provider: "resend" };
  } catch (err: any) {
    console.error("[Resend] Unexpected error:", err);
    // Fallback to Gmail on unexpected errors
    process.stderr.write(`[Resend] Unexpected error, falling back to Gmail SMTP: ${err?.message}\n`);
    return sendViaGmail(opts);
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
      user: process.env.GMAIL_USER!,
      pass: process.env.GMAIL_APP_PASSWORD!,
    },
  });
}
