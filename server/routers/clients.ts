import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createClient,
  deleteClient,
  getClientById,
  getClients,
  getClientsWithLTV,
  searchClients,
  updateClient,
  upsertClientFromQuote,
} from "../db";

export const clientsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        search: z.string().optional(),
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      return getClients(input);
    }),

  listWithLTV: protectedProcedure
    .input(
      z.object({
        search: z.string().optional(),
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
        sortBy: z.enum(['ltv', 'orderCount', 'lastOrder', 'default']).optional(),
      })
    )
    .query(async ({ input }) => {
      return getClientsWithLTV(input);
    }),

  search: protectedProcedure
    .input(z.object({ query: z.string(), limit: z.number().min(1).max(20).default(10) }))
    .query(async ({ input }) => {
      return searchClients(input.query, input.limit);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const client = await getClientById(input.id);
      if (!client) throw new TRPCError({ code: "NOT_FOUND", message: "客戶不存在" });
      return client;
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        company: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        notes: z.string().optional(),
        source: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      return createClient(input);
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        company: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        notes: z.string().optional(),
        source: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      const updated = await updateClient(id, data);
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "客戶不存在" });
      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteClient(input.id);
      return { success: true };
    }),

  // 從報價單資料新增/更新客戶（電郵查重，已存在則更新缺漏欄位）
  addFromQuote: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        company: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await upsertClientFromQuote({
        name: input.name,
        company: input.company,
        email: input.email,
        phone: input.phone,
      });
      return { id: result.id, isNew: result.isNew, alreadyExists: !result.isNew };
    }),

  // 檢查電郵是否已在客戶資料庫
  checkEmailExists: protectedProcedure
    .input(z.object({ email: z.string() }))
    .query(async ({ input }) => {
      if (!input.email.trim()) return { exists: false, client: null };
      const results = await searchClients(input.email, 5);
      const match = results.find(c => c.email?.toLowerCase() === input.email.toLowerCase());
      return { exists: !!match, client: match ?? null };
    }),
});
