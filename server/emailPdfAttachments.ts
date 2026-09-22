/**
 * Extract text from PDF, image, and Word (.docx) email attachments
 * for inquiry understanding.
 * Text-layer PDFs first; scanned PDFs and images fall back to OCR.
 * Unsupported formats are recorded (not silently dropped).
 */
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import {
  isOcrEnabled,
  MAX_OCR_PAGES_PER_PDF,
  MIN_TEXT_LAYER_CHARS_FOR_OCR_SKIP,
  ocrImageBuffer,
  ocrPdfBuffer,
} from "./emailAttachmentOcr";

export const MAX_PDF_ATTACHMENT_BYTES = 8 * 1024 * 1024; // 8 MB
export const MAX_IMAGE_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_WORD_ATTACHMENT_BYTES = 8 * 1024 * 1024;
/** Per-file extract cap (text-layer or OCR). Long RFPs need more than a short email body. */
export const MAX_PDF_TEXT_CHARS = 20000;
export const MAX_PDF_ATTACHMENTS = 3;
export const MAX_IMAGE_ATTACHMENTS = 3;
export const MAX_WORD_ATTACHMENTS = 3;
/**
 * Marker must match AI prompt + inquiryParseRefine (do not rename casually).
 * Briefs like celebration film + drone often put the real scope only in the PDF.
 */
export const PDF_ATTACHMENT_MARKER = "=== PDF ATTACHMENT TEXT ===";
/** Default body+PDF budget passed into parseInquiryWithAI. */
export const MERGED_BODY_MAX_CHARS = 24000;
/** Always reserve this much room for attachment text when present. */
export const MERGED_PDF_MIN_CHARS = 10000;

export type EmailAttachmentInput = {
  filename?: string | null;
  contentType?: string | null;
  content: Buffer;
  /** mailparser: true for related/inline CID parts */
  related?: boolean | null;
  contentDisposition?: string | null;
  cid?: string | null;
};

export type AttachmentExtractResult = {
  filename: string;
  text: string;
  pages?: number;
  truncated: boolean;
  /** pdf_text | pdf_ocr | image_ocr | docx */
  source?: "pdf_text" | "pdf_ocr" | "image_ocr" | "docx";
  error?: string;
};

export type SkippedAttachment = {
  filename: string;
  contentType: string;
  reason: string;
};

/** @deprecated use AttachmentExtractResult */
export type PdfExtractResult = AttachmentExtractResult;

function isPdfAttachment(att: EmailAttachmentInput): boolean {
  const name = (att.filename ?? "").toLowerCase();
  const type = (att.contentType ?? "").toLowerCase();
  return (
    type.includes("application/pdf") ||
    type === "application/x-pdf" ||
    name.endsWith(".pdf")
  );
}

function isImageAttachment(att: EmailAttachmentInput): boolean {
  const name = (att.filename ?? "").toLowerCase();
  const type = (att.contentType ?? "").toLowerCase();
  if (type.startsWith("image/")) {
    return (
      type.includes("jpeg") ||
      type.includes("jpg") ||
      type.includes("png") ||
      type.includes("webp") ||
      type.includes("gif") ||
      type.includes("bmp")
    );
  }
  return /\.(jpe?g|png|webp|gif|bmp)$/i.test(name);
}

/** .docx only — mammoth does not extract legacy .doc binary. */
function isDocxAttachment(att: EmailAttachmentInput): boolean {
  const name = (att.filename ?? "").toLowerCase();
  const type = (att.contentType ?? "").toLowerCase();
  return (
    name.endsWith(".docx") ||
    type.includes(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) ||
    type === "application/vnd.ms-word.document.macroenabled.12"
  );
}

function isLegacyDocAttachment(att: EmailAttachmentInput): boolean {
  const name = (att.filename ?? "").toLowerCase();
  const type = (att.contentType ?? "").toLowerCase();
  if (name.endsWith(".docx")) return false;
  return (
    name.endsWith(".doc") ||
    type === "application/msword" ||
    type.includes("application/msword")
  );
}

/** Skip CID/signature/inline images — not RFQ attachments. */
export function isLikelyInlineAttachment(att: EmailAttachmentInput): boolean {
  if (att.related === true) return true;
  const disp = (att.contentDisposition ?? "").toLowerCase();
  if (disp.includes("inline")) return true;
  if (att.cid && !att.filename && isImageAttachment(att)) return true;
  return false;
}

export async function extractTextFromPdfBuffer(
  content: Buffer,
  opts?: { maxChars?: number; allowOcr?: boolean }
): Promise<{
  text: string;
  pages?: number;
  truncated: boolean;
  source: "pdf_text" | "pdf_ocr" | "none";
}> {
  const maxChars = opts?.maxChars ?? MAX_PDF_TEXT_CHARS;
  const allowOcr = opts?.allowOcr !== false && isOcrEnabled();
  const parser = new PDFParse({ data: content });
  let textLayer = "";
  let pages: number | undefined;
  try {
    const result = await parser.getText();
    const raw = (result?.text ?? "").replace(/\u0000/g, " ").trim();
    const collapsed = raw.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
    textLayer = collapsed;
    pages = typeof result?.total === "number" ? result.total : undefined;
  } finally {
    try {
      await parser.destroy();
    } catch {
      /* ignore */
    }
  }

  if (
    textLayer.length >= MIN_TEXT_LAYER_CHARS_FOR_OCR_SKIP ||
    !allowOcr
  ) {
    const truncated = textLayer.length > maxChars;
    return {
      text: truncated ? textLayer.slice(0, maxChars) : textLayer,
      pages,
      truncated,
      source: textLayer.length > 0 ? "pdf_text" : "none",
    };
  }

  try {
    const ocr = await ocrPdfBuffer(content, {
      maxPages: MAX_OCR_PAGES_PER_PDF,
      maxChars,
    });
    if (ocr.text.trim()) {
      return {
        text: ocr.text,
        pages: pages ?? ocr.pagesOcrd,
        truncated: ocr.truncated,
        source: "pdf_ocr",
      };
    }
  } catch (e) {
    console.warn("[EmailAttachment] PDF OCR failed:", e);
  }

  const truncated = textLayer.length > maxChars;
  return {
    text: truncated ? textLayer.slice(0, maxChars) : textLayer,
    pages,
    truncated,
    source: textLayer.length > 0 ? "pdf_text" : "none",
  };
}

export async function extractTextFromDocxBuffer(
  content: Buffer,
  opts?: { maxChars?: number }
): Promise<{ text: string; truncated: boolean }> {
  const maxChars = opts?.maxChars ?? MAX_PDF_TEXT_CHARS;
  const result = await mammoth.extractRawText({ buffer: content });
  const text = (result?.value ?? "")
    .replace(/\u0000/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const truncated = text.length > maxChars;
  return {
    text: truncated ? text.slice(0, maxChars) : text,
    truncated,
  };
}

/**
 * Extract text from PDF + image + Word attachments on an email (mailparser shape).
 * Skipped/unsupported non-inline files are returned for UI + gate logic.
 */
export async function extractTextFromEmailAttachments(
  attachments: EmailAttachmentInput[] | null | undefined
): Promise<{
  texts: AttachmentExtractResult[];
  combinedText: string;
  pdfCount: number;
  imageCount: number;
  wordCount: number;
  attachmentCount: number;
  skippedAttachments: SkippedAttachment[];
  rawNonInlineCount: number;
}> {
  const list = Array.isArray(attachments) ? attachments : [];
  const nonInline = list.filter((a) => !isLikelyInlineAttachment(a));
  const skippedAttachments: SkippedAttachment[] = [];

  const pdfs = nonInline.filter(isPdfAttachment).slice(0, MAX_PDF_ATTACHMENTS);
  const images = nonInline
    .filter((a) => !isPdfAttachment(a) && isImageAttachment(a))
    .slice(0, MAX_IMAGE_ATTACHMENTS);
  const words = nonInline
    .filter((a) => isDocxAttachment(a))
    .slice(0, MAX_WORD_ATTACHMENTS);
  const texts: AttachmentExtractResult[] = [];

  const handled = new Set<EmailAttachmentInput>([
    ...pdfs,
    ...images,
    ...words,
  ]);

  for (const att of nonInline) {
    if (handled.has(att)) continue;
    const filename = att.filename?.trim() || "(unnamed)";
    const contentType = att.contentType?.trim() || "unknown";
    if (isLegacyDocAttachment(att)) {
      skippedAttachments.push({
        filename,
        contentType,
        reason: "legacy_doc_unsupported_use_docx",
      });
      continue;
    }
    // Cap overflow of supported types also counts as skipped
    if (isPdfAttachment(att) || isImageAttachment(att) || isDocxAttachment(att)) {
      skippedAttachments.push({
        filename,
        contentType,
        reason: "over_attachment_limit",
      });
      continue;
    }
    skippedAttachments.push({
      filename,
      contentType,
      reason: "unsupported_format",
    });
  }

  if (skippedAttachments.length > 0) {
    console.warn(
      "[EmailAttachment] Skipped non-inline attachments:",
      skippedAttachments
        .map((s) => `${s.filename} (${s.reason})`)
        .join("; ")
    );
  }

  for (const att of pdfs) {
    const filename = att.filename?.trim() || "attachment.pdf";
    if (!att.content || att.content.length === 0) {
      texts.push({ filename, text: "", truncated: false, error: "empty" });
      continue;
    }
    if (att.content.length > MAX_PDF_ATTACHMENT_BYTES) {
      texts.push({
        filename,
        text: "",
        truncated: false,
        error: `too_large (${att.content.length} bytes)`,
      });
      continue;
    }
    try {
      const extracted = await extractTextFromPdfBuffer(att.content);
      const source =
        extracted.source === "pdf_ocr"
          ? "pdf_ocr"
          : extracted.source === "pdf_text"
            ? "pdf_text"
            : undefined;
      texts.push({
        filename,
        text: extracted.text,
        pages: extracted.pages,
        truncated: extracted.truncated,
        source,
        error: extracted.text
          ? undefined
          : source === "pdf_ocr"
            ? "ocr_empty"
            : "no_text_layer",
      });
    } catch (e) {
      texts.push({
        filename,
        text: "",
        truncated: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  for (const att of images) {
    const filename = att.filename?.trim() || "attachment.jpg";
    if (!att.content || att.content.length === 0) {
      texts.push({ filename, text: "", truncated: false, error: "empty" });
      continue;
    }
    if (att.content.length > MAX_IMAGE_ATTACHMENT_BYTES) {
      texts.push({
        filename,
        text: "",
        truncated: false,
        error: `too_large (${att.content.length} bytes)`,
      });
      continue;
    }
    try {
      const text = await ocrImageBuffer(att.content);
      const truncated = text.length > MAX_PDF_TEXT_CHARS;
      texts.push({
        filename,
        text: truncated ? text.slice(0, MAX_PDF_TEXT_CHARS) : text,
        truncated,
        source: text ? "image_ocr" : undefined,
        error: text ? undefined : "ocr_empty",
      });
    } catch (e) {
      texts.push({
        filename,
        text: "",
        truncated: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  for (const att of words) {
    const filename = att.filename?.trim() || "attachment.docx";
    if (!att.content || att.content.length === 0) {
      texts.push({ filename, text: "", truncated: false, error: "empty" });
      continue;
    }
    if (att.content.length > MAX_WORD_ATTACHMENT_BYTES) {
      texts.push({
        filename,
        text: "",
        truncated: false,
        error: `too_large (${att.content.length} bytes)`,
      });
      continue;
    }
    try {
      const extracted = await extractTextFromDocxBuffer(att.content);
      texts.push({
        filename,
        text: extracted.text,
        truncated: extracted.truncated,
        source: extracted.text ? "docx" : undefined,
        error: extracted.text ? undefined : "docx_empty",
      });
    } catch (e) {
      texts.push({
        filename,
        text: "",
        truncated: false,
        error: e instanceof Error ? e.message : String(e),
      });
      // Also surface as unsupported-ish for gate if extract threw
      skippedAttachments.push({
        filename,
        contentType: att.contentType ?? "application/docx",
        reason: `docx_extract_failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  const combinedParts = texts
    .filter((t) => t.text.trim())
    .map((t) => {
      const via =
        t.source === "pdf_ocr"
          ? "OCR"
          : t.source === "image_ocr"
            ? "image OCR"
            : t.source === "docx"
              ? "Word"
              : t.pages
                ? `${t.pages} pages`
                : "";
      const suffix = via ? ` (${via})` : "";
      const trunc = t.truncated ? " [truncated]" : "";
      return `--- Attachment: ${t.filename}${suffix}${trunc} ---\n${t.text}`;
    });

  return {
    texts,
    combinedText: combinedParts.join("\n\n"),
    pdfCount: pdfs.length,
    imageCount: images.length,
    wordCount: words.length,
    attachmentCount: pdfs.length + images.length + words.length,
    skippedAttachments,
    rawNonInlineCount: nonInline.length,
  };
}

/** @deprecated use extractTextFromEmailAttachments */
export async function extractTextFromPdfAttachments(
  attachments: EmailAttachmentInput[] | null | undefined
): Promise<{
  texts: AttachmentExtractResult[];
  combinedText: string;
  pdfCount: number;
}> {
  const out = await extractTextFromEmailAttachments(attachments);
  return {
    texts: out.texts,
    combinedText: out.combinedText,
    pdfCount: out.pdfCount,
  };
}

/**
 * Merge email body + attachment text for AI parse.
 * Keeps body first, but **reserves** room for PDF so long email threads cannot
 * push the brief out of the prompt window (common RFP failure mode).
 */
export function mergeEmailBodyWithPdfText(
  bodyText: string,
  pdfCombinedText: string,
  opts?: { maxTotalChars?: number; minPdfChars?: number }
): string {
  const maxTotal = opts?.maxTotalChars ?? MERGED_BODY_MAX_CHARS;
  const minPdf = opts?.minPdfChars ?? MERGED_PDF_MIN_CHARS;
  const body = (bodyText ?? "").trim();
  const pdf = (pdfCombinedText ?? "").trim();
  if (!pdf) return body.slice(0, maxTotal);

  const header = `\n\n${PDF_ATTACHMENT_MARKER}\n`;
  const pdfNeed = Math.min(pdf.length, Math.max(minPdf, Math.floor(maxTotal * 0.55)));
  const headerLen = header.length;
  const bodyBudget = Math.max(500, maxTotal - headerLen - pdfNeed);
  const bodySlice = body.length > bodyBudget ? body.slice(0, bodyBudget) : body;
  const pdfBudget = Math.max(0, maxTotal - bodySlice.length - headerLen);
  const pdfSlice = pdf.length > pdfBudget ? pdf.slice(0, pdfBudget) : pdf;
  return `${bodySlice}${header}${pdfSlice}`;
}
