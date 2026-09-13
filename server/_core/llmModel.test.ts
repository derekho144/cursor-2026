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

  it("defaults ad analysis model to gpt-5", async () => {
    vi.stubEnv("LLM_MODEL_AD_ANALYSIS", "");
    const { ENV } = await import("./env");
    expect(ENV.llmModelAdAnalysis).toBe("gpt-5");
  });

  it("respects LLM_MODEL_AD_ANALYSIS override", async () => {
    vi.stubEnv("LLM_MODEL_AD_ANALYSIS", "gpt-5.6");
    const { ENV } = await import("./env");
    expect(ENV.llmModelAdAnalysis).toBe("gpt-5.6");
  });
});
