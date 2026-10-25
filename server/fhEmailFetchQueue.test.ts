import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./scrapers/freehunterBoard", () => ({
  fetchEmailForJob: vi.fn(async (jobId: string) => {
    if (jobId === "fail") return { email: null, error: "no email" };
    await new Promise((r) => setTimeout(r, 20));
    return { email: `${jobId}@example.com` };
  }),
}));

import {
  startFhEmailFetch,
  getFhEmailFetchStatus,
  _resetFhEmailFetchQueueForTests,
} from "./fhEmailFetchQueue";

describe("fhEmailFetchQueue", () => {
  beforeEach(() => {
    _resetFhEmailFetchQueueForTests();
  });

  it("returns immediately and marks running then ok", async () => {
    const kick = startFhEmailFetch("35606");
    expect(kick.started).toBe(true);
    expect(kick.alreadyRunning).toBe(false);
    expect(getFhEmailFetchStatus("35606")?.status).toBe("running");

    const again = startFhEmailFetch("35606");
    expect(again.started).toBe(false);
    expect(again.alreadyRunning).toBe(true);

    await new Promise((r) => setTimeout(r, 50));
    const done = getFhEmailFetchStatus("35606");
    expect(done?.status).toBe("ok");
    expect(done?.email).toBe("35606@example.com");
  });

  it("records error when fetch returns no email", async () => {
    startFhEmailFetch("fail");
    await new Promise((r) => setTimeout(r, 40));
    const st = getFhEmailFetchStatus("fail");
    expect(st?.status).toBe("error");
    expect(st?.error).toContain("no email");
  });

  it("reclaims stale running jobs so a retry can start", async () => {
    const kick = startFhEmailFetch("slow");
    expect(kick.started).toBe(true);
    const running = getFhEmailFetchStatus("slow");
    expect(running?.status).toBe("running");
    // Force startedAt into the past beyond STALE_RUNNING_MS (110s)
    (running as { startedAt: number }).startedAt = Date.now() - 120_000;

    const again = startFhEmailFetch("slow");
    expect(again.started).toBe(true);
    expect(again.alreadyRunning).toBe(false);
    expect(getFhEmailFetchStatus("slow")?.status).toBe("running");
  });
});
