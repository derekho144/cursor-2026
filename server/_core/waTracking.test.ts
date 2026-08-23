import { describe, expect, it } from "vitest";
import { WA_PREFILL, waMeUrlWithPrefill } from "./waTracking";

describe("waTracking prefills", () => {
  it("uses different natural openers for website vs email", () => {
    expect(WA_PREFILL.website).not.toBe(WA_PREFILL.email);
    expect(WA_PREFILL.website).toContain("JD Studio");
    expect(WA_PREFILL.email).not.toMatch(/email|Email|電郵|Google|FH|網站/i);
    expect(WA_PREFILL.website).not.toMatch(/email|Email|電郵/i);
  });

  it("builds wa.me URLs with encoded text", () => {
    const emailUrl = waMeUrlWithPrefill("email");
    const siteUrl = waMeUrlWithPrefill("website");
    expect(emailUrl).toContain("wa.me/85291531976?text=");
    expect(siteUrl).toContain("wa.me/85291531976?text=");
    expect(emailUrl).not.toBe(siteUrl);
    expect(decodeURIComponent(emailUrl.split("text=")[1])).toBe(WA_PREFILL.email);
    expect(decodeURIComponent(siteUrl.split("text=")[1])).toBe(WA_PREFILL.website);
  });
});
