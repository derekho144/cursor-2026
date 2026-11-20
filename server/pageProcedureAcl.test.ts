import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import { pageProcedure, pageProcedureAny, router } from "./_core/trpc";
import type { TrpcContext } from "./_core/context";
import type { User } from "../drizzle/schema";

function user(partial: Partial<User> & Pick<User, "role" | "allowedPages">): User {
  return {
    id: 1,
    openId: "test-open-id",
    name: "Test",
    email: "t@example.com",
    loginMethod: "password",
    isActive: true,
    username: "tester",
    passwordHash: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...partial,
  } as User;
}

function ctx(u: User | null): TrpcContext {
  return {
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    user: u,
  };
}

const testRouter = router({
  quotesPing: pageProcedure("quotes").query(() => ({ ok: true as const })),
  adsPing: pageProcedureAny([
    "ad-expenses",
    "platform-efficiency",
    "ad-sync",
  ]).query(() => ({ ok: true as const })),
});

async function call(
  procedure: "quotesPing" | "adsPing",
  userCtx: User | null
) {
  const caller = testRouter.createCaller(ctx(userCtx));
  return caller[procedure]();
}

describe("pageProcedure server ACL", () => {
  it("allows admin regardless of allowedPages", async () => {
    await expect(
      call("quotesPing", user({ role: "admin", allowedPages: [] }))
    ).resolves.toEqual({ ok: true });
  });

  it("allows employee with matching page", async () => {
    await expect(
      call(
        "quotesPing",
        user({ role: "user", allowedPages: ["quotes", "clients"] })
      )
    ).resolves.toEqual({ ok: true });
  });

  it("rejects employee without matching page (empty ACL)", async () => {
    try {
      await call("quotesPing", user({ role: "user", allowedPages: [] }));
      expect.fail("expected FORBIDDEN");
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("FORBIDDEN");
      expect((err as TRPCError).message).toContain("沒有權限");
    }
  });

  it("rejects employee with other pages only", async () => {
    try {
      await call(
        "quotesPing",
        user({ role: "user", allowedPages: ["expenses", "deliveries"] })
      );
      expect.fail("expected FORBIDDEN");
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("FORBIDDEN");
    }
  });

  it("pageProcedureAny allows any listed page", async () => {
    await expect(
      call(
        "adsPing",
        user({ role: "user", allowedPages: ["platform-efficiency"] })
      )
    ).resolves.toEqual({ ok: true });
    await expect(
      call("adsPing", user({ role: "user", allowedPages: ["ad-sync"] }))
    ).resolves.toEqual({ ok: true });
  });

  it("pageProcedureAny rejects unrelated pages", async () => {
    try {
      await call("adsPing", user({ role: "user", allowedPages: ["quotes"] }));
      expect.fail("expected FORBIDDEN");
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("FORBIDDEN");
    }
  });

  it("rejects unauthenticated callers", async () => {
    try {
      await call("quotesPing", null);
      expect.fail("expected UNAUTHORIZED");
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("UNAUTHORIZED");
    }
  });
});
