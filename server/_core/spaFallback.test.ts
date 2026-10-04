import { describe, expect, it } from "vitest";
import { shouldSpaFallback } from "./spaFallback";

describe("shouldSpaFallback", () => {
  it("blocks SPA HTML for missing Vite asset chunks", () => {
    expect(shouldSpaFallback("/assets/GrowthPriorities-djWj8Yy5.js")).toBe(false);
    expect(shouldSpaFallback("/assets/index-C8vfdTjB.js?v=1")).toBe(false);
    expect(shouldSpaFallback("/assets/index-zDDV_QZ7.css")).toBe(false);
  });

  it("blocks SPA HTML for other static file extensions", () => {
    expect(shouldSpaFallback("/favicon.ico")).toBe(false);
    expect(shouldSpaFallback("/deploy-revision.txt")).toBe(false);
    expect(shouldSpaFallback("/manifest.webmanifest")).toBe(false);
  });

  it("allows SPA HTML for app routes", () => {
    expect(shouldSpaFallback("/")).toBe(true);
    expect(shouldSpaFallback("/growth-priorities")).toBe(true);
    expect(shouldSpaFallback("/quotes/123?tab=1")).toBe(true);
  });
});
