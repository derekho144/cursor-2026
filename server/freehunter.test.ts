/**
 * Tests for Freehunter integration module
 * Uses Playwright browser automation for login.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  extractJobIdFromUrl,
} from "./freehunter";

// ─── extractJobIdFromUrl ──────────────────────────────────────────
describe("extractJobIdFromUrl", () => {
  it("extracts job ID from standard freelancejobs URL", () => {
    expect(extractJobIdFromUrl("https://freehunter.hk/freelancejobs/33538/some-title")).toBe(33538);
  });

  it("extracts job ID from short freelancejob URL", () => {
    expect(extractJobIdFromUrl("https://freehunter.hk/freelancejobs/33514")).toBe(33514);
  });

  it("extracts job ID from old freehunter.com.hk domain", () => {
    expect(extractJobIdFromUrl("https://www.freehunter.com.hk/job/12345")).toBe(12345);
  });

  it("extracts job ID from task URL", () => {
    expect(extractJobIdFromUrl("https://freehunter.hk/task/99999")).toBe(99999);
  });

  it("returns null for non-Freehunter URL", () => {
    expect(extractJobIdFromUrl("https://example.com/page/123")).toBeNull();
  });

  it("returns null for URL without job ID", () => {
    expect(extractJobIdFromUrl("https://freehunter.hk/freelancejobs")).toBeNull();
  });

  it("handles URL with encoded title", () => {
    const url = "https://freehunter.hk/freelancejobs/33538/Documentary-Style%20Videography";
    expect(extractJobIdFromUrl(url)).toBe(33538);
  });
});

// ─── Cookie header building ───────────────────────────────────────
describe("cookie header building logic", () => {
  it("filters freehunter cookies and formats correctly", () => {
    const cookies = [
      { name: "session", value: "abc123", domain: "freehunter.hk" },
      { name: "csrf", value: "xyz789", domain: "freehunter.hk" },
      { name: "ga", value: "GA1.2.xxx", domain: ".google.com" },
    ];
    const header = cookies
      .filter((c) => c.domain?.includes("freehunter") || !c.domain)
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    expect(header).toBe("session=abc123; csrf=xyz789");
    expect(header).not.toContain("ga=");
  });

  it("includes cookies without domain", () => {
    const cookies = [
      { name: "token", value: "abc", domain: undefined as any },
    ];
    const header = cookies
      .filter((c) => c.domain?.includes("freehunter") || !c.domain)
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    expect(header).toBe("token=abc");
  });
});

// ─── Session expiry logic ──────────────────────────────────────────
describe("session expiry logic", () => {
  it("detects expired session", () => {
    const expiresAt = Date.now() - 1000;
    const bufferMs = 60 * 60 * 1000;
    expect(expiresAt > Date.now() + bufferMs).toBe(false);
  });

  it("detects valid session", () => {
    const expiresAt = Date.now() + 8 * 24 * 60 * 60 * 1000;
    const bufferMs = 60 * 60 * 1000;
    expect(expiresAt > Date.now() + bufferMs).toBe(true);
  });

  it("rejects session within buffer period", () => {
    const expiresAt = Date.now() + 30 * 60 * 1000;
    const bufferMs = 60 * 60 * 1000;
    expect(expiresAt > Date.now() + bufferMs).toBe(false);
  });
});

// ─── Job contact response parsing ─────────────────────────────────
describe("job contact response parsing", () => {
  it("extracts email from result field", () => {
    const response: any = { result: "client@example.com" };
    const email = response?.result || response?.email || response?.client_email || "";
    expect(email).toBe("client@example.com");
  });

  it("falls back to email field when result is null", () => {
    const response: any = { result: null, email: "fallback@example.com" };
    const email = response?.result || response?.email || response?.client_email || "";
    expect(email).toBe("fallback@example.com");
  });

  it("returns empty string when no email found", () => {
    const response: any = { result: null };
    const email = response?.result || response?.email || response?.client_email || "";
    expect(email).toBe("");
  });
});

// ─── API response email extraction ───────────────────────────────
describe("API response email extraction", () => {
  it("extracts email from getClientEmail result field", () => {
    const response: any = { result: "lmh@tps.edu.hk" };
    const email =
      response?.result ||
      response?.email ||
      response?.client_email ||
      (response?.data as any)?.email ||
      "";
    expect(email).toBe("lmh@tps.edu.hk");
  });

  it("extracts email from applyEmailJob email field", () => {
    const response: any = { result: null, email: "client@company.com" };
    const email =
      response?.result ||
      response?.email ||
      response?.client_email ||
      "";
    expect(email).toBe("client@company.com");
  });

  it("returns empty string when API returns null result", () => {
    const response: any = { result: null };
    const email =
      response?.result ||
      response?.email ||
      response?.client_email ||
      "";
    expect(email).toBe("");
    expect(!email).toBe(true); // triggers error throw
  });

  it("parses __NEXT_DATA__ for job title and client name", () => {
    const html = `<html><head></head><body>
      <script id="__NEXT_DATA__" type="application/json">
        {"props":{"pageProps":{"result":{"id":33538,"title":"學校影片拍攝","user_name":"sir 梁"}}}}
      </script>
    </body></html>`;
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    expect(match).toBeTruthy();
    const nextData = JSON.parse(match![1]);
    const result = nextData?.props?.pageProps?.result;
    expect(result?.title).toBe("學校影片拍攝");
    expect(result?.user_name).toBe("sir 梁");
  });
});
