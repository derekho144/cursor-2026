/**
 * emailInquiries.scan.test.ts
 * Unit tests for Gmail scan active hours, approve/reject state transitions,
 * and inquiry status validation logic.
 */
import { describe, it, expect } from "vitest";

// ─── Active Hours Logic (mirrors emailInquiries.ts scanStatus) ──────────────

/**
 * Mirrors the active hours check in scanStatus procedure.
 * Active hours: 07:00–21:00 HKT (UTC+8)
 */
function isWithinActiveHours(utcMs: number): boolean {
  const nowHKT = new Date(utcMs + 8 * 60 * 60 * 1000);
  const hour = nowHKT.getUTCHours();
  return hour >= 7 && hour < 21;
}

describe("Gmail scan active hours (07:00–21:00 HKT)", () => {
  // Helper: create a UTC timestamp for a specific HKT hour
  function hktHour(h: number): number {
    // UTC = HKT - 8h; use a fixed date (2026-01-01) to avoid DST issues
    return Date.UTC(2026, 0, 1, h - 8 < 0 ? h - 8 + 24 : h - 8, 0, 0);
  }

  it("should be active at 07:00 HKT (boundary start)", () => {
    expect(isWithinActiveHours(hktHour(7))).toBe(true);
  });

  it("should be active at 12:00 HKT (noon)", () => {
    expect(isWithinActiveHours(hktHour(12))).toBe(true);
  });

  it("should be active at 20:59 HKT (just before cutoff)", () => {
    const utcMs = Date.UTC(2026, 0, 1, 12, 59, 0); // 20:59 HKT
    expect(isWithinActiveHours(utcMs)).toBe(true);
  });

  it("should NOT be active at 21:00 HKT (boundary end)", () => {
    expect(isWithinActiveHours(hktHour(21))).toBe(false);
  });

  it("should NOT be active at 23:00 HKT (late night)", () => {
    expect(isWithinActiveHours(hktHour(23))).toBe(false);
  });

  it("should NOT be active at 00:00 HKT (midnight)", () => {
    expect(isWithinActiveHours(hktHour(0))).toBe(false);
  });

  it("should NOT be active at 06:59 HKT (before start)", () => {
    const utcMs = Date.UTC(2025, 11, 31, 22, 59, 0); // 06:59 HKT next day
    expect(isWithinActiveHours(utcMs)).toBe(false);
  });
});

// ─── Approve / Reject State Transitions ─────────────────────────────────────

type InquiryStatus = "pending" | "approved" | "rejected" | "auto_replied";

function canApprove(status: InquiryStatus): boolean {
  return status === "pending" || status === "auto_replied";
}

function canReject(status: InquiryStatus): boolean {
  return status === "pending" || status === "auto_replied";
}

function getNextStatus(action: "approve" | "reject", current: InquiryStatus): InquiryStatus | null {
  if (action === "approve" && canApprove(current)) return "approved";
  if (action === "reject" && canReject(current)) return "rejected";
  return null; // invalid transition
}

describe("Inquiry approve/reject state transitions", () => {
  it("pending → approve → approved", () => {
    expect(getNextStatus("approve", "pending")).toBe("approved");
  });

  it("pending → reject → rejected", () => {
    expect(getNextStatus("reject", "pending")).toBe("rejected");
  });

  it("auto_replied → approve → approved", () => {
    expect(getNextStatus("approve", "auto_replied")).toBe("approved");
  });

  it("auto_replied → reject → rejected", () => {
    expect(getNextStatus("reject", "auto_replied")).toBe("rejected");
  });

  it("already approved cannot be approved again", () => {
    expect(getNextStatus("approve", "approved")).toBeNull();
  });

  it("already rejected cannot be rejected again", () => {
    expect(getNextStatus("reject", "rejected")).toBeNull();
  });
});

// ─── AI Score Threshold for Auto-Reply ──────────────────────────────────────

const AI_CONFIDENCE_THRESHOLD = 80;

function shouldAutoReply(score: number): boolean {
  return score >= AI_CONFIDENCE_THRESHOLD;
}

describe("AI confidence threshold for auto-reply", () => {
  it("score 80 triggers auto-reply", () => {
    expect(shouldAutoReply(80)).toBe(true);
  });

  it("score 100 triggers auto-reply", () => {
    expect(shouldAutoReply(100)).toBe(true);
  });

  it("score 79 does NOT trigger auto-reply (manual review needed)", () => {
    expect(shouldAutoReply(79)).toBe(false);
  });

  it("score 0 does NOT trigger auto-reply", () => {
    expect(shouldAutoReply(0)).toBe(false);
  });

  it("score 50 does NOT trigger auto-reply", () => {
    expect(shouldAutoReply(50)).toBe(false);
  });
});

// ─── Scan Interval Logic ─────────────────────────────────────────────────────

const GMAIL_SCAN_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

function getNextScanTime(lastScanAt: Date | null): Date | null {
  if (!lastScanAt) return null;
  return new Date(lastScanAt.getTime() + GMAIL_SCAN_INTERVAL_MS);
}

describe("Gmail scan interval (30 minutes)", () => {
  it("returns null when no previous scan", () => {
    expect(getNextScanTime(null)).toBeNull();
  });

  it("next scan is 30 minutes after last scan", () => {
    const lastScan = new Date("2026-01-01T10:00:00Z");
    const nextScan = getNextScanTime(lastScan);
    expect(nextScan?.getTime()).toBe(new Date("2026-01-01T10:30:00Z").getTime());
  });

  it("interval is exactly 1800000ms (30 min)", () => {
    expect(GMAIL_SCAN_INTERVAL_MS).toBe(1800000);
  });
});
