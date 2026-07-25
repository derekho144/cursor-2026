/**
 * quoteEmail.ts
 * Email sending helpers for JD Studio quotations.
 * Extracted from quotes.ts to keep the router file manageable.
 */
import { createEmailTransporter } from "../resendEmail";
import { ENV } from "../_core/env";

// createEmailTransporter is imported from resendEmail.ts (single source of truth)

// ─── Signature Confirmation Email ─────────────────────────────────
export async function sendSignatureConfirmationEmail(opts: {
  to: string;
  quoteNumber: string;
  signedByName: string;
  pdfBuffer: Buffer | null;
}): Promise<void> {
  const { to, quoteNumber, signedByName, pdfBuffer } = opts;
  const transporter = createEmailTransporter();
  const signedDate = new Date().toLocaleString("zh-HK", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const emailBody = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
<div style="background:#1a1a1a;padding:20px 30px">
  <h2 style="color:#fff;margin:0;font-size:18px;letter-spacing:2px">JD STUDIO HK</h2>
</div>
<div style="padding:30px">
  <p>Dear <strong>${signedByName}</strong>,</p>
  <p>Thank you for signing the quotation <strong>${quoteNumber}</strong>.</p>
  <p>Your signature has been recorded on <strong>${signedDate}</strong>.</p>
  ${pdfBuffer
    ? "<p>Please find the attached signed quotation PDF for your reference.</p>"
    : "<p>Your signed quotation has been recorded. We will send you the PDF copy shortly.</p>"}
  <p>We will be in touch shortly to confirm the next steps.</p>
  <p>If you have any questions, please feel free to contact us.</p>
  <br/>
  <p>Best regards,<br/><strong>Derek</strong><br/>JD Studio HK<br/>Tel: +852 9153 1976<br/><a href="https://www.jdstudiohk.com">www.jdstudiohk.com</a></p>
</div>
<div style="background:#f5f5f5;padding:15px 30px;font-size:12px;color:#888">
  <p style="margin:0">JD Studio · Hong Kong &nbsp;|&nbsp; info.exposurehk@gmail.com &nbsp;|&nbsp; www.jdstudiohk.com</p>
</div>
</div>`;

  await transporter.sendMail({
    from: `"JD Studio HK" <${ENV.gmailUser}>`,
    to,
    subject: `[JD Studio HK] Quotation ${quoteNumber} - Signed Confirmation`,
    html: emailBody,
    ...(pdfBuffer
      ? {
          attachments: [
            {
              filename: `${quoteNumber}.pdf`,
              content: pdfBuffer,
              contentType: "application/pdf",
            },
          ],
        }
      : {}),
  });
}
