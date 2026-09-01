import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveFromAddress, resolveReplyTo } from "./resendEmail";

describe("email deliverability From / Reply-To", () => {
  const prev = { ...process.env };

  beforeEach(() => {
    delete process.env.RESEND_FROM_EMAIL;
    delete process.env.RESEND_FROM_OUTREACH;
    delete process.env.EMAIL_REPLY_TO;
    delete process.env.GMAIL_USER;
  });

  afterEach(() => {
    process.env = { ...prev };
  });

  it("never defaults to onboarding@resend.dev", () => {
    const from = resolveFromAddress({ purpose: "transactional" });
    expect(from.toLowerCase()).not.toContain("@resend.dev");
  });

  it("defaults transactional From to info.exposurehk@gmail.com", () => {
    const from = resolveFromAddress({ purpose: "transactional" });
    expect(from).toContain("info.exposurehk@gmail.com");
  });

  it("rejects shared resend.dev even if passed as from", () => {
    const from = resolveFromAddress({
      from: "JD Studio HK <onboarding@resend.dev>",
      purpose: "transactional",
    });
    expect(from.toLowerCase()).not.toContain("@resend.dev");
    expect(from).toContain("info.exposurehk@gmail.com");
  });

  it("uses RESEND_FROM_EMAIL when set to a real domain", () => {
    process.env.RESEND_FROM_EMAIL = "JD Studio HK <quotes@jdstudiohk.com>";
    expect(resolveFromAddress({ purpose: "transactional" })).toBe(
      "JD Studio HK <quotes@jdstudiohk.com>"
    );
  });

  it("outreach uses GMAIL_USER", () => {
    process.env.GMAIL_USER = "info.exposurehk@gmail.com";
    const from = resolveFromAddress({ purpose: "outreach" });
    expect(from).toContain("info.exposurehk@gmail.com");
  });

  it("resolveReplyTo falls back to GMAIL_USER", () => {
    process.env.GMAIL_USER = "info.exposurehk@gmail.com";
    expect(resolveReplyTo({})).toBe("info.exposurehk@gmail.com");
  });

  it("domain From still Reply-To Gmail by default", () => {
    process.env.GMAIL_USER = "info.exposurehk@gmail.com";
    process.env.RESEND_FROM_EMAIL = "JD Studio HK <info@jdstudiohk.com>";
    expect(resolveFromAddress({ purpose: "transactional" })).toContain(
      "info@jdstudiohk.com"
    );
    expect(resolveReplyTo({})).toBe("info.exposurehk@gmail.com");
  });

  it("EMAIL_REPLY_TO overrides Gmail reply mailbox", () => {
    process.env.EMAIL_REPLY_TO = "other@example.com";
    expect(resolveReplyTo({})).toBe("other@example.com");
  });
});
