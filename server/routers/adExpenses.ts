import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { SERVICE_TYPE_LABELS } from "./quotePdfKit";
import { invokeLLM, extractLLMText } from "../_core/llm";
import {
  createAdSyncLog,
  deleteAdExpense,
  deleteAdTransactionsByPlatform,
  deletePlatformCredential,
  getAllPlatformCredentials,
  getAdExpenses,
  getAdExpenseSummary,
  getAdPlatformConfigs,
  getAdSyncLogs,
  deleteAdSyncLogs,
  getAdTransactions,
  getPlatformCredential,
  getPlatformEfficiency,
  getServiceTypeProfitability,
  getPro360Cookies,
  getHelloTobyCookies,
  savePlatformCredential,
  savePro360Cookies,
  saveHelloTobyCookies,
  updateAdPlatformSyncStatus,
  upsertAdExpense,
  upsertAdPlatformConfig,
  upsertAdTransaction,
  saveAiAnalysisReport,
  getAiAnalysisHistory,
  getLatestAiAnalysis,
} from "../db";
import { scrapeHellotobyExpenses, scrapePro360Expenses, scrapePro360WithCookies, scrapeHelloTobyWithCookies, scrapeHelloTobyViaAPI } from "../scrapers/hellotoby";
import { getSchedulerStatus } from "../scheduler";
import { fetchGoogleAdsCosts, testGoogleAdsConnection } from "../googleAds";

const platformEnum = z.enum(["hellotoby", "360pro", "freehunter", "google_ads"]);

export const adExpensesRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        year: z.number().optional(),
        month: z.number().min(1).max(12).optional(),
        platform: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      return getAdExpenses(input);
    }),

  summary: protectedProcedure
    .input(z.object({ year: z.number() }))
    .query(async ({ input }) => {
      return getAdExpenseSummary(input.year);
    }),

  getTransactions: protectedProcedure
    .input(
      z.object({
        platform: z.string().optional(),
        year: z.number().optional(),
        month: z.number().min(1).max(12).optional(),
        type: z.enum(["expense", "refund", "topup"]).optional(),
        limit: z.number().min(1).max(500).default(100),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      return getAdTransactions(input);
    }),

  platformEfficiency: protectedProcedure
    .input(z.object({ year: z.number() }))
    .query(async ({ input }) => {
      return getPlatformEfficiency(input.year);
    }),

  serviceTypeProfitability: protectedProcedure
    .input(z.object({ year: z.number() }))
    .query(async ({ input }) => {
      return getServiceTypeProfitability(input.year);
    }),

  upsert: protectedProcedure
    .input(
      z.object({
        platform: platformEnum,
        year: z.number().min(2020).max(2099),
        month: z.number().min(1).max(12),
        amount: z.number().min(0),
        currency: z.string().default("HKD"),
        impressions: z.number().optional(),
        clicks: z.number().optional(),
        conversions: z.number().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const id = await upsertAdExpense({
        ...input,
        amount: String(input.amount),
        isAutoSynced: 0,
      });
      return { success: true, id };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteAdExpense(input.id);
      return { success: true };
    }),

  // Platform configs
  getPlatformConfigs: protectedProcedure.query(async () => {
    return getAdPlatformConfigs();
  }),

  savePlatformConfig: protectedProcedure
    .input(
      z.object({
        platform: platformEnum,
        isEnabled: z.boolean(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional(),
        accountId: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await upsertAdPlatformConfig({
        platform: input.platform,
        isEnabled: input.isEnabled ? 1 : 0,
        apiKey: input.apiKey,
        apiSecret: input.apiSecret,
        accountId: input.accountId,
      });
      return { success: true };
    }),

  // ─── Platform Credentials (帳號憑證管理) ─────────────────────────
  getCredentials: protectedProcedure.query(async () => {
    return getAllPlatformCredentials();
  }),

  saveCredential: protectedProcedure
    .input(
      z.object({
        platform: platformEnum,
        email: z.string().email("請輸入有效的電郵地址"),
        password: z.string().min(1, "密碼不能為空"),
      })
    )
    .mutation(async ({ input }) => {
      await savePlatformCredential(input.platform, input.email, input.password);
      return { success: true };
    }),

  deleteCredential: protectedProcedure
    .input(z.object({ platform: platformEnum }))
    .mutation(async ({ input }) => {
      await deletePlatformCredential(input.platform);
      return { success: true };
    }),

  // ─── PRO360 Cookie Session (replaces Google OAuth) ───────────────────────────────────
  savePro360Cookies: protectedProcedure
    .input(
      z.object({
        cookiesJson: z.string().min(10, "請貼上有效的 Cookies JSON"),
        accountEmail: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Validate JSON
      try {
        const parsed = JSON.parse(input.cookiesJson);
        if (!Array.isArray(parsed)) throw new Error("Cookies 必須是陣列格式");
        const hasSessionToken = parsed.some((c: { name: string }) => c.name === "session_token");
        if (!hasSessionToken) throw new Error("缺少 session_token，請確認已複製完整的 Cookies");
      } catch (e) {
        throw new Error(e instanceof Error ? e.message : "Cookies JSON 格式錯誤");
      }
      await savePro360Cookies(input.cookiesJson, input.accountEmail);
      return { success: true };
    }),

  // ─── HelloToby Cookie Session (replaces Google OAuth) ─────────────────────────────────
  saveHelloTobyCookies: protectedProcedure
    .input(
      z.object({
        cookiesJson: z.string().min(10, "請貼上有效的 Cookies JSON"),
        accountEmail: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Validate JSON
      try {
        const parsed = JSON.parse(input.cookiesJson);
        if (!Array.isArray(parsed)) throw new Error("Cookies 必須是陣列格式");
        // Check for key HelloToby cookies
        const hasNftoken = parsed.some((c: { name: string }) => c.name === "nftoken");
        const hasNfsession = parsed.some((c: { name: string }) => c.name === "nfsession");
        if (!hasNftoken && !hasNfsession) throw new Error("缺少 nftoken 或 nfsession，請確認已複製完整的 Cookies");
      } catch (e) {
        throw new Error(e instanceof Error ? e.message : "Cookies JSON 格式錯誤");
      }
      await saveHelloTobyCookies(input.cookiesJson, input.accountEmail);
      return { success: true };
    }),

  // ─── Auto Sync with Puppeteer ─────────────────────────────────────
  syncPlatform: protectedProcedure
    .input(
      z.object({
        platform: platformEnum,
        year: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { platform, year } = input;
      await updateAdPlatformSyncStatus(platform, "syncing");

      try {
        let recordsUpdated = 0;

        if (platform === "hellotoby" || platform === "360pro") {
          let scrapeResult;

          if (platform === "360pro") {
            // PRO360: use Cookie-based scraping (bypasses Google OAuth)
            const cookiesJson = await getPro360Cookies();
            if (!cookiesJson) {
              await updateAdPlatformSyncStatus(platform, "error", "尚未設定 PRO360 Session Cookies，請先在「平台同步」頁面貼上 Cookies");
              await createAdSyncLog({ platform, status: "error", message: "尚未設定 PRO360 Session Cookies", recordsUpdated: 0 });
              throw new Error("尚未設定 PRO360 Session Cookies，請先在「平台同步」頁面貼上 Cookies");
            }
            scrapeResult = await scrapePro360WithCookies(cookiesJson, year);
          } else {
            // HelloToby: use Cookie-based scraping (bypasses Google OAuth)
            const cookiesJson = await getHelloTobyCookies();
            if (!cookiesJson) {
              await updateAdPlatformSyncStatus(platform, "error", "尚未設定 HelloToby Session Cookies，請先在「平台同步」頁面貼上 Cookies");
              await createAdSyncLog({ platform, status: "error", message: "尚未設定 HelloToby Session Cookies", recordsUpdated: 0 });
              throw new Error("尚未設定 HelloToby Session Cookies，請先在「平台同步」頁面貼上 Cookies");
            }
            scrapeResult = await scrapeHelloTobyViaAPI(cookiesJson, year);
          }

          if (!scrapeResult.success) {
            await updateAdPlatformSyncStatus(platform, "error", scrapeResult.error);
            await createAdSyncLog({
              platform,
              status: "error",
              message: scrapeResult.error || "同步失敗",
              recordsUpdated: 0,
            });
            throw new Error(scrapeResult.error || "同步失敗");
          }

          // Auto-renew cookies after successful session
          if (platform === "360pro" && scrapeResult.refreshedCookies) {
            try {
              await savePro360Cookies(scrapeResult.refreshedCookies);
              console.log("[syncPlatform] ✅ PRO360 session cookies auto-renewed.");
            } catch (e) {
              console.warn("[syncPlatform] Failed to save refreshed cookies:", e);
            }
          }
          if (platform === "hellotoby" && scrapeResult.refreshedCookies) {
            try {
              await saveHelloTobyCookies(scrapeResult.refreshedCookies);
              console.log("[syncPlatform] ✅ HelloToby session cookies auto-renewed.");
            } catch (e) {
              console.warn("[syncPlatform] Failed to save HelloToby refreshed cookies:", e);
            }
          }

          // Save scraped expenses to database
          for (const expense of scrapeResult.expenses) {
            const [expYear, expMonth] = expense.month.split("-").map(Number);
            if (expYear && expMonth) {
              await upsertAdExpense({
                platform,
                year: expYear,
                month: expMonth,
                amount: String(expense.amount),
                refundAmount: String(expense.refundAmount ?? 0),
                currency: expense.currency,
                isAutoSynced: 1,
              });
              recordsUpdated++;
            }
          }
          // Save individual transactions
          if (scrapeResult.transactions && scrapeResult.transactions.length > 0) {
            try {
              await deleteAdTransactionsByPlatform(platform);
              for (const tx of scrapeResult.transactions) {
                await upsertAdTransaction({ ...tx, platform: tx.platform as "hellotoby" | "360pro" | "freehunter" | "google_ads" });
              }
              console.log(`[syncPlatform] ✅ Saved ${scrapeResult.transactions.length} individual transactions for ${platform}`);
            } catch (e) {
              console.warn(`[syncPlatform] Failed to save transactions for ${platform}:`, e);
            }
          }
          const message =
            scrapeResult.expenses.length > 0
              ? `成功同步 ${recordsUpdated} 筆記錄`
              : scrapeResult.error || "登入成功，但未找到帳單數據（請確認帳號有廣告開支記錄）";

          await updateAdPlatformSyncStatus(platform, "success");
          await createAdSyncLog({
            platform,
            status: "success",
            message,
            recordsUpdated,
          });

          return { success: true, recordsUpdated, message };
        } else if (platform === "google_ads") {
          // Google Ads: use real API
          const syncYear = year ?? new Date().getFullYear();
          const currentMonth = new Date().getMonth() + 1;
          const monthsToSync = syncYear === new Date().getFullYear()
            ? Array.from({ length: currentMonth }, (_, i) => i + 1)
            : Array.from({ length: 12 }, (_, i) => i + 1);

          for (const m of monthsToSync) {
            const startDate = `${syncYear}-${String(m).padStart(2, "0")}-01`;
            const lastDay = new Date(syncYear, m, 0).getDate();
            const endDate = `${syncYear}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

            const summaries = await fetchGoogleAdsCosts(startDate, endDate);
            const totalCostHKD = summaries.reduce((sum, s) => sum + s.totalCostHKD, 0);
            const totalImpressions = summaries.reduce((sum, s) => sum + s.totalImpressions, 0);
            const totalClicks = summaries.reduce((sum, s) => sum + s.totalClicks, 0);

            if (totalCostHKD > 0) {
              await upsertAdExpense({
                platform,
                year: syncYear,
                month: m,
                amount: String(Math.round(totalCostHKD * 100) / 100),
                currency: "HKD",
                impressions: totalImpressions > 0 ? totalImpressions : undefined,
                clicks: totalClicks > 0 ? totalClicks : undefined,
                isAutoSynced: 1,
              });
              recordsUpdated++;
            }
          }

          await updateAdPlatformSyncStatus(platform, "success");
          await createAdSyncLog({
            platform,
            status: "success",
            message: `成功同步 ${recordsUpdated} 個月份的 Google Ads 費用`,
            recordsUpdated,
          });
          return { success: true, recordsUpdated };
        } else {
          // FreeHunter: mock data
          const mockData = generateMockSyncData(platform);
          for (const record of mockData) {
            await upsertAdExpense({
              platform,
              year: record.year,
              month: record.month,
              amount: String(record.amount),
              impressions: record.impressions,
              clicks: record.clicks,
              conversions: record.conversions,
              isAutoSynced: 1,
            });
            recordsUpdated++;
          }
          await updateAdPlatformSyncStatus(platform, "success");
          await createAdSyncLog({
            platform,
            status: "success",
            message: `成功同步 ${recordsUpdated} 筆記錄`,
            recordsUpdated,
          });
          return { success: true, recordsUpdated };
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : "未知錯誤";
        await updateAdPlatformSyncStatus(platform, "error", errMsg);
        await createAdSyncLog({
          platform,
          status: "error",
          message: errMsg,
          recordsUpdated: 0,
        });
        throw error;
      }
    }),

  getSyncLogs: protectedProcedure
    .input(z.object({ platform: z.string().optional() }))
    .query(async ({ input }) => {
      return getAdSyncLogs(input.platform);
    }),

  clearSyncLogs: protectedProcedure
    .input(z.object({
      platform: z.string(),
      keepCount: z.number().int().min(0).max(10).default(3),
    }))
    .mutation(async ({ input }) => {
      const deleted = await deleteAdSyncLogs(input.platform, input.keepCount);
      return { deleted };
    }),

  // ─── Scheduler Status ─────────────────────────────────────────────
  getSchedulerStatus: protectedProcedure.query(async () => {
    return getSchedulerStatus();
  }),

  // ─── Manual trigger for immediate sync (resets 10-day timer) ─────
  triggerAutoSync: protectedProcedure
    .input(z.object({ platform: platformEnum }))
    .mutation(async ({ input }) => {
      const { platform } = input;
      if (platform !== "360pro" && platform !== "hellotoby") {
        throw new Error("目前只有 360Pro 和 HelloToby 支援自動排程同步");
      }

      await updateAdPlatformSyncStatus(platform, "syncing");
      const currentYear = new Date().getFullYear();
      let result;

      if (platform === "360pro") {
        // PRO360: use Cookie-based scraping
        const cookiesJson = await getPro360Cookies();
        if (!cookiesJson) {
          throw new Error("尚未設定 PRO360 Session Cookies，請先在「平台同步」頁面貼上 Cookies");
        }
        result = await scrapePro360WithCookies(cookiesJson, currentYear);
      } else {
        // HelloToby: use Cookie-based scraping
        const cookiesJson = await getHelloTobyCookies();
        if (!cookiesJson) {
          throw new Error("尚未設定 HelloToby Session Cookies，請先在「平台同步」頁面貼上 Cookies");
        }
        result = await scrapeHelloTobyViaAPI(cookiesJson, currentYear);
      }

      if (!result.success) {
        await updateAdPlatformSyncStatus(platform, "error", result.error);
        await createAdSyncLog({ platform, status: "error", message: `[自動排程] ${result.error || "同步失敗"}`, recordsUpdated: 0 });
        throw new Error(result.error || "同步失敗");
      }
      let recordsUpdated = 0;
      for (const expense of result.expenses) {
        const [expYear, expMonth] = expense.month.split("-").map(Number);
        if (expYear && expMonth) {
          await upsertAdExpense({ platform, year: expYear, month: expMonth, amount: String(expense.amount), refundAmount: String(expense.refundAmount ?? 0), currency: expense.currency, isAutoSynced: 1 });
          recordsUpdated++;
        }
      }
      // Save individual transactions (HelloToby only for now)
      if (result.transactions && result.transactions.length > 0) {
        try {
          await deleteAdTransactionsByPlatform(platform);
          for (const tx of result.transactions) {
            await upsertAdTransaction({ ...tx, platform: tx.platform as "hellotoby" | "360pro" | "freehunter" | "google_ads" });
          }
          console.log(`[triggerAutoSync] ✅ Saved ${result.transactions.length} individual transactions for ${platform}`);
        } catch (e) {
          console.warn("[triggerAutoSync] Failed to save transactions:", e);
        }
      }
      // Auto-renew cookies after successful triggerAutoSync
      if (result.refreshedCookies) {
        try {
          if (platform === "360pro") {
            await savePro360Cookies(result.refreshedCookies);
            console.log("[triggerAutoSync] ✅ PRO360 session cookies auto-renewed.");
          } else {
            await saveHelloTobyCookies(result.refreshedCookies);
            console.log("[triggerAutoSync] ✅ HelloToby session cookies auto-renewed.");
          }
        } catch (e) {
          console.warn("[triggerAutoSync] Failed to save refreshed cookies:", e);
        }
      }
      await updateAdPlatformSyncStatus(platform, "success");
      await createAdSyncLog({ platform, status: "success", message: `[自動排程] 成功同步 ${recordsUpdated} 筆記錄`, recordsUpdated });
      return { success: true, recordsUpdated };
    }),

  // ─── AI 月度廣告效益分析 ─────────────────────────────────────────
  aiAnalysis: protectedProcedure
    .input(z.object({ year: z.number(), month: z.number().min(1).max(12) }))
    .mutation(async ({ input }) => {
      const { year, month } = input;
      // 取得當年全年數據
      const effData = await getPlatformEfficiency(year);
      if (!effData) throw new Error("無法取得平台效益數據");
      const { platformStats, totalNetSpend, totalRevenue, totalLeads, totalConversions, trendByMonth } = effData;

      // 上月資訊
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevYear = month === 1 ? year - 1 : year;
      const prevEffData = month === 1 ? await getPlatformEfficiency(prevYear) : effData;

      // 從 trendByMonth 取得當月及上月廣告開支
      const adPlatformKeys = ["hellotoby", "360pro", "freehunter", "google_ads"] as const;
      const curMonthTrend = trendByMonth.find((r: { month: number }) => r.month === month);
      const prevMonthTrend = (month === 1 && prevEffData)
        ? prevEffData.trendByMonth.find((r: { month: number }) => r.month === 12)
        : trendByMonth.find((r: { month: number }) => r.month === prevMonth);

      const curMonthSpend: Record<string, number> = {};
      const prevMonthSpend: Record<string, number> = {};
      for (const p of adPlatformKeys) {
        curMonthSpend[p] = curMonthTrend ? Number((curMonthTrend as Record<string, unknown>)[p] ?? 0) : 0;
        prevMonthSpend[p] = prevMonthTrend ? Number((prevMonthTrend as Record<string, unknown>)[p] ?? 0) : 0;
      }
      const curMonthTotalSpend = Object.values(curMonthSpend).reduce((a, b) => a + b, 0);
      const prevMonthTotalSpend = Object.values(prevMonthSpend).reduce((a, b) => a + b, 0);

      // 從 quotes 取得當月及上月詢價/成交數據
      const { getDb } = await import("../db");
      const db = await getDb();
      const { quotes, expenses } = await import("../../drizzle/schema");
      const { sql: drizzleSql } = await import("drizzle-orm");

      let curMonthLeads = 0, curMonthConversions = 0, curMonthRevenue = 0;
      let prevMonthLeads = 0, prevMonthConversions = 0, prevMonthRevenue = 0;
      let curMonthAvgQuote = 0, prevMonthAvgQuote = 0;
      // 報價失敗原因分布（當月）
      const rejectionReasons: Record<string, number> = {};
      // 當月所有被拒絕報價的完整明細
      interface RejectedQuoteDetail {
        serviceType: string;
        total: number;
        reason: string;
        leadSource: string;
        notes: string;
      }
      const rejectedQuoteDetails: RejectedQuoteDetail[] = [];
      // 全年歷史拒絕原因統計（作對比）
      const yearlyRejectionReasons: Record<string, number> = {};
      // 服務類型分布（當月成交）
      const serviceTypeMap: Record<string, number> = {};
      // 詢價來源分布（當月）
      const leadSourceMap: Record<string, number> = {};
      // 當月營運支出
      let curMonthOpExpenses = 0;
      const opExpensesByCategory: Record<string, number> = {};
      // 回頭客數量（當月成交中有 clientId 且 clientId 在歷史已有成交記錄）
      let returningClientCount = 0;

      if (db) {
        const curStart = `${year}-${String(month).padStart(2,"0")}-01 00:00:00`;
        const curEndM = month === 12 ? 1 : month + 1;
        const curEndY = month === 12 ? year + 1 : year;
        const curEnd = `${curEndY}-${String(curEndM).padStart(2,"0")}-01 00:00:00`;

        // 當月報價狀態統計
        const curRows = await db.select({
          status: quotes.status,
          count: drizzleSql<number>`COUNT(*)`,
          revenue: drizzleSql<number>`SUM(total)`,
          avgTotal: drizzleSql<number>`AVG(total)`,
        }).from(quotes).where(drizzleSql`createdAt >= ${curStart} AND createdAt < ${curEnd}`).groupBy(quotes.status);
        for (const r of curRows) {
          curMonthLeads += Number(r.count);
          if (r.status === "accepted") {
            curMonthConversions += Number(r.count);
            curMonthRevenue += Number(r.revenue ?? 0);
            curMonthAvgQuote = Number(r.avgTotal ?? 0);
          }
        }

        // 當月報價失敗原因分布
        const rejRows = await db.select({
          reason: quotes.rejectedReason,
          count: drizzleSql<number>`COUNT(*)`,
        }).from(quotes).where(drizzleSql`createdAt >= ${curStart} AND createdAt < ${curEnd} AND status = 'rejected'`).groupBy(quotes.rejectedReason);
        for (const r of rejRows) {
          const key = r.reason ?? "未填寫原因";
          rejectionReasons[key] = Number(r.count);
        }

        // 當月所有被拒絕報價的完整明細（用於 AI 深度分析）
        const rejDetailRows = await db.select({
          serviceType: quotes.serviceType,
          total: quotes.total,
          reason: quotes.rejectedReason,
          leadSource: quotes.leadSource,
          notes: quotes.notes,
        }).from(quotes).where(drizzleSql`createdAt >= ${curStart} AND createdAt < ${curEnd} AND status = 'rejected'`).limit(50);
        for (const r of rejDetailRows) {
          rejectedQuoteDetails.push({
            serviceType: r.serviceType ?? "其他",
            total: Number(r.total ?? 0),
            reason: r.reason ?? "未填寫原因",
            leadSource: r.leadSource ?? "未知",
            notes: r.notes ? String(r.notes).substring(0, 80) : "",
          });
        }

        // 全年歷史拒絕原因統計（${year}年全年）
        const yearStart = `${year}-01-01 00:00:00`;
        const yearEnd = `${year + 1}-01-01 00:00:00`;
        const yearRejRows = await db.select({
          reason: quotes.rejectedReason,
          count: drizzleSql<number>`COUNT(*)`,
        }).from(quotes).where(drizzleSql`createdAt >= ${yearStart} AND createdAt < ${yearEnd} AND status = 'rejected'`).groupBy(quotes.rejectedReason);
        for (const r of yearRejRows) {
          const key = r.reason ?? "未填寫原因";
          yearlyRejectionReasons[key] = Number(r.count);
        }

        // 當月成交服務類型分布
        const svcRows = await db.select({
          serviceType: quotes.serviceType,
          count: drizzleSql<number>`COUNT(*)`,
          revenue: drizzleSql<number>`SUM(total)`,
        }).from(quotes).where(drizzleSql`createdAt >= ${curStart} AND createdAt < ${curEnd} AND status = 'accepted'`).groupBy(quotes.serviceType);
        for (const r of svcRows) {
          serviceTypeMap[r.serviceType] = Number(r.count);
        }

        // 當月詢價來源分布
        const srcRows = await db.select({
          leadSource: quotes.leadSource,
          count: drizzleSql<number>`COUNT(*)`,
        }).from(quotes).where(drizzleSql`createdAt >= ${curStart} AND createdAt < ${curEnd}`).groupBy(quotes.leadSource);
        for (const r of srcRows) {
          leadSourceMap[r.leadSource ?? "未知"] = Number(r.count);
        }

        // 當月營運支出（expenses 表）
        const expRows = await db.select({
          category: expenses.category,
          total: drizzleSql<number>`SUM(amount)`,
        }).from(expenses).where(drizzleSql`date >= ${curStart} AND date < ${curEnd}`).groupBy(expenses.category);
        for (const r of expRows) {
          const amt = Number(r.total ?? 0);
          curMonthOpExpenses += amt;
          opExpensesByCategory[r.category] = amt;
        }

        // 回頭客：當月成交中 clientId 在此月之前已有 accepted 報價
        const returningRows = await db.select({
          count: drizzleSql<number>`COUNT(DISTINCT q.clientId)`,
        }).from(drizzleSql`quotes q`).where(drizzleSql`q.status = 'accepted' AND q.clientId IS NOT NULL AND q.createdAt >= ${curStart} AND q.createdAt < ${curEnd} AND EXISTS (SELECT 1 FROM quotes q2 WHERE q2.clientId = q.clientId AND q2.status = 'accepted' AND q2.createdAt < ${curStart})`);
        returningClientCount = Number(returningRows[0]?.count ?? 0);

        // 上月數據
        const prevStart = `${prevYear}-${String(prevMonth).padStart(2,"0")}-01 00:00:00`;
        const prevEndM = prevMonth === 12 ? 1 : prevMonth + 1;
        const prevEndY = prevMonth === 12 ? prevYear + 1 : prevYear;
        const prevEnd = `${prevEndY}-${String(prevEndM).padStart(2,"0")}-01 00:00:00`;
        const prevRows = await db.select({
          status: quotes.status,
          count: drizzleSql<number>`COUNT(*)`,
          revenue: drizzleSql<number>`SUM(total)`,
          avgTotal: drizzleSql<number>`AVG(total)`,
        }).from(quotes).where(drizzleSql`createdAt >= ${prevStart} AND createdAt < ${prevEnd}`).groupBy(quotes.status);
        for (const r of prevRows) {
          prevMonthLeads += Number(r.count);
          if (r.status === "accepted") {
            prevMonthConversions += Number(r.count);
            prevMonthRevenue += Number(r.revenue ?? 0);
            prevMonthAvgQuote = Number(r.avgTotal ?? 0);
          }
        }
      }

      // ── 從 adExpenses 表取得當月 Google Ads impressions/clicks ──
      let curMonthImpressions = 0;
      let curMonthClicks = 0;
      let prevMonthImpressions = 0;
      let prevMonthClicks = 0;
      if (db) {
        const { adExpenses: adExpensesTable } = await import("../../drizzle/schema");
        const { eq: drizzleEq, and: drizzleAnd } = await import("drizzle-orm");
        const gaRows = await db.select({
          impressions: drizzleSql<number>`SUM(impressions)`,
          clicks: drizzleSql<number>`SUM(clicks)`,
        }).from(adExpensesTable).where(drizzleAnd(
          drizzleEq(adExpensesTable.platform, "google_ads"),
          drizzleEq(adExpensesTable.year, year),
          drizzleEq(adExpensesTable.month, month),
        ));
        curMonthImpressions = Number(gaRows[0]?.impressions ?? 0);
        curMonthClicks = Number(gaRows[0]?.clicks ?? 0);
        const prevGaRows = await db.select({
          impressions: drizzleSql<number>`SUM(impressions)`,
          clicks: drizzleSql<number>`SUM(clicks)`,
        }).from(adExpensesTable).where(drizzleAnd(
          drizzleEq(adExpensesTable.platform, "google_ads"),
          drizzleEq(adExpensesTable.year, prevYear),
          drizzleEq(adExpensesTable.month, prevMonth),
        ));
        prevMonthImpressions = Number(prevGaRows[0]?.impressions ?? 0);
        prevMonthClicks = Number(prevGaRows[0]?.clicks ?? 0);
      }

      // ── 計算 Google Ads CTR 和 CPC ──
      const curGoogleSpend = curMonthSpend["google_ads"] ?? 0;
      const prevGoogleSpend = prevMonthSpend["google_ads"] ?? 0;
      const curCtr = curMonthImpressions > 0 ? ((curMonthClicks / curMonthImpressions) * 100).toFixed(2) : null;
      const prevCtr = prevMonthImpressions > 0 ? ((prevMonthClicks / prevMonthImpressions) * 100).toFixed(2) : null;
      const curCpc = curMonthClicks > 0 && curGoogleSpend > 0 ? (curGoogleSpend / curMonthClicks).toFixed(1) : null;
      const prevCpc = prevMonthClicks > 0 && prevGoogleSpend > 0 ? (prevGoogleSpend / prevMonthClicks).toFixed(1) : null;

      // ── 計算各平台 CPL（每詢價成本）──
      const platformCplMap: Record<string, string> = {};
      for (const p of platformStats as Array<{ platform: string; cpl: number | null; label: string }>) {
        if (p.cpl !== null) platformCplMap[p.label] = `HK$${Math.round(p.cpl)}`;
      }

      const curConvRate = curMonthLeads > 0 ? ((curMonthConversions / curMonthLeads) * 100).toFixed(1) : "0";
      const prevConvRate = prevMonthLeads > 0 ? ((prevMonthConversions / prevMonthLeads) * 100).toFixed(1) : "0";
      const curRoas = curMonthTotalSpend > 0 ? (curMonthRevenue / curMonthTotalSpend).toFixed(2) : "N/A";
      const prevRoas = prevMonthTotalSpend > 0 ? (prevMonthRevenue / prevMonthTotalSpend).toFixed(2) : "N/A";
      const overallConvRate = totalLeads > 0 ? ((totalConversions / totalLeads) * 100).toFixed(1) : "0";
      const overallRoas = totalNetSpend > 0 ? (totalRevenue / totalNetSpend).toFixed(2) : "N/A";

      const spendChangePct = prevMonthTotalSpend > 0
        ? (((curMonthTotalSpend - prevMonthTotalSpend) / prevMonthTotalSpend) * 100).toFixed(1) : "N/A";
      const revenueChangePct = prevMonthRevenue > 0
        ? (((curMonthRevenue - prevMonthRevenue) / prevMonthRevenue) * 100).toFixed(1) : "N/A";
      const leadsChangePct = prevMonthLeads > 0
        ? (((curMonthLeads - prevMonthLeads) / prevMonthLeads) * 100).toFixed(1) : "N/A";

      const platformSummary = platformStats
        .filter((p: { totalLeads: number; spend: number }) => p.totalLeads > 0 || p.spend > 0)
        .map((p: {
          label: string; grade: string; overallScore: number; netSpend: number; revenue: number;
          totalLeads: number; conversions: number; conversionRate: number; roas: number | null;
          trueRoi: number | null; cpa: number | null; ltvCacRatio: number | null; platform: string;
          followUpsSent?: number; followUpWinRate?: number | null; openRate?: number | null;
        }) => ({
          name: p.label, grade: p.grade, score: p.overallScore, spend: p.netSpend,
          revenue: p.revenue, leads: p.totalLeads, conversions: p.conversions,
          convRate: p.conversionRate, roas: p.roas, trueRoi: p.trueRoi, cpa: p.cpa,
          ltvCac: p.ltvCacRatio,
          followUpsSent: p.followUpsSent ?? 0,
          followUpWinRate: p.followUpWinRate ?? null,
          openRate: p.openRate ?? null,
          curSpend: curMonthSpend[p.platform] ?? 0,
          prevSpend: prevMonthSpend[p.platform] ?? 0,
        }))
        .sort((a: { score: number }, b: { score: number }) => b.score - a.score);

      const followUpChannelSummary = platformSummary
        .filter((p: { followUpsSent: number }) => p.followUpsSent > 0)
        .map((p: { name: string; followUpsSent: number; followUpWinRate: number | null; openRate: number | null }) =>
          `${p.name}：跟進${p.followUpsSent}次／跟進後成交率${p.followUpWinRate ?? "—"}%／郵件打開率${p.openRate ?? "—"}%`
        )
        .join("；") || "暫無跟進成效數據";

      const monthNames = ["一月","二月","三月","四月","五月","六月","七月","八月","九月","十月","十一月","十二月"];
      const monthLabel = monthNames[month - 1];
      const prevMonthLabel = monthNames[prevMonth - 1];
      const nextMonthNum = month === 12 ? 1 : month + 1;
      const nextYearNum = month === 12 ? year + 1 : year;
      const nextMonthLabel = monthNames[nextMonthNum - 1];
      const nextMonthTitle = `${nextYearNum}年${nextMonthLabel}`;

      // 計算淨利潤（收入 - 廣告開支 - 營運支出）
      const curMonthNetProfit = curMonthRevenue - curMonthTotalSpend - curMonthOpExpenses;
      const prevMonthNetProfit = prevMonthRevenue - prevMonthTotalSpend;
      const netProfitChangePct = prevMonthNetProfit !== 0
        ? (((curMonthNetProfit - prevMonthNetProfit) / Math.abs(prevMonthNetProfit)) * 100).toFixed(1) : "N/A";
      const avgQuoteChangePct = prevMonthAvgQuote > 0
        ? (((curMonthAvgQuote - prevMonthAvgQuote) / prevMonthAvgQuote) * 100).toFixed(1) : "N/A";

      // 服務類型中文名稱對照（從 quotePdfKit 引入，單一來源）
      const serviceTypeSummary = Object.entries(serviceTypeMap)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${SERVICE_TYPE_LABELS[k] ?? k}：${v}單`)
        .join("、") || "暫無成交數據";

      const rejectionSummary = Object.entries(rejectionReasons)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}（${v}宗）`)
        .join("、") || "暫無拒絕記錄";

      const yearlyRejectionSummary = Object.entries(yearlyRejectionReasons)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}（${v}宗）`)
        .join("、") || "暫無全年數據";

      const totalYearlyRejections = Object.values(yearlyRejectionReasons).reduce((a, b) => a + b, 0);

      const rejectedDetailsText = rejectedQuoteDetails.length > 0
        ? rejectedQuoteDetails.map((r, i) =>
            `${i + 1}. 服務：${SERVICE_TYPE_LABELS[r.serviceType] ?? r.serviceType} | 金額：HK$${r.total.toLocaleString()} | 來源：${r.leadSource} | 原因：${r.reason}${r.notes ? ` | 備註：${r.notes}` : ""}`
          ).join("\n")
        : "本月暫無被拒絕的報價記錄";

      const leadSourceSummary = Object.entries(leadSourceMap)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}：${v}個`)
        .join("、") || "暫無來源數據";

      const opExpSummary = Object.entries(opExpensesByCategory)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}：HK$${Number(v).toLocaleString()}`)
        .join("、") || "暫無支出記錄";

      // 計算拒絕報價平均金額
      const avgRejectedAmount = rejectedQuoteDetails.length > 0
        ? Math.round(rejectedQuoteDetails.reduce((sum, r) => sum + r.total, 0) / rejectedQuoteDetails.length)
        : 0;

      // 計算 CPL 各平台摘要文字
      const cplSummary = Object.entries(platformCplMap)
        .map(([name, cpl]) => `${name}：${cpl}/詢價`)
        .join("、") || "暫無 CPL 數據";

      const prompt = `你是一位商業分析師（Commercial Analyst），服務香港 B2B 創意／攝影工作室。你的唯一目標不是寫漂亮報告，而是：

**用 ${year}年${monthLabel} 的真實數據，設計 ${nextMonthTitle} 的投放與成交策略，從而提高「詢價→成交率」與「營業額」。**

決策框架（必須貫穿全文）：
1. 診斷：本月哪個環節流失最大（曝光→點擊→詢價→報價→成交→客單）？
2. 歸因：流失來自渠道質量、CPL/CPC、跟進、定價、還是服務結構？
3. 決策：${nextMonthTitle} 預算如何重新分配？加碼／凍結／砍哪個平台？
4. 成交：怎樣提高成交率（跟進、報價、拒絕原因對策）？
5. 營業額：怎樣提高收入（高意向渠道、高客單服務、回頭客）？
6. 量化：每項行動要有預期影響（成交率 pp 或 HKD）與完成期限。

以下是系統抽取的真實數據，請嚴格依據數字，不要編造未提供的指標。

---
# ${year}年${monthLabel} → ${nextMonthTitle}｜商業分析師投放決策報告

## 本月 vs 上月（增長／流失總覽）
- 廣告開支：本月 HK$${curMonthTotalSpend.toLocaleString()}｜上月 HK$${prevMonthTotalSpend.toLocaleString()}｜變化 ${spendChangePct !== "N/A" ? (Number(spendChangePct) >= 0 ? "+" : "") + spendChangePct + "%" : "N/A"}
- 詢價：本月 ${curMonthLeads}｜上月 ${prevMonthLeads}｜變化 ${leadsChangePct !== "N/A" ? (Number(leadsChangePct) >= 0 ? "+" : "") + leadsChangePct + "%" : "N/A"}
- 成交：本月 ${curMonthConversions}｜上月 ${prevMonthConversions}
- 成交率：本月 ${curConvRate}%｜上月 ${prevConvRate}%｜全年 ${overallConvRate}%
- 營業額：本月 HK$${curMonthRevenue.toLocaleString()}｜上月 HK$${prevMonthRevenue.toLocaleString()}｜變化 ${revenueChangePct !== "N/A" ? (Number(revenueChangePct) >= 0 ? "+" : "") + revenueChangePct + "%" : "N/A"}
- ROAS：本月 ${curRoas}${curRoas !== "N/A" ? "x" : ""}｜上月 ${prevRoas}${prevRoas !== "N/A" ? "x" : ""}｜全年 ${overallRoas}${overallRoas !== "N/A" ? "x" : ""}
- 淨利估算：本月 HK$${Math.round(curMonthNetProfit).toLocaleString()}（廣告 HK$${curMonthTotalSpend.toLocaleString()} + 營運 HK$${curMonthOpExpenses.toLocaleString()}）
- 回頭客成交：${returningClientCount} 位
- 平均失敗報價金額：HK$${avgRejectedAmount.toLocaleString()}

## 漏斗指標（投放 → 曝光 → 點擊 → 詢價 → 成交）

### ① 投放力度（預算結構）
| 平台 | ${monthLabel}開支 | ${prevMonthLabel}開支 | 變化 |
|------|---------|---------|------|
${platformSummary.map((p: { name: string; curSpend: number; prevSpend: number }) => {
  const change = p.prevSpend > 0 ? (((p.curSpend - p.prevSpend) / p.prevSpend) * 100).toFixed(1) : "N/A";
  return `| ${p.name} | HK$${p.curSpend.toLocaleString()} | HK$${p.prevSpend.toLocaleString()} | ${change !== "N/A" ? (Number(change) >= 0 ? "+" : "") + change + "%" : "N/A"} |`;
}).join("\n")}
| **合計** | **HK$${curMonthTotalSpend.toLocaleString()}** | **HK$${prevMonthTotalSpend.toLocaleString()}** | **${spendChangePct !== "N/A" ? (Number(spendChangePct) >= 0 ? "+" : "") + spendChangePct + "%" : "N/A"}** |

### ②–④ Google Ads 曝光／CTR／CPC
- 曝光：本月 ${curMonthImpressions > 0 ? curMonthImpressions.toLocaleString() : "暫無"}｜上月 ${prevMonthImpressions > 0 ? prevMonthImpressions.toLocaleString() : "暫無"}
- CTR：本月 ${curCtr !== null ? curCtr + "%" : "暫無"}｜上月 ${prevCtr !== null ? prevCtr + "%" : "暫無"}（業界參考 1–3%）
- CPC：本月 ${curCpc !== null ? "HK$" + curCpc : "暫無"}｜上月 ${prevCpc !== null ? "HK$" + prevCpc : "暫無"}
- Google Ads 本月開支：HK$${curGoogleSpend.toLocaleString()}

### ⑤–⑥ 詢價成本與來源質量
- 各平台 CPL（全年均值）：${cplSummary}
- 本月詢價來源：${leadSourceSummary}
- 成交服務類型：${serviceTypeSummary}

### ⑦ 成交率與拒絕原因（提高成交率的關鍵）
- 失敗原因分布：${rejectionSummary}
- 全年失敗原因：${yearlyRejectionSummary}
- 失敗明細：
${rejectedDetailsText}

### ⑧ 平台綜合效益（加碼／砍量依據）
| 平台 | 評級 | 全年ROAS | 全年CPL | 成交率 | 全年開支 | 本月開支 |
|------|------|---------|---------|--------|----------|----------|
${platformSummary.map((p: {
  name: string; grade: string; score: number; spend: number;
  leads: number; conversions: number; convRate: number; roas: number | null;
  cpa: number | null; curSpend: number;
}) => `| ${p.name} | ${p.grade}(${p.score}分) | ${p.roas !== null ? p.roas + "x" : "-"} | ${platformCplMap[p.name] ?? "-"} | ${p.convRate}% | HK$${p.spend.toLocaleString()} | HK$${p.curSpend.toLocaleString()} |`).join("\n")}

### 跟進效率
${followUpChannelSummary}

### 營運支出（影響淨利）
${opExpSummary}

---
# 請輸出報告結構（必須完整，不可省略）

## A. 執行摘要（給老闆 30 秒看完）
- 本月生意結論（營業額／成交率／ROAS 一句話）
- 最大增長槓桿 vs 最大出血點（各 1 點）
- ${nextMonthTitle} 目標建議：成交率目標（%）＋營業額目標（HKD）＋所需詢價／預算粗算

## B. 漏斗診斷（本月哪裡丟單／丟錢）
依序分析：投放→曝光→CTR→CPC→CPL→詢價質量→成交率→ROAS。每層只寫：
- 數據事實
- 商業含義（對成交率／營業額的影響）
- 是否值得在 ${nextMonthTitle} 優先處理

## C. 渠道決策矩陣（${nextMonthTitle} 必做）
為每個有花費或有詢價的平台標註：**加碼／維持／優化後再加／減碼／暫停**，並給出：
- 建議預算（HKD）
- 原因（用 CPL、成交率、ROAS、來源質量）
- 預期對詢價量／成交／營業額的影響

## D. 提高成交率行動（非純投流）
根據拒絕原因與跟進數據，列出 3–5 項可在 ${nextMonthTitle} 執行的成交率提升動作（報價、跟進節奏、服務包裝、定價）。每項寫預期可提升幾個百分點。

## E. 提高營業額行動
指出應側重哪些服務類型／客單／回頭客策略，以及廣告訊息應指向哪些高意向關鍵字或場景（結合現有數據，勿空談）。

## F. ${nextMonthTitle} 投放作戰計劃（核心產出）
用表格輸出：
| 優先級 | 行動 | 負責人(Derek/助理) | 對應指標 | 預期影響(成交率pp或HKD) | 完成期限 |
|--------|------|-------------------|----------|-------------------------|----------|
至少 5 項，按影響力排序。前 3 項必須是「不做就影響下月營業額」的事。

## G. 異常警報（如有）
CPL 暴升、成交率驟降、ROAS < 1、某渠道只燒錢無成交 → 立即止血方案。

寫作要求：
- 繁體中文；商業分析師口吻：冷靜、量化、可執行
- 禁止空泛句（如「加強品牌曝光」）；每句建議要能落地
- 所有結論必須能回溯到上方數據；缺數據就寫「缺什麼數據、怎樣補、否則決策風險是什麼」
- 全文焦點永遠係：${nextMonthTitle} 點樣用更好投放 + 更高成交率帶動更高營業額`;

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content:
              "你是服務香港攝影／創意工作室的商業分析師。你的報告只服務一個目的：根據本月數據，制定下月投放與成交策略，以提高成交率與營業額。風格像內部商業分析備忘：直接、量化、可執行，不要公關腔。請用繁體中文。",
          },
          { role: "user", content: prompt },
        ],
      });

      const content = extractLLMText(response?.choices?.[0]?.message?.content);
      const dataSnapshot = {
        totalNetSpend, totalRevenue, overallRoas, overallConvRate,
        platformCount: platformSummary.length,
        curMonthTotalSpend, prevMonthTotalSpend,
        curMonthRevenue, prevMonthRevenue,
        curMonthLeads, prevMonthLeads,
        curMonthConversions, prevMonthConversions,
        spendChangePct, revenueChangePct,
        curMonthNetProfit, prevMonthNetProfit, netProfitChangePct,
        curMonthAvgQuote, prevMonthAvgQuote, avgQuoteChangePct,
        returningClientCount, curMonthOpExpenses,
        rejectionReasons, serviceTypeMap, leadSourceMap,
        rejectedQuoteCount: rejectedQuoteDetails.length,
        avgRejectedAmount,
        yearlyRejectionReasons,
        totalYearlyRejections,
        // Google Ads 曝光/點擊（漏斗診斷用）
        curMonthImpressions, prevMonthImpressions,
        curMonthClicks, prevMonthClicks,
        curCtr, prevCtr,
        curCpc, prevCpc,
        curGoogleSpend, prevGoogleSpend,
        platformCplMap,
      };
      await saveAiAnalysisReport({ year, month, analysis: content, dataSnapshot });
      return { analysis: content, generatedAt: new Date().toISOString(), year, month, dataSnapshot };
    }),

  getAiAnalysisHistory: protectedProcedure
    .input(z.object({
      year: z.number().optional(),
      month: z.number().min(1).max(12).optional(),
      limit: z.number().min(1).max(50).optional(),
    }))
    .query(async ({ input }) => {
      const reports = await getAiAnalysisHistory(input);
      return reports.map(r => ({
        id: r.id,
        year: r.year,
        month: r.month,
        analysis: r.analysis,
        dataSnapshot: r.dataSnapshot,
        generatedAt: r.generatedAt instanceof Date ? r.generatedAt.toISOString() : String(r.generatedAt),
      }));
    }),

  getLatestAiAnalysis: protectedProcedure
    .input(z.object({ year: z.number(), month: z.number().min(1).max(12) }))
    .query(async ({ input }) => {
      const report = await getLatestAiAnalysis(input.year, input.month);
      if (!report) return null;
      return {
        id: report.id,
        year: report.year,
        month: report.month,
        analysis: report.analysis,
        dataSnapshot: report.dataSnapshot,
        generatedAt: report.generatedAt instanceof Date ? report.generatedAt.toISOString() : String(report.generatedAt),
      };
    }),

  // ─── Google Ads API Connection Test ─────────────────────────────────
  testGoogleAdsConnection: protectedProcedure.mutation(async () => {
    return testGoogleAdsConnection();
  }),

  // ─── Monthly Platform Quote Stats ────────────────────────────────────
  // 查詢指定年月每個平台的詢價數和已接受報價數
  monthlyPlatformQuotes: protectedProcedure
    .input(z.object({ year: z.number(), month: z.number().min(1).max(12) }))
    .query(async ({ input }) => {
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return [];
      const { quotes } = await import("../../drizzle/schema");
      const { sql: drizzleSql } = await import("drizzle-orm");

      const { year, month } = input;
      const start = `${year}-${String(month).padStart(2, "0")}-01 00:00:00`;
      const endM = month === 12 ? 1 : month + 1;
      const endY = month === 12 ? year + 1 : year;
      const end = `${endY}-${String(endM).padStart(2, "0")}-01 00:00:00`;

      const LEAD_SOURCE_MAP: Record<string, string> = {
        HelloToby: "hellotoby",
        PRO360: "360pro",
        FreelanceHunter: "freehunter",
        Google: "google_ads",
        Instagram: "instagram",
        Facebook: "facebook",
        "88DB": "88db",
        Referral: "referral",
        Website: "website",
        Repeat: "repeat",
        Other: "other",
      };

      // 詢價數：按 createdAt（建立日期）篩選當月所有報價單
      const leadsRows = await db
        .select({
          leadSource: quotes.leadSource,
          count: drizzleSql<number>`COUNT(*)`,
        })
        .from(quotes)
        .where(drizzleSql`createdAt >= ${start} AND createdAt < ${end}`)
        .groupBy(quotes.leadSource);

      // 已接受數：有拍攝日按拍攝月；無拍攝日按開單月 createdAt（與評分卡／Dashboard 一致）
      const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
      const endDate = `${endY}-${String(endM).padStart(2, "0")}-01`;
      const acceptedRows = await db
        .select({
          leadSource: quotes.leadSource,
          count: drizzleSql<number>`COUNT(*)`,
        })
        .from(quotes)
        .where(drizzleSql`
          status = 'accepted'
          AND (
            (shootingDate IS NOT NULL AND shootingDate != '' AND shootingDate >= ${startDate} AND shootingDate < ${endDate})
            OR
            ((shootingDate IS NULL OR shootingDate = '') AND createdAt >= ${start} AND createdAt < ${end})
          )
        `)
        .groupBy(quotes.leadSource);

      const platformMap: Record<string, { leads: number; accepted: number }> = {};

      for (const row of leadsRows) {
        const src = row.leadSource?.trim() ?? "unknown";
        const key = LEAD_SOURCE_MAP[src] ?? src.toLowerCase();
        if (!platformMap[key]) platformMap[key] = { leads: 0, accepted: 0 };
        platformMap[key].leads += Number(row.count);
      }

      for (const row of acceptedRows) {
        const src = row.leadSource?.trim() ?? "unknown";
        const key = LEAD_SOURCE_MAP[src] ?? src.toLowerCase();
        if (!platformMap[key]) platformMap[key] = { leads: 0, accepted: 0 };
        platformMap[key].accepted += Number(row.count);
      }

      return Object.entries(platformMap).map(([platform, stats]) => ({
        platform,
        leads: stats.leads,
        accepted: stats.accepted,
      }));
    }),
});

function generateMockSyncData(platform: string) {
  const now = new Date();
  const records = [];
  for (let i = 0; i < 3; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const baseAmounts: Record<string, number> = {
      hellotoby: 1200,
      "360pro": 800,
      freehunter: 600,
      google_ads: 3500,
    };
    const base = baseAmounts[platform] ?? 1000;
    records.push({
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      amount: base + Math.floor(Math.random() * 500 - 250),
      impressions: Math.floor(Math.random() * 50000) + 10000,
      clicks: Math.floor(Math.random() * 2000) + 500,
      conversions: Math.floor(Math.random() * 50) + 5,
    });
  }
  return records;
}
