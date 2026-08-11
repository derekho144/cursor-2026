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
import { getReceivablesSummary, getRecentActivity } from "./opsInsights";
import { quoteCostsRouter } from "./routers/quoteCosts";
import { followUpRouter } from "./routers/followUp";
import { pitchOutreachRouter } from "./routers/pitchOutreach";
import { linkedinOpsRouter } from "./routers/linkedinOps";
import { linkedinContentRouter } from "./routers/linkedinContent";
import { protectedProcedure } from "./_core/trpc";
import { emailInquiries, freehunterJobs } from "../drizzle/schema";
import { eq, sql, isNotNull, and, gt } from "drizzle-orm";
import { getWatchdogStatus } from "./watchdog";
import { lastFreehunterScrapeAt, lastFreehunterScrapeResult } from "./scheduler";

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
      .input(z.object({ year: z.number(), month: z.number().min(1).max(12) }).optional())
      .query(async ({ input }) => {
        const hkt = new Date(Date.now() + 8 * 60 * 60 * 1000);
        const year = input?.year ?? hkt.getUTCFullYear();
        const month = input?.month ?? hkt.getUTCMonth() + 1;
        return getWhatsappClickStats({ year, month });
      }),
    // ─── Merged Dashboard Query ───────────────────────────────────────────
    // Replaces 5 separate API calls with 1 parallel Promise.all
    all: protectedProcedure
      .input(z.object({ year: z.number().optional(), month: z.number().min(1).max(12).optional() }).optional())
      .query(async ({ input }) => {
        const hkt = new Date(Date.now() + 8 * 60 * 60 * 1000);
        const year = input?.year ?? hkt.getUTCFullYear();
        const month = input?.month ?? hkt.getUTCMonth() + 1;
        const db = await getDb();

        const [stats, avgResp, waStats, pendingCount, fhStats, receivables, recentActivity, fhHealth] = await Promise.all([
          // 1. Main KPI stats (revenue, ad spend, trend, source distribution)
          getDashboardStats(year, month),
          // 2. Average response time
          getAvgResponseTimeHours({ year, month }),
          // 3. WhatsApp click stats (same selected month as other KPIs)
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
          // 6. Receivables / overdue
          getReceivablesSummary(20),
          // 7. Recent activity timeline
          getRecentActivity(15),
          // 8. FH health (DB last scrape + in-memory + watchdog)
          db
            ? db
                .select({ lastScrapedAt: sql<Date | null>`MAX(${freehunterJobs.scrapedAt})` })
                .from(freehunterJobs)
                .then(([row]) => {
                  const lastDb = row?.lastScrapedAt ? new Date(row.lastScrapedAt) : null;
                  const lastMem = lastFreehunterScrapeAt;
                  const lastAt = [lastDb, lastMem].filter(Boolean).sort((a, b) => (b!.getTime() - a!.getTime()))[0] ?? null;
                  const ageHours = lastAt ? (Date.now() - lastAt.getTime()) / (3600 * 1000) : null;
                  const hktHour = new Date(Date.now() + 8 * 3600 * 1000).getUTCHours();
                  const inActiveHours = hktHour >= 8 && hktHour < 21;
                  const scrapeStale = inActiveHours && (ageHours == null || ageHours > 2);
                  return {
                    lastScrapedAt: lastAt?.toISOString() ?? null,
                    lastScrapeResult: lastFreehunterScrapeResult ?? null,
                    ageHours: ageHours != null ? Math.round(ageHours * 10) / 10 : null,
                    scrapeStale,
                    watchdog: getWatchdogStatus(),
                  };
                })
            : Promise.resolve(null),
        ]);

        return { stats, avgResp, waStats, pendingCount, fhStats, receivables, recentActivity, fhHealth };
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
  linkedinContent: linkedinContentRouter,
});

export type AppRouter = typeof appRouter;
