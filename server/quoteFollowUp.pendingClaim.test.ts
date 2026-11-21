import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { quoteFollowUps } from "../drizzle/schema";
import { getDb, getPendingFollowUps, upsertQuoteFollowUp } from "./db";

const TEST_EMAIL = "pending-claim-followup@example.com";

describe("quote follow-up pending claim", () => {
  afterEach(async () => {
    const db = await getDb();
    if (!db) return;
    await db.delete(quoteFollowUps).where(eq(quoteFollowUps.toEmail, TEST_EMAIL));
  });

  it("upsertQuoteFollowUp leaves followUpSentAt null so pending rows are claimable", async () => {
    const db = await getDb();
    if (!db) {
      console.log("Database not available, skipping test");
      return;
    }

    const sentAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await upsertQuoteFollowUp({
      gmailMessageId: `msg-pending-claim-${Date.now()}`,
      gmailThreadId: `thread-pending-claim-${Date.now()}`,
      toEmail: TEST_EMAIL,
      toName: "Pending Claim Client",
      subject: "Quote follow-up claim test",
      sentAt,
      status: "pending",
    });

    const [row] = await db
      .select()
      .from(quoteFollowUps)
      .where(eq(quoteFollowUps.toEmail, TEST_EMAIL))
      .limit(1);

    expect(row).toBeDefined();
    expect(row.followUpSentAt).toBeNull();

    const pending = await getPendingFollowUps(3);
    const claimed = pending.find((fu) => fu.toEmail === TEST_EMAIL);
    expect(claimed).toBeDefined();
  });

  it("getPendingFollowUps heals pending rows that were stamped with followUpSentAt", async () => {
    const db = await getDb();
    if (!db) {
      console.log("Database not available, skipping test");
      return;
    }

    const sentAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await db.insert(quoteFollowUps).values({
      gmailMessageId: `msg-poisoned-${Date.now()}`,
      gmailThreadId: `thread-poisoned-${Date.now()}`,
      toEmail: TEST_EMAIL,
      toName: "Poisoned Client",
      subject: "Poisoned pending follow-up",
      sentAt,
      status: "pending",
      // Simulate the historical bug: pending insert stamped followUpSentAt
      followUpSentAt: new Date(),
      stopFollowUp: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const pending = await getPendingFollowUps(3);
    const claimed = pending.find((fu) => fu.toEmail === TEST_EMAIL);
    expect(claimed).toBeDefined();
  });
});
