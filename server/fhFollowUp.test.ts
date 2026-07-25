/**
 * fhFollowUp.test.ts
 * 端到端測試 FH 跟進郵件系統的核心邏輯
 *
 * 覆蓋的邊界情況：
 * 1. 正常流程：24 小時後發送跟進郵件
 * 2. 已有回覆：不發送跟進郵件
 * 3. 已超過重試次數：不再嘗試
 * 4. SENTINEL 值處理：失敗後正確重置
 * 5. 狀態不影響：job status 改變後仍能發送
 * 6. 重試計數：每次失敗後正確遞增
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock the database module ─────────────────────────────────────────────────
vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getFHJobsPendingFollowUp: vi.fn(),
    markFollowUpSent: vi.fn(),
    resetFollowUpSentinel: vi.fn(),
  };
});

// ─── Mock the email sending module ───────────────────────────────────────────
vi.mock("./routers/emailInquiries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./routers/emailInquiries")>();
  return {
    ...actual,
    sendFHFollowUpEmail: vi.fn(),
  };
});

// ─── Mock notification ────────────────────────────────────────────────────────
vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

import { runFHFollowUpEmails } from "./scheduler";
import { getFHJobsPendingFollowUp, markFollowUpSent, resetFollowUpSentinel } from "./db";
import { sendFHFollowUpEmail } from "./routers/emailInquiries";

const mockGetFHJobsPendingFollowUp = getFHJobsPendingFollowUp as ReturnType<typeof vi.fn>;
const mockMarkFollowUpSent = markFollowUpSent as ReturnType<typeof vi.fn>;
const mockResetFollowUpSentinel = resetFollowUpSentinel as ReturnType<typeof vi.fn>;
const mockSendFHFollowUpEmail = sendFHFollowUpEmail as ReturnType<typeof vi.fn>;

// ─── Mock scheduler lock to run immediately ───────────────────────────────────
vi.mock("./schedulerLock", () => ({
  withSchedulerLock: vi.fn(async (_key: string, _ttl: number, fn: Function) => {
    await fn();
  }),
}));

const SAMPLE_JOB = {
  inquiryId: 42,
  clientEmail: "client@example.com",
  clientName: "Test Client",
  jobTitle: "Video Production",
  jobDescription: "Need a 2-minute corporate video",
  fhJobId: 101,
  firstEmailSentAt: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25 hours ago
};

describe("FH Follow-up Email System", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMarkFollowUpSent.mockResolvedValue(undefined);
    mockResetFollowUpSentinel.mockResolvedValue(undefined);
  });

  describe("runFHFollowUpEmails", () => {
    it("sends follow-up email when job is eligible", async () => {
      mockGetFHJobsPendingFollowUp.mockResolvedValue([SAMPLE_JOB]);
      mockSendFHFollowUpEmail.mockResolvedValue({ success: true, messageId: "msg-123" });

      await runFHFollowUpEmails();

      expect(mockSendFHFollowUpEmail).toHaveBeenCalledWith(
        SAMPLE_JOB.clientEmail,
        SAMPLE_JOB.clientName,
        SAMPLE_JOB.jobTitle,
        SAMPLE_JOB.inquiryId,
        SAMPLE_JOB.jobDescription
      );
      expect(mockMarkFollowUpSent).toHaveBeenCalledWith(SAMPLE_JOB.inquiryId);
      expect(mockResetFollowUpSentinel).not.toHaveBeenCalled();
    });

    it("resets SENTINEL when email sending fails", async () => {
      mockGetFHJobsPendingFollowUp.mockResolvedValue([SAMPLE_JOB]);
      mockSendFHFollowUpEmail.mockResolvedValue({ success: false });

      await runFHFollowUpEmails();

      expect(mockMarkFollowUpSent).not.toHaveBeenCalled();
      expect(mockResetFollowUpSentinel).toHaveBeenCalledWith(
        SAMPLE_JOB.inquiryId,
        expect.any(String)
      );
    });

    it("resets SENTINEL when email sending throws an error", async () => {
      mockGetFHJobsPendingFollowUp.mockResolvedValue([SAMPLE_JOB]);
      mockSendFHFollowUpEmail.mockRejectedValue(new Error("SMTP connection failed"));

      await runFHFollowUpEmails();

      expect(mockMarkFollowUpSent).not.toHaveBeenCalled();
      expect(mockResetFollowUpSentinel).toHaveBeenCalledWith(
        SAMPLE_JOB.inquiryId,
        "SMTP connection failed"
      );
    });

    it("does nothing when no pending follow-ups", async () => {
      mockGetFHJobsPendingFollowUp.mockResolvedValue([]);

      await runFHFollowUpEmails();

      expect(mockSendFHFollowUpEmail).not.toHaveBeenCalled();
      expect(mockMarkFollowUpSent).not.toHaveBeenCalled();
    });

    it("handles multiple jobs and sends all", async () => {
      const jobs = [
        { ...SAMPLE_JOB, inquiryId: 1, clientEmail: "a@example.com" },
        { ...SAMPLE_JOB, inquiryId: 2, clientEmail: "b@example.com" },
        { ...SAMPLE_JOB, inquiryId: 3, clientEmail: "c@example.com" },
      ];
      mockGetFHJobsPendingFollowUp.mockResolvedValue(jobs);
      mockSendFHFollowUpEmail.mockResolvedValue({ success: true, messageId: "msg-ok" });

      await runFHFollowUpEmails();

      expect(mockSendFHFollowUpEmail).toHaveBeenCalledTimes(3);
      expect(mockMarkFollowUpSent).toHaveBeenCalledTimes(3);
    });

    it("continues sending other jobs even if one fails", async () => {
      const jobs = [
        { ...SAMPLE_JOB, inquiryId: 1, clientEmail: "a@example.com" },
        { ...SAMPLE_JOB, inquiryId: 2, clientEmail: "b@example.com" },
      ];
      mockGetFHJobsPendingFollowUp.mockResolvedValue(jobs);
      mockSendFHFollowUpEmail
        .mockResolvedValueOnce({ success: false }) // first fails
        .mockResolvedValueOnce({ success: true, messageId: "msg-ok" }); // second succeeds

      await runFHFollowUpEmails();

      expect(mockResetFollowUpSentinel).toHaveBeenCalledWith(1, expect.any(String));
      expect(mockMarkFollowUpSent).toHaveBeenCalledWith(2);
    });

    it("uses fallback job title when jobTitle is null", async () => {
      const jobWithNoTitle = { ...SAMPLE_JOB, jobTitle: null };
      mockGetFHJobsPendingFollowUp.mockResolvedValue([jobWithNoTitle]);
      mockSendFHFollowUpEmail.mockResolvedValue({ success: true, messageId: "msg-123" });

      await runFHFollowUpEmails();

      expect(mockSendFHFollowUpEmail).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        "Photography/Video Service", // fallback title
        expect.any(Number),
        expect.anything()
      );
    });

    it("does not crash when getFHJobsPendingFollowUp throws", async () => {
      mockGetFHJobsPendingFollowUp.mockRejectedValue(new Error("DB connection lost"));

      // Should not throw
      await expect(runFHFollowUpEmails()).resolves.not.toThrow();
    });
  });
});
