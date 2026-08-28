import { describe, expect, it } from "vitest";
import {
  extractTextFromPdfBuffer,
  mergeEmailBodyWithPdfText,
  extractTextFromEmailAttachments,
} from "./emailPdfAttachments";
import PDFDocument from "pdfkit";
import { createCanvas } from "@napi-rs/canvas";

async function makeSimplePdf(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.font("Helvetica").fontSize(12).text(text);
    doc.end();
  });
}

/** Minimal PNG with text-like pattern for OCR smoke test (optional). */
async function makeTextPng(text: string): Promise<Buffer> {
  const canvas = createCanvas(400, 120);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 400, 120);
  ctx.fillStyle = "#000000";
  ctx.font = "24px sans-serif";
  ctx.fillText(text, 10, 60);
  return canvas.toBuffer("image/png");
}

describe("mergeEmailBodyWithPdfText", () => {
  it("returns body only when no pdf", () => {
    expect(mergeEmailBodyWithPdfText("hello", "")).toBe("hello");
  });

  it("appends pdf section", () => {
    const merged = mergeEmailBodyWithPdfText("body", "pdf contents here");
    expect(merged).toContain("body");
    expect(merged).toContain("PDF ATTACHMENT TEXT");
    expect(merged).toContain("pdf contents here");
  });
});

describe("extractTextFromPdfBuffer", () => {
  it("extracts text from a simple text-layer PDF", async () => {
    const buf = await makeSimplePdf(
      "Event photography required for 5 hours at HKCEC. Deliver 80 photos."
    );
    const result = await extractTextFromPdfBuffer(buf);
    expect(result.text.toLowerCase()).toContain("photography");
    expect(result.text.toLowerCase()).toContain("5 hours");
    expect(result.source).toBe("pdf_text");
  });
});

describe("extractTextFromEmailAttachments", () => {
  it("skips non-pdf and extracts pdf", async () => {
    const buf = await makeSimplePdf(
      "Need product shoot 30 SKUs white background"
    );
    const out = await extractTextFromEmailAttachments([
      {
        filename: "note.txt",
        contentType: "text/plain",
        content: Buffer.from("ignore"),
      },
      {
        filename: "brief.pdf",
        contentType: "application/pdf",
        content: buf,
      },
    ]);
    expect(out.pdfCount).toBe(1);
    expect(out.combinedText).toContain("brief.pdf");
    expect(out.combinedText.toLowerCase()).toContain("product");
  });

  it("OCRs image attachments", async () => {
    const png = await makeTextPng("Product shoot 25 photos");
    const out = await extractTextFromEmailAttachments([
      {
        filename: "brief.png",
        contentType: "image/png",
        content: png,
      },
    ]);
    expect(out.imageCount).toBe(1);
    expect(out.texts[0].source).toBe("image_ocr");
    // OCR may misread slightly — check for key tokens
    expect(out.combinedText.toLowerCase()).toMatch(/product|shoot|25|photo/);
  }, 60_000);
});
