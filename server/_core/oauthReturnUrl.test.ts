import { describe, expect, it } from "vitest";
import { resolveTrustedOAuthReturn, trustedOAuthOrigins } from "./oauthReturnUrl";
import { ENV } from "./env";

describe("resolveTrustedOAuthReturn", () => {
  it("allowlists app/public base origins", () => {
    const allowed = trustedOAuthOrigins();
    expect(allowed.length).toBeGreaterThan(0);
    expect(allowed).toContain(new URL(ENV.appBaseUrl).origin);
  });

  it("rejects attacker state origins (open redirect)", () => {
    const r = resolveTrustedOAuthReturn("https://evil.example/phish");
    expect(r.appOrigin).not.toContain("evil.example");
    expect(r.appOrigin).toBe(new URL(ENV.appBaseUrl).origin);
    expect(r.returnPath).toBe("/ad-sync");
  });

  it("keeps path when state is on a trusted origin", () => {
    const origin = new URL(ENV.appBaseUrl).origin;
    const r = resolveTrustedOAuthReturn(`${origin}/ad-sync?x=1`);
    expect(r.appOrigin).toBe(origin);
    expect(r.returnPath).toBe("/ad-sync");
  });

  it("falls back when state is missing or malformed", () => {
    expect(resolveTrustedOAuthReturn(undefined).returnPath).toBe("/ad-sync");
    expect(resolveTrustedOAuthReturn("not a url").appOrigin).toBe(
      new URL(ENV.appBaseUrl).origin
    );
  });
});
