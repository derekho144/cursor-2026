/**
 * LinkedIn Content Factory — Authority 內容工廠
 * 每週自動產出 3 類高互動草稿：
 * 1) Carousel Case Study（輪播成功案例）
 * 2) 外包 vs 自聘辯論
 * 3) 反常識觀點（Contrarian Take）
 * 你批核 → 排程 → 你或 Manus 發佈後標記 published
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
  carousel_case_study: "輪播成功案例",
  outsource_vs_inhire: "外包 vs 自聘辯論",
  contrarian_take: "反常識觀點",
};

export const CONTENT_TYPE_BLURBS: Record<LinkedInContentType, string> = {
  carousel_case_study: "輪播互動率約 24.42%（vs 文字 6.67%），故事＋幕後最易停滑",
  outsource_vs_inhire: "觸碰客戶核心痛點，引發大量評論",
  contrarian_take: "引發辯論，演算法大力推廣",
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
  { type: "outsource_vs_inhire", dayOffset: 1, hourHkt: 16 }, // Tue 4pm
  { type: "carousel_case_study", dayOffset: 2, hourHkt: 16 }, // Wed 4pm
  { type: "contrarian_take", dayOffset: 3, hourHkt: 17 }, // Thu 5pm
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
        li_content_type enum('carousel_case_study','outsource_vs_inhire','contrarian_take','case_study','industry_insight') NOT NULL,
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
        li_asset_preferred_for enum('any','carousel','debate','contrarian') NOT NULL DEFAULT 'any',
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
          'carousel_case_study','contrarian_take'
        ) NOT NULL
      `);
      await db.execute(sql`
        UPDATE linkedin_content_posts SET li_content_type = 'carousel_case_study'
        WHERE li_content_type = 'case_study'
      `);
      await db.execute(sql`
        UPDATE linkedin_content_posts SET li_content_type = 'contrarian_take'
        WHERE li_content_type = 'industry_insight'
      `);
      await db.execute(sql`
        ALTER TABLE linkedin_content_posts
        MODIFY COLUMN li_content_type ENUM(
          'carousel_case_study','outsource_vs_inhire','contrarian_take'
        ) NOT NULL
      `);
    } catch (migrateErr) {
      console.warn("[ContentFactory] enum migrate (may already be current):", migrateErr);
    }
    tableReady = true;
  } catch (err) {
    console.error("[ContentFactory] ensureTable error:", err);
  }
}

/** preferredFor → content type（指定主題嘅相只會用喺對應帖） */
const THEME_KEY: Record<LinkedInContentType, "carousel" | "debate" | "contrarian"> = {
  carousel_case_study: "carousel",
  outsource_vs_inhire: "debate",
  contrarian_take: "contrarian",
};

/**
 * 抽相規則：
 * 1) 有標「輪播案例／外包辯論／反常識」→ 該主題用晒呢啲相（唔會借去其他主題）
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
  const maxAssets = type === "carousel_case_study" ? 9 : 4;

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
  carousel_case_study: {
    angle: `Write a LinkedIn CAROUSEL case-study post for JD STUDIO HK (Type A: 項目案例 + 幕後故事).
Follow LINKEDIN_COPY_STYLE strictly (story-first, Michele Galeotto pattern: project + deep reflection, not portfolio dump).
BODY:
1) Hook (story / myth / number / question — never corporate announce)
2) Scene + challenge (honest difficulty OK)
3) Method with ✓ / ❌ lists
4) One real behind-the-scenes moment grounded in PROVIDED PHOTOS / captions
5) Result — only real numbers/names from captions; no invented testimonials
6) Insight (craft / trust / process philosophy)
7) CTA as a question (comments), not hard sell; soft jdstudiohk.com only if natural after the question
Also list numbered slide beats (5–7) matching photo order in the body or mediaHint.
If photos are event/product/food/fashion/jewellery/commercial — write THAT story; never force wedding.`,
    mediaHint:
      "輪播 Type A（5–7 頁）：P1 Hook 封面 → P2 場景/挑戰 → P3 方法 ✓ → P4 幕後真實時刻 → P5 結果 → P6 洞察 → P7 CTA 問題",
  },
  outsource_vs_inhire: {
    angle: `Write a LinkedIn DEBATE post: outsource photography/video to a specialist studio (JD STUDIO HK) vs hire in-house.
Follow LINKEDIN_COPY_STYLE (hook methods, short paragraphs, CTA = question).
Hit core pain: cost, downtime, gear, peak seasons, creative range — clear stance, room to disagree.
Use ✓ / ❌ lists. No hard sell. Soft jdstudiohk.com only after a question CTA.
If photos provided, treat as proof of specialist craft in framing/mediaHint.`,
    mediaHint: "配圖：Outsource vs In-house 對比，或問題式封面「你會點揀？」",
  },
  contrarian_take: {
    angle: `Write a CONTRARIAN LinkedIn take on brand photography / video / creative hiring in HK or Asia.
Follow LINKEDIN_COPY_STYLE. ONE sharp anti-consensus claim (myth-bust hook).
Structure: bold claim → why the consensus is wrong → nuance / real craft → CTA question for debate.
Ground in provided photos if any. Confident, not rude. No hard sell.`,
    mediaHint: "配圖：大字報式反常識金句封面、高對比",
  },
};

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
          content: `You are the LinkedIn content writer for JD STUDIO HK (Hong Kong photography & videography: product, food, fashion, jewellery, event, commercial, video).

${LINKEDIN_COPY_STYLE_PROMPT}

Content type this run: ${CONTENT_TYPE_LABELS[type]} — ${CONTENT_TYPE_BLURBS[type]}

When photos are attached, ground every claim in those images and captions.
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
    const mediaHint =
      String(parsed.mediaHint || meta.mediaHint) +
      (assets.length
        ? `\n\n已抽庫存相：${assets.map((a) => `#${a.id} ${a.fileName}`).join(" · ")}`
        : "");
    return {
      title: String(parsed.title || CONTENT_TYPE_LABELS[type]).slice(0, 500),
      body: String(parsed.body || ""),
      mediaHint,
      selectedMedia,
    };
  } catch (err: any) {
    console.error(`[ContentFactory] LLM failed for ${type}:`, err?.message);
    const fallbackHint = assets.length
      ? `用庫存相：${assets.map((a, i) => `${i + 1}=#${a.id}`).join(", ")}`
      : meta.mediaHint;
    if (type === "carousel_case_study") {
      return {
        title: "Carousel case study",
        body: `上週拍攝，客戶一句話改咗成個方向：「唔好靚到假，要真。」\n\n我哋跟住故事走，唔再等「完美光線」。\n\n✓ 現場即時對光\n✓ 少擺拍、多捕捉\n✓ 交咗精選，唔係交晒全部\n\n最難嘅一刻往往先最有溫度。\n\n你最近一次拍攝，邊張相最有「真」？\n\n---\nLast shoot, one line changed everything: "Don't make it fake-pretty. Make it real."\nWe followed the story — not the perfect light.\nWhich frame from your last project felt the most honest?\n\n#CaseStudy #PhotographyHK #JDStudioHK`,
        mediaHint: fallbackHint,
        selectedMedia,
      };
    }
    if (type === "outsource_vs_inhire") {
      return {
        title: "Outsource vs in-house debate",
        body: `「請攝影師」聽落好有掌控感。\n「搵工作室」聽落好似有風險。\n\n現實係：自聘隱藏咗人工、淡季空窗、同你仍然冇嘅器材。\n\n❌ 以為有人坐喺度就等於有產量\n✓ 峰值檔期先見到真正成本\n\n你而家 Team Outsource 定 Team In-house？留言話我知。\n\n---\nHiring in-house feels like control. Outsourcing feels like risk.\nOften the "safe" hire hides salary, downtime, and gear you still don't own.\nTeam Outsource or Team In-house?\n\n#MarketingHK #CreativeOps #Photography`,
        mediaHint: fallbackHint,
        selectedMedia,
      };
    }
    return {
      title: "Contrarian take",
      body: `反常識講一句：\n\n「急請攝影師」好多時唔係招聘問題——係視覺需求管理問題。\n\n有時更慳同更快嘅做法，唔係再請一個人，而係同一間 studio 建立彈性 retainer。\n\n你同意定反對？\n\n---\nUnpopular: a "Photographer wanted" post is often a demand problem, not a hiring problem.\nSometimes the move is: don't hire — build a flexible studio retainer.\nAgree or disagree?\n\n#Contrarian #BrandVisuals #HongKong`,
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
