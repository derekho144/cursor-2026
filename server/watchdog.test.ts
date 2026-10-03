import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn(async () => true),
}));

vi.mock("./db", () => ({
  getDb: vi.fn(async () => null),
}));

vi.mock("./freehunter", () => ({
  getFreehunterStatus: vi.fn(async () => ({ connected: true, expiresAt: Date.now() + 10 * 24 * 3600_000 })),
  renewFreehunterSessionExpiry: vi.fn(async () => {}),
  getOrLoginFreehunter: vi.fn(async () => ({ cookies: [], userId: 1, email: "t@example.com" })),
  closeFreehunterBrowserSession: vi.fn(async () => {}),
}));

vi.mock("./scrapers/freehunterBoard", () => ({
  fetchEmailForJob: vi.fn(async () => ({ email: null })),
}));

vi.mock("./routers/emailInquiries", () => ({
  sendFHFirstEmail: vi.fn(async () => ({ success: false })),
}));

vi.mock("./schedulerLock", () => ({
  withSchedulerLock: vi.fn(async (_key: string, _ttl: number, fn: () => Promise<void>) => fn()),
}));

vi.mock("./scheduler", () => ({
  lastFreehunterScrapeAt: new Date(),
  lastGmailScanAt: new Date(),
  getPersistedFreehunterScrapeStatus: vi.fn(async () => ({
    at: new Date(),
    ok: true,
    newJobs: 0,
    emailsFetched: 0,
    raw: "ok:0/0",
  })),
  getPersistedGmailScanStatus: vi.fn(async () => ({
    at: new Date(),
    ok: true,
    raw: "ok:0/0",
  })),
  runScheduledFreehunterScrape: vi.fn(async () => {}),
  runScheduledGmailScan: vi.fn(async () => {}),
}));

describe("watchdog silent heal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs without notifying when session and scans are healthy", async () => {
    const { notifyOwner } = await import("./_core/notification");
    const { runWatchdog, getWatchdogStatus } = await import("./watchdog");

    await runWatchdog();

    expect(notifyOwner).not.toHaveBeenCalled();
    const status = getWatchdogStatus();
    expect(status.lastRunAt).toBeInstanceOf(Date);
  });
});
