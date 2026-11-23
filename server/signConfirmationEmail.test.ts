import { describe, expect, it } from "vitest";
import {
  buildSignConfirmationEmailHtml,
  buildStaffPrintQuoteUrl,
  signConfirmationBaseUrl,
} from "./signConfirmationEmail";

describe("signConfirmationEmail", () => {
  it("escapes HTML in signedByName so phishing markup cannot break out", () => {
    const html = buildSignConfirmationEmailHtml({
      signedByName: `</strong></p><p><a href="https://evil.example/pay">Pay balance</a></p><p><strong>x`,
      quoteNumber: "Q-100",
      signedDate: "2026年11月23日",
      printUrl: "https://jdsys.biz/print/quote/1",
    });
    expect(html).not.toContain(`href="https://evil.example/pay"`);
    expect(html).toContain("&lt;/strong&gt;");
    expect(html).toContain("https://evil.example/pay"); // escaped text may still mention host as text via &quot; path — check raw tag absent
    expect(html).not.toMatch(/<a href="https:\/\/evil\.example/);
  });

  it("escapes quoteNumber and printUrl attribute breakouts", () => {
    const html = buildSignConfirmationEmailHtml({
      signedByName: "Alex",
      quoteNumber: `Q"><img src=x onerror=alert(1)>`,
      signedDate: "today",
      printUrl: `https://jdsys.biz/print/quote/1" onclick="alert(1)`,
    });
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain('onclick="alert(1)');
    expect(html).toContain("&quot;");
  });

  it("builds print URLs on the trusted public base, never a client origin", () => {
    const base = signConfirmationBaseUrl();
    expect(base).toMatch(/^https?:\/\//);
    expect(buildStaffPrintQuoteUrl(42)).toBe(`${base}/print/quote/42`);
    expect(buildStaffPrintQuoteUrl(42)).not.toContain("evil.example");
  });
});
