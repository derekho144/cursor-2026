import { describe, expect, it } from "vitest";
import { isChunkLoadError } from "./lazyRetry";

describe("isChunkLoadError", () => {
  it("detects browser module import failures after stale deploys", () => {
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://jdsys.biz/assets/x.js"))).toBe(true);
    expect(isChunkLoadError(new Error("Loading chunk GrowthPriorities failed"))).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isChunkLoadError(new Error("Network Error"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});
