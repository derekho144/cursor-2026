import { describe, expect, it } from "vitest";
import { isOcrEnabled } from "./emailAttachmentOcr";

describe("emailAttachmentOcr", () => {
  it("is enabled by default", () => {
    const prev = process.env.EMAIL_ATTACHMENT_OCR;
    delete process.env.EMAIL_ATTACHMENT_OCR;
    expect(isOcrEnabled()).toBe(true);
    process.env.EMAIL_ATTACHMENT_OCR = prev;
  });

  it("can be disabled via env", () => {
    const prev = process.env.EMAIL_ATTACHMENT_OCR;
    process.env.EMAIL_ATTACHMENT_OCR = "0";
    expect(isOcrEnabled()).toBe(false);
    process.env.EMAIL_ATTACHMENT_OCR = prev;
  });
});
