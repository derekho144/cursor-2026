import { z } from "zod";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
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
import { getDashboardStats, getDashboardStatsQuick, getAvgResponseTimeHours, getWhatsappClickStats, getMonthlyQuoteCosts, getDb, getUserByUsername } from "./db";
import { getReceivablesSummary, getRecentActivity } from "./opsInsights";
import { quoteCostsRouter } from "./routers/quoteCosts";
import { followUpRouter } from "./routers/followUp";
import { pitchOutreachRouter } from "./routers/pitchOutreach";
import { linkedinOpsRouter } from "./routers/linkedinOps";
import { linkedinContentRouter } from "./routers/linkedinContent";
import { employeesRouter } from "./routers/employees";
import { pricingLearningRouter } from "./routers/pricingLearning";
import { protectedProcedure } from "./_core/trpc";
import { emailInquiries, freehunterJobs } from "../drizzle/schema";
import { eq, sql, isNotNull, and, gt } from "drizzle-orm";
import { getWatchdogStatus } from "./watchdog";
import { lastFreehunterScrapeAt, lastFreehunterScrapeResult } from "./scheduler";
import { parseAllowedPages } from "@shared/pagePermissions";
import { verifyPassword } from "./passwordAuth";
import { sdk } from "./_core/sdk";
import { TRPCError } from "@trpc/server";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(({ ctx }) => {
      const u = ctx.user;
      if (!u) return null;
      const { passwordHash: _ph, ...safe } = u as typeof u & { passwordHash?: string | null };
      return {
        ...safe,
        isActive: u.isActive !== false,
        allowedPages: parseAllowedPages(u.allowedPages),
        username: (u as { username?: string | null }).username ?? null,
        hasPassword: Boolean(_ph),
      };
    }),
    login: publicProcedure
      .input(
        z.object({
          username: z.string().trim().min(1).max(64),
          password: z.string().min(1).max(128),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const user = await getUserByUsername(input.username);
        if (!user?.passwordHash || !user.username) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "帳號或密碼錯誤",
          });
        }
        if (!verifyPassword(input.password, user.passwordHash)) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "帳號或密碼錯誤",
          });
        }
        if (user.role !== "admin" && user.isActive === false) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "帳戶已停用，請聯絡管理員",
          });
        }

        const sessionName =
          (user.name && String(user.name).trim()) ||
          user.username ||
          "User";
        const sessionToken = await sdk.createSessionToken(user.openId, {
          name: sessionName,
          expiresInMs: ONE_YEAR_MS,
        });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, {
          ...cookieOptions,
          maxAge: ONE_YEAR_MS,
        });

        const { passwordHash: _ph, ...safe } = user;
        return {
          ...safe,
          isActive: user.isActive !== false,
          allowedPages: parseAllowedPages(user.allowedPages),
          hasPassword: true,
        };
      }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  employees: employeesRouter,
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
  pricingLearning: pricingLearningRouter,
});

export type AppRouter = typeof appRouter;
