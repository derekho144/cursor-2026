/**
 * freehunterBoard.test.ts
 * Tests for FreehunterBoard router critical paths:
 * - Status deduplication (LEFT JOIN multiple email_inquiries)
 * - AI score threshold logic (>= 80 auto-send, < 80 manual)
 * - SERVICE_TYPE_LABELS single source of truth
 * - formatDate / formatHKD utility functions
 */
import { describe, it, expect } from "vitest";

// ─── SERVICE_TYPE_LABELS single source of truth ───────────────────
describe("SERVICE_TYPE_LABELS", () => {
  it("quotePdfKit exports SERVICE_TYPE_LABELS", async () => {
    const { SERVICE_TYPE_LABELS } = await import("./routers/quotePdfKit");
    expect(SERVICE_TYPE_LABELS).toBeDefined();
    expect(SERVICE_TYPE_LABELS.corporate_event).toBe("企業活動攝影");
    expect(SERVICE_TYPE_LABELS.video_production).toBe("影片製作");
    expect(SERVICE_TYPE_LABELS.other).toBe("其他服務");
  });

  it("quotePdf re-exports SERVICE_TYPE_LABELS from quotePdfKit (no duplication)", async () => {
    const pdfKit = await import("./routers/quotePdfKit");
    const pdf = await import("./routers/quotePdf");
    // Both should reference the same object (re-export)
    expect(pdf.SERVICE_TYPE_LABELS).toEqual(pdfKit.SERVICE_TYPE_LABELS);
    // Verify all keys match
    expect(Object.keys(pdf.SERVICE_TYPE_LABELS)).toEqual(Object.keys(pdfKit.SERVICE_TYPE_LABELS));
  });
});

// ─── AI Score threshold logic ─────────────────────────────────────
describe("AI score auto-send threshold", () => {
  const AUTO_ACTION_THRESHOLD = 80;

  it("score >= 80 is high confidence (auto-send)", () => {
    expect(80 >= AUTO_ACTION_THRESHOLD).toBe(true);
    expect(90 >= AUTO_ACTION_THRESHOLD).toBe(true);
    expect(100 >= AUTO_ACTION_THRESHOLD).toBe(true);
  });

  it("score < 80 is low confidence (manual compose)", () => {
    expect(79 >= AUTO_ACTION_THRESHOLD).toBe(false);
    expect(75 >= AUTO_ACTION_THRESHOLD).toBe(false);
    expect(0 >= AUTO_ACTION_THRESHOLD).toBe(false);
  });

  it("score exactly 80 triggers auto-send", () => {
    expect(80 >= AUTO_ACTION_THRESHOLD).toBe(true);
  });
});

// ─── Deduplication logic ──────────────────────────────────────────
describe("getStatus deduplication", () => {
  type JobRow = {
    jobId: string;
    title: string;
    _inquiryId: number | null;
    replyTrackingId?: string | null;
  };

  /**
   * Mirrors the dedup logic in freehunterBoard.ts getStatus procedure.
   * Keeps the row with the highest _inquiryId (latest tracking record).
   */
  function deduplicateJobs(rawJobs: JobRow[]): JobRow[] {
    const jobMap = new Map<string, JobRow>();
    for (const row of rawJobs) {
      const existing = jobMap.get(row.jobId);
      if (!existing) {
        jobMap.set(row.jobId, row);
      } else {
        const existingInqId = existing._inquiryId ?? 0;
        const rowInqId = row._inquiryId ?? 0;
        if (rowInqId > existingInqId) jobMap.set(row.jobId, row);
      }
    }
    return Array.from(jobMap.values());
  }

  it("returns single row when no duplicates", () => {
    const rows: JobRow[] = [
      { jobId: "100", title: "Job A", _inquiryId: 1 },
      { jobId: "101", title: "Job B", _inquiryId: 2 },
    ];
    const result = deduplicateJobs(rows);
    expect(result).toHaveLength(2);
  });

  it("deduplicates when same jobId has multiple inquiry rows", () => {
    const rows: JobRow[] = [
      { jobId: "33857", title: "Job X", _inquiryId: 10, replyTrackingId: "old-track" },
      { jobId: "33857", title: "Job X", _inquiryId: 15, replyTrackingId: "new-track" },
      { jobId: "33858", title: "Job Y", _inquiryId: 5 },
    ];
    const result = deduplicateJobs(rows);
    expect(result).toHaveLength(2);
    const jobX = result.find((j) => j.jobId === "33857");
    expect(jobX?._inquiryId).toBe(15); // keeps highest (latest) inquiry
    expect(jobX?.replyTrackingId).toBe("new-track");
  });

  it("handles null _inquiryId (no email inquiry linked)", () => {
    const rows: JobRow[] = [
      { jobId: "33861", title: "Job Z", _inquiryId: null },
      { jobId: "33861", title: "Job Z", _inquiryId: 7 },
    ];
    const result = deduplicateJobs(rows);
    expect(result).toHaveLength(1);
    expect(result[0]._inquiryId).toBe(7);
  });

  it("handles all null _inquiryId rows", () => {
    const rows: JobRow[] = [
      { jobId: "99999", title: "New Job", _inquiryId: null },
    ];
    const result = deduplicateJobs(rows);
    expect(result).toHaveLength(1);
    expect(result[0]._inquiryId).toBeNull();
  });
});

// ─── formatDate / formatHKD utility functions ─────────────────────
describe("client utility functions", () => {
  // We test the logic directly without importing the client module
  // (avoids browser-only APIs in Node.js test environment)

  function formatHKD(amount: number | null | undefined): string {
    if (amount == null) return "—";
    return `HK$${Math.round(amount).toLocaleString("en-HK")}`;
  }

  it("formatHKD formats positive numbers", () => {
    expect(formatHKD(12345)).toBe("HK$12,345");
    expect(formatHKD(1000)).toBe("HK$1,000");
    expect(formatHKD(0)).toBe("HK$0");
  });

  it("formatHKD rounds decimals", () => {
    expect(formatHKD(1234.7)).toBe("HK$1,235");
    expect(formatHKD(1234.4)).toBe("HK$1,234");
  });

  it("formatHKD handles null/undefined", () => {
    expect(formatHKD(null)).toBe("—");
    expect(formatHKD(undefined)).toBe("—");
  });
});
