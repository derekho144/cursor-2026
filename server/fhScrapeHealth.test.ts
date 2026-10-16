import { describe, expect, it } from "vitest";
import { computeFhScrapeHealth } from "./fhScrapeHealth";
import { parsePersistedFhScrapeRaw } from "./scheduler";

describe("computeFhScrapeHealth", () => {
  const base = {
    sessionConnected: true,
    scrapeStale: false,
    lastScrapeOk: true as boolean | null,
    newJobs: 2,
    emailsFetched: 1,
    discovered: 10 as number | null,
    lastScrapedAt: new Date(),
  };

  it("ok when scrape found new jobs", () => {
    const v = computeFhScrapeHealth(base);
    expect(v.level).toBe("ok");
    expect(v.tone).toBe("ok");
    expect(v.title).toContain("正常");
  });

  it("caught_up when saw board but no new jobs", () => {
    const v = computeFhScrapeHealth({ ...base, newJobs: 0, emailsFetched: 0, discovered: 12 });
    expect(v.level).toBe("caught_up");
    expect(v.tone).toBe("ok");
    expect(v.title).toContain("已追上");
    expect(v.title).toContain("12");
  });

  it("failed when last scrape ok=false", () => {
    const v = computeFhScrapeHealth({ ...base, lastScrapeOk: false, newJobs: 0 });
    expect(v.level).toBe("failed");
    expect(v.tone).toBe("bad");
    expect(v.title).toContain("失敗");
  });

  it("failed (blind) when ok but discovered=0 — never claim 正常", () => {
    const v = computeFhScrapeHealth({
      ...base,
      newJobs: 0,
      emailsFetched: 0,
      discovered: 0,
    });
    expect(v.level).toBe("failed");
    expect(v.tone).toBe("bad");
    expect(v.title).not.toContain("正常");
    expect(v.title).toMatch(/睇唔到|異常/);
  });

  it("ambiguous for legacy ok:0/0 without discovered (screenshot case)", () => {
    const v = computeFhScrapeHealth({
      ...base,
      newJobs: 0,
      emailsFetched: 0,
      discovered: null,
    });
    expect(v.level).toBe("ambiguous");
    expect(v.tone).toBe("warn");
    expect(v.title).not.toBe("爬取狀態正常");
    expect(v.title).toMatch(/\+0|未能確認/);
  });

  it("stale overrides caught_up when scrape clock is old", () => {
    const v = computeFhScrapeHealth({
      ...base,
      scrapeStale: true,
      newJobs: 0,
      discovered: 5,
    });
    expect(v.level).toBe("stale");
    expect(v.tone).toBe("bad");
  });

  it("session_down warns when scrape ok but session dead", () => {
    const v = computeFhScrapeHealth({
      ...base,
      sessionConnected: false,
      newJobs: 1,
      discovered: 8,
    });
    expect(v.level).toBe("session_down");
    expect(v.tone).toBe("warn");
  });

  it("unknown when no signals", () => {
    const v = computeFhScrapeHealth({
      sessionConnected: false,
      scrapeStale: true,
      lastScrapeOk: null,
      newJobs: null,
      emailsFetched: null,
      discovered: null,
      lastScrapedAt: null,
    });
    expect(v.level).toBe("unknown");
    expect(v.tone).toBe("warn");
  });
});

describe("parsePersistedFhScrapeRaw", () => {
  it("parses new ok:new/emails/discovered", () => {
    expect(parsePersistedFhScrapeRaw("ok:2/1/15")).toEqual({
      ok: true,
      newJobs: 2,
      emailsFetched: 1,
      discovered: 15,
    });
  });

  it("parses legacy ok:new/emails with discovered=null", () => {
    expect(parsePersistedFhScrapeRaw("ok:0/0")).toEqual({
      ok: true,
      newJobs: 0,
      emailsFetched: 0,
      discovered: null,
    });
  });

  it("parses fail:", () => {
    expect(parsePersistedFhScrapeRaw("fail:board empty")).toEqual({
      ok: false,
      newJobs: null,
      emailsFetched: null,
      discovered: null,
    });
  });
});
