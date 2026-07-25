import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
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

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

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
