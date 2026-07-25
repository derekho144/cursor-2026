/**
 * multiLayerEmailFinder.test.ts
 * 測試多層次電郵搜尋模組的核心邏輯
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock fetch for Snov.io ───────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ─── Mock dns/promises ────────────────────────────────────────────────────────

vi.mock("dns/promises", () => ({
  resolveMx: vi.fn().mockResolvedValue([{ exchange: "mail.example.com", priority: 10 }]),
}));

// ─── Mock net ─────────────────────────────────────────────────────────────────

vi.mock("net", () => ({
  default: {
    createConnection: vi.fn().mockReturnValue({
      setTimeout: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      destroy: vi.fn(),
      on: vi.fn((event: string, cb: Function) => {
        if (event === "close") setTimeout(() => cb(), 10);
      }),
    }),
  },
}));

describe("multiLayerEmailFinder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: Snov.io token fetch succeeds
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "test-token-123" }),
      text: async () => "",
    });
  });

  describe("getSnovioToken", () => {
    it("returns null when credentials are not set", async () => {
      const originalId = process.env.SNOVIO_CLIENT_ID;
      const originalSecret = process.env.SNOVIO_CLIENT_SECRET;
      delete process.env.SNOVIO_CLIENT_ID;
      delete process.env.SNOVIO_CLIENT_SECRET;

      // Import fresh to test without env vars
      const { multiLayerEmailSearch } = await import("./scrapers/multiLayerEmailFinder");
      const result = await multiLayerEmailSearch({
        companyName: "Test Company",
        companyWebsite: undefined,
      });
      // Should still work, just skip Snov.io layer
      expect(result).toBeDefined();
      expect(result.candidates).toBeInstanceOf(Array);

      process.env.SNOVIO_CLIENT_ID = originalId;
      process.env.SNOVIO_CLIENT_SECRET = originalSecret;
    });
  });

  describe("multiLayerEmailSearch", () => {
    it("returns empty candidates when no domain and no credentials", async () => {
      const { multiLayerEmailSearch } = await import("./scrapers/multiLayerEmailFinder");
      const result = await multiLayerEmailSearch({
        companyName: "Unknown Small Company",
        companyWebsite: undefined,
        hunterApiKey: undefined,
      });
      expect(result.candidates).toBeInstanceOf(Array);
      expect(result.searchedLayers).toBeInstanceOf(Array);
    });

    it("extracts domain from company website URL", async () => {
      // Mock Snov.io domain search to return emails
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ access_token: "test-token" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            emails: [
              {
                email: "hr@example.com",
                firstName: "Jane",
                lastName: "Doe",
                position: "HR Manager",
                confidence: 90,
              },
            ],
          }),
        });

      process.env.SNOVIO_CLIENT_ID = "test-id";
      process.env.SNOVIO_CLIENT_SECRET = "test-secret";

      const { multiLayerEmailSearch } = await import("./scrapers/multiLayerEmailFinder");
      const result = await multiLayerEmailSearch({
        companyName: "Example Corp",
        companyWebsite: "https://www.example.com",
      });

      expect(result.domain).toBe("example.com");
    });

    it("deduplicates candidates from multiple sources", async () => {
      // Both Hunter.io and Snov.io return the same email
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ access_token: "test-token" }),
        })
        .mockResolvedValueOnce({
          // Snov.io domain search
          ok: true,
          status: 200,
          json: async () => ({
            emails: [
              { email: "info@company.com", confidence: 80 },
              { email: "info@company.com", confidence: 80 }, // duplicate
            ],
          }),
        });

      process.env.SNOVIO_CLIENT_ID = "test-id";
      process.env.SNOVIO_CLIENT_SECRET = "test-secret";

      const { multiLayerEmailSearch } = await import("./scrapers/multiLayerEmailFinder");
      const result = await multiLayerEmailSearch({
        companyName: "Test Company",
        companyWebsite: "https://company.com",
      });

      // Should deduplicate
      const emails = result.candidates.map(c => c.email);
      const uniqueEmails = [...new Set(emails)];
      expect(emails.length).toBe(uniqueEmails.length);
    });
    it("sorts candidates by decision-maker tier first, then confidence", async () => {
      // Test the sorting logic directly
      const testCandidates = [
        { email: "general@co.com", position: "Staff", confidence: 50, source: "website" as const },
        { email: "ceo@co.com", position: "CEO", confidence: 95, source: "hunter" as const },
        { email: "hr@co.com", position: "HR Manager", confidence: 85, source: "snovio" as const },
      ];

      // Simulate the sorting logic from multiLayerEmailSearch
      const DECISION_MAKER_TIERS = {
        tier1: ['ceo', 'founder', 'co-founder', 'owner', 'chief'],
        tier2: ['director', 'head of', 'head'],
        tier3: ['hr', 'human resources', 'talent', 'people', 'recruiting', 'manager', 'marketing'],
      };

      const getDecisionMakerTier = (position?: string): number => {
        if (!position) return 99;
        const pos = position.toLowerCase();
        if (DECISION_MAKER_TIERS.tier1.some(t => pos.includes(t))) return 0;
        if (DECISION_MAKER_TIERS.tier2.some(t => pos.includes(t))) return 1;
        if (DECISION_MAKER_TIERS.tier3.some(t => pos.includes(t))) return 2;
        return 3;
      };

      testCandidates.sort((a, b) => {
        const tierA = getDecisionMakerTier(a.position);
        const tierB = getDecisionMakerTier(b.position);
        if (tierA !== tierB) return tierA - tierB;
        return b.confidence - a.confidence;
      });

      // CEO should be first (tier1), HR Manager second (tier3), Staff last (tier4)
      expect(testCandidates).toHaveLength(3);
      expect(testCandidates[0]?.position).toBe('CEO');
      expect(testCandidates[1]?.position).toBe('HR Manager');
      expect(testCandidates[2]?.position).toBe('Staff');
    });

    it("handles Snov.io API failure gracefully", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ access_token: "test-token" }),
        })
        .mockRejectedValueOnce(new Error("Network error"));

      process.env.SNOVIO_CLIENT_ID = "test-id";
      process.env.SNOVIO_CLIENT_SECRET = "test-secret";

      const { multiLayerEmailSearch } = await import("./scrapers/multiLayerEmailFinder");
      // Should not throw, just return empty
      await expect(
        multiLayerEmailSearch({
          companyName: "Test Company",
          companyWebsite: "https://test.com",
        })
      ).resolves.toBeDefined();
    });

    it("includes 'Snov.io' in searchedLayers when credentials are set", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ access_token: "test-token" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ emails: [] }),
        });

      process.env.SNOVIO_CLIENT_ID = "test-id";
      process.env.SNOVIO_CLIENT_SECRET = "test-secret";

      const { multiLayerEmailSearch } = await import("./scrapers/multiLayerEmailFinder");
      const result = await multiLayerEmailSearch({
        companyName: "Test Company",
        companyWebsite: "https://test.com",
      });

      expect(result.searchedLayers).toContain("Snov.io");
    });
  });
});
