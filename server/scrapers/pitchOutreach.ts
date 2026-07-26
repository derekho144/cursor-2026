/**
 * pitchOutreach.ts
 * 客戶開拓：招聘訊號雷達 + LinkedIn 人手跟進
 * - 抓取 JobsDB / Indeed 等「請攝影師／攝錄師」職位
 * - 存成待跟進線索（唔再自動搵電郵／盲寄）
 * - 可選：生成 LinkedIn DM 草稿供複製
 */
import { getDb } from "../db";
import { pitchLeads } from "../../drizzle/schema";
import { eq, and, gte, count, sql } from "drizzle-orm";
import { invokeLLM } from "../_core/llm";
import { scrapeAllJobBoards, type ScrapedJob } from "./jobScraper";
import { extractDomain } from "./jobScraper";

/** 超過呢個日數嘅職位當過期，自動移出「待跟進」 */
export const JOB_LISTING_MAX_AGE_DAYS = 21;

export function leadAgeAnchor(lead: { jobPostedAt?: Date | null; createdAt: Date }): Date {
  return lead.jobPostedAt ?? lead.createdAt;
}

export function isLeadExpired(lead: { jobPostedAt?: Date | null; createdAt: Date }, now = Date.now()): boolean {
  const anchor = leadAgeAnchor(lead).getTime();
  return now - anchor > JOB_LISTING_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}

/** LinkedIn people search for HR / hiring contacts at a company */
export function linkedInPeopleSearchUrl(companyName: string): string {
  const q = `${companyName} HR OR "Talent" OR "Hiring Manager" OR Founder Hong Kong`;
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`;
}

/** LinkedIn company search */
export function linkedInCompanySearchUrl(companyName: string): string {
  return `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(companyName)}`;
}

/** JobsDB 過期時用公司搜尋頁代替死連結 */
export function fallbackJobSearchUrl(lead: { source: string; companyName: string; jobUrl: string }): string {
  if (lead.source === "jobsdb") {
    return `https://hk.jobsdb.com/jobs?q=${encodeURIComponent(lead.companyName)}`;
  }
  if (lead.source === "indeed") {
    return `https://hk.indeed.com/jobs?q=${encodeURIComponent(lead.companyName)}&l=Hong+Kong`;
  }
  return lead.jobUrl;
}

// ─── AI 生成個性化 pitch email ─────────────────────────────────────────────
export async function generatePitchEmail(params: {
  companyName: string;
  jobTitle: string;
  jobDescription?: string;
  industry?: string;
  contactName?: string;
  source?: string;
}): Promise<{ subject: string; body: string }> {
  const { companyName, jobTitle, jobDescription, industry, contactName, source } = params;

  // 將來源轉換為可讀的平台名稱
  const sourceName = source === "linkedin" ? "LinkedIn" :
    source === "jobsdb" ? "JobsDB" :
    source === "indeed" ? "Indeed" :
    source === "ctgoodjobs" ? "CTgoodjobs" : "a job platform";

  // 根據職位類型判斷對應作品集連結
  const jobTitleLower = jobTitle.toLowerCase();
  const descLower = (jobDescription ?? '').toLowerCase();
  const industryLower = (industry ?? '').toLowerCase();

  const isJewellery = jobTitleLower.includes('jewel') || jobTitleLower.includes('珠寶') || jobTitleLower.includes('首飾') || industryLower.includes('jewel');
  const isFood = jobTitleLower.includes('food') || jobTitleLower.includes('食物') || jobTitleLower.includes('食品') || industryLower.includes('food') || industryLower.includes('restaurant') || industryLower.includes('f&b');
  const isProduct = jobTitleLower.includes('product') || jobTitleLower.includes('產品') || industryLower.includes('product');
  const isFashion = jobTitleLower.includes('fashion') || jobTitleLower.includes('時裝') || jobTitleLower.includes('apparel') || jobTitleLower.includes('clothing') || jobTitleLower.includes('garment') || industryLower.includes('fashion') || industryLower.includes('apparel');
  const isVideo = jobTitleLower.includes('video') || jobTitleLower.includes('videograph') || jobTitleLower.includes('攝錄') || jobTitleLower.includes('影片') || descLower.includes('video production') || descLower.includes('videograph');

  let portfolioUrl: string;
  if (isJewellery) {
    portfolioUrl = 'https://www.jdstudiohk.com/services/jewelry-photography';
  } else if (isFood) {
    portfolioUrl = 'https://www.jdstudiohk.com/services/food-photography';
  } else if (isProduct) {
    portfolioUrl = 'https://www.jdstudiohk.com/services/product-photography';
  } else if (isFashion) {
    portfolioUrl = 'https://www.jdstudiohk.com';
  } else if (isVideo) {
    portfolioUrl = 'https://www.jdstudiohk.com/services/video-project';
  } else {
    portfolioUrl = 'https://www.jdstudiohk.com';
  }

  const systemPrompt = `You are a professional business development writer for JD STUDIO HK, a Hong Kong-based creative studio specialising in product photography, food photography, fashion photography, jewellery photography, and video production for brands and companies.
Your task is to write a short LinkedIn DM (connection note or InMail body) to someone at a company that is currently hiring an in-house photographer/videographer.
The goal: persuade them to outsource to JD STUDIO HK instead of hiring full-time.

Rules:
- Write in English only
- 80–130 words, 2–3 short paragraphs, suitable for LinkedIn DM (not a long email)
- Mention we saw their ${jobTitle} posting on ${sourceName}
- Propose outsourcing as more flexible / cost-effective than a full-time hire
- Include this portfolio link naturally: ${portfolioUrl}
- Soft CTA for a quick chat
- Do NOT include "Dear..." greeting or email sign-off — LinkedIn style, first person "I"
- Sound warm and human
- Output JSON with keys: "subject" (short LinkedIn opener / first line) and "body" (full DM text)`;

  const userPrompt = `Company: ${companyName}
Job Title they posted: ${jobTitle}
Platform where we saw the posting: ${sourceName}
${industry ? `Industry: ${industry}` : ""}
${jobDescription ? `Job Description (excerpt): ${jobDescription.slice(0, 600)}` : ""}
${contactName ? `Contact name if known: ${contactName}` : ""}

Write a personalised LinkedIn DM proposing JD STUDIO HK as an outsourced photography/video partner instead of an in-house hire.`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "pitch_email",
          strict: true,
          schema: {
            type: "object",
            properties: {
              subject: { type: "string", description: "Email subject line" },
              body: { type: "string", description: "Email body (without greeting and sign-off)" },
            },
            required: ["subject", "body"],
            additionalProperties: false,
          },
        },
      },
    });

    const rawContent = response?.choices?.[0]?.message?.content;
    if (!rawContent) throw new Error("No content from LLM");
    const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);

    const parsed = JSON.parse(content);
    return {
      subject: parsed.subject || `Photography & Video Production Partnership — JD STUDIO HK`,
      body: parsed.body || "",
    };
  } catch (err: any) {
    console.error("[PitchOutreach] AI generation error:", err?.message);
    // 備用固定模板（LinkedIn DM）
    return {
      subject: `Saw your ${jobTitle} posting`,
      body: `Hi — I noticed ${companyName} is hiring for a ${jobTitle} role on ${sourceName}.

Instead of bringing on a full-time hire, many Hong Kong brands work with JD STUDIO as an outsourced photo/video partner — more flexible, and often more cost-effective for project or ongoing needs.

Happy to share relevant work: ${portfolioUrl}

Would a quick chat this week make sense?`,
    };
  }
}

// ─── 清理聯絡人名字（避免使用電郵用戶名或不合理的名字）────────────────────────
export function sanitizeContactName(name?: string): string | undefined {
  if (!name) return undefined;
  const trimmed = name.trim();
  // 過濾電郵用戶名格式（含有 . _ - 或純英文+數字組合）
  if (/[._\-]/.test(trimmed)) return undefined;
  // 過濾含有數字的名字
  if (/\d/.test(trimmed)) return undefined;
  // 過濾太短（1個字）或太長（超過40個字）
  if (trimmed.length < 2 || trimmed.length > 40) return undefined;
  // 只取名（First Name），避免 Dear Stephanie Kwok 這類全名
  const firstName = trimmed.split(/\s+/)[0];
  // 確保名字首字母大寫
  return firstName.charAt(0).toUpperCase() + firstName.slice(1);
}

// ─── 今日已標記「已聯絡」數量 ────────────────────────────────────────
export async function getTodayContactedCount(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const result = await db
    .select({ cnt: count() })
    .from(pitchLeads)
    .where(
      and(
        eq(pitchLeads.status, "sent"),
        gte(pitchLeads.pitchSentAt, todayStart)
      )
    );

  return result[0]?.cnt ?? 0;
}

/** @deprecated use getTodayContactedCount — LinkedIn flow no longer auto-sends email */
export async function getTodaySentCount(): Promise<number> {
  return getTodayContactedCount();
}

// ─── 儲存 leads 到資料庫（去重） ──────────────────────────────────────────
export async function saveLeadsToDb(jobs: ScrapedJob[]): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  let saved = 0;

  // 相關性過濾：只保留攝影/攝錄相關職位
  // 使用更精確的過濾邏輯：職位必須包含「photographer」或「videographer」等核心詞彙
  const CORE_KEYWORDS = [
    'photographer', 'videographer', 'cinematographer', 'video production',
    '攝影師', '攝錄師',
  ];

  // 排除義工/非商業性質的職位關鍵字
  const EXCLUDE_KEYWORDS = [
    'volunteer', 'voluntary', 'intern', 'internship', 'unpaid',
    '義工', '實習', '義務', '無薪',
  ];

  // 公司黑名單：永遠不發送 Pitch Email 的公司
  const COMPANY_BLACKLIST = [
    'hk01', 'hk01 company', 'time auction', 'now tv',
  ];

  const isRelevantJob = (title: string): boolean => {
    const t = title.toLowerCase();
    // 必須包含核心詞彙
    if (!CORE_KEYWORDS.some(kw => t.includes(kw.toLowerCase()))) return false;
    // 排除義工/實習等非商業職位
    if (EXCLUDE_KEYWORDS.some(kw => t.includes(kw.toLowerCase()))) return false;
    return true;
  };

  const isBlacklistedCompany = (companyName: string): boolean => {
    const c = companyName.toLowerCase();
    return COMPANY_BLACKLIST.some(bl => c.includes(bl));
  };

  for (const job of jobs) {
    // 過濾不相關職位（例如 Product Designer、Fashion Designer 等）
    if (!isRelevantJob(job.jobTitle)) {
      console.log(`[PitchOutreach] Skipping irrelevant job: "${job.jobTitle}" at ${job.companyName}`);
      continue;
    }
    // 過濾黑名單公司
    if (isBlacklistedCompany(job.companyName)) {
      console.log(`[PitchOutreach] Skipping blacklisted company: "${job.companyName}"`);
      continue;
    }

    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      // 去重 1：同一 jobUrl 不重複插入
      const existing = await db
        .select({ id: pitchLeads.id })
        .from(pitchLeads)
        .where(eq(pitchLeads.jobUrl, job.jobUrl))
        .limit(1);
      if (existing.length > 0) continue;

      // 去重 2：同一公司名稱 + 職位標題在過去 30 天內不重複（防止不同關鍵字搜尋到同一職位）
      const titleExisting = await db
        .select({ id: pitchLeads.id })
        .from(pitchLeads)
        .where(
          and(
            eq(pitchLeads.companyName, job.companyName),
            eq(pitchLeads.jobTitle, job.jobTitle),
            gte(pitchLeads.createdAt, thirtyDaysAgo)
          )
        )
        .limit(1);
      if (titleExisting.length > 0) continue;

      // 去重 3：同一公司域名在過去 30 天內不重複
      if (job.companyWebsite) {
        const domain = extractDomain(job.companyWebsite);
        if (domain) {
          const domainExisting = await db
            .select({ id: pitchLeads.id })
            .from(pitchLeads)
            .where(
              and(
                eq(pitchLeads.companyDomain, domain),
                gte(pitchLeads.createdAt, thirtyDaysAgo)
              )
            )
            .limit(1);
          if (domainExisting.length > 0) continue;
        }
      }

      // 確保 URL 不超過資料庫欄位限制（varchar 1024）
      const safeJobUrl = job.jobUrl.slice(0, 1020);
      const safeCompanyWebsite = job.companyWebsite?.slice(0, 512);
      // 確保 source 是有效的 enum 值
      const validSources = ["jobsdb", "linkedin", "indeed", "ctgoodjobs"] as const;
      const safeSource = validSources.includes(job.source as any) ? job.source : "linkedin";
      await db.insert(pitchLeads).values({
        companyName: job.companyName.slice(0, 255),
        companyWebsite: safeCompanyWebsite,
        industry: job.industry?.slice(0, 128),
        jobTitle: job.jobTitle.slice(0, 255),
        jobUrl: safeJobUrl,
        jobDescription: job.jobDescription,
        source: safeSource,
        jobPostedAt: job.jobPostedAt,
        companyDomain: safeCompanyWebsite ? extractDomain(safeCompanyWebsite) : undefined,
        status: "pending_review", // 待 LinkedIn 跟進
      });
      saved++;
    } catch (err: any) {
      console.error(`[PitchOutreach] Error saving lead for ${job.companyName}:`, err?.message);
    }
  }

  console.log(`[PitchOutreach] Saved ${saved} new leads to DB`);
  return saved;
}

/**
 * 將超過 JOB_LISTING_MAX_AGE_DAYS 日、仍待跟進嘅職位標為 skipped（已過期）。
 * 用 COALESCE(job_posted_at, createdAt) 做錨點。
 */
export async function expireStaleLeads(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const cutoff = new Date(Date.now() - JOB_LISTING_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  const note = `Job listing expired (>${JOB_LISTING_MAX_AGE_DAYS}d)`;

  try {
    const result = await db.execute(sql`
      UPDATE pitch_leads
      SET status = 'skipped',
          notes = ${note},
          updatedAt = NOW()
      WHERE status IN ('pending_review', 'pending_email')
        AND COALESCE(job_posted_at, createdAt) < ${cutoff}
    `);
    const affected = Number((result as any)?.[0]?.affectedRows ?? (result as any)?.affectedRows ?? 0);
    if (affected > 0) {
      console.log(`[PitchOutreach] Expired ${affected} stale lead(s) older than ${JOB_LISTING_MAX_AGE_DAYS}d`);
    }
    return affected;
  } catch (err) {
    console.error("[PitchOutreach] expireStaleLeads error:", err);
    return 0;
  }
}

// ─── 主流程：只爬取 + 存線索（唔再自動搵電郵／寄信）────────────────────
export async function runOutreachPipeline(_hunterApiKey?: string): Promise<{
  scraped: number;
  saved: number;
  emailsFound: number;
  sent: number;
  skipped: number;
}> {
  const db = await getDb();
  if (!db) return { scraped: 0, saved: 0, emailsFound: 0, sent: 0, skipped: 0 };

  console.log("[PitchOutreach] Starting lead-radar pipeline (scrape only, no auto-email)...");

  // 1. 舊 pending_email → 待跟進；唔再批量重開「No email found」（多數已過期）
  try {
    await db
      .update(pitchLeads)
      .set({ status: "pending_review", notes: null })
      .where(eq(pitchLeads.status, "pending_email"));
  } catch (err) {
    console.error("[PitchOutreach] Legacy status migrate error:", err);
  }

  // 2. 過期職位移出待跟進
  const expired = await expireStaleLeads();

  // 3. 抓取職位
  const jobs = await scrapeAllJobBoards();
  console.log(`[PitchOutreach] Scraped ${jobs.length} jobs`);

  // 4. 儲存到資料庫（status = pending_review）
  const saved = await saveLeadsToDb(jobs);

  console.log(`[PitchOutreach] Pipeline complete. Scraped: ${jobs.length}, new: ${saved}, expired: ${expired}`);

  return { scraped: jobs.length, saved, emailsFound: 0, sent: 0, skipped: expired };
}
