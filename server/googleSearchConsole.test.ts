import { describe, expect, it } from "vitest";
import { DEFAULT_GSC_SITE_URL, gscOAuthScope } from "./googleSearchConsole";

describe("googleSearchConsole helpers", () => {
  it("uses webmasters.readonly scope", () => {
    expect(gscOAuthScope()).toBe("https://www.googleapis.com/auth/webmasters.readonly");
  });

  it("defaults site URL to jdstudiohk www", () => {
    expect(DEFAULT_GSC_SITE_URL).toContain("jdstudiohk.com");
  });
});
