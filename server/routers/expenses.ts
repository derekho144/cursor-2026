import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import { getDb, ensureExpensesPostProductionCategory } from "../db";
import { expenses } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { EXPENSE_CATEGORY_LABELS as CATEGORY_LABELS, expenseMonthCondition, getMonthlyExpenseSummary } from "../monthlyExpenses";

const expenseInputSchema = z.object({
  date: z.string(),
  category: z.enum([
    "transport",
    "equipment_rent",
    "equipment_buy",
    "staff",
    "post_production",
    "software",
    "marketing",
    "office",
    "other",
  ]),
  description: z.string().min(1).max(512),
  amount: z.number().positive(),
  payee: z.string().max(255).optional(),
  receiptUrl: z.string().max(1024).optional().or(z.literal("")),
  notes: z.string().optional(),
});

export const expensesRouter = router({
  // List expenses with optional month/year filter
  list: protectedProcedure
    .input(z.object({
      year: z.number().optional(),
      month: z.number().min(1).max(12).optional(),
      category: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      await ensureExpensesPostProductionCategory();
      const conditions = [];

      if (input?.year && input?.month) {
        conditions.push(expenseMonthCondition(input.year, input.month));
      } else if (input?.year) {
        conditions.push(sql`YEAR(${expenses.date}) = ${input.year}`);
      }

      if (input?.category && input.category !== "all") {
        conditions.push(sql`${expenses.category} = ${input.category}`);
      }

      const rows = await db
        .select()
        .from(expenses)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(expenses.date));

      return rows.map(r => ({
        ...r,
        amount: Number(r.amount),
        categoryLabel: CATEGORY_LABELS[r.category] ?? r.category,
        isFromQuoteCost: r.quoteCostId != null,
      }));
    }),

  // Monthly summary by category
  monthlySummary: protectedProcedure
    .input(z.object({
      year: z.number(),
      month: z.number().min(1).max(12),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      return getMonthlyExpenseSummary(db, input.year, input.month);
    }),

  // Create expense
  create: protectedProcedure
    .input(expenseInputSchema)
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      await ensureExpensesPostProductionCategory();
      const [result] = await db.insert(expenses).values({
        date: new Date(input.date),
        category: input.category,
        description: input.description,
        amount: String(input.amount),
        payee: input.payee || null,
        receiptUrl: input.receiptUrl || null,
        notes: input.notes || null,
      });
      return { id: result.insertId };
    }),

  // Update expense
  update: protectedProcedure
    .input(z.object({ id: z.number() }).merge(expenseInputSchema))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const { id, ...data } = input;
      await db.update(expenses).set({
        date: new Date(data.date),
        category: data.category,
        description: data.description,
        amount: String(data.amount),
        payee: data.payee || null,
        receiptUrl: data.receiptUrl || null,
        notes: data.notes || null,
      }).where(eq(expenses.id, id));
      return { success: true };
    }),

  // Delete expense
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      await db.delete(expenses).where(eq(expenses.id, input.id));
      return { success: true };
    }),
});
