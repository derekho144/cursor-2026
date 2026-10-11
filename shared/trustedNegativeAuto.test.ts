import { describe, expect, it } from "vitest";
import {
  TRUSTED_NEGATIVE_AUTO_KIND,
  buildTrustedNegativeAutoSummary,
  hktDateStringFromMs,
  isTrustedNegativeAutoEnabled,
  isTrustedNegativeAutoWindow,
  parseTrustedNegativeAutoSummary,
  shouldRunTrustedNegativeAuto,
} from "./trustedNegativeAuto";

describe("trustedNegativeAuto helpers", () => {
  it("computes HKT date", () => {
    // 2026-10-11 15:00 UTC = 2026-10-11 23:00 HKT
    expect(hktDateStringFromMs(Date.parse("2026-10-11T15:00:00.000Z"))).toBe("2026-10-11");
    // 2026-10-11 16:30 UTC = 2026-10-12 00:30 HKT
    expect(hktDateStringFromMs(Date.parse("2026-10-11T16:30:00.000Z"))).toBe("2026-10-12");
  });

  it("opens window from 10:00 HKT", () => {
    // 01:00 UTC = 09:00 HKT → closed
    expect(isTrustedNegativeAutoWindow(Date.parse("2026-10-11T01:00:00.000Z"))).toBe(false);
    // 02:30 UTC = 10:30 HKT → open
    expect(isTrustedNegativeAutoWindow(Date.parse("2026-10-11T02:30:00.000Z"))).toBe(true);
    // 13:00 UTC = 21:00 HKT → closed
    expect(isTrustedNegativeAutoWindow(Date.parse("2026-10-11T13:00:00.000Z"))).toBe(false);
  });

  it("respects env kill switch", () => {
    expect(isTrustedNegativeAutoEnabled(undefined)).toBe(true);
    expect(isTrustedNegativeAutoEnabled("0")).toBe(false);
    expect(isTrustedNegativeAutoEnabled("false")).toBe(false);
  });

  it("runs once per HKT day inside window", () => {
    const nowMs = Date.parse("2026-10-11T03:00:00.000Z"); // 11:00 HKT
    expect(
      shouldRunTrustedNegativeAuto({
        nowMs,
        lastAutoRunHktDate: null,
        enabled: true,
      })
    ).toBe(true);
    expect(
      shouldRunTrustedNegativeAuto({
        nowMs,
        lastAutoRunHktDate: "2026-10-11",
        enabled: true,
      })
    ).toBe(false);
    expect(
      shouldRunTrustedNegativeAuto({
        nowMs: Date.parse("2026-10-11T01:00:00.000Z"),
        lastAutoRunHktDate: null,
        enabled: true,
      })
    ).toBe(false);
  });

  it("builds and parses summary envelope", () => {
    const summary = buildTrustedNegativeAutoSummary({
      nowMs: Date.parse("2026-10-11T03:00:00.000Z"),
      attempted: ["trusted-negative:1"],
      results: [
        { actionId: "trusted-negative:1", state: "executed", mutationCount: 5, message: "ok" },
      ],
      skippedAlreadyDone: 2,
      stoppedOn: null,
    });
    expect(summary.kind).toBe(TRUSTED_NEGATIVE_AUTO_KIND);
    expect(summary.succeeded).toBe(1);
    expect(summary.hktDate).toBe("2026-10-11");
    expect(parseTrustedNegativeAutoSummary(summary)?.message).toMatch(/成功 1/);
    expect(parseTrustedNegativeAutoSummary({ kind: "other" })).toBeNull();
  });
});
