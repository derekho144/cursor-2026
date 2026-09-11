import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { getSessionCookieOptions } from "./cookies";

function mockReq(opts: {
  protocol?: string;
  forwardedProto?: string | string[];
}): Request {
  return {
    protocol: opts.protocol ?? "http",
    headers: {
      "x-forwarded-proto": opts.forwardedProto,
    },
  } as unknown as Request;
}

describe("getSessionCookieOptions", () => {
  it("uses SameSite=Lax on HTTPS so first-party login cookies stick", () => {
    const opts = getSessionCookieOptions(
      mockReq({ protocol: "https" })
    );
    expect(opts.sameSite).toBe("lax");
    expect(opts.secure).toBe(true);
    expect(opts.httpOnly).toBe(true);
    expect(opts.path).toBe("/");
  });

  it("detects HTTPS via x-forwarded-proto (Railway / Manus proxy)", () => {
    const opts = getSessionCookieOptions(
      mockReq({ protocol: "http", forwardedProto: "https" })
    );
    expect(opts.secure).toBe(true);
    expect(opts.sameSite).toBe("lax");
  });

  it("keeps Lax on plain HTTP local dev", () => {
    const opts = getSessionCookieOptions(mockReq({ protocol: "http" }));
    expect(opts.sameSite).toBe("lax");
    expect(opts.secure).toBe(false);
  });
});
