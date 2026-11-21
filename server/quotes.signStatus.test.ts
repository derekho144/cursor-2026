import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { TrpcContext } from "./_core/context";
import { quotes } from "../drizzle/schema";
import { getDb } from "./db";
import { appRouter } from "./routers";

const TEST_EMAIL = "sign-status-guard@example.com";

function publicCaller() {
  return appRouter.createCaller({
    user: null,
    req: { headers: {}, cookies: {} } as any,
    res: { clearCookie: () => {}, cookie: () => {} } as any,
  } as any);
}

function createAdminContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "admin-sign-status",
      name: "Admin",
      email: "admin@example.com",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

describe("e-sign status guards", () => {
  afterEach(async () => {
    const db = await getDb();
    if (!db) return;
    await db.delete(quotes).where(eq(quotes.clientEmail, TEST_EMAIL));
  });

  it("submitSignature rejects signing a rejected quote that still has a token", async () => {
    const db = await getDb();
    if (!db) {
      console.log("Database not available, skipping test");
      return;
    }

    const signToken = nanoid(32);
    await db.insert(quotes).values({
      quoteNumber: `SIGN-REJ-${Date.now()}`,
      clientName: "Rejected Client",
      clientEmail: TEST_EMAIL,
      serviceType: "product",
      subtotal: 1000,
      total: 1000,
      status: "rejected",
      signToken,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      publicCaller().quotes.submitSignature({
        token: signToken,
        signedByName: "Attacker",
        signatureData: "data:image/png;base64,aaa",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const [row] = await db
      .select({ status: quotes.status, signedAt: quotes.signedAt })
      .from(quotes)
      .where(eq(quotes.clientEmail, TEST_EMAIL))
      .limit(1);
    expect(row.status).toBe("rejected");
    expect(row.signedAt).toBeNull();
  });

  it("quotes.update clears signToken when status becomes rejected", async () => {
    const db = await getDb();
    if (!db) {
      console.log("Database not available, skipping test");
      return;
    }

    const signToken = nanoid(32);
    const [inserted] = await db.insert(quotes).values({
      quoteNumber: `SIGN-CLR-${Date.now()}`,
      clientName: "Clear Token Client",
      clientEmail: TEST_EMAIL,
      serviceType: "product",
      subtotal: 1000,
      total: 1000,
      status: "sent",
      signToken,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const id = Number((inserted as any).insertId);

    await appRouter.createCaller(createAdminContext()).quotes.update({
      id,
      status: "rejected",
    });

    const [row] = await db
      .select({ status: quotes.status, signToken: quotes.signToken })
      .from(quotes)
      .where(eq(quotes.id, id))
      .limit(1);
    expect(row.status).toBe("rejected");
    expect(row.signToken).toBeNull();
  });
});
