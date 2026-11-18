import { describe, expect, it } from "vitest";
import {
  buildSignedQuotePrintPath,
  buildSignedQuotePrintUrl,
} from "./signConfirmation";

describe("signConfirmation print URL", () => {
  it("builds a public print path from the sign token", () => {
    expect(buildSignedQuotePrintPath("abc_Token-1")).toBe(
      "/print/sign/abc_Token-1"
    );
  });

  it("encodes special characters in the token", () => {
    expect(buildSignedQuotePrintPath("a/b c")).toBe("/print/sign/a%2Fb%20c");
  });

  it("joins base URL without a trailing slash", () => {
    expect(buildSignedQuotePrintUrl("https://jdsys.biz/", "tok")).toBe(
      "https://jdsys.biz/print/sign/tok"
    );
  });

  it("rejects empty tokens", () => {
    expect(() => buildSignedQuotePrintPath("  ")).toThrow(/signToken/);
  });
});
