import { describe, expect, it } from "vitest";
import { hellotobyApiErrorDetail } from "./hellotobyApi";

describe("hellotobyApiErrorDetail", () => {
  it("prefers errorMessage from live HelloToby API", () => {
    expect(
      hellotobyApiErrorDetail({
        success: false,
        errorCode: "00000",
        errorMessage: "請登錄后再執行。",
      })
    ).toBe("請登錄后再執行。");
  });

  it("falls back to message / error / msg", () => {
    expect(hellotobyApiErrorDetail({ success: false, message: "nope" })).toBe("nope");
    expect(hellotobyApiErrorDetail({ success: false, error: "err" })).toBe("err");
    expect(hellotobyApiErrorDetail({ success: false, msg: "m" })).toBe("m");
  });

  it("uses errorCode when no text", () => {
    expect(hellotobyApiErrorDetail({ success: false, errorCode: "00000" })).toBe("errorCode=00000");
  });

  it("uses fallback for empty body", () => {
    expect(hellotobyApiErrorDetail(null)).toBe("success=false");
    expect(hellotobyApiErrorDetail({})).toBe("success=false");
  });
});
