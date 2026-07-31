/**
 * LinkedIn Content Factory — Authority 內容工廠
 * 每週自動產出 3 類高互動草稿（研究 Type A/B/C）：
 * 1) 項目案例 + 幕後故事
 * 2) 攝影教育 + 行業洞察
 * 3) 數據 + 視覺化
 * 你批核 → Buffer → LinkedIn
 */
import { getDb } from "./db";
import {
  linkedinContentPosts,
  linkedinContentAssets,
  type LinkedInContentType,
  type LinkedInContentAsset,
} from "../drizzle/schema";
import { and, eq, gte, lte, inArray, sql, asc, desc } from "drizzle-orm";
import { invokeLLM, type MessageContent } from "./_core/llm";
import { notifyOwner } from "./_core/notification";
import { STYLE_BY_TYPE, LINKEDIN_SHARED_RULES } from "./linkedinCopyStyle";

export type SelectedMediaItem = {
  id: number;
  url: string;
  fileName: string;
  category: string;
  caption: string | null;
  slideOrder: number;
};

const CATEGORY_LABELS: Record<string, string> = {
  food: "食物",
  jewellery: "珠寶",
  product: "產品",
  fashion: "時裝",
  commercial: "商業／人像",
  before_after: "前後對比",
  event: "活動攝影",
  other: "其他",
};

export const CONTENT_TYPE_LABELS: Record<LinkedInContentType, string> = {
  project_bts: "項目案例 + 幕後故事",
  photo_education: "攝影教育 + 行業洞察",
  data_viz: "數據 + 視覺化",
};

export const CONTENT_TYPE_BLURBS: Record<LinkedInContentType, string> = {
  project_bts: "展示真實工作流程",
  photo_education: "建立思想領導力",
  data_viz: "吸引商業客戶",
};

/** ISO week key in HKT, e.g. 2026-W31 */
export function getHktWeekKey(date = new Date()): string {
  const hkt = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const target = new Date(Date.UTC(hkt.getUTCFullYear(), hkt.getUTCMonth(), hkt.getUTCDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function getMondayHkt(date = new Date()): Date {
  const hkt = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const day = hkt.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(hkt.getUTCFullYear(), hkt.getUTCMonth(), hkt.getUTCDate() + diff, 0, 0, 0));
  return new Date(monday.getTime() - 8 * 60 * 60 * 1000);
}

const WEEK_SLOTS: Array<{ type: LinkedInContentType; dayOffset: number; hourHkt: number }> = [
  { type: "project_bts", dayOffset: 1, hourHkt: 8 }, // Tue 8–9am → 08:00
  { type: "photo_education", dayOffset: 2, hourHkt: 12 }, // Wed 12–1pm → 12:00
  { type: "data_viz", dayOffset: 4, hourHkt: 16 }, // Fri 4–5pm → 16:00
];

export function scheduledForSlot(weekMondayUtc: Date, dayOffset: number, hourHkt: number): Date {
  const hktMidnight = weekMondayUtc.getTime() + 8 * 60 * 60 * 1000;
  const slotHkt = hktMidnight + dayOffset * 86400000 + hourHkt * 3600000;
  return new Date(slotHkt - 8 * 60 * 60 * 1000);
}

/**
 * Content week for generation/UI: if this week's Fri 16:00 HKT is already past,
 * roll forward to next Mon–Fri timetable (Tue 08 / Wed 12 / Fri 16).
 */
export function resolveContentWeek(date = new Date()): {
  weekKey: string;
  monday: Date;
  rolledFromPastWeek: boolean;
} {
  let monday = getMondayHkt(date);
  let weekKey = getHktWeekKey(date);
  const friSlot = scheduledForSlot(monday, 4, 16);
  if (friSlot.getTime() < date.getTime()) {
    monday = new Date(monday.getTime() + 7 * 86400000);
    weekKey = getHktWeekKey(new Date(monday.getTime() + 12 * 3600000));
    return { weekKey, monday, rolledFromPastWeek: true };
  }
  return { weekKey, monday, rolledFromPastWeek: false };
}

export function describeWeekSchedule(monday: Date): Array<{ type: LinkedInContentType; atHkt: string }> {
  return WEEK_SLOTS.map((slot) => {
    const at = scheduledForSlot(monday, slot.dayOffset, slot.hourHkt);
    return {
      type: slot.type,
      atHkt: at.toLocaleString("zh-HK", {
        timeZone: "Asia/Hong_Kong",
        weekday: "short",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
    };
  });
}

/** Best-effort Monday UTC for an ISO week key like 2026-W31 (HKT-based). */
export function getMondayForWeekKey(weekKey: string): Date | null {
  const m = weekKey.match(/^(\d{4})-W(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  // ISO week: Thursday of week 1 is in `year`; Monday = Thursday - 3
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const mondayUtc = new Date(week1Monday);
  mondayUtc.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  // Treat calendar Monday 00:00 as HKT midnight → convert to UTC instant used by scheduledForSlot
  return new Date(mondayUtc.getTime() - 8 * 60 * 60 * 1000);
}

/** Inclusive UTC window for an ISO week key (Mon 00:00 HKT → next Mon 00:00 HKT). */
export function getWeekRangeUtc(weekKey: string): { start: Date; end: Date } | null {
  const monday = getMondayForWeekKey(weekKey);
  if (!monday) return null;
  const start = monday;
  const end = new Date(monday.getTime() + 7 * 86400000 - 1);
  return { start, end };
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
        li_content_type enum('project_bts','photo_education','data_viz','carousel_case_study','outsource_vs_inhire','contrarian_take','case_study','industry_insight') NOT NULL,
        li_content_status enum('draft','pending_review','approved','scheduled','published','rejected') NOT NULL DEFAULT 'pending_review',
        title varchar(512) NOT NULL,
        body mediumtext NOT NULL,
        media_hint text,
        selected_media mediumtext,
        scheduled_for timestamp NULL,
        published_at timestamp NULL,
        approved_at timestamp NULL,
        notes text,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS linkedin_content_assets (
        id int AUTO_INCREMENT PRIMARY KEY,
        url varchar(1024) NOT NULL,
        storage_key varchar(512) NOT NULL,
        file_name varchar(255) NOT NULL,
        mime_type varchar(128) NOT NULL,
        li_asset_category enum('food','jewellery','product','fashion','commercial','before_after','event','other') NOT NULL DEFAULT 'other',
        li_asset_preferred_for enum('any','project','education','data','carousel','debate','contrarian') NOT NULL DEFAULT 'any',
        caption text,
        ai_description text,
        times_used int NOT NULL DEFAULT 0,
        last_used_at timestamp NULL,
        active int NOT NULL DEFAULT 1,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    try {
      await db.execute(sql`ALTER TABLE linkedin_content_posts ADD COLUMN selected_media mediumtext`);
    } catch {
      // column may already exist
    }
    try {
      await db.execute(sql`ALTER TABLE linkedin_content_posts ADD COLUMN buffer_post_id varchar(64) NULL`);
    } catch {
      /* exists */
    }
    try {
      await db.execute(sql`ALTER TABLE linkedin_content_posts ADD COLUMN buffer_status varchar(32) NULL`);
    } catch {
      /* exists */
    }
    try {
      await db.execute(sql`ALTER TABLE linkedin_content_posts ADD COLUMN buffer_error text NULL`);
    } catch {
      /* exists */
    }
    try {
      await db.execute(sql`ALTER TABLE linkedin_content_posts ADD COLUMN impressions int NULL`);
    } catch {
      /* exists */
    }
    try {
      await db.execute(sql`ALTER TABLE linkedin_content_posts ADD COLUMN reactions int NULL`);
    } catch {
      /* exists */
    }
    try {
      await db.execute(sql`ALTER TABLE linkedin_content_posts ADD COLUMN comments int NULL`);
    } catch {
      /* exists */
    }
    try {
      await db.execute(sql`ALTER TABLE linkedin_content_posts ADD COLUMN reposts int NULL`);
    } catch {
      /* exists */
    }
    try {
      await db.execute(sql`ALTER TABLE linkedin_content_posts ADD COLUMN engagement_rate varchar(16) NULL`);
    } catch {
      /* exists */
    }
    try {
      await db.execute(sql`ALTER TABLE linkedin_content_posts ADD COLUMN metrics_updated_at timestamp NULL`);
    } catch {
      /* exists */
    }
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS linkedin_week_scoreboards (
        week_key varchar(16) PRIMARY KEY,
        post_count int NULL,
        impressions int NULL,
        reactions int NULL,
        comments int NULL,
        reposts int NULL,
        engagement_rate varchar(16) NULL,
        metrics_synced_at timestamp NULL,
        metrics_sync_error text NULL,
        new_followers int NULL,
        linkedin_inquiries int NULL,
        quotes_from_linkedin int NULL,
        dm_conversations int NULL,
        experiment_note text NULL,
        next_week_plan text NULL,
        verdict varchar(64) NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    try {
      await db.execute(sql`
        ALTER TABLE linkedin_content_assets
        MODIFY COLUMN li_asset_category ENUM(
          'food','jewellery','product','fashion','commercial','before_after','event','other'
        ) NOT NULL DEFAULT 'other'
      `);
    } catch (enumErr) {
      console.warn("[ContentFactory] asset category enum migrate:", enumErr);
    }
    try {
      await db.execute(sql`
        ALTER TABLE linkedin_content_posts
        MODIFY COLUMN li_content_type ENUM(
          'case_study','outsource_vs_inhire','industry_insight',
          'carousel_case_study','contrarian_take',
          'project_bts','photo_education','data_viz'
        ) NOT NULL
      `);
      await db.execute(sql`
        UPDATE linkedin_content_posts SET li_content_type = 'project_bts'
        WHERE li_content_type IN ('case_study','carousel_case_study')
      `);
      await db.execute(sql`
        UPDATE linkedin_content_posts SET li_content_type = 'photo_education'
        WHERE li_content_type IN ('outsource_vs_inhire','industry_insight')
      `);
      await db.execute(sql`
        UPDATE linkedin_content_posts SET li_content_type = 'data_viz'
        WHERE li_content_type = 'contrarian_take'
      `);
      await db.execute(sql`
        ALTER TABLE linkedin_content_posts
        MODIFY COLUMN li_content_type ENUM(
          'project_bts','photo_education','data_viz'
        ) NOT NULL
      `);
    } catch (migrateErr) {
      console.warn("[ContentFactory] content-type enum migrate:", migrateErr);
    }
    try {
      await db.execute(sql`
        ALTER TABLE linkedin_content_assets
        MODIFY COLUMN li_asset_preferred_for ENUM(
          'any','carousel','debate','contrarian','project','education','data'
        ) NOT NULL DEFAULT 'any'
      `);
      await db.execute(sql`
        UPDATE linkedin_content_assets SET li_asset_preferred_for = 'project'
        WHERE li_asset_preferred_for = 'carousel'
      `);
      await db.execute(sql`
        UPDATE linkedin_content_assets SET li_asset_preferred_for = 'education'
        WHERE li_asset_preferred_for = 'debate'
      `);
      await db.execute(sql`
        UPDATE linkedin_content_assets SET li_asset_preferred_for = 'data'
        WHERE li_asset_preferred_for = 'contrarian'
      `);
      await db.execute(sql`
        ALTER TABLE linkedin_content_assets
        MODIFY COLUMN li_asset_preferred_for ENUM(
          'any','project','education','data'
        ) NOT NULL DEFAULT 'any'
      `);
    } catch (prefErr) {
      console.warn("[ContentFactory] preferredFor enum migrate:", prefErr);
    }
    tableReady = true;
  } catch (err) {
    console.error("[ContentFactory] ensureTable error:", err);
  }
}

/** preferredFor → content type（指定主題嘅相只會用喺對應帖） */
const THEME_KEY: Record<LinkedInContentType, "project" | "education" | "data"> = {
  project_bts: "project",
  photo_education: "education",
  data_viz: "data",
};

/**
 * 抽相規則：
 * 1) 有標「項目／教育／數據」→ 該主題用晒呢啲相（唔會借去其他主題）
 * 2) 冇專屬相先先用「全部主題」
 * 3) 唔會用其他主題嘅相
 * 4) 仍然冇相 → 自動去 jdstudiohk.com 服務頁抽圖入庫再抽
 */
export async function pickAssetsForType(
  type: LinkedInContentType
): Promise<LinkedInContentAsset[]> {
  await ensureContentPostsTable();
  const db = await getDb();
  if (!db) return [];

  const theme = THEME_KEY[type];
  const maxAssets = type === "project_bts" ? 9 : type === "photo_education" ? 6 : 5;

  const selectPool = async (): Promise<LinkedInContentAsset[]> => {
    const rows = await db
      .select()
      .from(linkedinContentAssets)
      .where(eq(linkedinContentAssets.active, 1))
      .orderBy(
        asc(linkedinContentAssets.timesUsed),
        sql`(${linkedinContentAssets.lastUsedAt} IS NULL) DESC`,
        asc(linkedinContentAssets.lastUsedAt),
        desc(linkedinContentAssets.id)
      )
      .limit(200);

    const exact = rows.filter((r) => r.preferredFor === theme);
    const anyPool = rows.filter((r) => r.preferredFor === "any");
    const pool = exact.length > 0 ? exact : anyPool;
    return pool.slice(0, maxAssets);
  };

  let picked = await selectPool();
  if (picked.length > 0) return picked;

  try {
    const { harvestJdStudioWebsiteImages } = await import("./jdStudioWebsiteImages");
    // Always tag harvested stock as "any" so all 3 themes can use them.
    // (Theme-specific tags are for manually curated uploads.)
    const imported = await harvestJdStudioWebsiteImages({
      maxNew: Math.max(maxAssets * 2, 8),
      preferredFor: "any",
    });
    console.log(
      `[ContentFactory] website harvest for ${type}: imported ${imported.length}`
    );
  } catch (err: any) {
    console.warn("[ContentFactory] website harvest failed:", err?.message);
  }

  picked = await selectPool();
  if (picked.length > 0) return picked;

  // Last resort: ignore preferredFor and take any active photo
  const fallback = await db
    .select()
    .from(linkedinContentAssets)
    .where(eq(linkedinContentAssets.active, 1))
    .orderBy(
      asc(linkedinContentAssets.timesUsed),
      sql`(${linkedinContentAssets.lastUsedAt} IS NULL) DESC`,
      asc(linkedinContentAssets.lastUsedAt),
      desc(linkedinContentAssets.id)
    )
    .limit(maxAssets);
  return fallback;
}

async function markAssetsUsed(ids: number[]): Promise<void> {
  if (!ids.length) return;
  const db = await getDb();
  if (!db) return;
  const now = new Date();
  for (const id of ids) {
    await db
      .update(linkedinContentAssets)
      .set({
        timesUsed: sql`${linkedinContentAssets.timesUsed} + 1`,
        lastUsedAt: now,
      })
      .where(eq(linkedinContentAssets.id, id));
  }
}

export function assetsToSelectedMedia(assets: LinkedInContentAsset[]): SelectedMediaItem[] {
  return assets.map((a, i) => ({
    id: a.id,
    url: a.url,
    fileName: a.fileName,
    category: a.category,
    caption: a.caption,
    slideOrder: i + 1,
  }));
}

/** Pick (and if needed harvest) photos for a content type; returns selectedMedia JSON items. */
export async function ensureSelectedMediaForType(
  type: LinkedInContentType
): Promise<SelectedMediaItem[]> {
  const assets = await pickAssetsForType(type);
  if (!assets.length) return [];
  await markAssetsUsed(assets.map((a) => a.id));
  return assetsToSelectedMedia(assets);
}

function buildAssetBrief(assets: LinkedInContentAsset[]): string {
  if (!assets.length) return "";
  return assets
    .map((a, i) => {
      const cat = CATEGORY_LABELS[a.category] || a.category;
      const desc = a.aiDescription || a.caption || a.fileName;
      return `Slide/Image ${i + 1} [id=${a.id}] (${cat}): ${desc}\nURL: ${a.url}`;
    })
    .join("\n");
}

const TYPE_PROMPTS: Record<LinkedInContentType, { angle: string; mediaHint: string }> = {
  project_bts: {
    angle: `Theme Type A only — Michele Galeotto 項目案例 + 幕後.
ENGLISH primary project diary + reflection. Open on what happened on set. Honest challenge vivid photo beat quiet insight soft CTA then site line.
Then --- short 繁中 digest. No punctuation. Match real shoot type.`,
    mediaHint:
      "輪播 Type A（5–7 頁）：P1 故事開場 → P2 真實挑戰 → P3 現場選擇 → P4 幕後一刻 → P5 結果 → P6 思考 → P7 CTA",
  },
  photo_education: {
    angle: `Theme Type B only — Educator / Myth-bust 攝影教育 + 行業洞察.
ENGLISH primary teaching post NOT Michele diary. why-hook → ❌ myth vs ✓ truth → A/B/C → practice → insight → soft CTA → site line.
Then --- short 繁中 digest. No punctuation.`,
    mediaHint:
      "輪播 Type B（5–6 頁）：P1 點解／迷思 Hook → P2 ❌ vs ✓ → P3 對比例子 → P4 可練習做法 → P5 行業洞察 → P6 CTA",
  },
  data_viz: {
    angle: `Theme Type C only — Commercial data 數據 + 視覺化.
ENGLISH primary: number with stakes → second figure → buyer meaning → craft judgment → soft CTA → site line.
Then --- short 繁中 digest. No fake JD ROI. No punctuation.`,
    mediaHint:
      "輪播 Type C（4–5 頁）：P1 有張力數字 → P2 第二組數字／對比 → P3 對買家意味 → P4 判斷 → P5 CTA",
  },
};

function stripHashtags(block: string): { text: string; tags: string } {
  const lines = block.split("\n");
  const tagLines: string[] = [];
  const bodyLines: string[] = [];
  for (const line of lines) {
    if (/^\s*#/.test(line.trim())) tagLines.push(line.trim());
    else bodyLines.push(line);
  }
  return {
    text: bodyLines.join("\n").trim(),
    tags: tagLines.join("\n"),
  };
}

/** Format B: English primary then --- then short 繁中 */
function splitBilingual(body: string): { before: string; after: string; tags: string } {
  const { text: main, tags } = stripHashtags(body.trim());
  const sep = main.search(/\n---\n?/);
  if (sep < 0) return { before: main, after: "", tags };
  return {
    before: main.slice(0, sep).trim(),
    after: main.slice(sep).replace(/^\n?---\n?/, "").trim(),
    tags,
  };
}

function hasFormatB(body: string): boolean {
  const { before, after } = splitBilingual(body);
  if (!after) return false;
  const latin = (before.match(/[A-Za-z]/g) || []).length;
  const cjk = (after.match(/[\u4e00-\u9fff]/g) || []).length;
  return latin >= 120 && cjk >= 12;
}

async function generateChineseDigest(enBody: string, type: LinkedInContentType): Promise<string> {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `Write a SHORT Traditional Chinese digest (2–5 lines) of this English LinkedIn post for JD STUDIO HK HK audience.
Theme hint: ${type}
Rules:
- No punctuation marks
- Short line breaks Cantonese flavour OK
- Capture hook + one key beat + soft CTA question only — not a full rewrite
- End with exactly: 更多案例睇 www.jdstudiohk.com
- Output JSON { "chinese": "..." } without --- and without hashtags`,
      },
      {
        role: "user",
        content: `English post:\n\n${enBody}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "zh_digest",
        strict: true,
        schema: {
          type: "object",
          properties: { chinese: { type: "string" } },
          required: ["chinese"],
          additionalProperties: false,
        },
      },
    },
  });
  const raw = response?.choices?.[0]?.message?.content;
  if (!raw) throw new Error("No Chinese LLM content");
  const text = typeof raw === "string" ? raw : JSON.stringify(raw);
  const parsed = JSON.parse(text);
  return String(parsed.chinese || "").trim();
}

function ensureSiteCta(body: string): string {
  const ZH = "更多案例睇 www.jdstudiohk.com";
  const EN = "Head to www.jdstudiohk.com for more case studies";
  const { before, after, tags } = splitBilingual(body);
  // Format B: before = English, after = 繁中
  let en = before;
  let zh = after;
  // If model still outputted ZH-first (legacy), detect and swap
  const beforeLatin = (before.match(/[A-Za-z]/g) || []).length;
  const beforeCjk = (before.match(/[\u4e00-\u9fff]/g) || []).length;
  if (beforeCjk > beforeLatin && after) {
    zh = before;
    en = after;
  }
  if (!/jdstudiohk\.com/i.test(en)) en = `${en}\n\n${EN}`;
  if (zh && !/jdstudiohk\.com/i.test(zh)) zh = `${zh}\n\n${ZH}`;
  if (!zh) {
    const parts = [en];
    if (tags) parts.push("", tags);
    return parts.join("\n");
  }
  const parts = [en, "---", zh];
  if (tags) parts.push("", tags);
  return parts.join("\n");
}

async function ensureBilingualBody(body: string, type: LinkedInContentType): Promise<string> {
  const trimmed = body.trim();
  let result = trimmed;
  if (!hasFormatB(trimmed)) {
    const { before, after, tags } = splitBilingual(trimmed);
    const beforeLatin = (before.match(/[A-Za-z]/g) || []).length;
    const beforeCjk = (before.match(/[\u4e00-\u9fff]/g) || []).length;
    // Prefer existing English block; if ZH-first convert by generating digest from EN after or EN from ZH
    try {
      if (beforeLatin >= 120) {
        const zh = after && (after.match(/[\u4e00-\u9fff]/g) || []).length >= 12
          ? after
          : await generateChineseDigest(before, type);
        if ((zh.match(/[\u4e00-\u9fff]/g) || []).length >= 8) {
          const parts = [before, "---", zh];
          if (tags) parts.push("", tags);
          result = parts.join("\n");
        }
      } else if (beforeCjk >= 12) {
        // Legacy Chinese-primary: keep ZH short as digest if EN exists after, else ask for EN rewrite via digest path flipped
        // Generate English by asking model to expand — reuse generateChineseDigest inverse
        const enResp = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `Expand this Chinese LinkedIn note into a FULL English LinkedIn post for JD STUDIO HK.
Theme: ${type}
No punctuation marks Short line breaks
Full arc ending with soft CTA then: Head to www.jdstudiohk.com for more case studies
Output JSON { "english": "..." }`,
            },
            { role: "user", content: before },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "en_full",
              strict: true,
              schema: {
                type: "object",
                properties: { english: { type: "string" } },
                required: ["english"],
                additionalProperties: false,
              },
            },
          },
        });
        const raw = enResp?.choices?.[0]?.message?.content;
        const parsed = JSON.parse(typeof raw === "string" ? raw : JSON.stringify(raw));
        const en = String(parsed.english || "").trim();
        const zhShort =
          after && (after.match(/[A-Za-z]/g) || []).length > 40
            ? await generateChineseDigest(en, type)
            : before.length > 80
              ? (await generateChineseDigest(en, type))
              : before;
        if ((en.match(/[A-Za-z]/g) || []).length >= 80) {
          const parts = [en, "---", zhShort];
          if (tags) parts.push("", tags);
          result = parts.join("\n");
        }
      }
    } catch (err: any) {
      console.warn("[ContentFactory] Format B repair failed:", err?.message);
    }
  }
  return ensureSiteCta(result);
}

async function generateOnePost(
  type: LinkedInContentType,
  assets: LinkedInContentAsset[] = []
): Promise<{
  title: string;
  body: string;
  mediaHint: string;
  selectedMedia: SelectedMediaItem[];
}> {
  const meta = TYPE_PROMPTS[type];
  const selectedMedia = assetsToSelectedMedia(assets);
  const assetBrief = buildAssetBrief(assets);

  try {
    const userParts: MessageContent[] = [
      {
        type: "text",
        text: `Content type: ${type} (${CONTENT_TYPE_LABELS[type]})

${meta.angle}

${
  assets.length
    ? `IMPORTANT — Write around these REAL JD STUDIO photos from our library (auto-picked for this week):\n${assetBrief}\n\nmediaHint must map each slide/cover to these photo ids/URLs.`
    : `No library photos available — invent a plausible anonymised scenario and give design mediaHint only.\nDefault media hint if needed: ${meta.mediaHint}`
}`,
      },
    ];

    for (const a of assets.slice(0, 4)) {
      userParts.push({
        type: "image_url",
        image_url: { url: a.url, detail: "low" },
      });
    }

    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You write LinkedIn posts for JD STUDIO HK. Use ONLY the theme style below for this run — do not mix Type A/B/C voices.

${STYLE_BY_TYPE[type]}

${LINKEDIN_SHARED_RULES}

Content type: ${CONTENT_TYPE_LABELS[type]} — ${CONTENT_TYPE_BLURBS[type]}

When photos are attached ground claims in images/captions.
CRITICAL bilingual Format B: English FULL first then --- then short 繁中 digest. Never Chinese-primary.
Always end EN with Head to www.jdstudiohk.com for more case studies and 繁中 with 更多案例睇 www.jdstudiohk.com
Output JSON only: { "title": "short internal label", "body": "full post text", "mediaHint": "carousel slides or image brief with photo ids" }`,
        },
        {
          role: "user",
          content: userParts,
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
    const body = await ensureBilingualBody(String(parsed.body || ""), type);
    const mediaHint =
      String(parsed.mediaHint || meta.mediaHint) +
      (assets.length
        ? `\n\n已抽庫存相：${assets.map((a) => `#${a.id} ${a.fileName}`).join(" · ")}`
        : "");
    return {
      title: String(parsed.title || CONTENT_TYPE_LABELS[type]).slice(0, 500),
      body,
      mediaHint,
      selectedMedia,
    };
  } catch (err: any) {
    console.error(`[ContentFactory] LLM failed for ${type}:`, err?.message);
    const fallbackHint = assets.length
      ? `用庫存相：${assets.map((a, i) => `${i + 1}=#${a.id}`).join(", ")}`
      : meta.mediaHint;
    if (type === "project_bts") {
      return {
        title: "項目案例 + 幕後故事",
        body: `Last month we spent days inside one live rhythm
The hard part was never the kit count
It was knowing every turn had no redo
When the room went quiet we ignored the wide
and held one small gesture
After wrap we remembered the honest frame more than the pretty one
What unrehearsed moment from your last shoot still sticks

Head to www.jdstudiohk.com for more case studies

---
上個月我哋喺同一個現場節奏入面連續幾日
最難唔係架數 而係每個轉折都冇第二次
你最近一次拍攝最記得邊個冇得重來嘅瞬間

更多案例睇 www.jdstudiohk.com

#CaseStudy #BehindTheScenes #JDStudioHK`,
        mediaHint: fallbackHint,
        selectedMedia,
      };
    }
    if (type === "photo_education") {
      return {
        title: "攝影教育 + 行業洞察",
        body: `Why do some frames from the same scene feel alive
and others feel flat
Myth good camera equals good photo
Truth light timing and story do the work
Same room
A misses the angle
B is technically perfect and cold
C waits for the turn and it lands
Before your next shoot ask
what is the story in this moment
Which photos do you treasure more
posed or unposed

Head to www.jdstudiohk.com for more case studies

---
點解同一場景有啲相有靈魂有啲冇
❌ 好相機先有好相
✓ 好光好事機好故事
你最鍾意嘅相係擺拍定自然一刻

更多案例睇 www.jdstudiohk.com

#PhotographyTips #CreativeLeadership #JDStudioHK`,
        mediaHint: fallbackHint,
        selectedMedia,
      };
    }
    return {
      title: "數據 + 視覺化",
      body: `Commercial buyers rarely fund pretty frames alone
They fund clarity about risk and outcome
So each sequence should answer
what problem did this solve
not how many files we delivered
Numbers help
Numbers without judgment are noise
What format helps your team explain value upstairs

Head to www.jdstudiohk.com for more case studies

---
商業客戶批嘅係睇得明風險同結果
唔係相靚就得
你哋團隊用邊種內容最能同老闆講清楚值不值得做

更多案例睇 www.jdstudiohk.com

#DataStorytelling #B2BMarketing #JDStudioHK`,
      mediaHint: fallbackHint,
      selectedMedia,
    };
  }
}

export async function generateWeeklyContentBatch(opts?: {
  weekKey?: string;
  force?: boolean;
}): Promise<{
  weekKey: string;
  created: number;
  existing: number;
  assetsUsed: number;
  rolledFromPastWeek: boolean;
  schedule: Array<{ type: LinkedInContentType; atHkt: string }>;
}> {
  await ensureContentPostsTable();
  const db = await getDb();
  if (!db) {
    return {
      weekKey: "",
      created: 0,
      existing: 0,
      assetsUsed: 0,
      rolledFromPastWeek: false,
      schedule: [],
    };
  }

  const resolved = resolveContentWeek();
  const weekKey = opts?.weekKey ?? resolved.weekKey;
  const mondayForSlots = opts?.weekKey
    ? getMondayForWeekKey(opts.weekKey) ?? resolved.monday
    : resolved.monday;

  let created = 0;
  let existing = 0;
  let assetsUsed = 0;

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

    const assets = await pickAssetsForType(slot.type);
    const gen = await generateOnePost(slot.type, assets);
    const selectedJson = JSON.stringify(gen.selectedMedia);
    const scheduledFor = scheduledForSlot(mondayForSlots, slot.dayOffset, slot.hourHkt);

    if (found.length && opts?.force) {
      const [row] = await db
        .select()
        .from(linkedinContentPosts)
        .where(eq(linkedinContentPosts.id, found[0].id))
        .limit(1);
      if (row && (row.status === "approved" || row.status === "scheduled" || row.status === "published")) {
        existing++;
        continue;
      }
      await db
        .update(linkedinContentPosts)
        .set({
          title: gen.title,
          body: gen.body,
          mediaHint: gen.mediaHint,
          selectedMedia: selectedJson,
          status: "pending_review",
          scheduledFor,
        })
        .where(eq(linkedinContentPosts.id, found[0].id));
      await markAssetsUsed(assets.map((a) => a.id));
      assetsUsed += assets.length;
      created++;
      continue;
    }

    await db.insert(linkedinContentPosts).values({
      weekKey,
      contentType: slot.type,
      status: "pending_review",
      title: gen.title,
      body: gen.body,
      mediaHint: gen.mediaHint,
      selectedMedia: selectedJson,
      scheduledFor,
    });
    await markAssetsUsed(assets.map((a) => a.id));
    assetsUsed += assets.length;
    created++;
  }

  return {
    weekKey,
    created,
    existing,
    assetsUsed,
    rolledFromPastWeek: !opts?.weekKey && resolved.rolledFromPastWeek,
    schedule: describeWeekSchedule(mondayForSlots),
  };
}

/**
 * Cancel Buffer queues + delete all unpublished content-factory posts, then regenerate
 * for the active timetable week (rolls to next week if Fri slot already passed).
 */
export async function resetSchedulesAndRegenerate(): Promise<{
  deleted: number;
  bufferCancelled: number;
  bufferErrors: string[];
  generated: Awaited<ReturnType<typeof generateWeeklyContentBatch>>;
}> {
  const { deleteBufferPost } = await import("./bufferClient");
  await ensureContentPostsTable();
  const db = await getDb();
  if (!db) {
    return {
      deleted: 0,
      bufferCancelled: 0,
      bufferErrors: ["Database unavailable"],
      generated: {
        weekKey: "",
        created: 0,
        existing: 0,
        assetsUsed: 0,
        rolledFromPastWeek: false,
        schedule: [],
      },
    };
  }

  const rows = await db
    .select({
      id: linkedinContentPosts.id,
      bufferPostId: linkedinContentPosts.bufferPostId,
      bufferStatus: linkedinContentPosts.bufferStatus,
      status: linkedinContentPosts.status,
    })
    .from(linkedinContentPosts)
    .where(
      inArray(linkedinContentPosts.status, [
        "draft",
        "pending_review",
        "approved",
        "scheduled",
        "rejected",
      ])
    );

  const bufferErrors: string[] = [];
  let bufferCancelled = 0;
  for (const row of rows) {
    if (row.bufferPostId && row.bufferStatus === "queued") {
      const del = await deleteBufferPost(row.bufferPostId);
      if (del.ok) bufferCancelled++;
      else bufferErrors.push(`#${row.id}: ${del.error}`);
    }
  }

  for (const row of rows) {
    await db.delete(linkedinContentPosts).where(eq(linkedinContentPosts.id, row.id));
  }

  const generated = await generateWeeklyContentBatch({ force: false });
  return {
    deleted: rows.length,
    bufferCancelled,
    bufferErrors,
    generated,
  };
}

export async function runScheduledContentFactory(): Promise<void> {
  const hkt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const day = hkt.getUTCDay();
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
          `主題：輪播案例 · 外包vs自聘 · 反常識`,
          `新增草稿：${result.created}`,
          `已有（略過）：${result.existing}`,
          `請到「LinkedIn 營運 → 內容工廠」批核。`,
        ].join("\n"),
      });
    } catch {
      // non-critical
    }
  }

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
            `• [${CONTENT_TYPE_LABELS[p.contentType] ?? p.contentType}] ${p.title}\n${(p.body || "").slice(0, 120)}…`
        )
        .join("\n\n"),
    });
  } catch {
    // non-critical
  }
}
