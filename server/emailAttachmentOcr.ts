/**
 * OCR for scanned PDF pages and image email attachments.
 * Uses tesseract.js (chi_tra + eng) and pdfjs-dist + @napi-rs/canvas.
 */
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { createWorker, type Worker } from "tesseract.js";

export const MAX_OCR_PAGES_PER_PDF = 3;
export const MIN_TEXT_LAYER_CHARS_FOR_OCR_SKIP = 40;
export const OCR_LANGUAGES = ["eng", "chi_tra"] as const;

let ocrWorkerPromise: Promise<Worker> | null = null;

export function isOcrEnabled(): boolean {
  const raw = process.env.EMAIL_ATTACHMENT_OCR?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
}

async function getOcrWorker(): Promise<Worker> {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      const worker = await createWorker([...OCR_LANGUAGES]);
      return worker;
    })();
  }
  return ocrWorkerPromise;
}

/** OCR a PNG/JPEG buffer to plain text. */
export async function ocrImageBuffer(
  imageBuffer: Buffer,
  opts?: { timeoutMs?: number }
): Promise<string> {
  if (!isOcrEnabled()) return "";
  const timeoutMs = opts?.timeoutMs ?? 90_000;
  const worker = await getOcrWorker();
  const task = worker.recognize(imageBuffer);
  const result = await Promise.race([
    task,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("ocr_timeout")), timeoutMs)
    ),
  ]);
  return (result.data.text ?? "")
    .replace(/\u0000/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Render one PDF page to PNG for OCR. */
export async function renderPdfPageToPng(
  pdfBytes: Buffer,
  pageNumber: number,
  scale = 2
): Promise<Buffer> {
  const data = new Uint8Array(pdfBytes);
  const doc = await pdfjs
    .getDocument({
      data,
      disableWorker: true,
      useSystemFonts: true,
    } as Parameters<typeof pdfjs.getDocument>[0])
    .promise;
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(
    Math.ceil(viewport.width),
    Math.ceil(viewport.height)
  );
  const ctx = canvas.getContext("2d");
  await page.render({
    canvasContext: ctx as unknown as CanvasRenderingContext2D,
    viewport,
    canvas: canvas as unknown as HTMLCanvasElement,
  }).promise;
  return canvas.toBuffer("image/png");
}

/**
 * OCR up to maxPages of a PDF (for scanned / image-only PDFs).
 */
export async function ocrPdfBuffer(
  pdfBytes: Buffer,
  opts?: { maxPages?: number; maxChars?: number }
): Promise<{ text: string; pagesOcrd: number; truncated: boolean }> {
  if (!isOcrEnabled()) {
    return { text: "", pagesOcrd: 0, truncated: false };
  }
  const maxPages = opts?.maxPages ?? MAX_OCR_PAGES_PER_PDF;
  const maxChars = opts?.maxChars ?? 12_000;
  const data = new Uint8Array(pdfBytes);
  const doc = await pdfjs
    .getDocument({
      data,
      disableWorker: true,
      useSystemFonts: true,
    } as Parameters<typeof pdfjs.getDocument>[0])
    .promise;
  const pageCount = Math.min(doc.numPages, maxPages);
  const parts: string[] = [];

  for (let p = 1; p <= pageCount; p++) {
    try {
      const png = await renderPdfPageToPng(pdfBytes, p);
      const pageText = await ocrImageBuffer(png, { timeoutMs: 60_000 });
      if (pageText.trim()) {
        parts.push(`[Page ${p}]\n${pageText}`);
      }
    } catch (e) {
      console.warn(`[EmailOCR] PDF page ${p} OCR failed:`, e);
    }
  }

  const combined = parts.join("\n\n");
  const truncated = combined.length > maxChars;
  return {
    text: truncated ? combined.slice(0, maxChars) : combined,
    pagesOcrd: pageCount,
    truncated,
  };
}
