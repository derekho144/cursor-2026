import { ENV } from "./_core/env";
import { escapeHtml } from "./reviewInviteEmail";

/** Trusted public origin for post-sign confirmation links (never client-supplied). */
export function signConfirmationBaseUrl(): string {
  return (ENV.publicBaseUrl || ENV.appBaseUrl || "https://jdsys.biz").replace(
    /\/+$/,
    ""
  );
}

/**
 * Confirmation email after public e-sign.
 * Escapes untrusted interpolations; print CTA always points at our host.
 */
export function buildSignConfirmationEmailHtml(input: {
  signedByName: string;
  quoteNumber: string;
  signedDate: string;
  /** Absolute print URL (already on a trusted host). */
  printUrl: string;
}): string {
  const name = escapeHtml(input.signedByName);
  const quoteNumber = escapeHtml(input.quoteNumber);
  const signedDate = escapeHtml(input.signedDate);
  const printUrl = escapeHtml(input.printUrl);
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
<div style="background:#1a1a1a;padding:20px 30px">
  <h2 style="color:#fff;margin:0;font-size:18px;letter-spacing:2px">JD STUDIO HK</h2>
</div>
<div style="padding:30px">
  <p>Dear <strong>${name}</strong>,</p>
  <p>Thank you for signing the quotation <strong>${quoteNumber}</strong>.</p>
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
}

/** Build print URL for an accepted quote on the trusted public origin. */
export function buildStaffPrintQuoteUrl(quoteId: number): string {
  return `${signConfirmationBaseUrl()}/print/quote/${quoteId}`;
}
