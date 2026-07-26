import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { quotesRouter } from "./routers/quotes";
import { adExpensesRouter } from "./routers/adExpenses";
import { clientsRouter } from "./routers/clients";
import { deliveriesRouter } from "./routers/deliveries";
import { emailInquiriesRouter } from "./routers/emailInquiries";
import { freehunterBoardRouter } from "./routers/freehunterBoard";
import { expensesRouter } from "./routers/expenses";
import { loyaltyRouter } from "./routers/loyalty";
import { getDashboardStats, getDashboardStatsQuick, getAvgResponseTimeHours, getWhatsappClickStats, getMonthlyQuoteCosts, getDb } from "./db";
import { quoteCostsRouter } from "./routers/quoteCosts";
import { followUpRouter } from "./routers/followUp";
import { pitchOutreachRouter } from "./routers/pitchOutreach";
import { linkedinOpsRouter } from "./routers/linkedinOps";
import { protectedProcedure } from "./_core/trpc";
import { emailInquiries, freehunterJobs } from "../drizzle/schema";
import { eq, sql, isNotNull, and, gt } from "drizzle-orm";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  dashboard: router({
    quick: protectedProcedure
      .input(z.object({ year: z.number().optional(), month: z.number().min(1).max(12).optional() }).optional())
      .query(async ({ input }) => {
        return getDashboardStatsQuick(input?.year, input?.month);
      }),
    stats: protectedProcedure
      .input(z.object({ year: z.number().optional(), month: z.number().min(1).max(12).optional() }).optional())
      .query(async ({ input }) => {
        return getDashboardStats(input?.year, input?.month);
      }),
    avgResponseTime: protectedProcedure
      .input(z.object({ year: z.number(), month: z.number().min(1).max(12).optional() }).optional())
      .query(async ({ input }) => {
        const year = input?.year ?? new Date().getFullYear();
        return getAvgResponseTimeHours({ year, month: input?.month });
      }),
    whatsappStats: protectedProcedure
      .input(z.object({ year: z.number(), month: z.number().min(1).max(12).optional() }).optional())
      .query(async ({ input }) => {
        const year = input?.year ?? new Date().getFullYear();
        return getWhatsappClickStats({ year, month: input?.month });
      }),
    // ─── Merged Dashboard Query ───────────────────────────────────────────
    // Replaces 5 separate API calls with 1 parallel Promise.all
    all: protectedProcedure
      .input(z.object({ year: z.number().optional(), month: z.number().min(1).max(12).optional() }).optional())
      .query(async ({ input }) => {
        const year = input?.year ?? new Date().getFullYear();
        const month = input?.month ?? (new Date().getMonth() + 1);
        const db = await getDb();

        const [stats, avgResp, waStats, pendingCount, fhStats] = await Promise.all([
          // 1. Main KPI stats (revenue, ad spend, trend, source distribution)
          getDashboardStats(year, month),
          // 2. Average response time
          getAvgResponseTimeHours({ year, month }),
          // 3. WhatsApp click stats
          getWhatsappClickStats({ year, month }),
          // 4. Pending email inquiries count (lightweight — only count, no full rows)
          db
            ? db
                .select({ total: sql<number>`COUNT(*)` })
                .from(emailInquiries)
                .where(eq(emailInquiries.status, "pending"))
                .then((r) => Number(r[0]?.total ?? 0))
            : Promise.resolve(0),
          // 5. Freehunter board stats (status counts + follow-up sent)
          db
            ? Promise.all([
                db
                  .select({
                    status: freehunterJobs.status,
                    count: sql<number>`COUNT(*)`,
                  })
                  .from(freehunterJobs)
                  .groupBy(freehunterJobs.status),
                db
                  .select({ count: sql<number>`COUNT(*)` })
                  .from(freehunterJobs)
                  .where(
                    and(
                      isNotNull(freehunterJobs.followUpSentAt),
                      // Exclude claim SENTINEL (1970-01-01) if ever written on this column
                      gt(freehunterJobs.followUpSentAt, new Date("1971-01-01T00:00:00.000Z"))
                    )
                  ),
              ]).then(([rows, followUpRows]) => ({
                total: rows.reduce((s, r) => s + Number(r.count), 0),
                new: Number(rows.find((r) => r.status === "new")?.count ?? 0),
                emailFetched: Number(rows.find((r) => r.status === "email_fetched")?.count ?? 0),
                firstEmailSent: Number(rows.find((r) => r.status === "first_email_sent")?.count ?? 0),
                followUpSent: Number(followUpRows[0]?.count ?? 0),
                imported: Number(rows.find((r) => r.status === "imported")?.count ?? 0),
                ignored: Number(rows.find((r) => r.status === "ignored")?.count ?? 0),
              }))
            : Promise.resolve(null),
        ]);

        return { stats, avgResp, waStats, pendingCount, fhStats };
      }),
  }),
  quotes: quotesRouter,
  adExpenses: adExpensesRouter,
  clients: clientsRouter,
  deliveries: deliveriesRouter,
  emailInquiries: emailInquiriesRouter,
  freehunterBoard: freehunterBoardRouter,
  expenses: expensesRouter,
  loyalty: loyaltyRouter,
  quoteCosts: quoteCostsRouter,
  followUp: followUpRouter,
  pitchOutreach: pitchOutreachRouter,
  linkedinOps: linkedinOpsRouter,
});

export type AppRouter = typeof appRouter;
