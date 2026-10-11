import { describe, expect, it } from "vitest";
import { resolveSessionAccountEmail } from "./platformSessionAccount";

describe("resolveSessionAccountEmail", () => {
  it("prefers explicit incoming email", () => {
    expect(resolveSessionAccountEmail("a@x.com", "b@x.com", "fallback@session")).toBe("a@x.com");
  });

  it("preserves existing email when renewing without label", () => {
    expect(resolveSessionAccountEmail(undefined, "derekho1155@gmail.com", "hellotoby@session")).toBe(
      "derekho1155@gmail.com"
    );
  });

  it("uses fallback when nothing is stored", () => {
    expect(resolveSessionAccountEmail("", null, "hellotoby@session")).toBe("hellotoby@session");
  });
});
