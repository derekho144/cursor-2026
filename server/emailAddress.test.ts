import { describe, expect, it } from "vitest";
import { normalizeEmailAddress } from "./resendEmail";

describe("quote email recipient normalization", () => {
  it("trims surrounding whitespace before sending", () => {
    expect(normalizeEmailAddress("  cathy.chan@shopline.com  ")).toBe("cathy.chan@shopline.com");
  });

  it("rejects malformed recipient addresses before any provider call", () => {
    expect(() => normalizeEmailAddress("cathy.chan@shopline")).toThrow("收件人電郵地址格式不正確");
    expect(() => normalizeEmailAddress("cathy.chan shopline.com")).toThrow("收件人電郵地址格式不正確");
  });
});
