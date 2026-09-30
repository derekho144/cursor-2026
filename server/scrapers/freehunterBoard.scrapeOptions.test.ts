import { describe, expect, it } from "vitest";
import { resolveScrapeOptions } from "./freehunterBoard";

describe("resolveScrapeOptions", () => {
  it("legacy true → fetchEmails with capped fetches", () => {
    const o = resolveScrapeOptions(true, 20);
    expect(o.fetchEmails).toBe(true);
    expect(o.maxJobs).toBe(20);
    expect(o.maxEmailFetches).toBe(8);
  });

  it("legacy false → no email fetches (scheduled path)", () => {
    const o = resolveScrapeOptions(false, 40);
    expect(o.fetchEmails).toBe(false);
    expect(o.maxJobs).toBe(40);
    expect(o.maxEmailFetches).toBe(0);
  });

  it("options object discovery-first", () => {
    const o = resolveScrapeOptions({
      fetchEmails: false,
      maxJobs: 40,
      skipPlaywrightBackup: true,
      deadlineMs: 7 * 60 * 1000,
    });
    expect(o.fetchEmails).toBe(false);
    expect(o.maxEmailFetches).toBe(0);
    expect(o.skipPlaywrightBackup).toBe(true);
    expect(o.deadlineMs).toBe(7 * 60 * 1000);
  });
});
