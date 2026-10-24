import { describe, expect, it } from "vitest";
import {
  extractWaRefCode,
  generateWaRefCode,
  waMeUrlWithPrefill,
} from "./waTracking";

describe("WA ref codes", () => {
  it("generates W + 4 safe chars", () => {
    const code = generateWaRefCode();
    expect(code).toMatch(/^W[2-9A-HJ-NP-Z]{4}$/);
  });

  it("extracts code from full first-line prefill", () => {
    expect(
      extractWaRefCode("你好，我想查詢JD Studio的攝影服務（W7K3M）")
    ).toBe("W7K3M");
    expect(extractWaRefCode("w7k3m")).toBe("W7K3M");
    expect(extractWaRefCode("no code here")).toBeNull();
  });

  it("appends ref to website prefill URL", () => {
    const url = waMeUrlWithPrefill("website", { refCode: "W7K3M" });
    const text = decodeURIComponent(new URL(url).searchParams.get("text") || "");
    expect(text).toContain("你好，我想查詢JD Studio的攝影服務");
    expect(text).toContain("（W7K3M）");
    expect(text.toLowerCase()).not.toContain("google");
  });
});
