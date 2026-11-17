import { describe, expect, it } from "vitest";
import {
  DEFAULT_GSC_SITE_URL,
  resolveGscSiteUrl,
} from "./googleSearchConsole";

describe("resolveGscSiteUrl", () => {
  it("prefers www URL-prefix over sc-domain", () => {
    const url = resolveGscSiteUrl([
      { siteUrl: "sc-domain:jdstudiohk.com", permissionLevel: "siteFullUser" },
      {
        siteUrl: "https://www.jdstudiohk.com/",
        permissionLevel: "siteOwner",
      },
    ]);
    expect(url).toBe("https://www.jdstudiohk.com/");
  });

  it("uses sc-domain only when no https property exists", () => {
    expect(
      resolveGscSiteUrl([
        { siteUrl: "sc-domain:jdstudiohk.com", permissionLevel: "siteOwner" },
      ])
    ).toBe("sc-domain:jdstudiohk.com");
  });

  it("honours explicit preferred when present in list", () => {
    expect(
      resolveGscSiteUrl(
        [
          { siteUrl: "https://www.jdstudiohk.com/" },
          { siteUrl: "sc-domain:jdstudiohk.com" },
        ],
        "sc-domain:jdstudiohk.com"
      )
    ).toBe("sc-domain:jdstudiohk.com");
  });

  it("falls back to DEFAULT when list empty", () => {
    expect(resolveGscSiteUrl([])).toBe(DEFAULT_GSC_SITE_URL);
  });
});
