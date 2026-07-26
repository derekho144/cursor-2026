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
import { LINKEDIN_COPY_STYLE_PROMPT } from "./linkedinCopyStyle";

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
 */
export async function pickAssetsForType(
  type: LinkedInContentType
): Promise<LinkedInContentAsset[]> {
  await ensureContentPostsTable();
  const db = await getDb();
  if (!db) return [];

  const theme = THEME_KEY[type];
  const maxAssets = type === "project_bts" ? 9 : type === "photo_education" ? 6 : 5;

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

  // 有指定主題相 → 用晒（上限 maxAssets）；否則先用「全部主題」
  const pool = exact.length > 0 ? exact : anyPool;
  return pool.slice(0, maxAssets);
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

function assetsToSelectedMedia(assets: LinkedInContentAsset[]): SelectedMediaItem[] {
  return assets.map((a, i) => ({
    id: a.id,
    url: a.url,
    fileName: a.fileName,
    category: a.category,
    caption: a.caption,
    slideOrder: i + 1,
  }));
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
    angle: `Write a LinkedIn post in Michele Galeotto style for JD STUDIO HK — Type A 項目案例 + 幕後.
Feel: creative director reflecting on a real shoot with the team (we) — project first then thinking.
Open on what happened last week / on set with a little friction — not a service summary.
Include one honest challenge one vivid moment from PROVIDED PHOTOS then a quiet insight from THIS job.
Soft CTA question. English after --- = mini-story (hook conflict/moment insight CTA) not weak bullets.
5–7 slide beats in mediaHint. Match real shoot type never force wedding. No punctuation in body.`,
    mediaHint:
      "輪播 Type A（5–7 頁）：P1 故事開場 → P2 真實挑戰 → P3 現場選擇 → P4 幕後一刻 → P5 結果（只用真實 caption）→ P6 思考 → P7 柔和 CTA",
  },
  photo_education: {
    angle: `Michele Galeotto style Type B 攝影教育 + 行業洞察 for JD STUDIO HK.
Open like industry thinking from someone who just left a set — not a textbook tip list.
One lived example (from photos if any) then what most teams get wrong then what you notice after years of shoots.
Soft CTA. English after --- mini-story arc. No punctuation in body.`,
    mediaHint:
      "輪播 Type B（5–6 頁）：P1 行業觀察開場 → P2 迷思 → P3 現場例子 → P4 我哋點睇 → P5 洞察 → P6 CTA",
  },
  data_viz: {
    angle: `Michele Galeotto style Type C 數據 + 視覺化 for JD STUDIO HK.
Start from a number or timeline that changed how you briefed or shot — then what it means for commercial buyers.
Insight must feel like craft reflection not a marketing dashboard. Soft CTA.
English after --- mini-story. No fake JD ROI. No punctuation in body.`,
    mediaHint:
      "輪播 Type C（4–5 頁）：P1 有故事嘅數字 → P2 現場含義 → P3 對客戶意味住咩 → P4 思考 → P5 CTA",
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

/** True if text after --- has enough Latin letters to count as English mini-story */
function hasEnglishMiniStory(body: string): boolean {
  const idx = body.indexOf("\n---\n");
  const alt = idx < 0 ? body.indexOf("\n---") : idx;
  if (alt < 0) return false;
  const after = body.slice(alt).replace(/^[\s\-]+/, "");
  const { text } = stripHashtags(after);
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  return latin >= 80;
}

async function generateEnglishMiniStory(zhBody: string): Promise<string> {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `Rewrite the Chinese LinkedIn post as an English mini-story summary for JD STUDIO HK.
Rules:
- No punctuation marks at all (no . , ? ! : ; ' " etc)
- Use short line breaks
- Structure exactly: hook then conflict/real moment then insight then soft CTA question
- Conversational Michele Galeotto creative-director tone we-voice
- Do not invent new facts beyond the Chinese
- Output JSON { "english": "..." } only the English block without --- and without hashtags`,
      },
      {
        role: "user",
        content: `Chinese post:\n\n${zhBody}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "en_mini_story",
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
  const raw = response?.choices?.[0]?.message?.content;
  if (!raw) throw new Error("No English LLM content");
  const text = typeof raw === "string" ? raw : JSON.stringify(raw);
  const parsed = JSON.parse(text);
  return String(parsed.english || "").trim();
}

async function ensureBilingualBody(body: string): Promise<string> {
  const trimmed = body.trim();
  if (hasEnglishMiniStory(trimmed)) return trimmed;

  // Split off trailing hashtags
  const { text: main, tags } = stripHashtags(trimmed);
  let zh = main;
  const sep = zh.indexOf("\n---");
  if (sep >= 0) zh = zh.slice(0, sep).trim();

  try {
    const en = await generateEnglishMiniStory(zh);
    if ((en.match(/[A-Za-z]/g) || []).length < 40) return trimmed;
    const parts = [zh, "---", en];
    if (tags) parts.push("", tags);
    return parts.join("\n");
  } catch (err: any) {
    console.warn("[ContentFactory] English mini-story repair failed:", err?.message);
    return trimmed;
  }
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
          content: `You write LinkedIn posts for JD STUDIO HK in the voice of Michele Galeotto (HK creative director style): project + reflection story-first honest challenge we-voice soft invite.

${LINKEDIN_COPY_STYLE_PROMPT}

Content type this run: ${CONTENT_TYPE_LABELS[type]} — ${CONTENT_TYPE_BLURBS[type]}

When photos are attached ground every claim in those images and captions.
CRITICAL:
1) No punctuation marks in body
2) Sound like Michele — not a case-report brochure
3) body MUST be bilingual Format A: full 繁中 story then a line with only --- then English mini-story (hook + conflict/moment + insight + CTA). Never end after --- with empty English. Never Chinese-only.
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
    const body = await ensureBilingualBody(String(parsed.body || ""));
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
        body: `上個月我哋連續幾日跟住同一個現場節奏走

真正難嘅唔係架數
而係每一個轉折都冇第二次

有一刻場內突然靜咗
我哋冇追大景
而係對準一個好細嘅動作

拍完先明
現場最有價值嘅往往唔係最靚嗰格
而係最真嗰格

你哋最近一次拍攝
最記得邊一個冇得重來嘅瞬間

---
Last month we spent days inside one live rhythm
The hard part was never the kit count
It was knowing every turn had no redo
When the room went quiet we ignored the wide
and held one small gesture
After wrap we remembered the honest frame more than the pretty one
What unrehearsed moment from your last shoot still sticks

#CaseStudy #BehindTheScenes #JDStudioHK`,
        mediaHint: fallbackHint,
        selectedMedia,
      };
    }
    if (type === "photo_education") {
      return {
        title: "攝影教育 + 行業洞察",
        body: `我哋做創作越耐
越發現人哋問錯第一條問題

多數人會問邊部機
現場真正分高下嘅
往往係你肯唔肯等同你睇唔睇到

同一場景
有人追完美光
有人追故事轉折
結果差好遠

你學嘢到而家
邊一個習慣最難改

---
The longer we make work the clearer one thing gets
People ask about the camera first
On set the real split is whether you wait and whether you see
Same scene
Some chase perfect light
Some chase the turn in the story
Which habit has been hardest for you to unlearn

#PhotographyTips #CreativeLeadership #JDStudioHK`,
        mediaHint: fallbackHint,
        selectedMedia,
      };
    }
    return {
      title: "數據 + 視覺化",
      body: `商業客戶好少因為相靚就批 budget
佢哋批嘅係自己睇得明風險同結果

所以我哋越嚟越少堆圖
多講每一段畫面解決咗咩問題

數字有用
但冇判斷嘅數字只係噪音

你哋團隊而家用邊種內容
最能同老闆講清楚值不值得做

---
Commercial buyers rarely fund pretty frames alone
They fund clarity about risk and outcome
So we show fewer dumps and more
what each sequence actually solved
Numbers help
Numbers without judgment are just noise
What format helps your team explain value upstairs

#DataStorytelling #B2BMarketing #JDStudioHK`,
      mediaHint: fallbackHint,
      selectedMedia,
    };
  }
}

export async function generateWeeklyContentBatch(opts?: {
  weekKey?: string;
  force?: boolean;
}): Promise<{ weekKey: string; created: number; existing: number; assetsUsed: number }> {
  await ensureContentPostsTable();
  const db = await getDb();
  if (!db) return { weekKey: "", created: 0, existing: 0, assetsUsed: 0 };

  const weekKey = opts?.weekKey ?? getHktWeekKey();
  const monday = getMondayHkt();
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
    const scheduledFor = scheduledForSlot(monday, slot.dayOffset, slot.hourHkt);

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

  return { weekKey, created, existing, assetsUsed };
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
