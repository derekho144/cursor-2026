import { describe, expect, it } from "vitest";
import {
  resolveAcceptedCalendarDate,
  resolveAcceptedCalendarDates,
  toHktYmd,
} from "./opsInsights";

describe("resolveAcceptedCalendarDate", () => {
  it("prefers shootingDate when valid YYYY-MM-DD", () => {
    const r = resolveAcceptedCalendarDate({
      shootingDate: "2026-09-20",
      signedAt: "2026-09-01T04:00:00.000Z",
      createdAt: "2026-08-15T04:00:00.000Z",
    });
    expect(r).toEqual({ date: "2026-09-20", source: "shootingDate" });
  });

  it("trims shootingDate and ignores empty", () => {
    const r = resolveAcceptedCalendarDate({
      shootingDate: "  ",
      signedAt: "2026-09-01T04:00:00.000Z", // 12:00 HKT on Sep 1
      createdAt: "2026-08-15T04:00:00.000Z",
    });
    expect(r.source).toBe("signedAt");
    expect(r.date).toBe("2026-09-01");
  });

  it("falls back to createdAt when no shoot/sign", () => {
    const r = resolveAcceptedCalendarDate({
      shootingDate: null,
      signedAt: null,
      createdAt: "2026-09-10T16:30:00.000Z", // 2026-09-11 00:30 HKT
    });
    expect(r.source).toBe("createdAt");
    expect(r.date).toBe(toHktYmd(new Date("2026-09-10T16:30:00.000Z")));
  });

  it("rejects malformed shootingDate", () => {
    const r = resolveAcceptedCalendarDate({
      shootingDate: "TBD",
      signedAt: null,
      createdAt: "2026-03-05T02:00:00.000Z",
    });
    expect(r.source).toBe("createdAt");
  });

  it("expands multi-day shootingDate..shootingEndDate onto each inclusive day", () => {
    const days = resolveAcceptedCalendarDates({
      shootingDate: "2026-10-18",
      shootingEndDate: "2026-10-19",
      signedAt: "2026-10-01T04:00:00.000Z",
      createdAt: "2026-09-20T04:00:00.000Z",
    });
    expect(days).toEqual([
      { date: "2026-10-18", source: "shootingDate" },
      { date: "2026-10-19", source: "shootingDate" },
    ]);
    expect(
      resolveAcceptedCalendarDate({
        shootingDate: "2026-10-18",
        shootingEndDate: "2026-10-19",
        createdAt: "2026-09-20T04:00:00.000Z",
      })
    ).toEqual({ date: "2026-10-18", source: "shootingDate" });
  });
});
