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
import { sanitizeQuoteNotesForClientPdf } from "../../shared/inquiryDraftReadiness";

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
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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

  const money = (n: number) =>
    n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const itemRows = items
    .map((item: any, idx: number) => {
      const isIncluded = item.isIncluded || Number(item.unitPrice) === 0;
      const priceCell = isIncluded
        ? `<em style="font-style:italic;color:#888;">Included</em>`
        : money(Number(item.unitPrice));
      const amountCell = isIncluded
        ? `<em style="font-style:italic;color:#888;">Included</em>`
        : money(Number(item.amount));
      const rowBg = idx % 2 === 0 ? "#ffffff" : "#f7f7f7";
      const descHtml = String(item.description || "")
        .split("\n")
        .map((line: string, i: number, arr: string[]) =>
          `${escapeHtml(line)}${i < arr.length - 1 ? "<br/>" : ""}`
        )
        .join("");
      return `
      <div style="display:flex;border-bottom:1px solid #eeeeee;padding:7px 0;background:${rowBg};-webkit-print-color-adjust:exact;print-color-adjust:exact;">
        <div style="width:48px;text-align:center;font-size:10.5px;color:#444;">${Number(item.quantity)}</div>
        <div style="flex:1;font-size:10.5px;color:#111;font-weight:500;word-break:break-word;padding-right:8px;">${descHtml}</div>
        <div style="width:110px;text-align:right;font-size:10.5px;color:#444;white-space:nowrap;">${priceCell}</div>
        <div style="width:110px;text-align:right;font-size:10.5px;color:#222;white-space:nowrap;padding-right:4px;">${amountCell}</div>
      </div>`;
    })
    .join("");

  // Meta rows match /print/quote — equipment / team / delivery only (shots/hours go in SERVICE DETAILS)
  const extraRowDefs = [
    quote.equipment ? { label: "LIGHTING & EQUIPMENT", value: quote.equipment } : null,
    quote.team ? { label: "TEAM", value: quote.team } : null,
    quote.deliveryMethod ? { label: "PHOTO DELIVERY METHOD", value: quote.deliveryMethod } : null,
  ].filter(Boolean) as { label: string; value: string }[];

  const extraRows = extraRowDefs
    .map((row, i) => {
      const rowBg = (items.length + i) % 2 === 0 ? "#ffffff" : "#f7f7f7";
      return `
      <div style="display:flex;border-bottom:1px solid #eeeeee;padding:7px 0;background:${rowBg};-webkit-print-color-adjust:exact;print-color-adjust:exact;">
        <div style="flex:1;font-size:7.5px;letter-spacing:0.12em;text-transform:uppercase;color:#888;font-weight:600;padding-left:8px;">${row.label}</div>
        <div style="flex:1;font-size:10.5px;color:#333;text-align:right;padding-right:4px;word-break:break-word;">${escapeHtml(row.value)}</div>
      </div>`;
    })
    .join("");

  const notesHtml = (() => {
    const cleaned = sanitizeQuoteNotesForClientPdf(quote.notes);
    return cleaned
      ? cleaned
          .split("\n")
          .map((line) => escapeHtml(line))
          .join("<br>")
      : "";
  })();

  const discPct = Number((quote as any).discountPercent ?? 0);
  const discountRow =
    Number(quote.discountAmount) > 0
      ? `<div style="display:flex;justify-content:space-between;gap:32px;margin-bottom:4px;">
           <span style="font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:#aaa;">SUBTOTAL</span>
           <span style="font-size:10.5px;color:#555;">HKD ${money(Number(quote.subtotal))}</span>
         </div>
         <div style="display:flex;justify-content:space-between;gap:32px;margin-bottom:4px;">
           <span style="font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:#aaa;">DISCOUNT${discPct > 0 ? ` (${discPct}%)` : ""}</span>
           <span style="font-size:10.5px;color:#555;">- HKD ${money(Number(quote.discountAmount))}</span>
         </div>`
      : "";

  // Match /print/quote: missing depositPercent = 0 (do NOT invent 50%)
  const depositMode = (quote as any).depositMode ?? "percent";
  const depositPct = Number((quote as any).depositPercent ?? 0);
  const depositFixedAmt = Number((quote as any).depositFixedAmount ?? 0);
  const hasDeposit = depositMode === "fixed" ? depositFixedAmt > 0 : depositPct > 0;
  const depositAmt = depositMode === "fixed"
    ? depositFixedAmt
    : Number(quote.total) * depositPct / 100;
  const netPayment = Number(quote.total) - depositAmt;
  const depositLabel = depositMode === "fixed"
    ? `DEPOSIT (HKD ${depositAmt.toLocaleString("en-HK")})`
    : `DEPOSIT (${depositPct}%)`;
  const isFullPayment = depositAmt >= Number(quote.total);
  const fmtDeposit = (n: number) =>
    n.toLocaleString("en-HK", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const depositBlock = hasDeposit
    ? `
    <div style="margin-top:8px;">
      <div style="display:flex;justify-content:space-between;gap:32px;">
        <span style="font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:#aaaaaa;">${depositLabel}</span>
        <span style="font-size:10.5px;color:#111111;font-weight:600;">HKD ${fmtDeposit(depositAmt)}</span>
      </div>
      ${!isFullPayment ? `<div style="display:flex;justify-content:space-between;gap:32px;margin-top:4px;">
        <span style="font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:#aaaaaa;">NET PAYMENT</span>
        <span style="font-size:10.5px;color:#555555;">HKD ${fmtDeposit(netPayment)}</span>
      </div>` : ""}
    </div>`
    : "";

  // SERVICE DETAILS extras — match QuotePrintPage (shots / hours / team)
  const photogs = Number((quote as any).crewPhotographers ?? 0);
  const asst = Number((quote as any).crewAssistants ?? 0);
  const video = Number((quote as any).crewVideographers ?? 0);
  const others = Number((quote as any).crewOthers ?? 0);
  const crewParts: string[] = [];
  if (photogs > 0) crewParts.push(`Photographer×${photogs}`);
  if (video > 0) crewParts.push(`Video×${video}`);
  if (asst > 0) crewParts.push(`Assistant×${asst}`);
  if (others > 0) crewParts.push(`Other×${others}`);
  const teamField = String((quote as any).team ?? "").trim();
  const teamLabel = crewParts.length > 0 ? crewParts.join(" + ") : teamField;
  const serviceDetailLines = [
    quote.shootingDate
      ? `<div style="font-size:9.5px;color:#555;margin-bottom:1px;">Date: ${escapeHtml(String(quote.shootingDate))}</div>`
      : "",
    quote.shootingLocation
      ? `<div style="font-size:9.5px;color:#555;margin-bottom:1px;">Location: ${escapeHtml(String(quote.shootingLocation))}</div>`
      : "",
    (quote as any).shotCount != null && Number((quote as any).shotCount) > 0
      ? `<div style="font-size:9.5px;color:#555;margin-bottom:1px;">Shots: ${Number((quote as any).shotCount)}</div>`
      : "",
    (quote as any).shootHours != null && Number((quote as any).shootHours) > 0
      ? `<div style="font-size:9.5px;color:#555;margin-bottom:1px;">Hours: ${Number((quote as any).shootHours)}</div>`
      : "",
    teamLabel
      ? `<div style="font-size:9.5px;color:#555;margin-bottom:1px;">Team: ${escapeHtml(teamLabel)}</div>`
      : "",
  ].join("");

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

<!-- ═══ HEADER - BLACK BG (mirrors QuotePrintPage) ═══ -->
<table width="794" cellpadding="0" cellspacing="0" style="background-color:#111111;-webkit-print-color-adjust:exact;print-color-adjust:exact;"><tr><td style="padding:16px 32px 14px 32px;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="vertical-align:top;width:55%;">
        <div style="margin-bottom:8px;">
          <img src="${LOGO_BASE64_URL}" alt="JD STUDIO" style="width:90px;height:auto;display:block;" />
        </div>
        <div style="font-size:11px;line-height:2.0;">
          <span style="font-size:7px;letter-spacing:0.18em;text-transform:uppercase;color:#777;display:inline-block;width:38px;">TEL</span><span style="font-size:9.5px;color:#cccccc;">+852 9153 1976</span><br>
          <span style="font-size:7px;letter-spacing:0.18em;text-transform:uppercase;color:#777;display:inline-block;width:38px;">EMAIL</span><span style="font-size:9.5px;color:#cccccc;">info.exposurehk@gmail.com</span><br>
          <span style="font-size:7px;letter-spacing:0.18em;text-transform:uppercase;color:#777;display:inline-block;width:38px;">WEB</span><span style="font-size:9.5px;color:#cccccc;">www.jdstudiohk.com</span>
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
<!-- Gold accent under header — same as /print/quote -->
<div style="width:794px;height:1px;background:linear-gradient(to right,#d4a843,rgba(212,168,67,0.1),transparent);-webkit-print-color-adjust:exact;print-color-adjust:exact;"></div>

<!-- ═══ MAIN BODY - WHITE BG (40px content inset like QuotePrintPage) ═══ -->
<div style="background:#ffffff;width:794px;padding:0 40px 32px 40px;box-sizing:border-box;">

  <!-- PREPARED FOR / SERVICE DETAILS — flex like QuotePrintPage -->
  <div style="display:flex;border-bottom:1px solid #e8e8e8;">
    <div style="flex:1;padding:10px 16px 10px 0;">
      <div style="font-size:7px;letter-spacing:0.18em;text-transform:uppercase;color:#aaa;font-weight:500;margin-bottom:5px;">PREPARED FOR</div>
      <div style="font-size:13px;font-weight:700;color:#111;margin-bottom:2px;">${escapeHtml(quote.clientCompany || quote.clientName || "")}</div>
      ${quote.clientCompany && quote.clientName ? `<div style="font-size:9.5px;color:#555;margin-bottom:1px;">${escapeHtml(quote.clientName)}</div>` : ""}
      ${quote.clientPhone ? `<div style="font-size:9.5px;color:#555;margin-bottom:1px;">${escapeHtml(quote.clientPhone)}</div>` : ""}
      ${quote.clientEmail ? `<div style="font-size:9.5px;color:#555;margin-bottom:1px;">${escapeHtml(quote.clientEmail)}</div>` : ""}
    </div>
    <div style="flex:1;padding:10px 0 10px 16px;border-left:1px solid #f0f0f0;">
      <div style="font-size:7px;letter-spacing:0.18em;text-transform:uppercase;color:#aaa;font-weight:500;margin-bottom:5px;">SERVICE DETAILS</div>
      <div style="font-size:12px;color:#222;font-weight:400;margin-bottom:2px;">${escapeHtml(serviceTypeLabels[quote.serviceType] || quote.serviceType || "")}</div>
      ${serviceDetailLines}
    </div>
  </div>

  <!-- ITEMS TABLE — flex rows identical to QuotePrintPage -->
  <div style="margin-top:0;border-bottom:1px solid #e8e8e8;">
    <div style="display:flex;border-bottom:1px solid #dddddd;border-top:1px solid #dddddd;background:#f7f7f7;padding:5px 0;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
      <div style="width:48px;text-align:center;font-size:7px;letter-spacing:0.15em;text-transform:uppercase;color:#888;font-weight:500;">QTY</div>
      <div style="flex:1;font-size:7px;letter-spacing:0.15em;text-transform:uppercase;color:#888;font-weight:500;">DESCRIPTION</div>
      <div style="width:110px;text-align:right;font-size:7px;letter-spacing:0.15em;text-transform:uppercase;color:#888;font-weight:500;">UNIT PRICE</div>
      <div style="width:110px;text-align:right;font-size:7px;letter-spacing:0.15em;text-transform:uppercase;color:#888;font-weight:500;padding-right:4px;">AMOUNT</div>
    </div>
    ${itemRows}
    ${extraRows}
  </div>

  <!-- TOTAL — stacked layout matching /print/quote -->
  <div style="padding:10px 0 6px 0;display:flex;justify-content:flex-end;">
    <div style="text-align:right;min-width:200px;padding-right:4px;">
      ${discountRow}
      <div style="border-top:1px solid #cccccc;padding-top:8px;margin-top:4px;">
        <div style="font-size:8px;letter-spacing:0.15em;text-transform:uppercase;color:#aaaaaa;margin-bottom:4px;">TOTAL AMOUNT</div>
        <div style="font-size:22px;font-weight:300;color:#111111;letter-spacing:-0.02em;">$${money(Number(quote.total))}</div>
      </div>
      ${depositBlock}
    </div>
  </div>

  ${notesHtml ? `
  <!-- NOTES -->
  <div style="margin:8px 0;border:1px solid #e8e8e8;border-radius:2px;padding:7px 10px;">
    <div style="font-size:7px;letter-spacing:0.18em;text-transform:uppercase;color:#aaaaaa;font-weight:500;margin-bottom:6px;">NOTES</div>
    <div style="font-size:10.5px;color:#444444;line-height:1.7;">${notesHtml}</div>
  </div>` : ""}

  <!-- PAYMENT DETAIL -->
  <div style="margin-top:10px;margin-bottom:8px;page-break-inside:avoid;-webkit-column-break-inside:avoid;break-inside:avoid;">
    <div style="font-size:7px;letter-spacing:0.18em;text-transform:uppercase;color:#aaaaaa;font-weight:500;margin-bottom:12px;">PAYMENT DETAIL</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
      <tr>
        <td style="vertical-align:top;width:35%;padding-right:16px;">
          <div style="font-size:7px;letter-spacing:0.15em;text-transform:uppercase;color:#aaaaaa;font-weight:500;margin-bottom:5px;">BANK TRANSFER</div>
          <table cellpadding="0" cellspacing="0">
            <tr><td style="font-size:7.5px;letter-spacing:0.1em;text-transform:uppercase;color:#aaaaaa;padding:1px 6px 2px 0;white-space:nowrap;width:48px;vertical-align:top;">PAYEE</td><td style="font-size:9.5px;color:#222222;font-weight:500;">JD STUDIO Limited</td></tr>
            <tr><td style="font-size:7.5px;letter-spacing:0.1em;text-transform:uppercase;color:#aaaaaa;padding:1px 6px 2px 0;vertical-align:top;">BANK</td><td style="font-size:9.5px;color:#222222;font-weight:500;">Standard Chartered Bank (Hong Kong) Ltd</td></tr>
            <tr><td style="font-size:7.5px;letter-spacing:0.1em;text-transform:uppercase;color:#aaaaaa;padding:1px 6px 2px 0;vertical-align:top;">ACCOUNT</td><td style="font-size:9.5px;color:#222222;font-weight:500;">44796326072</td></tr>
            <tr><td style="font-size:7.5px;letter-spacing:0.1em;text-transform:uppercase;color:#aaaaaa;padding:1px 6px 2px 0;vertical-align:top;">REF</td><td style="font-size:9.5px;color:#222222;font-weight:700;">${quote.quoteNumber}</td></tr>
          </table>
        </td>
        <td style="vertical-align:top;width:35%;padding-right:16px;">
          <div style="font-size:7px;letter-spacing:0.15em;text-transform:uppercase;color:#aaaaaa;font-weight:500;margin-bottom:5px;">FPS 轉數快</div>
          <table cellpadding="0" cellspacing="0">
            <tr><td style="font-size:7.5px;letter-spacing:0.1em;text-transform:uppercase;color:#aaaaaa;padding:1px 6px 2px 0;white-space:nowrap;width:48px;vertical-align:top;">PAYEE</td><td style="font-size:9.5px;color:#222222;font-weight:500;">HUI MAN HO</td></tr>
            <tr><td style="font-size:7.5px;letter-spacing:0.1em;text-transform:uppercase;color:#aaaaaa;padding:1px 6px 2px 0;vertical-align:top;">電話</td><td style="font-size:9.5px;color:#222222;font-weight:500;">95131188</td></tr>
            <tr><td style="font-size:7.5px;letter-spacing:0.1em;text-transform:uppercase;color:#aaaaaa;padding:1px 6px 2px 0;vertical-align:top;">REF</td><td style="font-size:9.5px;color:#222222;font-weight:700;">${quote.quoteNumber}</td></tr>
          </table>
        </td>
        <td style="vertical-align:top;width:30%;">
          <div style="background:#1a1a1a;padding:10px 14px;min-width:120px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
            <div style="font-size:6.5px;letter-spacing:0.15em;text-transform:uppercase;color:#888888;margin-bottom:5px;">CONTACT</div>
            <div style="font-size:18px;font-weight:400;color:#ffffff;margin-bottom:3px;">Derek</div>
            <div style="font-size:10px;color:#cccccc;">+852 9153 1976</div>
            <div style="width:20px;height:2px;background:#c9a84c;margin-top:6px;-webkit-print-color-adjust:exact;print-color-adjust:exact;"></div>
          </div>
        </td>
      </tr>
    </table>
  </div>
  <!-- TERMS & CONDITIONS -->
  <div style="margin-top:8px;margin-bottom:8px;">
    <div style="font-size:7px;letter-spacing:0.18em;text-transform:uppercase;color:#aaaaaa;font-weight:500;margin-bottom:10px;">TERMS &amp; CONDITIONS</div>
    <ul style="list-style:disc;padding-left:18px;">
      ${termsItems}
    </ul>
  </div>
  ${docType !== "RECEIPT" ? `
  <!-- GOOGLE REVIEW — matches /print/quote; keep block together in email PDF -->
  <div style="margin:12px 0 10px 0;background:#0d0d0d;border:1px solid #3a2e14;border-radius:6px;padding:12px 16px;-webkit-print-color-adjust:exact;print-color-adjust:exact;page-break-inside:avoid;-webkit-column-break-inside:avoid;break-inside:avoid;">
    <table width="100%" cellpadding="0" cellspacing="0" style="page-break-inside:avoid;break-inside:avoid;"><tr>
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
  <div style="margin-top:10px;padding-top:10px;border-top:1px solid #e8e8e8;page-break-inside:avoid;break-inside:avoid;">
    <div style="font-size:7px;letter-spacing:0.18em;text-transform:uppercase;color:#aaaaaa;font-weight:500;margin-bottom:12px;">SIGNATURES</div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="width:48%;vertical-align:top;padding-right:16px;">
          <div style="font-size:7px;letter-spacing:0.18em;text-transform:uppercase;color:#bbbbbb;margin-bottom:8px;">CLIENT SIGNATURE</div>
          <div style="border:1px solid #e0e0e0;border-radius:2px;background:#fafafa;padding:4px;margin-bottom:8px;height:80px;overflow:hidden;text-align:center;">
            <img src="${signatureData}" style="max-width:100%;max-height:72px;object-fit:contain;display:inline-block;" alt="Client Signature" />
          </div>
          <div style="border-top:1px solid #cccccc;padding-top:6px;">
            <div style="font-size:10px;color:#333333;font-weight:500;">${quote.signedByName || ""}</div>
            <div style="font-size:8px;color:#aaaaaa;margin-top:2px;">${quote.signedAt ? new Date(quote.signedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase() : new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase()}</div>
          </div>
        </td>
        <td style="width:4%;"></td>
        <td style="width:48%;vertical-align:top;padding-left:16px;">
          <div style="font-size:7px;letter-spacing:0.18em;text-transform:uppercase;color:#bbbbbb;margin-bottom:8px;">AUTHORISED SIGNATURE</div>
          <div style="border:1px solid #e0e0e0;border-radius:2px;background:#fafafa;padding:4px;margin-bottom:8px;height:80px;overflow:hidden;text-align:center;line-height:80px;">
            <span style="font-family:'Georgia',serif;font-size:26px;color:#1a1a1a;letter-spacing:0.02em;font-style:italic;vertical-align:middle;">JD Studio HK</span>
          </div>
          <div style="border-top:1px solid #cccccc;padding-top:6px;">
            <div style="font-size:10px;color:#333333;font-weight:500;">JD Studio HK</div>
            <div style="font-size:8px;color:#aaaaaa;margin-top:2px;">${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase()}</div>
          </div>
        </td>
      </tr>
    </table>
  </div>` : ""}
  <!-- FOOTER -->
  <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e8e8e8;margin-top:10px;">
    <tr>
      <td style="padding-top:7px;font-size:8px;color:#bbbbbb;letter-spacing:0.1em;">JD STUDIO &middot; HONG KONG</td>
      <td style="padding-top:7px;text-align:right;font-size:8px;color:#bbbbbb;letter-spacing:0.1em;">info.exposurehk@gmail.com &nbsp;&middot;&nbsp; www.jdstudiohk.com</td>
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

