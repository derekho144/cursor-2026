/**
 * quotePdf.ts
 * PDF generation helpers for JD Studio quotations and receipts.
 * Uses @sparticuz/chromium + puppeteer-core for serverless-compatible PDF generation.
 * Works in Cloud Run (Node.js only) without system Chrome or Python.
 *
 * Visual template matches /print/quote (「下載 PDF」) — used for email attachments.
 */
import puppeteerCore from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import { LOGO_BASE64_URL } from "./logoBase64";

// SERVICE_TYPE_LABELS is defined in quotePdfKit.ts (single source of truth)
export { SERVICE_TYPE_LABELS } from "./quotePdfKit";

/** Same Noto CJK fonts as PDFKit — required so Chromium renders 中文 correctly. */
const NOTO_CJK_REGULAR =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663457748523/VbnWSJV6UQ79sGuykqPPae/NotoSansCJK-Regular_fc1f0423.otf";
const NOTO_CJK_BOLD =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663457748523/VbnWSJV6UQ79sGuykqPPae/NotoSansCJK-Bold_74a83bdc.otf";

// ─── Shared PDF Generator (@sparticuz/chromium + puppeteer-core) ────────────
/**
 * Renders HTML to a PDF buffer.
 * Uses @sparticuz/chromium + puppeteer-core — works in Cloud Run serverless without
 * system Chrome, Python, or weasyprint.
 * @param html - Full HTML string to render
 * @param logPrefix - Log prefix for stderr messages
 * @param extraArgs - Additional Chrome args (ignored, kept for API compatibility)
 * @param waitMs - Extra wait time in ms after page load
 */
export async function generatePdfFromHtml(
  html: string,
  logPrefix = "[PDF]",
  _extraArgs: string[] = [],
  waitMs = 2000
): Promise<Buffer> {
  // Disable graphics (WebGL) for serverless — reduces binary size and avoids GPU errors
  chromium.setGraphicsMode = false;
  const execPath = await chromium.executablePath();
  process.stderr.write(`${logPrefix} Using @sparticuz/chromium: ${execPath}\n`);

  const browser = await puppeteerCore.launch({
    args: chromium.args,
    executablePath: execPath,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 60000 });
    // Wait for @font-face (Noto CJK) + inlined images to settle before capture
    await page.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready;
    });
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    const pdfData = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    const buf = Buffer.from(pdfData);
    process.stderr.write(`${logPrefix} PDF generated: ${buf.length} bytes\n`);
    return buf;
  } finally {
    await browser.close();
  }
}

// ─── HTML Template ─────────────────────────────────────────────────
export function generateQuotePdfHtml(
  quote: any,
  llmDescription: string,
  serviceTypeLabels: Record<string, string>,
  docType: "QUOTATION" | "RECEIPT" = "QUOTATION",
  signatureData?: string | null
): string {
  const items = quote.items || [];

  const formatDate = (d: string | Date) => {
    const dt = new Date(d);
    return dt
      .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
      .toUpperCase();
  };

  const itemRows = items
    .map((item: any, idx: number) => {
      const isIncluded = item.isIncluded || Number(item.unitPrice) === 0;
      const priceCell = isIncluded
        ? `<em style="font-style:italic;color:#555;">Included</em>`
        : `${Number(item.unitPrice).toLocaleString()}.00`;
      const amountCell = isIncluded
        ? `<em style="font-style:italic;color:#555;">Included</em>`
        : `${Number(item.amount).toLocaleString()}.00`;
      const rowBg = idx % 2 === 0 ? "background:#ffffff;" : "background:#f5f5f5;";
      return `
      <tr style="${rowBg}">
        <td style="padding:9px 6px 9px 24px;border-bottom:1px solid #e8e8e8;font-size:10.5px;color:#333;text-align:center;">${Number(item.quantity)}</td>
        <td style="padding:9px 10px;border-bottom:1px solid #e8e8e8;font-size:10.5px;color:#111;font-weight:500;word-break:break-word;overflow-wrap:break-word;max-width:0;">${item.description.replace(/\n/g, "<br>")}</td>
        <td style="padding:9px 10px;border-bottom:1px solid #e8e8e8;text-align:right;font-size:10.5px;color:#333;white-space:nowrap;">${priceCell}</td>
        <td style="padding:9px 24px 9px 10px;border-bottom:1px solid #e8e8e8;text-align:right;font-size:10.5px;color:#333;white-space:nowrap;">${amountCell}</td>
      </tr>`;
    })
    .join("");

  const extraRowDefs = [
    (quote as any).shootHours != null && Number((quote as any).shootHours) > 0
      ? { label: "SHOOT<br>HOURS", value: `${Number((quote as any).shootHours)} hours` }
      : null,
    quote.equipment ? { label: "LIGHTING &amp;<br>EQUIPMENT", value: quote.equipment } : null,
    quote.team ? { label: "TEAM", value: quote.team } : null,
    quote.deliveryMethod ? { label: "PHOTO<br>DELIVERY<br>METHOD", value: quote.deliveryMethod } : null,
  ].filter(Boolean) as { label: string; value: string }[];

  const extraRows = extraRowDefs
    .map((row, i) => {
      const rowBg = (items.length + i) % 2 === 0 ? "background:#ffffff;" : "background:#f5f5f5;";
      return `<tr style="${rowBg}">
          <td colspan="2" style="padding:8px 8px 8px 24px;border-bottom:1px solid #e8e8e8;font-size:7.5px;letter-spacing:0.12em;text-transform:uppercase;color:#888;font-weight:600;vertical-align:top;min-width:120px;">${row.label}</td>
          <td colspan="2" style="padding:8px 24px 8px 10px;border-bottom:1px solid #e8e8e8;font-size:10.5px;color:#333;word-break:break-word;overflow-wrap:break-word;">${row.value}</td>
        </tr>`;
    })
    .join("");

  const notesHtml = quote.notes ? quote.notes.replace(/\n/g, "<br>") : "";

  const discountRow =
    Number(quote.discountAmount) > 0
      ? `<div style="display:flex;justify-content:space-between;padding:6px 0;">
           <span style="font-size:9.5px;letter-spacing:0.12em;text-transform:uppercase;color:#999;">DISCOUNT</span>
           <span style="font-size:11.5px;color:#555;">- ${Number(quote.discountAmount).toLocaleString()}.00</span>
         </div>`
      : "";

  const depositMode = (quote as any).depositMode ?? "percent";
  const depositPct = Number((quote as any).depositPercent ?? (quote as any).depositPercentage ?? 50);
  const depositFixedAmt = Number((quote as any).depositFixedAmount ?? 0);
  const hasDeposit = depositMode === "fixed" ? depositFixedAmt > 0 : depositPct > 0;
  const depositAmt = depositMode === "fixed"
    ? depositFixedAmt
    : Math.round(Number(quote.total) * depositPct / 100);
  const netPayment = Number(quote.total) - depositAmt;
  const depositLabel = depositMode === "fixed"
    ? `DEPOSIT (HKD ${depositAmt.toLocaleString()})`
    : `DEPOSIT (${depositPct}%)`;
  const isFullPayment = depositAmt >= Number(quote.total);
  const depositBlock = hasDeposit
    ? `
    <div style="margin-top:8px;">
      <div style="display:flex;justify-content:space-between;gap:32px;">
        <span style="font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:#aaaaaa;">${depositLabel}</span>
        <span style="font-size:10.5px;color:#111111;font-weight:600;">HKD ${depositAmt.toLocaleString()}</span>
      </div>
      ${!isFullPayment ? `<div style="display:flex;justify-content:space-between;gap:32px;margin-top:4px;">
        <span style="font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:#aaaaaa;">NET PAYMENT</span>
        <span style="font-size:10.5px;color:#555555;">HKD ${netPayment.toLocaleString()}</span>
      </div>` : ""}
    </div>`
    : "";

  const termsItems = [
    "訂金不設退款 &middot; Deposit is non-refundable",
    "報價單有效期 14 天 &middot; Quotation valid for 14 days from date of issue",
    "付款後方可確認預約 &middot; Booking confirmed upon receipt of deposit",
    "因不可抗力（如天災、疫情等）導致拍攝無法進行，雙方可協商改期，但不能取消 &middot; In case of force majeure (e.g. natural disaster, pandemic), rescheduling may be arranged by mutual agreement, but cancellation is not permitted",
    "本報價單經客戶簽署或以任何形式確認後，即視為具有法律效力之合約，雙方均受其條款約束 &middot; This quotation, once signed or confirmed by the client in any form, constitutes a legally binding contract and both parties shall be bound by its terms.",
  ]
    .map((t) => `<li style="margin-bottom:5px;font-size:9.5px;color:#444;line-height:1.7;">${t}</li>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<title>JD Studio - ${quote.quoteNumber}</title>
<style>
  @font-face {
    font-family: 'NotoSansCJK';
    src: url('${NOTO_CJK_REGULAR}') format('opentype');
    font-weight: 400;
    font-style: normal;
  }
  @font-face {
    font-family: 'NotoSansCJK';
    src: url('${NOTO_CJK_BOLD}') format('opentype');
    font-weight: 600;
    font-style: normal;
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#ffffff; color:#222; font-family:'NotoSansCJK','Helvetica Neue',Helvetica,Arial,sans-serif; font-weight:400; -webkit-print-color-adjust:exact; print-color-adjust:exact; margin:0; padding:0; width:794px; overflow-x:hidden; }
  @media print {
    body { -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
  }
</style>
</head>
<body>

<!-- ═══ HEADER - BLACK BG ═══ -->
<table width="794" cellpadding="0" cellspacing="0" style="background-color:#111111;-webkit-print-color-adjust:exact;print-color-adjust:exact;"><tr><td style="padding:24px 32px 20px 32px;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="vertical-align:top;width:55%;">
        <div style="margin-bottom:14px;">
          <img src="${LOGO_BASE64_URL}" alt="JD STUDIO" style="width:90px;height:auto;display:block;" />
        </div>
        <div style="font-size:10px;line-height:2.2;">
          <span style="font-size:7.5px;letter-spacing:0.22em;text-transform:uppercase;color:#777;font-weight:500;display:inline-block;width:40px;">TEL</span><span style="color:#cccccc;">+852 9153 1976</span><br>
          <span style="font-size:7.5px;letter-spacing:0.22em;text-transform:uppercase;color:#777;font-weight:500;display:inline-block;width:40px;">EMAIL</span><span style="color:#cccccc;">info.exposurehk@gmail.com</span><br>
          <span style="font-size:7.5px;letter-spacing:0.22em;text-transform:uppercase;color:#777;font-weight:500;display:inline-block;width:40px;">WEB</span><span style="color:#cccccc;">www.jdstudiohk.com</span>
        </div>
      </td>
      <td style="vertical-align:top;text-align:right;width:45%;">
        <div style="font-size:7.5px;letter-spacing:0.25em;text-transform:uppercase;color:#888888;margin-bottom:5px;">${docType}</div>
        <div style="font-size:28px;font-weight:300;letter-spacing:0.01em;color:#ffffff;line-height:1;">${quote.quoteNumber}</div>
        <div style="width:100%;height:1px;background:#444444;margin:14px 0 10px;"></div>
        <div style="font-size:9px;color:#888888;letter-spacing:0.12em;text-transform:uppercase;">DATE &nbsp; ${formatDate(quote.createdAt)}</div>
      </td>
    </tr>
  </table>
</td></tr></table>

<!-- ═══ MAIN BODY - WHITE BG ═══ -->
<div style="background:#ffffff;width:794px;">

  <!-- PREPARED FOR / SERVICE DETAILS -->
  <table width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid #e0e0e0;border-collapse:collapse;">
    <tr>
      <td width="50%" style="padding:16px 20px 16px 32px;vertical-align:top;border-right:1px solid #e0e0e0;">
        <div style="font-size:7.5px;letter-spacing:0.22em;text-transform:uppercase;color:#aaaaaa;font-weight:500;margin-bottom:10px;">PREPARED FOR</div>
        <div style="font-size:14px;font-weight:600;color:#111111;margin-bottom:5px;letter-spacing:0.01em;">${quote.clientCompany || quote.clientName}</div>
        ${quote.clientPhone ? `<div style="font-size:11px;color:#555555;margin-top:4px;">${quote.clientPhone}</div>` : ""}
        ${quote.clientEmail ? `<div style="font-size:10px;color:#888888;margin-top:4px;">${quote.clientEmail}</div>` : ""}
      </td>
      <td width="50%" style="padding:16px 32px 16px 20px;vertical-align:top;">
        <div style="font-size:7.5px;letter-spacing:0.22em;text-transform:uppercase;color:#aaaaaa;font-weight:500;margin-bottom:10px;">SERVICE DETAILS</div>
        <div style="font-size:13px;color:#111111;font-weight:400;">${serviceTypeLabels[quote.serviceType] || quote.serviceType}</div>
        ${quote.shootingDate ? `<div style="font-size:10.5px;color:#888888;margin-top:6px;">Date: ${quote.shootingDate}</div>` : ""}
        ${quote.shootingLocation ? `<div style="font-size:10.5px;color:#888888;margin-top:4px;">Location: ${quote.shootingLocation}</div>` : ""}
      </td>
    </tr>
  </table>

  <!-- ITEMS TABLE -->
  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed;">
    <colgroup>
      <col style="width:56px;" />
      <col />
      <col style="width:108px;" />
      <col style="width:108px;" />
    </colgroup>
    <thead>
      <tr style="border-bottom:1px solid #cccccc;">
        <th style="padding:8px 6px 8px 24px;text-align:center;font-size:7.5px;letter-spacing:0.2em;text-transform:uppercase;color:#aaaaaa;font-weight:400;">QTY</th>
        <th style="padding:10px 10px;text-align:left;font-size:7.5px;letter-spacing:0.2em;text-transform:uppercase;color:#aaaaaa;font-weight:400;">DESCRIPTION</th>
        <th style="padding:10px 10px;text-align:right;font-size:7.5px;letter-spacing:0.2em;text-transform:uppercase;color:#aaaaaa;font-weight:400;">UNIT PRICE</th>
        <th style="padding:8px 24px 8px 10px;text-align:right;font-size:7.5px;letter-spacing:0.2em;text-transform:uppercase;color:#aaaaaa;font-weight:400;">AMOUNT</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
      ${extraRows}
    </tbody>
  </table>

  <!-- TOTAL — stacked layout matching /print/quote -->
  <div style="padding:10px 32px 6px 32px;display:flex;justify-content:flex-end;">
    <div style="text-align:right;min-width:200px;padding-right:4px;">
      ${discountRow}
      <div style="border-top:1px solid #cccccc;padding-top:8px;margin-top:4px;">
        <div style="font-size:8px;letter-spacing:0.15em;text-transform:uppercase;color:#aaaaaa;margin-bottom:4px;">TOTAL AMOUNT</div>
        <div style="font-size:22px;font-weight:300;color:#111111;letter-spacing:-0.02em;">$${Number(quote.total).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
      </div>
      ${depositBlock}
    </div>
  </div>

  ${notesHtml ? `
  <!-- NOTES -->
  <div style="margin:0 32px 14px;border-left:2px solid #cccccc;padding:8px 14px;background:#f9f9f9;">
    <div style="font-size:7.5px;letter-spacing:0.22em;text-transform:uppercase;color:#aaaaaa;font-weight:500;margin-bottom:8px;">NOTES</div>
    <div style="font-size:11px;color:#444444;line-height:1.9;">${notesHtml}</div>
  </div>` : ""}

  <!-- PAYMENT DETAIL -->
  <div style="padding:0 32px 0 32px;margin-bottom:0;">
    <div style="font-size:7.5px;letter-spacing:0.22em;text-transform:uppercase;color:#aaaaaa;font-weight:500;margin-bottom:12px;">PAYMENT DETAIL</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;">
      <tr>
        <td style="vertical-align:top;width:35%;padding-right:24px;">
          <div style="font-size:7.5px;letter-spacing:0.2em;text-transform:uppercase;color:#aaaaaa;margin-bottom:14px;">BANK TRANSFER</div>
          <table cellpadding="0" cellspacing="0">
            <tr><td style="font-size:7px;letter-spacing:0.14em;text-transform:uppercase;color:#bbbbbb;padding:3px 16px 3px 0;white-space:nowrap;">PAYEE</td><td style="font-size:10px;color:#333333;">JD STUDIO Limited</td></tr>
            <tr><td style="font-size:7px;letter-spacing:0.14em;text-transform:uppercase;color:#bbbbbb;padding:3px 16px 3px 0;">BANK</td><td style="font-size:10px;color:#333333;">Standard Chartered Bank (Hong Kong) Ltd</td></tr>
            <tr><td style="font-size:7px;letter-spacing:0.14em;text-transform:uppercase;color:#bbbbbb;padding:3px 16px 3px 0;">ACCOUNT</td><td style="font-size:10px;color:#333333;">44796326072</td></tr>
            <tr><td style="font-size:7px;letter-spacing:0.14em;text-transform:uppercase;color:#bbbbbb;padding:3px 16px 3px 0;">REF</td><td style="font-size:10px;color:#111111;font-weight:600;">${quote.quoteNumber}</td></tr>
          </table>
        </td>
        <td style="vertical-align:top;width:35%;padding-right:24px;">
          <div style="font-size:7.5px;letter-spacing:0.2em;text-transform:uppercase;color:#aaaaaa;margin-bottom:14px;">FPS 轉數快</div>
          <table cellpadding="0" cellspacing="0">
            <tr><td style="font-size:7px;letter-spacing:0.14em;text-transform:uppercase;color:#bbbbbb;padding:3px 16px 3px 0;white-space:nowrap;">PAYEE</td><td style="font-size:10px;color:#333333;">HUI MAN HO</td></tr>
            <tr><td style="font-size:7px;letter-spacing:0.14em;text-transform:uppercase;color:#bbbbbb;padding:3px 16px 3px 0;">電話</td><td style="font-size:10px;color:#333333;">95131188</td></tr>
            <tr><td style="font-size:7px;letter-spacing:0.14em;text-transform:uppercase;color:#bbbbbb;padding:3px 16px 3px 0;">REF</td><td style="font-size:10px;color:#111111;font-weight:600;">${quote.quoteNumber}</td></tr>
          </table>
        </td>
        <td style="vertical-align:top;width:30%;">
          <div style="background:#1a1a1a;padding:14px 18px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
            <div style="font-size:7px;letter-spacing:0.24em;text-transform:uppercase;color:#666666;margin-bottom:12px;">CONTACT</div>
            <div style="font-size:16px;font-weight:500;color:#ffffff;margin-bottom:4px;">Derek</div>
            <div style="font-size:10.5px;color:#aaaaaa;">+852 9153 1976</div>
            <div style="width:30px;height:2px;background:#b8873a;margin-top:14px;-webkit-print-color-adjust:exact;print-color-adjust:exact;"></div>
          </div>
        </td>
      </tr>
    </table>
  </div>
  <!-- TERMS & CONDITIONS -->
  <div style="padding:0 32px 14px 32px;">
    <div style="font-size:7.5px;letter-spacing:0.22em;text-transform:uppercase;color:#aaaaaa;font-weight:500;margin-bottom:12px;">TERMS &amp; CONDITIONS</div>
    <ul style="list-style:disc;padding-left:18px;">
      ${termsItems}
    </ul>
  </div>
  ${docType !== "RECEIPT" ? `
  <!-- GOOGLE REVIEW — matches /print/quote -->
  <div style="margin:0 32px 10px 32px;background:#0d0d0d;border:1px solid #3a2e14;border-radius:6px;padding:12px 16px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="width:36px;vertical-align:top;font-size:24px;line-height:1;padding-top:1px;">⭐</td>
      <td style="vertical-align:top;">
        <div style="font-family:Georgia,serif;font-style:italic;font-size:13px;color:#e8d5a0;margin-bottom:5px;letter-spacing:0.02em;">Google Review</div>
        <div style="font-size:10px;color:#cccccc;line-height:1.7;margin-bottom:2px;">
          Leave us a Google review &amp; follow our Instagram <span style="color:#c9a84c;font-style:italic;">@jdstudiohk</span> to enjoy a special discount on this shoot.
        </div>
        <div style="font-size:8.5px;color:#777777;line-height:1.7;margin-bottom:9px;">
          於 Google 留下您的真實評價，並追蹤我們的 Instagram <span style="color:#a07830;font-style:italic;">@jdstudiohk</span>，即可於本次攝影服務中享有特別折扣。
        </div>
        <div style="background:#1a1a1a;border:1px solid #3a2e14;border-radius:4px;padding:7px 14px;display:inline-block;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
          <div style="font-size:10px;color:#c9a84c;letter-spacing:0.06em;margin-bottom:1px;">Google Review + Follow IG &nbsp;→&nbsp; 10% Discount</div>
          <div style="font-size:8.5px;color:#a07830;letter-spacing:0.04em;">Google 好評 + Follow IG &nbsp;→&nbsp; 10% 折扣優惠</div>
        </div>
      </td>
    </tr></table>
  </div>` : ""}
  ${signatureData ? `
  <!-- SIGNATURE BLOCK -->
  <div style="padding:8px 32px 10px 32px;border-top:1px solid #e8e8e8;page-break-inside:avoid;break-inside:avoid;">
    <div style="font-size:7px;letter-spacing:0.22em;text-transform:uppercase;color:#aaaaaa;font-weight:500;margin-bottom:8px;">SIGNATURES</div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="width:48%;vertical-align:top;padding-right:16px;">
          <div style="font-size:6.5px;letter-spacing:0.18em;text-transform:uppercase;color:#bbbbbb;margin-bottom:4px;">CLIENT SIGNATURE</div>
          <div style="border:1px solid #e0e0e0;border-radius:2px;background:#fafafa;padding:3px;margin-bottom:4px;height:48px;overflow:hidden;text-align:center;">
            <img src="${signatureData}" style="max-width:100%;max-height:42px;object-fit:contain;display:inline-block;" alt="Client Signature" />
          </div>
          <div style="border-top:1px solid #cccccc;padding-top:4px;">
            <div style="font-size:9px;color:#333333;font-weight:500;">${quote.signedByName || ""}</div>
            <div style="font-size:7px;color:#aaaaaa;margin-top:1px;">${quote.signedAt ? new Date(quote.signedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase() : new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase()}</div>
          </div>
        </td>
        <td style="width:4%;"></td>
        <td style="width:48%;vertical-align:top;padding-left:16px;">
          <div style="font-size:6.5px;letter-spacing:0.18em;text-transform:uppercase;color:#bbbbbb;margin-bottom:4px;">AUTHORISED SIGNATURE</div>
          <div style="border:1px solid #e0e0e0;border-radius:2px;background:#fafafa;padding:3px;margin-bottom:4px;height:48px;overflow:hidden;text-align:center;line-height:48px;">
            <span style="font-family:'Georgia',serif;font-size:20px;color:#1a1a1a;letter-spacing:0.02em;font-style:italic;vertical-align:middle;">JD Studio HK</span>
          </div>
          <div style="border-top:1px solid #cccccc;padding-top:4px;">
            <div style="font-size:9px;color:#333333;font-weight:500;">JD Studio HK</div>
            <div style="font-size:7px;color:#aaaaaa;margin-top:1px;">${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase()}</div>
          </div>
        </td>
      </tr>
    </table>
  </div>` : ""}
  <!-- FOOTER -->
  <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e0e0e0;">
    <tr>
      <td style="padding:7px 32px;font-size:8.5px;color:#bbbbbb;letter-spacing:0.14em;">JD STUDIO &middot; HONG KONG</td>
      <td style="padding:7px 32px;text-align:right;font-size:8.5px;color:#bbbbbb;">info.exposurehk@gmail.com &nbsp;&middot;&nbsp; www.jdstudiohk.com</td>
    </tr>
  </table>
</div>
</body>
</html>`;
}

/**
 * Render the same visual template as /print/quote (browser download) to a PDF buffer.
 * Uses Chromium HTML→PDF so email attachments match the printed quotation layout.
 */
export async function renderQuotePdfLikePrint(
  quote: any,
  llmDescription: string,
  serviceTypeLabels: Record<string, string>,
  docType: "QUOTATION" | "RECEIPT" = "QUOTATION",
  signatureData?: string | null
): Promise<Buffer> {
  const html = generateQuotePdfHtml(
    quote,
    llmDescription,
    serviceTypeLabels,
    docType,
    signatureData
  );
  return generatePdfFromHtml(html, "[QuotePDF-Print]", [], 1500);
}

