import { z } from "zod";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { getDb } from "../db";
import { expenses } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";

const CATEGORY_LABELS: Record<string, string> = {
  transport: "車費",
  equipment_rent: "租用器材",
  equipment_buy: "購買器材",
  staff: "員工薪酬",
  software: "軟件/訂閱",
  marketing: "市場推廣",
  office: "辦公室/場地",
  other: "其他",
};

const expenseInputSchema = z.object({
  date: z.string(),
  category: z.enum(["transport", "equipment_rent", "equipment_buy", "staff", "software", "marketing", "office", "other"]),
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
      const conditions = [];

      if (input?.year && input?.month) {
        const startDate = new Date(input.year, input.month - 1, 1);
        const endDate = new Date(input.year, input.month, 0, 23, 59, 59);
        conditions.push(gte(expenses.date, startDate));
        conditions.push(lte(expenses.date, endDate));
      } else if (input?.year) {
        const startDate = new Date(input.year, 0, 1);
        const endDate = new Date(input.year, 11, 31, 23, 59, 59);
        conditions.push(gte(expenses.date, startDate));
        conditions.push(lte(expenses.date, endDate));
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
      const startDate = new Date(input.year, input.month - 1, 1);
      const endDate = new Date(input.year, input.month, 0, 23, 59, 59);

      const rows = await db
        .select({
          category: expenses.category,
          total: sql<string>`SUM(${expenses.amount})`,
          count: sql<string>`COUNT(*)`,
        })
        .from(expenses)
        .where(and(gte(expenses.date, startDate), lte(expenses.date, endDate)))
        .groupBy(expenses.category);

      const summary = rows.map(r => ({
        category: r.category,
        categoryLabel: CATEGORY_LABELS[r.category] ?? r.category,
        total: Number(r.total) || 0,
        count: Number(r.count) || 0,
      }));

      const grandTotal = summary.reduce((sum, r) => sum + r.total, 0);
      return { summary, grandTotal };
    }),

  // Create expense
  create: protectedProcedure
    .input(expenseInputSchema)
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
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
