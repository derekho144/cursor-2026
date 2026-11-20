import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { userCanAccessPage, type PageId } from "@shared/pagePermissions";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { ZodError } from "zod";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    // Format Zod validation errors into readable messages
    let zodError: ZodError | null = null;
    
    // Check if error.cause is a ZodError
    if (error.cause instanceof ZodError) {
      zodError = error.cause;
    }
    // Check if error itself is a ZodError (for input validation)
    else if (error instanceof ZodError) {
      zodError = error;
    }
    
    if (zodError) {
      const issues = zodError.issues;
      const messages = issues
        .map(issue => {
          const path = issue.path.length > 0 ? issue.path.join('.') : 'input';
          return `${path}: ${issue.message}`;
        })
        .join('; ');
      
      return {
        ...shape,
        message: messages || 'Validation error',
      };
    }
    
    return shape;
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  // Inactive employees cannot call protected APIs (admins always allowed)
  if (ctx.user.role !== "admin" && ctx.user.isActive === false) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "帳戶已停用，請聯絡管理員",
    });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

/** Auth-only. Prefer pageProcedure / pageProcedureAny for staff APIs. */
export const protectedProcedure = t.procedure.use(requireUser);

const PAGE_FORBIDDEN_MSG = "沒有權限存取此功能";

function assertPageAccess(
  user: NonNullable<TrpcContext["user"]>,
  pageIds: PageId[]
) {
  const ok = pageIds.some((pageId) =>
    userCanAccessPage({
      role: user.role,
      isActive: user.isActive,
      allowedPages: user.allowedPages,
      pageId,
    })
  );
  if (!ok) {
    throw new TRPCError({ code: "FORBIDDEN", message: PAGE_FORBIDDEN_MSG });
  }
}

/**
 * Logged-in + allowedPages includes pageId (admins always pass).
 * Use as a drop-in for protectedProcedure on page-scoped routers.
 */
export function pageProcedure(pageId: PageId) {
  return t.procedure.use(requireUser).use(async ({ ctx, next }) => {
    assertPageAccess(ctx.user, [pageId]);
    return next({ ctx });
  });
}

/** Logged-in + allowedPages includes any of the given pages (admins always pass). */
export function pageProcedureAny(pageIds: PageId[]) {
  if (pageIds.length === 0) {
    throw new Error("pageProcedureAny requires at least one page id");
  }
  return t.procedure.use(requireUser).use(async ({ ctx, next }) => {
    assertPageAccess(ctx.user, pageIds);
    return next({ ctx });
  });
}

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
