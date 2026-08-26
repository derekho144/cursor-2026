import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getQuoteCosts,
  createQuoteCost,
  deleteQuoteCost,
  getQuoteCostSummary,
  getQuoteById,
  createExpenseFromQuoteCost,
} from "../db";

const COST_CATEGORY_LABELS: Record<string, string> = {
  freelancer: "外判人員",
  venue: "拍攝場地",
  post_production: "後期製作",
  transport: "車費/交通",
  equipment_rent: "租用器材",
  equipment_buy: "購買器材",
  staff: "員工薪酬",
  other: "其他",
};

export const quoteCostsRouter = router({
  // 取得某張報價單的所有成本
  list: protectedProcedure
    .input(z.object({ quoteId: z.number() }))
    .query(async ({ input }) => {
      const costs = await getQuoteCosts(input.quoteId);
      return costs.map((c) => ({
        ...c,
        amount: Number(c.amount),
        categoryLabel: COST_CATEGORY_LABELS[c.category] ?? c.category,
      }));
    }),

  // 取得成本摘要（含毛利計算用）
  summary: protectedProcedure
    .input(z.object({ quoteId: z.number() }))
    .query(async ({ input }) => {
      const { totalCost, costs } = await getQuoteCostSummary(input.quoteId);
      return {
        totalCost,
        costs: costs.map((c) => ({
          ...c,
          amount: Number(c.amount),
          categoryLabel: COST_CATEGORY_LABELS[c.category] ?? c.category,
        })),
      };
    }),

  // 新增成本項目 → 同步寫入「收入及支出」支出欄並自動儲存
  create: protectedProcedure
    .input(
      z.object({
        quoteId: z.number(),
        category: z.enum([
          "freelancer",
          "venue",
          "post_production",
          "transport",
          "equipment_rent",
          "equipment_buy",
          "staff",
          "other",
        ]),
        description: z.string().min(1).max(512),
        amount: z.number().positive(),
        payee: z.string().max(255).optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const cost = await createQuoteCost({
        quoteId: input.quoteId,
        category: input.category,
        description: input.description,
        amount: input.amount.toString(),
        payee: input.payee ?? null,
        notes: input.notes ?? null,
      });

      let expenseId: number | undefined;
      try {
        const quote = await getQuoteById(input.quoteId);
        if (quote && cost?.id) {
          const expense = await createExpenseFromQuoteCost({
            quoteCostId: cost.id,
            quoteNumber: quote.quoteNumber,
            clientName: quote.clientName,
            shootingDate: quote.shootingDate,
            category: input.category,
            description: input.description,
            amount: input.amount,
            payee: input.payee ?? null,
            notes: input.notes ?? null,
          });
          expenseId = expense.id;
        }
      } catch (err) {
        console.error(
          `[quoteCosts.create] Failed to sync expense for cost #${cost?.id}:`,
          err
        );
      }

      return {
        ...cost,
        amount: Number(cost.amount),
        categoryLabel: COST_CATEGORY_LABELS[cost.category] ?? cost.category,
        expenseId,
        syncedToExpense: Boolean(expenseId),
      };
    }),

  // 刪除成本項目（同時刪除已同步的支出）
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteQuoteCost(input.id);
      return { success: true };
    }),
});
