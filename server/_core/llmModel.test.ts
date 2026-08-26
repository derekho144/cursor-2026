import { describe, expect, it, afterEach, vi } from "vitest";

describe("LLM model selection", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("defaults to gemini-2.5-pro", async () => {
    vi.stubEnv("LLM_MODEL", "");
    const { ENV } = await import("./env");
    expect(ENV.llmModel).toBe("gemini-2.5-pro");
  });

  it("respects LLM_MODEL override", async () => {
    vi.stubEnv("LLM_MODEL", "gemini-2.5-flash");
    const { ENV } = await import("./env");
    expect(ENV.llmModel).toBe("gemini-2.5-flash");
  });
});
