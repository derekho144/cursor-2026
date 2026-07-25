/**
 * quotePdfKit.ts
 * Pure Node.js PDF generation using PDFKit — no Chrome/Puppeteer required.
 * Uses Noto Sans CJK fonts (downloaded from CDN on first use) for full Chinese support.
 */
import PDFDocument from "pdfkit";
import { existsSync, writeFileSync, mkdirSync } from "fs";
import { join as pathJoin } from "path";
import { tmpdir } from "os";

// ─── Font CDN URLs (uploaded to Manus CDN) ─────────────────────────
const FONT_CDN = {
  regular:
    "https://d2xsxph8kpxj0f.cloudfront.net/310519663457748523/VbnWSJV6UQ79sGuykqPPae/NotoSansCJK-Regular_fc1f0423.otf",
  bold: "https://d2xsxph8kpxj0f.cloudfront.net/310519663457748523/VbnWSJV6UQ79sGuykqPPae/NotoSansCJK-Bold_74a83bdc.otf",
};

// ─── Font Cache: download once per process, store in /tmp ──────────
let fontPaths: { regular: string; bold: string } | null = null;

async function ensureFonts(): Promise<{ regular: string; bold: string }> {
  if (fontPaths) return fontPaths;

  const cacheDir = pathJoin(tmpdir(), "jd-studio-fonts");
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });

  const regularPath = pathJoin(cacheDir, "NotoSansCJK-Regular.otf");
  const boldPath = pathJoin(cacheDir, "NotoSansCJK-Bold.otf");

  async function downloadFont(url: string, dest: string) {
    if (existsSync(dest)) return; // already cached
    console.log(`[PDF] Downloading font: ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download font: ${res.status} ${url}`);
    const buf = await res.arrayBuffer();
    writeFileSync(dest, Buffer.from(buf));
    console.log(`[PDF] Font cached: ${dest}`);
  }

  await Promise.all([
    downloadFont(FONT_CDN.regular, regularPath),
    downloadFont(FONT_CDN.bold, boldPath),
  ]);

  fontPaths = { regular: regularPath, bold: boldPath };
  return fontPaths;
}

// ─── Service Type Labels ───────────────────────────────────────────
export const SERVICE_TYPE_LABELS: Record<string, string> = {
  corporate_event: "企業活動攝影",
  product: "產品攝影",
  food_beverage: "食物攝影",
  jewelry: "珠寶攝影",
  artwork: "藝術品攝影",
  interior: "建築/室內攝影",
  video_production: "影片製作",
  graphic_design: "平面設計",
  ad_video: "廣告影片",
  web_development: "網頁製作",
  ai_photography: "AI攝影",
  menu_design: "餐牌設計",
  portrait: "人像拍攝",
  "360_photography": "360 拍攝",
  drone: "航拍拍攝", kol_mi: "KOL/MI 推廣",
  other: "其他服務",
};

// ─── Colors ────────────────────────────────────────────────────────
const C = {
  black: "#111111",
  white: "#FFFFFF",
  gold: "#C9A84C",
  darkGray: "#333333",
  medGray: "#555555",
  lightGray: "#AAAAAA",
  veryLight: "#EEEEEE",
  rowAlt: "#F5F5F5",
  rowWhite: "#FFFFFF",
  border: "#E0E0E0",
  noteBg: "#F9F9F9",
  contactBg: "#1A1A1A",
};

// ─── Helpers ───────────────────────────────────────────────────────
function formatDate(d: string | Date): string {
  const dt = new Date(d);
  return dt
    .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    .toUpperCase();
}

function formatMoney(v: number | string): string {
  const n = Number(v);
  const s = n % 1 === 0
    ? n.toLocaleString("en-HK")
    : n.toLocaleString("en-HK", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  return `HKD ${s}`;
}

function fmtNum(v: number | string): string {
  const n = Number(v);
  if (n % 1 === 0) return n.toLocaleString("en-HK");
  return n.toLocaleString("en-HK", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function wrapText(doc: PDFKit.PDFDocument, text: string, maxWidth: number): string[] {
  // For CJK text, split character by character for better wrapping
  const chars = Array.from(text);
  const lines: string[] = [];
  let current = "";
  for (const ch of chars) {
    const test = current + ch;
    if (doc.widthOfString(test) <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = ch;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [text];
}

// ─── Main PDF Generator ────────────────────────────────────────────
export async function generateQuotePdfBuffer(
  quote: any,
  llmDescription: string,
  serviceTypeLabels: Record<string, string>,
  docType: "QUOTATION" | "RECEIPT" = "QUOTATION",
  signatureData?: string | null
): Promise<Buffer> {
  // Ensure CJK fonts are available
  const fonts = await ensureFonts();

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      info: {
        Title: `JD Studio - ${quote.quoteNumber}`,
        Author: "JD Studio HK",
      },
    });

    // Register CJK fonts
    doc.registerFont("NotoSans", fonts.regular);
    doc.registerFont("NotoSansBold", fonts.bold);

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const PW = 595.28; // A4 width in points
    const PH = 841.89; // A4 height in points
    const ML = 32; // left margin
    const MR = 32; // right margin
    const CW = PW - ML - MR; // content width

    // ── HEADER (black background) ──────────────────────────────────
    const headerH = 100;
    doc.rect(0, 0, PW, headerH).fill(C.black);

    // Logo text
    doc.fontSize(18).font("NotoSansBold").fillColor(C.white);
    doc.text("JD STUDIO HK", ML, 24, { lineBreak: false });

    // Gold underline
    doc.rect(ML, 44, 80, 1.5).fill(C.gold);

    // Contact info
    doc.fontSize(7).font("NotoSans").fillColor(C.lightGray);
    doc.text("TEL  +852 9153 1976", ML, 52, { lineBreak: false });
    doc.text("EMAIL  info.exposurehk@gmail.com", ML, 63, { lineBreak: false });
    doc.text("WEB  www.jdstudiohk.com", ML, 74, { lineBreak: false });

    // Doc type + number (right side)
    doc.fontSize(7).font("NotoSans").fillColor("#888888");
    doc.text(docType, PW - MR - 150, 24, { width: 150, align: "right", lineBreak: false });

    doc.fontSize(22).font("NotoSans").fillColor(C.white);
    doc.text(quote.quoteNumber, PW - MR - 180, 34, { width: 180, align: "right", lineBreak: false });

    // Divider line
    doc.rect(PW - MR - 150, 62, 150, 0.5).fill("#444444");

    doc.fontSize(7).font("NotoSans").fillColor("#888888");
    doc.text(`DATE   ${formatDate(quote.createdAt)}`, PW - MR - 150, 68, { width: 150, align: "right", lineBreak: false });

    let y = headerH;

    // ── PREPARED FOR / SERVICE DETAILS ────────────────────────────
    // Dynamically calculate infoH based on client name length
    const clientName = quote.clientCompany || quote.clientName;
    const clientNameWidth = CW / 2 - 16;
    // Estimate lines needed for client name (approx 13pt font, ~40 chars per line at this width)
    const charsPerLine = Math.floor(clientNameWidth / 7.5);
    const nameLines = Math.ceil(clientName.length / charsPerLine);
    const nameBlockH = Math.max(16, nameLines * 16);
    const extraLines = (quote.clientPhone ? 1 : 0) + (quote.clientEmail ? 1 : 0);
    const infoH = Math.max(70, 24 + nameBlockH + extraLines * 14 + 12);
    doc.rect(0, y, PW, infoH).fill(C.white);

    // Left: Prepared For
    doc.fontSize(6.5).font("NotoSans").fillColor(C.lightGray);
    doc.text("PREPARED FOR", ML, y + 12, { lineBreak: false });

    doc.fontSize(12).font("NotoSansBold").fillColor(C.black);
    doc.text(clientName, ML, y + 24, { width: clientNameWidth });

    let clientY = doc.y + 4;
    doc.fontSize(9).font("NotoSans").fillColor(C.medGray);
    if (quote.clientPhone) {
      doc.text(quote.clientPhone, ML, clientY, { lineBreak: false });
      clientY += 13;
    }
    if (quote.clientEmail) {
      doc.text(quote.clientEmail, ML, clientY, { width: clientNameWidth, lineBreak: false });
      clientY += 13;
    }

    // Vertical divider
    doc.rect(PW / 2, y + 8, 0.5, infoH - 16).fill(C.border);

    // Right: Service Details
    doc.fontSize(6.5).font("NotoSans").fillColor(C.lightGray);
    doc.text("SERVICE DETAILS", PW / 2 + 16, y + 12, { lineBreak: false });

    doc.fontSize(11).font("NotoSans").fillColor(C.black);
    doc.text(serviceTypeLabels[quote.serviceType] || quote.serviceType, PW / 2 + 16, y + 24, {
      width: CW / 2 - 16,
      lineBreak: false,
    });

    if (quote.shootingDate) {
      doc.fontSize(9).font("NotoSans").fillColor(C.medGray);
      doc.text(`Date: ${quote.shootingDate}`, PW / 2 + 16, y + 40, { lineBreak: false });
    }
    if (quote.shootingLocation) {
      doc.fontSize(9).font("NotoSans").fillColor(C.medGray);
      doc.text(`Location: ${quote.shootingLocation}`, PW / 2 + 16, y + 52, {
        width: CW / 2 - 16,
        lineBreak: false,
      });
    }

    // Bottom border
    doc.rect(0, y + infoH, PW, 0.5).fill(C.border);
    y += infoH + 0.5;

    // ── ITEMS TABLE ────────────────────────────────────────────────
    const colQty = 50;
    const colPrice = 100;
    const colAmt = 100;
    const colDesc = CW - colQty - colPrice - colAmt;

    // Table header
    const thH = 26;
    doc.rect(0, y, PW, thH).fill(C.white);
    doc.fontSize(6.5).font("NotoSans").fillColor(C.lightGray);
    doc.text("QTY", ML, y + 9, { width: colQty, align: "center", lineBreak: false });
    doc.text("DESCRIPTION", ML + colQty, y + 9, { lineBreak: false });
    doc.text("UNIT PRICE", ML + colQty + colDesc, y + 9, { width: colPrice, align: "right", lineBreak: false });
    doc.text("AMOUNT", ML + colQty + colDesc + colPrice, y + 9, { width: colAmt, align: "right", lineBreak: false });
    doc.rect(0, y + thH, PW, 0.5).fill("#CCCCCC");
    y += thH + 0.5;

    // Table rows
    const items = quote.items || [];
    items.forEach((item: any, idx: number) => {
      const isIncluded = item.isIncluded || Number(item.unitPrice) === 0;
      const descLines = String(item.description).split("\n");

      // Calculate row height based on description lines
      doc.fontSize(9).font("NotoSansBold");
      let totalDescLines = 0;
      for (const line of descLines) {
        const wrapped = wrapText(doc, line, colDesc - 10);
        totalDescLines += Math.max(1, wrapped.length);
      }
      const rowH = Math.max(28, totalDescLines * 13 + 14);

      // Row background
      const rowBg = idx % 2 === 0 ? C.rowWhite : C.rowAlt;
      doc.rect(0, y, PW, rowH).fill(rowBg);

      // QTY
      doc.fontSize(9).font("NotoSans").fillColor(C.darkGray);
      doc.text(String(Number(item.quantity)), ML, y + rowH / 2 - 5, { width: colQty, align: "center", lineBreak: false });

      // Description
      doc.fontSize(9).font("NotoSansBold").fillColor(C.black);
      let descY = y + 8;
      for (const line of descLines) {
        const wrapped = wrapText(doc, line, colDesc - 10);
        for (const wl of wrapped) {
          doc.text(wl, ML + colQty, descY, { lineBreak: false });
          descY += 13;
        }
      }

      // Unit Price
      if (isIncluded) {
        doc.fontSize(8).font("NotoSans").fillColor(C.medGray);
        doc.text("Included", ML + colQty + colDesc, y + rowH / 2 - 5, { width: colPrice, align: "right", lineBreak: false });
      } else {
        doc.fontSize(9).font("NotoSans").fillColor(C.darkGray);
        doc.text(fmtNum(item.unitPrice), ML + colQty + colDesc, y + rowH / 2 - 5, { width: colPrice, align: "right", lineBreak: false });
      }

      // Amount
      if (isIncluded) {
        doc.fontSize(8).font("NotoSans").fillColor(C.medGray);
        doc.text("Included", ML + colQty + colDesc + colPrice, y + rowH / 2 - 5, { width: colAmt, align: "right", lineBreak: false });
      } else {
        doc.fontSize(9).font("NotoSans").fillColor(C.darkGray);
        doc.text(fmtNum(item.amount), ML + colQty + colDesc + colPrice, y + rowH / 2 - 5, { width: colAmt, align: "right", lineBreak: false });
      }

      // Row bottom border
      doc.rect(0, y + rowH, PW, 0.5).fill(C.border);
      y += rowH + 0.5;
    });

    // Extra rows (equipment, team, delivery)
    const extraRowDefs = [
      quote.equipment ? { label: "LIGHTING & EQUIPMENT", value: quote.equipment } : null,
      quote.team ? { label: "TEAM", value: quote.team } : null,
      quote.deliveryMethod ? { label: "PHOTO DELIVERY METHOD", value: quote.deliveryMethod } : null,
    ].filter(Boolean) as { label: string; value: string }[];

    extraRowDefs.forEach((row, i) => {
      const rowBg = (items.length + i) % 2 === 0 ? C.rowWhite : C.rowAlt;
      const rowH = 32;
      doc.rect(0, y, PW, rowH).fill(rowBg);
      doc.fontSize(6.5).font("NotoSansBold").fillColor(C.lightGray);
      doc.text(row.label, ML, y + 10, { width: colQty + colDesc, lineBreak: false });
      doc.fontSize(9).font("NotoSans").fillColor(C.darkGray);
      doc.text(row.value, ML + colQty + colDesc, y + 10, { width: colPrice + colAmt, align: "right", lineBreak: false });
      doc.rect(0, y + rowH, PW, 0.5).fill(C.border);
      y += rowH + 0.5;
    });

    // ── TOTAL ──────────────────────────────────────────────────────
    doc.rect(0, y, PW, 0.5).fill(C.border);
    y += 0.5;

    const totalH = 50;
    doc.rect(0, y, PW, totalH).fill(C.white);

    // Discount
    if (Number(quote.discountAmount) > 0) {
      const discPct = Number((quote as any).discountPercent ?? 0);
      const discLabel = discPct > 0 ? `DISCOUNT (${discPct}%)` : "DISCOUNT";
      doc.fontSize(7.5).font("NotoSans").fillColor(C.lightGray);
      doc.text(discLabel, PW - MR - 200, y + 10, { width: 120, align: "right", lineBreak: false });
      doc.fontSize(10).font("NotoSans").fillColor(C.medGray);
      doc.text(`- ${fmtNum(quote.discountAmount)}`, PW - MR - 80, y + 10, { width: 80, align: "right", lineBreak: false });
    }

    doc.fontSize(7.5).font("NotoSans").fillColor(C.lightGray);
    doc.text("TOTAL AMOUNT", PW - MR - 220, y + 22, { width: 120, align: "right", lineBreak: false });

    // Total amount line
    doc.rect(PW - MR - 120, y + 18, 120, 0.5).fill(C.darkGray);

    doc.fontSize(22).font("NotoSans").fillColor(C.black);
    doc.text(`$${fmtNum(quote.total)}`, PW - MR - 140, y + 22, { width: 140, align: "right", lineBreak: false });

    y += totalH;

    // ── DEPOSIT & NET PAYMENT ──────────────────────────────────────
    const depositPct = Number((quote as any).depositPercent ?? 0);
    const depositMode = (quote as any).depositMode ?? "percent";
    const depositFixedAmt = Number((quote as any).depositFixedAmount ?? 0);
    const hasDeposit = depositMode === "fixed" ? depositFixedAmt > 0 : depositPct > 0;
    if (hasDeposit) {
      // 計算訂金金額
      const depositAmt = depositMode === "fixed"
        ? depositFixedAmt
        : Number(quote.total) * depositPct / 100;
      const netAmt = Number(quote.total) - depositAmt;
      const isFullPayment = depositAmt >= Number(quote.total);
      const fmtAmt = (n: number) => {
        const s = n % 1 === 0
          ? n.toLocaleString("en-HK")
          : n.toLocaleString("en-HK", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
        return `$${s}`;
      };
      // 訂金標籤：固定金額顯示金額，百分比顯示百分比
      const depositLabel = depositMode === "fixed"
        ? `DEPOSIT (HKD ${depositAmt.toLocaleString("en-HK")})`
        : `DEPOSIT (${depositPct}%)`;
      const depositRowH = !isFullPayment ? 48 : 28;
      doc.rect(0, y, PW, depositRowH).fill("#f9f6ef");
      doc.rect(0, y, PW, 0.5).fill(C.border);
      // Deposit row
      doc.fontSize(7.5).font("NotoSans").fillColor(C.lightGray);
      doc.text(depositLabel, PW - MR - 200, y + 8, { width: 120, align: "right", lineBreak: false });
      doc.fontSize(11).font("NotoSansBold").fillColor("#c8922a");
      doc.text(fmtAmt(depositAmt), PW - MR - 80, y + 6, { width: 80, align: "right", lineBreak: false });
      // Net Payment row
      if (!isFullPayment) {
        doc.fontSize(7.5).font("NotoSans").fillColor(C.lightGray);
        doc.text("NET PAYMENT", PW - MR - 200, y + 28, { width: 120, align: "right", lineBreak: false });
        doc.fontSize(11).font("NotoSans").fillColor(C.darkGray);
        doc.text(fmtAmt(netAmt), PW - MR - 80, y + 26, { width: 80, align: "right", lineBreak: false });
      }
      doc.rect(0, y + depositRowH, PW, 0.5).fill(C.border);
      y += depositRowH + 0.5;
    }

    // ── NOTES ──────────────────────────────────────────────────────
    if (quote.notes) {
      const noteLines = quote.notes.split("\n");
      const noteH = noteLines.length * 14 + 36;
      doc.rect(ML, y + 8, CW, noteH).fill(C.noteBg);
      doc.rect(ML, y + 8, 2, noteH).fill("#CCCCCC");

      doc.fontSize(6.5).font("NotoSans").fillColor(C.lightGray);
      doc.text("NOTES", ML + 12, y + 16, { lineBreak: false });

      doc.fontSize(9).font("NotoSans").fillColor("#444444");
      let noteY = y + 28;
      for (const line of noteLines) {
        doc.text(line || " ", ML + 12, noteY, { width: CW - 24, lineBreak: false });
        noteY += 14;
      }
      y += noteH + 16;
    } else {
      y += 8;
    }

    // ── PAYMENT DETAIL ─────────────────────────────────────────────
    doc.fontSize(6.5).font("NotoSans").fillColor(C.lightGray);
    doc.text("PAYMENT DETAIL", ML, y, { lineBreak: false });
    y += 16;

    const payColW = CW / 3;

    // Bank Transfer
    doc.fontSize(6.5).font("NotoSans").fillColor(C.lightGray);
    doc.text("BANK TRANSFER", ML, y, { lineBreak: false });
    y += 14;

    const bankRows = [
      ["PAYEE", "HUI MAN HO"],
      ["BANK", "HSBC Hong Kong"],
      ["ACCOUNT", "646-512590-833"],
      ["REF", quote.quoteNumber],
    ];
    let bankY = y;
    for (const [label, value] of bankRows) {
      doc.fontSize(6.5).font("NotoSans").fillColor(C.lightGray);
      doc.text(label, ML, bankY, { width: 40, lineBreak: false });
      doc.fontSize(8.5).font(label === "REF" ? "NotoSansBold" : "NotoSans").fillColor(C.darkGray);
      doc.text(value, ML + 44, bankY, { lineBreak: false });
      bankY += 13;
    }

    // FPS
    const fpsX = ML + payColW;
    doc.fontSize(6.5).font("NotoSans").fillColor(C.lightGray);
    doc.text("FPS 轉數快", fpsX, y - 14, { lineBreak: false });

    const fpsRows = [
      ["PAYEE", "HUI MAN HO"],
      ["電話", "95131188"],
      ["REF", quote.quoteNumber],
    ];
    let fpsY = y;
    for (const [label, value] of fpsRows) {
      doc.fontSize(6.5).font("NotoSans").fillColor(C.lightGray);
      doc.text(label, fpsX, fpsY, { width: 40, lineBreak: false });
      doc.fontSize(8.5).font(label === "REF" ? "NotoSansBold" : "NotoSans").fillColor(C.darkGray);
      doc.text(value, fpsX + 44, fpsY, { lineBreak: false });
      fpsY += 13;
    }

    // Contact box (dark)
    const contactX = ML + payColW * 2;
    const contactW = payColW;
    const contactH = 60;
    doc.rect(contactX, y - 14, contactW, contactH).fill(C.contactBg);
    doc.fontSize(6.5).font("NotoSans").fillColor("#666666");
    doc.text("CONTACT", contactX + 12, y - 6, { lineBreak: false });
    doc.fontSize(13).font("NotoSansBold").fillColor(C.white);
    doc.text("Derek", contactX + 12, y + 8, { lineBreak: false });
    doc.fontSize(9).font("NotoSans").fillColor(C.lightGray);
    doc.text("+852 9153 1976", contactX + 12, y + 24, { lineBreak: false });
    doc.rect(contactX + 12, y + 38, 24, 2).fill(C.gold);

    y = Math.max(bankY, fpsY) + 10;

    // ── TERMS & CONDITIONS ─────────────────────────────────────────
    doc.fontSize(6.5).font("NotoSans").fillColor(C.lightGray);
    doc.text("TERMS & CONDITIONS", ML, y, { lineBreak: false });
    y += 14;

    const terms = [
      "訂金不設退款 · Deposit is non-refundable",
      "報價單有效期 14 天 · Quotation valid for 14 days from date of issue",
      "付款後方可確認預約 · Booking confirmed upon receipt of deposit",
      "因不可抗力（如天災、疫情等）導致拍攝無法進行，雙方可協商改期，但不能取消 · In case of force majeure (e.g. natural disaster, pandemic), rescheduling may be arranged by mutual agreement, but cancellation is not permitted",
      "本報價單經客戶簽署或以任何形式確認後，即視為具有法律效力之合約，雙方均受其條款約束 · This quotation, once signed or confirmed by the client in any form, constitutes a legally binding contract and both parties shall be bound by its terms.",
    ];

    for (const term of terms) {
      doc.fontSize(8).font("NotoSans").fillColor("#444444");
      const termLines = wrapText(doc, `• ${term}`, CW - 10);
      for (const tl of termLines) {
        doc.text(tl, ML + 6, y, { lineBreak: false });
        y += 13;
      }
      y += 2;
    }

    y += 6;

    // ── GOOGLE REVIEW BLOCK (QUOTATION only) ──────────────────────────────────────────────
    if (docType !== "RECEIPT") {
      // Need enough space for: reviewBox(62) + gap(8) + signature(~120) + footer(28) = ~218
      // Use 200 as threshold to keep Google Review + signature on same page
      const reviewNeeded = signatureData ? 200 : 100;
      if (y + reviewNeeded > PH - 28) {
        doc.addPage();
        y = 32;
      }
      const reviewBoxH = 62;
      // Dark background box
      doc.rect(ML, y, CW, reviewBoxH).fill("#1a1a1a");
      // Star icon
      doc.fontSize(18).font("NotoSans").fillColor("#D4AF37");
      doc.text("★", ML + 12, y + 10, { lineBreak: false });
      // Title
      doc.fontSize(11).font("NotoSansBold").fillColor("#FFFFFF");
      doc.text("Google Review", ML + 38, y + 10, { lineBreak: false });
      // English description
      doc.fontSize(8).font("NotoSans").fillColor("#CCCCCC");
      doc.text("Leave us a Google review & follow our Instagram @jdstudiohk to enjoy a special discount on this shoot.", ML + 38, y + 26, { width: CW - 55, lineBreak: false });
      // Chinese description
      doc.fontSize(7).font("NotoSans").fillColor("#AAAAAA");
      doc.text("於 Google 留下您的真實評價，並追蹤我們的 Instagram @jdstudiohk，即可於本次攝影服務中享有特別折扣。", ML + 38, y + 38, { width: CW - 55, lineBreak: false });
      // Discount badge
      const badgeY = y + reviewBoxH - 16;
      doc.roundedRect(ML + 12, badgeY - 4, CW - 24, 14, 3).stroke("#D4AF37");
      doc.fontSize(7.5).font("NotoSansBold").fillColor("#D4AF37");
      doc.text("Google Review + Follow IG  →  10% Discount  /  Google 好評 + Follow IG → 10% 折扣優惠", ML + 18, badgeY - 1, { width: CW - 36, align: "center", lineBreak: false });
      y += reviewBoxH + 8;
    }

    // ── SIGNATURE BLOCK ───────────────────────────────────────────────────────────────────────────────────
    if (signatureData) {
      // Check if we need a new page
      if (y + 100 > PH - 40) {
        doc.addPage();
        y = 32;
      }

      doc.rect(0, y, PW, 0.5).fill(C.border);
      y += 10;

      doc.fontSize(6.5).font("NotoSans").fillColor(C.lightGray);
      doc.text("SIGNATURES", ML, y, { lineBreak: false });
      y += 14;

      const sigColW = (CW - 20) / 2;

      // Client signature
      doc.fontSize(6).font("NotoSans").fillColor(C.lightGray);
      doc.text("CLIENT SIGNATURE", ML, y, { lineBreak: false });
      y += 8;

      // Signature image box
      doc.rect(ML, y, sigColW, 50).stroke(C.border);

      // Try to embed the base64 signature image
      try {
        const base64Data = signatureData.replace(/^data:image\/\w+;base64,/, "");
        const imgBuffer = Buffer.from(base64Data, "base64");
        doc.image(imgBuffer, ML + 4, y + 4, { width: sigColW - 8, height: 42, fit: [sigColW - 8, 42] });
      } catch {
        // If image fails, just show the box
      }

      y += 54;
      doc.rect(ML, y, sigColW, 0.5).fill("#CCCCCC");
      y += 6;
      doc.fontSize(8).font("NotoSansBold").fillColor(C.darkGray);
      doc.text(quote.signedByName || "", ML, y, { lineBreak: false });
      y += 12;
      doc.fontSize(6.5).font("NotoSans").fillColor(C.lightGray);
      const signedDate = quote.signedAt
        ? new Date(quote.signedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase()
        : new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
      doc.text(signedDate, ML, y, { lineBreak: false });

      // Authorised signature (right side)
      const authX = ML + sigColW + 20;
      doc.fontSize(6).font("NotoSans").fillColor(C.lightGray);
      doc.text("AUTHORISED SIGNATURE", authX, y - 76, { lineBreak: false });

      doc.rect(authX, y - 64, sigColW, 50).stroke(C.border);
      doc.fontSize(16).font("NotoSans").fillColor(C.black);
      doc.text("JD Studio HK", authX + 8, y - 50, { width: sigColW - 16, align: "center", lineBreak: false });

      doc.rect(authX, y - 10, sigColW, 0.5).fill("#CCCCCC");
      doc.fontSize(8).font("NotoSansBold").fillColor(C.darkGray);
      doc.text("JD Studio HK", authX, y, { lineBreak: false });
      doc.fontSize(6.5).font("NotoSans").fillColor(C.lightGray);
      doc.text(new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase(), authX, y + 12, { lineBreak: false });

      y += 20;
    }

    // ── FOOTER ─────────────────────────────────────────────────────
    doc.rect(0, PH - 28, PW, 0.5).fill(C.border);
    doc.fontSize(7.5).font("NotoSans").fillColor(C.lightGray);
    doc.text("JD STUDIO · HONG KONG", ML, PH - 20, { lineBreak: false });
    doc.text("info.exposurehk@gmail.com  ·  www.jdstudiohk.com", ML, PH - 20, { width: CW, align: "right", lineBreak: false });

    doc.end();
  });
}
