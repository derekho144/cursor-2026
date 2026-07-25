/**
 * Unit tests for generateAIMeetingDraft and buildFallbackMeetingDraft helpers
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock invokeLLM before importing the module under test
vi.mock("./_core/llm", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    invokeLLM: vi.fn(),
  };
});

import { generateAIMeetingDraft, buildFallbackMeetingDraft } from "./routers/emailInquiries";
import { invokeLLM } from "./_core/llm";

const mockInvokeLLM = vi.mocked(invokeLLM);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildFallbackMeetingDraft", () => {
  it("returns a draft starting with Dear <clientName>", () => {
    const draft = buildFallbackMeetingDraft("Alice");
    expect(draft).toContain("Dear Alice,");
    expect(draft).toContain("JD STUDIO HK");
    expect(draft).toContain("9153 1976");
    expect(draft).toContain("jdstudiohk.com");
  });

  it("uses Sir/Madam when no name provided", () => {
    const draft = buildFallbackMeetingDraft("Sir/Madam");
    expect(draft).toContain("Dear Sir/Madam,");
  });
});

describe("generateAIMeetingDraft", () => {
  it("returns the LLM-generated draft", async () => {
    const fakeDraft = "Dear John,\n\nThank you for your inquiry about product photography.\n\nBest regards,\nDerek\nJD STUDIO HK\nTel No: (852) 9153 1976\nWeb: https://jdstudiohk.com/";
    mockInvokeLLM.mockResolvedValueOnce({
      choices: [{ message: { content: fakeDraft, role: "assistant" } }],
    } as any);

    const result = await generateAIMeetingDraft({
      clientName: "John",
      serviceType: "product",
      shootingDate: "2026-06-15",
      shootingLocation: "Tsim Sha Tsui",
    });

    expect(result).toBe(fakeDraft);
    expect(mockInvokeLLM).toHaveBeenCalledOnce();

    // Verify the prompt includes key context
    const callArgs = mockInvokeLLM.mock.calls[0]?.[0];
    const userMessage = callArgs?.messages?.find((m: any) => m.role === "user")?.content as string;
    expect(userMessage).toContain("product photography");
    expect(userMessage).toContain("2026-06-15");
    expect(userMessage).toContain("Tsim Sha Tsui");
    expect(userMessage).toContain("John");
  });

  it("throws when LLM returns empty content", async () => {
    mockInvokeLLM.mockResolvedValueOnce({
      choices: [{ message: { content: "", role: "assistant" } }],
    } as any);

    await expect(
      generateAIMeetingDraft({ clientName: "Bob", serviceType: "portrait" })
    ).rejects.toThrow("LLM returned empty response");
  });

  it("includes estimated budget in prompt when pricingMid is provided", async () => {
    mockInvokeLLM.mockResolvedValueOnce({
      choices: [{ message: { content: "Dear Carol,\n\nThank you.", role: "assistant" } }],
    } as any);

    await generateAIMeetingDraft({
      clientName: "Carol",
      serviceType: "corporate_event",
      pricingMid: 8000,
    });

    const callArgs = mockInvokeLLM.mock.calls[0]?.[0];
    const userMessage = callArgs?.messages?.find((m: any) => m.role === "user")?.content as string;
    expect(userMessage).toContain("HK$8,000");
    expect(userMessage).toContain("corporate event photography");
  });

  it("handles unknown serviceType gracefully", async () => {
    mockInvokeLLM.mockResolvedValueOnce({
      choices: [{ message: { content: "Dear Dave,\n\nThank you.", role: "assistant" } }],
    } as any);

    await generateAIMeetingDraft({
      clientName: "Dave",
      serviceType: "unknown_service_xyz",
    });

    const callArgs = mockInvokeLLM.mock.calls[0]?.[0];
    const userMessage = callArgs?.messages?.find((m: any) => m.role === "user")?.content as string;
    // Falls back to the raw serviceType string
    expect(userMessage).toContain("unknown_service_xyz");
  });
});
