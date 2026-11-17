import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./sdk", () => ({
  sdk: {
    authenticateRequest: vi.fn(),
  },
}));

import { sdk } from "./sdk";
import { requireLoggedInSession } from "./requireSession";

describe("requireLoggedInSession", () => {
  beforeEach(() => {
    vi.mocked(sdk.authenticateRequest).mockReset();
  });

  it("rejects missing/invalid sessions", async () => {
    vi.mocked(sdk.authenticateRequest).mockRejectedValue(new Error("no cookie"));
    expect(await requireLoggedInSession({} as any)).toBeNull();
  });

  it("rejects cron sessions", async () => {
    vi.mocked(sdk.authenticateRequest).mockResolvedValue({
      id: -1,
      role: "user",
      isCron: true,
      isActive: true,
    } as any);
    expect(await requireLoggedInSession({} as any)).toBeNull();
  });

  it("accepts active interactive users", async () => {
    const user = {
      id: 7,
      role: "admin",
      isCron: false,
      isActive: true,
    } as any;
    vi.mocked(sdk.authenticateRequest).mockResolvedValue(user);
    expect(await requireLoggedInSession({} as any)).toBe(user);
  });
});
