/**
 * LinkedIn Content Factory — Authority 內容工廠
 * 每週自動產出 3 類草稿：作品案例 / 外判 vs in-house / 行業觀察
 * 你批核 → 排程 → 你或 Manus 發佈後標記 published
 */
import { getDb } from "./db";
import { linkedinContentPosts, type LinkedInContentType } from "../drizzle/schema";
import { and, eq, gte, lte, inArray, sql } from "drizzle-orm";
import { invokeLLM } from "./_core/llm";
import { notifyOwner } from "./_core/notification";

export const CONTENT_TYPE_LABELS: Record<LinkedInContentType, string> = {
  case_study: "作品案例",
  outsource_vs_inhire: "外判 vs In-house",
  industry_insight: "行業／客戶觀察",
};

/** ISO week key in HKT, e.g. 2026-W31 */
export function getHktWeekKey(date = new Date()): string {
  const hkt = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const target = new Date(Date.UTC(hkt.getUTCFullYear(), hkt.getUTCMonth(), hkt.getUTCDate()));
  // Thursday in current week decides the year
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/** Monday 00:00 HKT of the week containing `date` */
function getMondayHkt(date = new Date()): Date {
  const hkt = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const day = hkt.getUTCDay(); // 0 Sun … 6 Sat in HKT wall clock via UTC fields
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(hkt.getUTCFullYear(), hkt.getUTCMonth(), hkt.getUTCDate() + diff, 0, 0, 0));
  // monday is UTC representing HKT midnight Monday → convert to real UTC instant
  return new Date(monday.getTime() - 8 * 60 * 60 * 1000);
}

/** Schedule slots relative to Monday of week (HKT hours) */
const WEEK_SLOTS: Array<{ type: LinkedInContentType; dayOffset: number; hourHkt: number }> = [
  { type: "case_study", dayOffset: 1, hourHkt: 10 }, // Tue 10:00
  { type: "outsource_vs_inhire", dayOffset: 3, hourHkt: 10 }, // Thu 10:00
  { type: "industry_insight", dayOffset: 5, hourHkt: 11 }, // Sat 11:00
];

export function scheduledForSlot(weekMondayUtc: Date, dayOffset: number, hourHkt: number): Date {
  // weekMondayUtc is real UTC instant of Monday 00:00 HKT
  const hktMidnight = weekMondayUtc.getTime() + 8 * 60 * 60 * 1000;
  const slotHkt = hktMidnight + dayOffset * 86400000 + hourHkt * 3600000;
  return new Date(slotHkt - 8 * 60 * 60 * 1000);
}

let tableReady = false;

export async function ensureContentPostsTable(): Promise<void> {
  if (tableReady) return;
  const db = await getDb();
  if (!db) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS linkedin_content_posts (
        id int AUTO_INCREMENT PRIMARY KEY,
        week_key varchar(16) NOT NULL,
        li_content_type enum('case_study','outsource_vs_inhire','industry_insight') NOT NULL,
        li_content_status enum('draft','pending_review','approved','scheduled','published','rejected') NOT NULL DEFAULT 'pending_review',
        title varchar(512) NOT NULL,
        body mediumtext NOT NULL,
        media_hint text,
        scheduled_for timestamp NULL,
        published_at timestamp NULL,
        approved_at timestamp NULL,
        notes text,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    tableReady = true;
  } catch (err) {
    console.error("[ContentFactory] ensureTable error:", err);
  }
}

const TYPE_PROMPTS: Record<
  LinkedInContentType,
  { angle: string; mediaHint: string }
> = {
  case_study: {
    angle:
      "Write a LinkedIn post showcasing a photography/video case study vibe for JD STUDIO HK (product, food, fashion, jewellery, or commercial). Structure: hook → what the brand needed → what we shot / approach → outcome. Invent a plausible anonymised or generic brand scenario (do not claim fake client names as real testimonials). Include a soft CTA to visit jdstudiohk.com. Suggest a before/after or shoot-day photo in media_hint.",
    mediaHint: "配圖建議：before/after 或 shoot day 現場／成品圖",
  },
  outsource_vs_inhire: {
    angle:
      "Write a LinkedIn post arguing why Hong Kong brands should outsource photography/video to a specialist studio (JD STUDIO HK) instead of hiring a full-time in-house photographer. Cover cost, flexibility, equipment, creative breadth, and peak seasons. Professional, not salesy. Soft CTA.",
    mediaHint: "配圖建議：工作室簡表／工作室 vs 攝影師對比圖，或工作室環境",
  },
  industry_insight: {
    angle:
      "Write a LinkedIn post with a sharp industry or client observation relevant to HK brand visual content (e.g. e-commerce imagery standards, food photography trends, jewellery lighting, hiring photographer roles as a signal). Thought-leadership tone. Soft CTA to JD STUDIO HK.",
    mediaHint: "配圖建議：行業相關視覺／mood board／細節特寫",
  },
};

async function generateOnePost(type: LinkedInContentType): Promise<{
  title: string;
  body: string;
  mediaHint: string;
}> {
  const meta = TYPE_PROMPTS[type];
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are the content strategist for JD STUDIO HK, a Hong Kong creative studio specialising in product, food, fashion, jewellery photography and video production.
Write LinkedIn posts in English (can include light Cantonese flavour in one short phrase if natural, but mostly English for LinkedIn reach).
Rules:
- 150–220 words
- Strong first line hook
- Short paragraphs, scannable
- No hashtag spam (max 3 relevant hashtags at end)
- No fake statistics
- Sound human and authoritative
- Output JSON: { "title": "short internal label", "body": "full post text", "mediaHint": "what image to attach" }`,
        },
        {
          role: "user",
          content: `Content type: ${type} (${CONTENT_TYPE_LABELS[type]})\n\n${meta.angle}\n\nDefault media hint if needed: ${meta.mediaHint}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "linkedin_post",
          strict: true,
          schema: {
            type: "object",
            properties: {
              title: { type: "string" },
              body: { type: "string" },
              mediaHint: { type: "string" },
            },
            required: ["title", "body", "mediaHint"],
            additionalProperties: false,
          },
        },
      },
    });

    const raw = response?.choices?.[0]?.message?.content;
    if (!raw) throw new Error("No LLM content");
    const text = typeof raw === "string" ? raw : JSON.stringify(raw);
    const parsed = JSON.parse(text);
    return {
      title: String(parsed.title || CONTENT_TYPE_LABELS[type]).slice(0, 500),
      body: String(parsed.body || ""),
      mediaHint: String(parsed.mediaHint || meta.mediaHint),
    };
  } catch (err: any) {
    console.error(`[ContentFactory] LLM failed for ${type}:`, err?.message);
    // Fallback templates
    if (type === "case_study") {
      return {
        title: "Shoot day case study",
        body: `Most brands don't need a full-time photographer on payroll — they need consistent, on-brand images when campaigns move.

Last shoot week we helped a product brand refresh their catalogue visuals: cleaner lighting, tighter composition, and assets ready for both web and social in one session.

If you're hiring for in-house photo/video capacity, it might be worth comparing that cost with a flexible studio partner.

Happy to share relevant work: https://www.jdstudiohk.com

#ProductPhotography #HongKong #JDStudio`,
        mediaHint: meta.mediaHint,
      };
    }
    if (type === "outsource_vs_inhire") {
      return {
        title: "Outsource vs in-house",
        body: `Hiring an in-house photographer looks simple — until you factor in salary, equipment, peak-season overload, and the days when there's nothing to shoot.

A specialist studio like JD STUDIO HK gives you senior-level output, the right kit for product / food / fashion / jewellery, and the freedom to scale up or pause without HR overhead.

When you see companies posting photographer roles, it's often a signal of visual demand — not necessarily that full-time is the best model.

Curious how outsourcing compares for your calendar? https://www.jdstudiohk.com

#CreativeStudio #HongKongBusiness #Photography`,
        mediaHint: meta.mediaHint,
      };
    }
    return {
      title: "Industry observation",
      body: `A quiet trend we're seeing: more HK brands are raising the bar on everyday product imagery — not just campaign heroes.

Shoppers decide in a scroll. Lighting, consistency, and detail matter as much as the product itself.

That's why "hire a photographer" postings keep appearing — and why many teams still get better ROI from a trusted external studio than a single in-house generalist.

We specialise in making brand visuals work harder: https://www.jdstudiohk.com

#BrandVisuals #Ecommerce #JDStudio`,
      mediaHint: meta.mediaHint,
    };
  }
}

/**
 * Ensure this week has all 3 content types as pending_review (or keep existing).
 * Returns how many were newly created.
 */
export async function generateWeeklyContentBatch(opts?: {
  weekKey?: string;
  force?: boolean;
}): Promise<{ weekKey: string; created: number; existing: number }> {
  await ensureContentPostsTable();
  const db = await getDb();
  if (!db) return { weekKey: "", created: 0, existing: 0 };

  const weekKey = opts?.weekKey ?? getHktWeekKey();
  const monday = getMondayHkt();
  // If generating for a specific weekKey matching current, monday is fine;
  // for simplicity always use current week's monday for schedule slots when weekKey is current.
  let created = 0;
  let existing = 0;

  for (const slot of WEEK_SLOTS) {
    const found = await db
      .select({ id: linkedinContentPosts.id })
      .from(linkedinContentPosts)
      .where(
        and(
          eq(linkedinContentPosts.weekKey, weekKey),
          eq(linkedinContentPosts.contentType, slot.type)
        )
      )
      .limit(1);

    if (found.length && !opts?.force) {
      existing++;
      continue;
    }

    if (found.length && opts?.force) {
      // regenerate rejected/draft only when force — skip if already approved/published
      const [row] = await db
        .select()
        .from(linkedinContentPosts)
        .where(eq(linkedinContentPosts.id, found[0].id))
        .limit(1);
      if (row && (row.status === "approved" || row.status === "scheduled" || row.status === "published")) {
        existing++;
        continue;
      }
      const gen = await generateOnePost(slot.type);
      await db
        .update(linkedinContentPosts)
        .set({
          title: gen.title,
          body: gen.body,
          mediaHint: gen.mediaHint,
          status: "pending_review",
          scheduledFor: scheduledForSlot(monday, slot.dayOffset, slot.hourHkt),
        })
        .where(eq(linkedinContentPosts.id, found[0].id));
      created++;
      continue;
    }

    const gen = await generateOnePost(slot.type);
    await db.insert(linkedinContentPosts).values({
      weekKey,
      contentType: slot.type,
      status: "pending_review",
      title: gen.title,
      body: gen.body,
      mediaHint: gen.mediaHint,
      scheduledFor: scheduledForSlot(monday, slot.dayOffset, slot.hourHkt),
    });
    created++;
  }

  return { weekKey, created, existing };
}

export async function runScheduledContentFactory(): Promise<void> {
  // Only Mon–Tue morning HKT to seed the week (and catch missed Monday)
  const hkt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const day = hkt.getUTCDay(); // 0 Sun
  const hour = hkt.getUTCHours();
  if (!((day === 1 || day === 2) && hour >= 9 && hour < 12)) {
    console.log("[ContentFactory] Skip weekly generate (outside Mon/Tue 09–12 HKT)");
    return;
  }

  console.log("[ContentFactory] Running weekly batch…");
  const result = await generateWeeklyContentBatch();
  console.log(`[ContentFactory] week=${result.weekKey} created=${result.created} existing=${result.existing}`);

  if (result.created > 0) {
    try {
      await notifyOwner({
        title: `✍️ LinkedIn 內容工廠：本週 ${result.created} 篇草稿待批核`,
        content: [
          `週次：${result.weekKey}`,
          `新增草稿：${result.created}`,
          `已有（略過）：${result.existing}`,
          `請到「LinkedIn 營運 → 內容工廠」批核。批核後按排程發佈（系統會提示今日要發）。`,
        ].join("\n"),
      });
    } catch {
      // non-critical
    }
  }

  // Also nudge if there are approved posts due today
  await notifyDuePublishes();
}

export async function notifyDuePublishes(): Promise<void> {
  await ensureContentPostsTable();
  const db = await getDb();
  if (!db) return;

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const due = await db
    .select()
    .from(linkedinContentPosts)
    .where(
      and(
        inArray(linkedinContentPosts.status, ["approved", "scheduled"]),
        gte(linkedinContentPosts.scheduledFor, start),
        lte(linkedinContentPosts.scheduledFor, end)
      )
    );

  if (due.length === 0) return;

  try {
    await notifyOwner({
      title: `📢 今日有 ${due.length} 篇 LinkedIn 帖要發`,
      content: due
        .map(
          (p) =>
            `• [${CONTENT_TYPE_LABELS[p.contentType]}] ${p.title}\n${(p.body || "").slice(0, 120)}…`
        )
        .join("\n\n"),
    });
  } catch {
    // non-critical
  }
}
