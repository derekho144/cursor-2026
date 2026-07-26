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
  other: "其他",
};

const PREFERRED_MAP: Record<LinkedInContentType, string[]> = {
  carousel_case_study: ["carousel", "any"],
  outsource_vs_inhire: ["debate", "any"],
  contrarian_take: ["contrarian", "any"],
};

export const CONTENT_TYPE_LABELS: Record<LinkedInContentType, string> = {
  carousel_case_study: "輪播成功案例",
  outsource_vs_inhire: "外包 vs 自聘辯論",
  contrarian_take: "反常識觀點",
};

export const CONTENT_TYPE_BLURBS: Record<LinkedInContentType, string> = {
  carousel_case_study: "互動率高達 45.85%，B2B 決策者最愛看成果",
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
  { type: "carousel_case_study", dayOffset: 1, hourHkt: 10 }, // Tue
  { type: "outsource_vs_inhire", dayOffset: 3, hourHkt: 10 }, // Thu
  { type: "contrarian_take", dayOffset: 5, hourHkt: 11 }, // Sat
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
        li_asset_category enum('food','jewellery','product','fashion','commercial','before_after','other') NOT NULL DEFAULT 'other',
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

/** Least-used active assets, preferring theme match; carousel gets more slides. */
export async function pickAssetsForType(
  type: LinkedInContentType
): Promise<LinkedInContentAsset[]> {
  await ensureContentPostsTable();
  const db = await getDb();
  if (!db) return [];

  const need = type === "carousel_case_study" ? 6 : 2;
  const preferred = PREFERRED_MAP[type];

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
    .limit(40);

  const scored = rows
    .map((r) => ({
      row: r,
      score:
        (preferred.includes(r.preferredFor) ? 0 : 10) +
        r.timesUsed * 2 +
        (r.preferredFor === preferred[0] ? 0 : 1),
    }))
    .sort((a, b) => a.score - b.score || a.row.id - b.row.id);

  // Prefer category diversity for carousel
  const picked: LinkedInContentAsset[] = [];
  const seenCat = new Set<string>();
  for (const { row } of scored) {
    if (picked.length >= need) break;
    if (type === "carousel_case_study" && seenCat.has(row.category) && picked.length < need - 1) {
      // skip same category first pass unless we need fillers
      continue;
    }
    picked.push(row);
    seenCat.add(row.category);
  }
  if (picked.length < need) {
    for (const { row } of scored) {
      if (picked.length >= need) break;
      if (picked.some((p) => p.id === row.id)) continue;
      picked.push(row);
    }
  }
  return picked;
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
    angle: `Write a LinkedIn post designed to accompany a CAROUSEL (multi-slide) case study for JD STUDIO HK.
B2B decision-makers love proof of results — frame it as a success story they can swipe through.
Structure the BODY as:
1) Hook line (result or transformation)
2) Caption that teases the carousel (problem → approach → outcome)
3) Explicit numbered slide beats matching the PROVIDED STUDIO PHOTOS (in order)
4) Soft CTA to jdstudiohk.com
If real photos are provided, BASE the story on what you see / the captions — do NOT invent unrelated scenes.
Do NOT invent fake named client testimonials.
In mediaHint: list each slide in Chinese + English, referencing which library photo (id) goes on which slide.`,
    mediaHint:
      "輪播建議（5–7 頁）：封面成果 → Before → Brief → Shoot day → After → 效果 → CTA jdstudiohk.com",
  },
  outsource_vs_inhire: {
    angle: `Write a LinkedIn DEBATE-style post: Outsourcing photography/video to a specialist studio (JD STUDIO HK) vs hiring in-house.
Goal: hit the client's core pain points and invite comments (not a hard sell).
Use a provocative question or "Team Outsource vs Team In-house" framing.
Cover cost, downtime, equipment, peak seasons, creative range — then take a clear stance with room for disagreement.
If studio photos are provided, use them as proof of specialist-studio quality in mediaHint / framing.
End with a question that sparks replies. Soft mention of JD STUDIO HK / jdstudiohk.com.`,
    mediaHint: "配圖建議：對比圖（Outsource vs In-house 兩欄）、或「你會點揀？」投票式封面",
  },
  contrarian_take: {
    angle: `Write a CONTRARIAN LinkedIn take about brand photography / video / hiring creatives in Hong Kong or Asia.
Pick ONE sharp anti-consensus claim. Structure: bold claim → why most people are wrong → nuance → invite debate in comments.
If studio photos are provided, tie the claim to what the image shows (real craft / real results).
Sound confident, not rude. Soft CTA to JD STUDIO HK only if natural.`,
    mediaHint: "配圖建議：大字報式 hook（一句反常識金句）、高對比爭議封面",
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
          content: `You are the content strategist for JD STUDIO HK, a Hong Kong creative studio specialising in product, food, fashion, jewellery photography and video production.
Write LinkedIn posts in English (light Cantonese flavour OK in one short phrase).
Content type focus: ${CONTENT_TYPE_LABELS[type]} — ${CONTENT_TYPE_BLURBS[type]}
Rules:
- 150–280 words (carousel posts can be slightly longer to include slide beats)
- Strong first-line hook
- Short paragraphs, scannable
- Max 3 hashtags at the end
- No fake statistics or fake named client quotes
- When photos are attached, ground the post in those images
- Sound human and authoritative; for debate/contrarian types, invite comments
- Output JSON: { "title": "short internal label", "body": "full post text", "mediaHint": "carousel slides or image brief with photo ids" }`,
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
        body: `We don't sell "a photographer for a day".\nWe sell a result you can swipe through.\n\nCarousel idea for this week:\nSlide 1 — The before\nSlide 2 — The brief\nSlide 3 — Lighting / setup\nSlide 4 — Shoot day\nSlide 5 — After\nSlide 6 — What changed\nSlide 7 — CTA\n\nMore work: https://www.jdstudiohk.com\n\n#CaseStudy #ProductPhotography #JDStudioHK`,
        mediaHint: fallbackHint,
        selectedMedia,
      };
    }
    if (type === "outsource_vs_inhire") {
      return {
        title: "Outsource vs in-house debate",
        body: `Hot take for HK brand teams:\n\nHiring an in-house photographer feels like control.\nOutsourcing to a studio feels like risk.\n\nReality check — the "safe" hire often hides salary + downtime + gear you still don't own.\n\nTeam Outsource or Team In-house?\nDrop your side in the comments.\n\nhttps://www.jdstudiohk.com\n\n#MarketingHK #CreativeOps #Photography`,
        mediaHint: fallbackHint,
        selectedMedia,
      };
    }
    return {
      title: "Contrarian take",
      body: `Unpopular opinion:\n\nA "Photographer wanted" job post is often not a hiring problem — it's a demand-for-visuals problem.\n\nSometimes the contrarian move is: don't hire. Build a flexible studio retainer instead.\n\nAgree or disagree?\n\nJD STUDIO HK — https://www.jdstudiohk.com\n\n#Contrarian #BrandVisuals #HongKong`,
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
