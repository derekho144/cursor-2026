/**
 * Extract text from PDF and image email attachments for inquiry understanding.
 * Text-layer PDFs first; scanned PDFs and images fall back to OCR.
 */
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
export const MAX_PDF_TEXT_CHARS = 12000;
export const MAX_PDF_ATTACHMENTS = 3;
export const MAX_IMAGE_ATTACHMENTS = 3;

export type EmailAttachmentInput = {
  filename?: string | null;
  contentType?: string | null;
  content: Buffer;
};

export type AttachmentExtractResult = {
  filename: string;
  text: string;
  pages?: number;
  truncated: boolean;
  /** pdf_text | pdf_ocr | image_ocr */
  source?: "pdf_text" | "pdf_ocr" | "image_ocr";
  error?: string;
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

  // Scanned / image PDF — OCR fallback
  try {
    const ocr = await ocrPdfBuffer(content, { maxPages: MAX_OCR_PAGES_PER_PDF, maxChars });
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

/**
 * Extract text from PDF + image attachments on an email (mailparser shape).
 */
export async function extractTextFromEmailAttachments(
  attachments: EmailAttachmentInput[] | null | undefined
): Promise<{
  texts: AttachmentExtractResult[];
  combinedText: string;
  pdfCount: number;
  imageCount: number;
  attachmentCount: number;
}> {
  const list = Array.isArray(attachments) ? attachments : [];
  const pdfs = list.filter(isPdfAttachment).slice(0, MAX_PDF_ATTACHMENTS);
  const images = list
    .filter((a) => !isPdfAttachment(a) && isImageAttachment(a))
    .slice(0, MAX_IMAGE_ATTACHMENTS);
  const texts: AttachmentExtractResult[] = [];

  for (const att of pdfs) {
    const filename = att.filename?.trim() || "attachment.pdf";
    if (!att.content || att.content.length === 0) {
      texts.push({
        filename,
        text: "",
        truncated: false,
        error: "empty",
      });
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
      texts.push({
        filename,
        text: "",
        truncated: false,
        error: "empty",
      });
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

  const combinedParts = texts
    .filter((t) => t.text.trim())
    .map((t) => {
      const via =
        t.source === "pdf_ocr"
          ? "OCR"
          : t.source === "image_ocr"
            ? "image OCR"
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
    attachmentCount: pdfs.length + images.length,
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

/** Merge email body + attachment text for AI parse (keeps body first). */
export function mergeEmailBodyWithPdfText(
  bodyText: string,
  pdfCombinedText: string,
  opts?: { maxTotalChars?: number }
): string {
  const maxTotal = opts?.maxTotalChars ?? 16000;
  const body = (bodyText ?? "").trim();
  const pdf = (pdfCombinedText ?? "").trim();
  if (!pdf) return body.slice(0, maxTotal);
  const header =
    "\n\n=== PDF ATTACHMENT TEXT (extracted; use for requirements) ===\n";
  const budget = Math.max(0, maxTotal - body.length - header.length);
  if (budget <= 0) return body.slice(0, maxTotal);
  const pdfSlice = pdf.length > budget ? pdf.slice(0, budget) : pdf;
  return `${body}${header}${pdfSlice}`;
}
