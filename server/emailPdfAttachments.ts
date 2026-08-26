/**
 * Extract text from PDF email attachments for inquiry understanding.
 * Text-layer PDFs only (no OCR for scanned images in v1).
 */
import { PDFParse } from "pdf-parse";

export const MAX_PDF_ATTACHMENT_BYTES = 8 * 1024 * 1024; // 8 MB
export const MAX_PDF_TEXT_CHARS = 12000;
export const MAX_PDF_ATTACHMENTS = 3;

export type PdfAttachmentInput = {
  filename?: string | null;
  contentType?: string | null;
  content: Buffer;
};

export type PdfExtractResult = {
  filename: string;
  text: string;
  pages?: number;
  truncated: boolean;
  error?: string;
};

function isPdfAttachment(att: PdfAttachmentInput): boolean {
  const name = (att.filename ?? "").toLowerCase();
  const type = (att.contentType ?? "").toLowerCase();
  return (
    type.includes("application/pdf") ||
    type === "application/x-pdf" ||
    name.endsWith(".pdf")
  );
}

export async function extractTextFromPdfBuffer(
  content: Buffer,
  opts?: { maxChars?: number }
): Promise<{ text: string; pages?: number; truncated: boolean }> {
  const maxChars = opts?.maxChars ?? MAX_PDF_TEXT_CHARS;
  const parser = new PDFParse({ data: content });
  try {
    const result = await parser.getText();
    const raw = (result?.text ?? "").replace(/\u0000/g, " ").trim();
    const collapsed = raw.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
    const truncated = collapsed.length > maxChars;
    return {
      text: truncated ? collapsed.slice(0, maxChars) : collapsed,
      pages: typeof result?.total === "number" ? result.total : undefined,
      truncated,
    };
  } finally {
    try {
      await parser.destroy();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Extract text from PDF attachments on an email (mailparser shape).
 */
export async function extractTextFromPdfAttachments(
  attachments: PdfAttachmentInput[] | null | undefined
): Promise<{
  texts: PdfExtractResult[];
  combinedText: string;
  pdfCount: number;
}> {
  const list = Array.isArray(attachments) ? attachments : [];
  const pdfs = list.filter(isPdfAttachment).slice(0, MAX_PDF_ATTACHMENTS);
  const texts: PdfExtractResult[] = [];

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
      texts.push({
        filename,
        text: extracted.text,
        pages: extracted.pages,
        truncated: extracted.truncated,
        error: extracted.text ? undefined : "no_text_layer",
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
    .map(
      (t) =>
        `--- PDF attachment: ${t.filename}${t.pages ? ` (${t.pages} pages)` : ""}${t.truncated ? " [truncated]" : ""} ---\n${t.text}`
    );

  return {
    texts,
    combinedText: combinedParts.join("\n\n"),
    pdfCount: pdfs.length,
  };
}

/** Merge email body + PDF text for AI parse (keeps body first). */
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
