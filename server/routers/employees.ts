import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import {
  listUsers,
  updateUserAccess,
  getUserById,
  getUserByUsername,
  upsertUserByOpenIdAccess,
  deleteUsersExceptOpenIds,
  createLocalEmployee,
  updateUserPassword,
  deleteUserById,
} from "../db";
import {
  ASSIGNABLE_PAGE_IDS,
  PAGE_CATALOG,
  parseAllowedPages,
  type PageId,
} from "@shared/pagePermissions";
import { ENV } from "../_core/env";
import {
  hashPassword,
  localOpenIdForUsername,
} from "../passwordAuth";

const pageIdSchema = z.enum(
  ASSIGNABLE_PAGE_IDS as [PageId, ...PageId[]]
);

const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[a-zA-Z0-9._-]+$/, "帳號只可用英文字母、數字、. _ -");

const passwordSchema = z.string().min(8).max(128);

function serializeUser(u: Awaited<ReturnType<typeof getUserById>>) {
  if (!u) return null;
  return {
    id: u.id,
    openId: u.openId,
    username: u.username ?? null,
    name: u.name,
    email: u.email,
    role: u.role,
    isActive: Boolean(u.isActive !== false),
    allowedPages: parseAllowedPages(u.allowedPages),
    loginMethod: u.loginMethod,
    hasPassword: Boolean(u.passwordHash),
    lastSignedIn: u.lastSignedIn,
    createdAt: u.createdAt,
    isOwner: Boolean(ENV.ownerOpenId && u.openId === ENV.ownerOpenId),
    isLocal: Boolean(u.username || u.loginMethod === "password"),
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

  create: adminProcedure
    .input(
      z.object({
        username: usernameSchema,
        password: passwordSchema,
        name: z.string().trim().max(255).optional(),
        email: z.string().email().optional().or(z.literal("")),
        isActive: z.boolean().optional(),
        allowedPages: z.array(pageIdSchema).default([]),
      })
    )
    .mutation(async ({ input }) => {
      const username = input.username.trim().toLowerCase();
      const existing = await getUserByUsername(username);
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "此帳號名稱已被使用" });
      }
      const openId = localOpenIdForUsername(username);
      const created = await createLocalEmployee({
        username,
        openId,
        passwordHash: hashPassword(input.password),
        name: input.name?.trim() || username,
        email: input.email?.trim() || null,
        isActive: input.isActive !== false,
        allowedPages: input.allowedPages,
        role: "user",
      });
      return serializeUser(created);
    }),

  resetPassword: adminProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
        password: passwordSchema,
      })
    )
    .mutation(async ({ input }) => {
      const target = await getUserById(input.userId);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "找不到該員工" });
      }
      if (!target.username && target.loginMethod !== "password") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "此帳戶用 Manus 登入，無法重設本系統密碼",
        });
      }
      const updated = await updateUserPassword({
        id: input.userId,
        passwordHash: hashPassword(input.password),
      });
      return serializeUser(updated);
    }),

  delete: adminProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const target = await getUserById(input.userId);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "找不到該員工" });
      }
      if (ENV.ownerOpenId && target.openId === ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "不可刪除系統擁有者" });
      }
      if (ctx.user.id === target.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "不可刪除自己" });
      }
      await deleteUserById(input.userId);
      return { success: true };
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

      if (ENV.ownerOpenId && target.openId === ENV.ownerOpenId) {
        if (input.role === "user" || input.isActive === false) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "不可停用或降級系統擁有者帳戶",
          });
        }
      }

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

  purgeExcept: adminProcedure
    .input(
      z.object({
        keepOpenId: z.string().min(1).max(64),
        name: z.string().max(255).optional(),
        email: z.string().email().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user?.openId) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "No current user" });
      }

      const keepOpenIds = Array.from(
        new Set(
          [
            input.keepOpenId,
            ctx.user.openId,
            ENV.ownerOpenId,
          ].filter(Boolean) as string[]
        )
      );

      await upsertUserByOpenIdAccess({
        openId: input.keepOpenId,
        name: input.name ?? null,
        email: input.email ?? null,
        loginMethod: null,
        role: "admin",
        isActive: true,
        allowedPages: [],
      });

      await deleteUsersExceptOpenIds({ excludeOpenIds: keepOpenIds });
      return { success: true, kept: keepOpenIds };
    }),
});
