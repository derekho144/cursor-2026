import { describe, expect, it, afterEach } from "vitest";
import { getDb } from "./db";
import { quotes, quoteFollowUps } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { getPendingFollowUps, upsertQuoteFollowUp } from "./db";

describe("Stop Follow-up Feature", () => {
  afterEach(async () => {
    const db = await getDb();
    if (db) {
      await db.delete(quoteFollowUps).where(eq(quoteFollowUps.toEmail, "test-client@example.com"));
      await db.delete(quoteFollowUps).where(eq(quoteFollowUps.toEmail, "test-client2@example.com"));
      await db.delete(quoteFollowUps).where(eq(quoteFollowUps.toEmail, "unlinked-client@example.com"));
      await db.delete(quoteFollowUps).where(eq(quoteFollowUps.toEmail, "test-client3@example.com"));
      await db.delete(quotes).where(eq(quotes.clientEmail, "test-client@example.com"));
      await db.delete(quotes).where(eq(quotes.clientEmail, "test-client2@example.com"));
      await db.delete(quotes).where(eq(quotes.clientEmail, "test-client3@example.com"));
    }
  });

  it("should exclude follow-ups with stopFollowUp=true on the follow-up record itself", async () => {
    const db = await getDb();
    if (!db) {
      console.log("Database not available, skipping test");
      return;
    }

    // Create a follow-up record with stopFollowUp=true directly on the record
    const sentAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
    await db.insert(quoteFollowUps).values({
      gmailMessageId: `msg-stopped-${Date.now()}`,
      gmailThreadId: `thread-stopped-${Date.now()}`,
      toEmail: "test-client@example.com",
      toName: "Test Client",
      subject: "Test Quote",
      sentAt,
      status: "pending",
      stopFollowUp: true, // Directly stopped on the follow-up record
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Get pending follow-ups (should exclude this one because stopFollowUp=true)
    const pending = await getPendingFollowUps(3); // daysAfterSent = 3

    // Should not include the stopped follow-up
    const foundFollowUp = pending.find((fu) => fu.toEmail === "test-client@example.com");
    expect(foundFollowUp).toBeUndefined();
  });

  it("should include follow-ups with stopFollowUp=false in pending follow-ups", async () => {
    const db = await getDb();
    if (!db) {
      console.log("Database not available, skipping test");
      return;
    }

    // Create a follow-up record with stopFollowUp=false (default)
    const sentAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
    await db.insert(quoteFollowUps).values({
      gmailMessageId: `msg-active-${Date.now()}`,
      gmailThreadId: `thread-active-${Date.now()}`,
      toEmail: "test-client2@example.com",
      toName: "Test Client 2",
      subject: "Test Quote 2",
      sentAt,
      status: "pending",
      stopFollowUp: false, // Not stopped
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Get pending follow-ups (should include this one)
    const pending = await getPendingFollowUps(3); // daysAfterSent = 3

    // Should include the active follow-up
    const foundFollowUp = pending.find((fu) => fu.toEmail === "test-client2@example.com");
    expect(foundFollowUp).toBeDefined();
    expect(foundFollowUp?.toEmail).toBe("test-client2@example.com");
  });

  it("should include follow-ups without quoteId (not linked to any quote)", async () => {
    const db = await getDb();
    if (!db) {
      console.log("Database not available, skipping test");
      return;
    }

    // Create a follow-up record WITHOUT linking to any quote
    const sentAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
    await db.insert(quoteFollowUps).values({
      gmailMessageId: `msg-unlinked-${Date.now()}`,
      gmailThreadId: `thread-unlinked-${Date.now()}`,
      toEmail: "unlinked-client@example.com",
      toName: "Unlinked Client",
      subject: "Unlinked Quote",
      sentAt,
      status: "pending",
      quoteId: null, // Not linked to any quote
      stopFollowUp: false, // Not stopped
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Get pending follow-ups (should include this one)
    const pending = await getPendingFollowUps(3); // daysAfterSent = 3

    // Should include the follow-up without quoteId
    const foundFollowUp = pending.find((fu) => fu.toEmail === "unlinked-client@example.com");
    expect(foundFollowUp).toBeDefined();
    expect(foundFollowUp?.toEmail).toBe("unlinked-client@example.com");
  });

  it("should automatically set quoteId when upserting follow-up with matching email", async () => {
    const db = await getDb();
    if (!db) {
      console.log("Database not available, skipping test");
      return;
    }

    // Create a test quote
    await db.insert(quotes).values({
      quoteNumber: `TEST-${Date.now()}`,
      clientName: "Test Client 3",
      clientEmail: "test-client3@example.com",
      serviceType: "product",
      subtotal: 3000,
      total: 3000,
      status: "sent",
      stopFollowUp: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Get the inserted quote ID
    const insertedQuotes = await db
      .select({ id: quotes.id })
      .from(quotes)
      .where(eq(quotes.clientEmail, "test-client3@example.com"))
      .limit(1);

    const quoteId = insertedQuotes[0]?.id;
    expect(quoteId).toBeDefined();

    // Upsert a follow-up without explicitly setting quoteId
    const sentAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
    await upsertQuoteFollowUp({
      gmailMessageId: `msg-auto-${Date.now()}`,
      gmailThreadId: `thread-auto-${Date.now()}`,
      toEmail: "test-client3@example.com",
      toName: "Test Client 3",
      subject: "Auto-linked Quote",
      sentAt,
      status: "pending",
      // Note: quoteId is NOT set here, should be auto-populated
    });

    // Verify that the follow-up was created with the correct quoteId
    const followUps = await db
      .select()
      .from(quoteFollowUps)
      .where(eq(quoteFollowUps.toEmail, "test-client3@example.com"))
      .limit(1);

    expect(followUps).toHaveLength(1);
    expect(followUps[0]?.quoteId).toBe(quoteId);
  });
});
