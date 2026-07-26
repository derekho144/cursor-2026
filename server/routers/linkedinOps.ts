/**
 * linkedinOps.ts — LinkedIn 營運中台 MVP
 * 今日任務板：暖場步驟 + DM 草稿 + 同招聘線索打通
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  linkedinContacts,
  linkedinActions,
  pitchLeads,
  type LinkedInContactStage,
} from "../../drizzle/schema";
import { eq, and, desc, count, lte, or, inArray, isNull, sql, ne } from "drizzle-orm";
import {
  linkedInPeopleSearchUrl,
  generatePitchEmail,
  expireStaleLeads,
  JOB_LISTING_MAX_AGE_DAYS,
} from "../scrapers/pitchOutreach";

const STAGE_VALUES = [
  "new",
  "warm_view",
  "warm_like",
  "connected",
  "dm_sent",
  "replied",
  "meeting",
  "won",
  "paused",
  "skipped",
] as const;

/** 階段推進順序（暖場 → 成交） */
const STAGE_FLOW: LinkedInContactStage[] = [
  "new",
  "warm_view",
  "warm_like",
  "connected",
  "dm_sent",
  "replied",
  "meeting",
  "won",
];

const STAGE_LABELS: Record<string, string> = {
  new: "待開始",
  warm_view: "已瀏覽",
  warm_like: "已互動",
  connected: "已連線",
  dm_sent: "已發 DM",
  replied: "有回覆",
  meeting: "約見面",
  won: "成交",
  paused: "暫停",
  skipped: "跳過",
};

/** 每步完成後，下次跟進延遲（日） */
const NEXT_ACTION_DAYS: Partial<Record<LinkedInContactStage, number>> = {
  new: 0,
  warm_view: 1,
  warm_like: 1,
  connected: 2,
  dm_sent: 3,
  replied: 1,
  meeting: 2,
};

const PLAYBOOK_META = [
  {
    id: "hire_signal" as const,
    name: "招聘訊號外判",
    summary: "公司請攝影師／攝錄師 → 建議外判畀 JD Studio",
    steps: ["瀏覽公司／決策者頁", "讚或留言（可選）", "加好友", "發 DM", "跟進"],
  },
  {
    id: "winback" as const,
    name: "舊客喚回",
    summary: "長期未合作客戶，LinkedIn 輕觸再約拍攝",
    steps: ["搵舊客決策者", "加好友／互動", "發暖場 DM", "跟進"],
  },
  {
    id: "general" as const,
    name: "一般開發",
    summary: "無特定招聘訊號嘅品牌開發",
    steps: ["搵對口人", "暖場", "連線", "DM"],
  },
];

let tablesReady = false;

async function ensureLinkedInOpsTables(): Promise<void> {
  if (tablesReady) return;
  const db = await getDb();
  if (!db) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS linkedin_contacts (
        id int AUTO_INCREMENT PRIMARY KEY,
        pitch_lead_id int,
        company_name varchar(255) NOT NULL,
        person_name varchar(255),
        person_title varchar(255),
        linkedin_profile_url varchar(1024),
        linkedin_search_url varchar(1024),
        job_title varchar(255),
        job_url varchar(1024),
        li_stage enum('new','warm_view','warm_like','connected','dm_sent','replied','meeting','won','paused','skipped') NOT NULL DEFAULT 'new',
        li_playbook enum('hire_signal','winback','general') NOT NULL DEFAULT 'hire_signal',
        dm_draft mediumtext,
        next_action_at timestamp NULL,
        last_action_at timestamp NULL,
        notes text,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS linkedin_actions (
        id int AUTO_INCREMENT PRIMARY KEY,
        contact_id int NOT NULL,
        li_action_type enum('viewed','liked','commented','connected','dm_sent','follow_up','replied','meeting','won','note') NOT NULL,
        note text,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    tablesReady = true;
  } catch (err) {
    console.error("[LinkedInOps] ensureTables error:", err);
  }
}

function addDays(from: Date, days: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  d.setHours(9, 0, 0, 0);
  return d;
}

function nextStage(current: LinkedInContactStage): LinkedInContactStage | null {
  const i = STAGE_FLOW.indexOf(current);
  if (i < 0 || i >= STAGE_FLOW.length - 1) return null;
  return STAGE_FLOW[i + 1];
}

function stageToAction(stage: LinkedInContactStage): "viewed" | "liked" | "connected" | "dm_sent" | "replied" | "meeting" | "won" | "note" {
  switch (stage) {
    case "warm_view":
      return "viewed";
    case "warm_like":
      return "liked";
    case "connected":
      return "connected";
    case "dm_sent":
      return "dm_sent";
    case "replied":
      return "replied";
    case "meeting":
      return "meeting";
    case "won":
      return "won";
    default:
      return "note";
  }
}

export const linkedinOpsRouter = router({
  playbooks: protectedProcedure.query(() => PLAYBOOK_META),

  stageLabels: protectedProcedure.query(() => STAGE_LABELS),

  getStats: protectedProcedure.query(async () => {
    await ensureLinkedInOpsTables();
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const activeStages = ["new", "warm_view", "warm_like", "connected", "dm_sent", "replied", "meeting"] as const;

    const [dueRow] = await db
      .select({ cnt: count() })
      .from(linkedinContacts)
      .where(
        and(
          inArray(linkedinContacts.stage, [...activeStages]),
          or(isNull(linkedinContacts.nextActionAt), lte(linkedinContacts.nextActionAt, endOfToday))
        )
      );

    const stageCounts = await db
      .select({ stage: linkedinContacts.stage, cnt: count() })
      .from(linkedinContacts)
      .groupBy(linkedinContacts.stage);

    const counts: Record<string, number> = {};
    for (const row of stageCounts) counts[row.stage] = row.cnt;

    return {
      dueToday: dueRow?.cnt ?? 0,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      dmSent: counts["dm_sent"] ?? 0,
      replied: counts["replied"] ?? 0,
      won: counts["won"] ?? 0,
      byStage: counts,
      stageLabels: STAGE_LABELS,
    };
  }),

  /** 今日要做嘅聯絡（nextActionAt ≤ 今日，未結束） */
  listDueToday: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(20) }).optional())
    .query(async ({ input }) => {
      await ensureLinkedInOpsTables();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const endOfToday = new Date();
      endOfToday.setHours(23, 59, 59, 999);
      const activeStages = ["new", "warm_view", "warm_like", "connected", "dm_sent", "replied", "meeting"] as const;

      const rows = await db
        .select()
        .from(linkedinContacts)
        .where(
          and(
            inArray(linkedinContacts.stage, [...activeStages]),
            or(isNull(linkedinContacts.nextActionAt), lte(linkedinContacts.nextActionAt, endOfToday))
          )
        )
        .orderBy(linkedinContacts.nextActionAt, desc(linkedinContacts.createdAt))
        .limit(input?.limit ?? 20);

      return {
        contacts: rows.map((c) => ({
          ...c,
          stageLabel: STAGE_LABELS[c.stage] ?? c.stage,
          nextStage: nextStage(c.stage as LinkedInContactStage),
          nextStageLabel: (() => {
            const n = nextStage(c.stage as LinkedInContactStage);
            return n ? STAGE_LABELS[n] : null;
          })(),
          searchUrl: c.linkedInSearchUrl || linkedInPeopleSearchUrl(c.companyName),
        })),
      };
    }),

  listContacts: protectedProcedure
    .input(
      z.object({
        stage: z.enum(["all", ...STAGE_VALUES]).default("all"),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      await ensureLinkedInOpsTables();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const conditions = [];
      if (input.stage !== "all") conditions.push(eq(linkedinContacts.stage, input.stage));
      const where = conditions.length ? and(...conditions) : undefined;
      const offset = (input.page - 1) * input.pageSize;

      const [rows, totalResult] = await Promise.all([
        db
          .select()
          .from(linkedinContacts)
          .where(where)
          .orderBy(desc(linkedinContacts.updatedAt))
          .limit(input.pageSize)
          .offset(offset),
        db.select({ cnt: count() }).from(linkedinContacts).where(where),
      ]);

      return {
        contacts: rows.map((c) => ({
          ...c,
          stageLabel: STAGE_LABELS[c.stage] ?? c.stage,
          searchUrl: c.linkedInSearchUrl || linkedInPeopleSearchUrl(c.companyName),
        })),
        total: totalResult[0]?.cnt ?? 0,
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  /** 從「待跟進」招聘線索同步入 LinkedIn 營運 */
  syncFromPitchLeads: protectedProcedure.mutation(async () => {
    await ensureLinkedInOpsTables();
    await expireStaleLeads();
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const cutoff = new Date(Date.now() - JOB_LISTING_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
    const leads = await db
      .select()
      .from(pitchLeads)
      .where(
        and(
          inArray(pitchLeads.status, ["pending_review", "pending_email"]),
          sql`COALESCE(${pitchLeads.jobPostedAt}, ${pitchLeads.createdAt}) >= ${cutoff}`
        )
      )
      .orderBy(desc(pitchLeads.createdAt))
      .limit(100);

    let created = 0;
    let skipped = 0;

    for (const lead of leads) {
      const existing = await db
        .select({ id: linkedinContacts.id })
        .from(linkedinContacts)
        .where(eq(linkedinContacts.pitchLeadId, lead.id))
        .limit(1);
      if (existing.length) {
        skipped++;
        continue;
      }

      // 同公司未完結嘅聯絡唔重複開
      const sameCompany = await db
        .select({ id: linkedinContacts.id })
        .from(linkedinContacts)
        .where(
          and(
            eq(linkedinContacts.companyName, lead.companyName),
            ne(linkedinContacts.stage, "skipped"),
            ne(linkedinContacts.stage, "won"),
            ne(linkedinContacts.stage, "paused")
          )
        )
        .limit(1);
      if (sameCompany.length) {
        skipped++;
        continue;
      }

      let dmDraft = lead.aiPitchBody ?? null;
      if (!dmDraft) {
        try {
          const gen = await generatePitchEmail({
            companyName: lead.companyName,
            jobTitle: lead.jobTitle,
            jobDescription: lead.jobDescription ?? undefined,
            industry: lead.industry ?? undefined,
            source: lead.source,
          });
          dmDraft = gen.body;
          await db
            .update(pitchLeads)
            .set({ aiPitchSubject: gen.subject, aiPitchBody: gen.body })
            .where(eq(pitchLeads.id, lead.id));
        } catch {
          dmDraft = `Hi — I noticed ${lead.companyName} is hiring for a ${lead.jobTitle} role. Instead of a full-time hire, many HK brands work with JD STUDIO as an outsourced photo/video partner. Happy to share relevant work: https://www.jdstudiohk.com — would a quick chat make sense?`;
        }
      }

      await db.insert(linkedinContacts).values({
        pitchLeadId: lead.id,
        companyName: lead.companyName,
        jobTitle: lead.jobTitle,
        jobUrl: lead.jobUrl,
        linkedInSearchUrl: linkedInPeopleSearchUrl(lead.companyName),
        stage: "new",
        playbook: "hire_signal",
        dmDraft,
        nextActionAt: new Date(),
      });
      created++;
    }

    return { created, skipped, scanned: leads.length };
  }),

  createContact: protectedProcedure
    .input(
      z.object({
        companyName: z.string().min(1),
        personName: z.string().optional(),
        personTitle: z.string().optional(),
        linkedInProfileUrl: z.string().url().optional().or(z.literal("")),
        playbook: z.enum(["hire_signal", "winback", "general"]).default("general"),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await ensureLinkedInOpsTables();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [result] = await db.insert(linkedinContacts).values({
        companyName: input.companyName,
        personName: input.personName,
        personTitle: input.personTitle,
        linkedInProfileUrl: input.linkedInProfileUrl || null,
        linkedInSearchUrl: linkedInPeopleSearchUrl(input.companyName),
        stage: "new",
        playbook: input.playbook,
        notes: input.notes,
        nextActionAt: new Date(),
      });

      return { id: Number((result as any).insertId) };
    }),

  updateContact: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        personName: z.string().optional(),
        personTitle: z.string().optional(),
        linkedInProfileUrl: z.string().optional(),
        dmDraft: z.string().optional(),
        notes: z.string().optional(),
        stage: z.enum(STAGE_VALUES).optional(),
      })
    )
    .mutation(async ({ input }) => {
      await ensureLinkedInOpsTables();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const { id, ...rest } = input;
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined) patch[k] = v === "" ? null : v;
      }
      if (Object.keys(patch).length === 0) return { success: true };

      await db.update(linkedinContacts).set(patch).where(eq(linkedinContacts.id, id));
      return { success: true };
    }),

  /** 完成而家呢一步 → 推進下一階段 */
  advanceStage: protectedProcedure
    .input(z.object({ id: z.number(), note: z.string().optional() }))
    .mutation(async ({ input }) => {
      await ensureLinkedInOpsTables();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [contact] = await db
        .select()
        .from(linkedinContacts)
        .where(eq(linkedinContacts.id, input.id))
        .limit(1);
      if (!contact) throw new TRPCError({ code: "NOT_FOUND", message: "Contact not found" });

      const nxt = nextStage(contact.stage as LinkedInContactStage);
      if (!nxt) throw new TRPCError({ code: "BAD_REQUEST", message: "Already at final stage" });

      const now = new Date();
      const delay = NEXT_ACTION_DAYS[nxt] ?? 1;
      const nextActionAt = nxt === "won" || nxt === "skipped" ? null : addDays(now, delay);

      await db
        .update(linkedinContacts)
        .set({
          stage: nxt,
          lastActionAt: now,
          nextActionAt,
        })
        .where(eq(linkedinContacts.id, input.id));

      // 同步 pitch lead 狀態（若有）
      if (contact.pitchLeadId) {
        if (nxt === "dm_sent") {
          await db
            .update(pitchLeads)
            .set({ status: "sent", pitchSentAt: now })
            .where(eq(pitchLeads.id, contact.pitchLeadId));
        } else if (nxt === "replied") {
          await db.update(pitchLeads).set({ status: "replied" }).where(eq(pitchLeads.id, contact.pitchLeadId));
        } else if (nxt === "won") {
          await db.update(pitchLeads).set({ status: "approved" }).where(eq(pitchLeads.id, contact.pitchLeadId));
        }
      }

      await db.insert(linkedinActions).values({
        contactId: input.id,
        actionType: stageToAction(nxt),
        note: input.note,
      });

      return { stage: nxt, stageLabel: STAGE_LABELS[nxt], nextActionAt };
    }),

  skipContact: protectedProcedure
    .input(z.object({ id: z.number(), note: z.string().optional() }))
    .mutation(async ({ input }) => {
      await ensureLinkedInOpsTables();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await db
        .update(linkedinContacts)
        .set({ stage: "skipped", notes: input.note, nextActionAt: null, lastActionAt: new Date() })
        .where(eq(linkedinContacts.id, input.id));

      const [c] = await db.select().from(linkedinContacts).where(eq(linkedinContacts.id, input.id)).limit(1);
      if (c?.pitchLeadId) {
        await db.update(pitchLeads).set({ status: "skipped", notes: input.note ?? "Skipped via LinkedIn ops" }).where(eq(pitchLeads.id, c.pitchLeadId));
      }

      await db.insert(linkedinActions).values({
        contactId: input.id,
        actionType: "note",
        note: input.note ?? "skipped",
      });

      return { success: true };
    }),

  generateDm: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await ensureLinkedInOpsTables();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [contact] = await db
        .select()
        .from(linkedinContacts)
        .where(eq(linkedinContacts.id, input.id))
        .limit(1);
      if (!contact) throw new TRPCError({ code: "NOT_FOUND", message: "Contact not found" });

      const gen = await generatePitchEmail({
        companyName: contact.companyName,
        jobTitle: contact.jobTitle || "Photographer",
        contactName: contact.personName ?? undefined,
        source: "linkedin",
      });

      await db
        .update(linkedinContacts)
        .set({ dmDraft: gen.body })
        .where(eq(linkedinContacts.id, input.id));

      return { body: gen.body, subject: gen.subject };
    }),

  listActions: protectedProcedure
    .input(z.object({ contactId: z.number() }))
    .query(async ({ input }) => {
      await ensureLinkedInOpsTables();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      return db
        .select()
        .from(linkedinActions)
        .where(eq(linkedinActions.contactId, input.contactId))
        .orderBy(desc(linkedinActions.createdAt))
        .limit(50);
    }),
});
