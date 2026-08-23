import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import { listUsers, updateUserAccess, getUserById } from "../db";
import {
  ASSIGNABLE_PAGE_IDS,
  PAGE_CATALOG,
  parseAllowedPages,
  type PageId,
} from "@shared/pagePermissions";
import { ENV } from "../_core/env";

const pageIdSchema = z.enum(
  ASSIGNABLE_PAGE_IDS as [PageId, ...PageId[]]
);

function serializeUser(u: Awaited<ReturnType<typeof getUserById>>) {
  if (!u) return null;
  return {
    id: u.id,
    openId: u.openId,
    name: u.name,
    email: u.email,
    role: u.role,
    isActive: Boolean(u.isActive !== false),
    allowedPages: parseAllowedPages(u.allowedPages),
    loginMethod: u.loginMethod,
    lastSignedIn: u.lastSignedIn,
    createdAt: u.createdAt,
    isOwner: Boolean(ENV.ownerOpenId && u.openId === ENV.ownerOpenId),
  };
}

export const employeesRouter = router({
  pageCatalog: adminProcedure.query(() =>
    PAGE_CATALOG.filter((p) => !p.adminOnly).map((p) => ({
      id: p.id,
      label: p.label,
    }))
  ),

  list: adminProcedure.query(async () => {
    const rows = await listUsers();
    return rows.map((u) => serializeUser(u)!);
  }),

  updateAccess: adminProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
        isActive: z.boolean().optional(),
        allowedPages: z.array(pageIdSchema).optional(),
        role: z.enum(["user", "admin"]).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const target = await getUserById(input.userId);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "找不到該員工" });
      }

      // Never demote / deactivate the owner account
      if (ENV.ownerOpenId && target.openId === ENV.ownerOpenId) {
        if (input.role === "user" || input.isActive === false) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "不可停用或降級系統擁有者帳戶",
          });
        }
      }

      // Prevent self-lockout: admin cannot remove own admin role
      if (ctx.user.id === target.id && input.role === "user") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "不可移除自己的管理員權限",
        });
      }

      const updated = await updateUserAccess({
        id: input.userId,
        isActive: input.isActive,
        allowedPages: input.allowedPages,
        role: input.role,
      });
      return serializeUser(updated);
    }),
});
