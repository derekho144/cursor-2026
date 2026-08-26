import { describe, expect, it } from "vitest";
import {
  extractTextFromPdfBuffer,
  mergeEmailBodyWithPdfText,
  extractTextFromPdfAttachments,
} from "./emailPdfAttachments";
import PDFDocument from "pdfkit";

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
  });
});

describe("extractTextFromPdfAttachments", () => {
  it("skips non-pdf and extracts pdf", async () => {
    const buf = await makeSimplePdf(
      "Need product shoot 30 SKUs white background"
    );
    const out = await extractTextFromPdfAttachments([
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
});
