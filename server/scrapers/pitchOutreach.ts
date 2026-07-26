/**
 * pitchOutreach.ts
 * 自動化客戶開拓主控制器
 * - 抓取招聘職位
 * - 搜尋聯絡 email
 * - AI 生成個性化 pitch email
 * - Gmail 發送，每日限 10 封
 */
import { getDb } from "../db";
import { pitchLeads, pitchSendLog } from "../../drizzle/schema";
import { eq, and, gte, count, inArray } from "drizzle-orm";
import { invokeLLM } from "../_core/llm";
import { sendViaGmail } from "../resendEmail";
import { scrapeAllJobBoards, type ScrapedJob } from "./jobScraper";
import { findContactEmail, findDecisionMakerEmail } from "./emailFinder";
import { extractDomain } from "./jobScraper";
import { findLinkedInDecisionMakers } from "./linkedinDecisionMaker";

const DAILY_SEND_LIMIT = 10;

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
  let photographyType: string;
  if (isJewellery) {
    portfolioUrl = 'https://www.jdstudiohk.com/services/jewelry-photography';
    photographyType = 'jewellery photography';
  } else if (isFood) {
    portfolioUrl = 'https://www.jdstudiohk.com/services/food-photography';
    photographyType = 'food photography';
  } else if (isProduct) {
    portfolioUrl = 'https://www.jdstudiohk.com/services/product-photography';
    photographyType = 'product photography';
  } else if (isFashion) {
    portfolioUrl = 'https://www.jdstudiohk.com';
    photographyType = 'fashion photography';
  } else if (isVideo) {
    portfolioUrl = 'https://www.jdstudiohk.com/services/video-project';
    photographyType = 'video production';
  } else {
    portfolioUrl = 'https://www.jdstudiohk.com';
    photographyType = 'product, food, fashion, and jewellery photography as well as video production';
  }

  const systemPrompt = `You are a professional business development writer for JD STUDIO HK, a Hong Kong-based creative studio specialising in product photography, food photography, fashion photography, jewellery photography, and video production for brands and companies.
Your task is to write a warm, personal, and compelling cold outreach email to a company that is currently hiring a photographer for product, food, or fashion photography needs.
The goal is to propose an alternative collaboration model — instead of hiring a full-time employee, they could work with JD STUDIO HK as a professional outsourced photography partner.

Rules:
- Write in English only
- 3 short paragraphs, around 120-180 words total
- Paragraph 1: Mention that we saw their job posting on ${sourceName} for a ${jobTitle} role. Express genuine interest in their brand/products/company. Be specific to their industry if possible (e.g. for a food brand, mention their food products; for a fashion brand, mention their collections)
- Paragraph 2: Introduce JD STUDIO HK briefly — Hong Kong-based creative studio specialising in ${photographyType} for brands. Mention that outsourcing to a specialist studio like ours can be more flexible, cost-effective, and deliver higher quality results than a full-time hire. Include this specific portfolio link naturally in the text: ${portfolioUrl}
- Paragraph 3: Soft call-to-action — invite them to have a quick chat or browse our portfolio at ${portfolioUrl}, no pressure
- Do NOT include greeting (Dear...) or sign-off — those will be added separately
- Sound warm, genuine, and human — NOT like a mass marketing email
- Reference the specific company name and job title naturally
- Output JSON with keys: "subject" and "body"`;

  const userPrompt = `Company: ${companyName}
Job Title they posted: ${jobTitle}
Platform where we saw the posting: ${sourceName}
${industry ? `Industry: ${industry}` : ""}
${jobDescription ? `Job Description (excerpt): ${jobDescription.slice(0, 600)}` : ""}

Write a personalised cold outreach email proposing JD STUDIO HK as an outsourced photography/video production partner.`;

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
    // 備用固定模板
    return {
      subject: `Photography & Video Production Services — JD STUDIO HK`,
      body: `We noticed that ${companyName} has photography and video production needs, and we'd love to introduce JD STUDIO HK as a potential creative partner.

We are a Hong Kong-based production company specializing in corporate photography, product shoots, event coverage, and video production. Our portfolio at jdstudiohk.com showcases our work across various industries.

We'd be happy to share our portfolio and discuss how we can support your visual content needs. Please feel free to reach out at your convenience.`,
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

// ─── 建立完整 email HTML ───────────────────────────────────────────────────
export function buildEmailHtml(params: {
  contactName?: string;
  body: string;
  companyName: string;
}): string {
  const safeName = sanitizeContactName(params.contactName);
  const greeting = safeName ? `Dear ${safeName},` : `Dear Hiring Manager,`;
  const bodyHtml = params.body
    .split("\n\n")
    .map((p) => `<p style="margin:0 0 12px 0;">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");

  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:600px;margin:0 auto;">
<p style="margin:0 0 12px 0;">${greeting}</p>
${bodyHtml}
<p style="margin:16px 0 4px 0;">Cheers!</p>
<p style="margin:0;font-weight:bold;">Derek</p>
<p style="margin:0;">JD STUDIO HK</p>
<p style="margin:0;">Tel No: (852) 9153 1976</p>
<p style="margin:0;">Web: <a href="https://jdstudiohk.com/" style="color:#1a73e8;">https://jdstudiohk.com/</a></p>
<div style="background:#f5f5f5;padding:12px 20px;font-size:11px;color:#888;margin-top:20px;">
  <p style="margin:0;">JD Studio · Hong Kong &nbsp;|&nbsp; info.exposurehk@gmail.com &nbsp;|&nbsp; www.jdstudiohk.com</p>
</div>
</div>`;
}

// ─── 今日已發送數量 ────────────────────────────────────────────────────────
export async function getTodaySentCount(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const result = await db
    .select({ cnt: count() })
    .from(pitchSendLog)
    .where(and(gte(pitchSendLog.sentAt, todayStart), eq(pitchSendLog.result, "success")));

  return result[0]?.cnt ?? 0;
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
        status: "pending_email",
      });
      saved++;
    } catch (err: any) {
      console.error(`[PitchOutreach] Error saving lead for ${job.companyName}:`, err?.message);
    }
  }

  console.log(`[PitchOutreach] Saved ${saved} new leads to DB`);
  return saved;
}

// ─── 主流程：爬取 + 搜尋 email + AI 生成 + 發送 ──────────────────────────
export async function runOutreachPipeline(hunterApiKey?: string): Promise<{
  scraped: number;
  emailsFound: number;
  sent: number;
  skipped: number;
}> {
  const db = await getDb();
  if (!db) return { scraped: 0, emailsFound: 0, sent: 0, skipped: 0 };
  let sent = 0;
  let skipped = 0;

  console.log("[PitchOutreach] Starting outreach pipeline...");

  // 1. 抓取職位
  const jobs = await scrapeAllJobBoards();
  console.log(`[PitchOutreach] Scraped ${jobs.length} jobs`);

  // 2. 儲存到資料庫
  const savedCount = await saveLeadsToDb(jobs);

  // 3. 取出 pending_email 的 leads（最多處理 50 個）
  const pendingLeads = await db
    .select()
    .from(pitchLeads)
    .where(eq(pitchLeads.status, "pending_email"))
    .limit(50);

  console.log(`[PitchOutreach] Processing ${pendingLeads.length} pending leads for email search`);

  // 4. 搜尋 email——先搜尋決策者，再搜尋一般聯絡
  let emailsFound = 0;
  for (const lead of pendingLeads) {
    try {
      let result: any = { email: null, foundVia: null, contactName: undefined };
      let decisionMakerName = "";

      // 4a. 優先用 Hunter.io 直接搜索公司 email（CEO/HR/general）
      // 跳過 LinkedIn 決策者爬蟲，因為 Firecrawl 被 LinkedIn 阻止
      console.log(`[PitchOutreach] Searching company email for "${lead.companyName}"`);
      result = await findContactEmail({
        jobUrl: lead.jobUrl,
        companyWebsite: lead.companyWebsite ?? undefined,
        companyName: lead.companyName,
        hunterApiKey,
      });
      
      // 4b. 如果 Hunter.io 失敗，嘗試 LinkedIn 決策者爬蟲（備選）
      if (!result.email) {
        console.log(`[PitchOutreach] Hunter.io failed, trying LinkedIn decision makers for "${lead.companyName}"`);
        try {
          const makers = await findLinkedInDecisionMakers(lead.companyName);
          
          if (makers.length > 0) {
            // 優先選擇 Owner/Founder/Co-founder/CEO
            let selectedMaker = makers.find(m => {
              const title = m.title.toLowerCase();
              return title.includes('owner') ||
                     title.includes('founder') || 
                     title.includes('ceo') ||
                     title.includes('chief');
            });
            
            // 次優先選擇 HR 相關職位
            if (!selectedMaker) {
              selectedMaker = makers.find(m => {
                const title = m.title.toLowerCase();
                return title.includes('hr') ||
                       title.includes('human resources') ||
                       title.includes('talent') ||
                       title.includes('people') ||
                       title.includes('recruiting');
              });
            }
            
            // 再次優先選擇 Director/Head of
            if (!selectedMaker) {
              selectedMaker = makers.find(m => {
                const title = m.title.toLowerCase();
                return title.includes('director') || 
                       title.includes('head of');
              });
            }
            
            // 最後選擇第一個
            if (!selectedMaker) {
              selectedMaker = makers[0];
            }

            if (selectedMaker) {
              decisionMakerName = selectedMaker.name;
              console.log(`[PitchOutreach] Found decision maker: ${decisionMakerName} (${selectedMaker.title})`);

              // 搜尋決策者 email
              result = await findDecisionMakerEmail({
                decisionMakerName,
                decisionMakerTitle: selectedMaker.title,
                companyName: lead.companyName,
                companyWebsite: lead.companyWebsite ?? undefined,
              });
            }
          }
        } catch (err) {
          console.error(`[PitchOutreach] LinkedIn decision maker search failed:`, err);
        }
      }

      if (result.email) {
        emailsFound++;
        // 更新 lead 狀態為 pending_review（等待 AI 生成 + 發送）
        await db
          .update(pitchLeads)
          .set({
            contactEmail: result.email,
            contactName: decisionMakerName || result.contactName,
            emailFoundVia: result.foundVia ?? undefined,
            status: "pending_review",
          })
          .where(eq(pitchLeads.id, lead.id));
      } else {
        // 找不到 email，標記為 skipped
        await db
          .update(pitchLeads)
          .set({ status: "skipped", notes: "No email found" })
          .where(eq(pitchLeads.id, lead.id));
        skipped++;
      }
    } catch (err: any) {
      console.error(`[PitchOutreach] Email search error for lead ${lead.id}:`, err?.message);
    }
  }

  console.log(`[PitchOutreach] Found emails for ${emailsFound} leads`);

  // 5. 取出 pending_review 的 leads，生成 AI 內容 + 發送
  const todaySent = await getTodaySentCount();
  const remainingQuota = DAILY_SEND_LIMIT - todaySent;

  if (remainingQuota <= 0) {
    console.log(`[PitchOutreach] Daily send limit reached (${DAILY_SEND_LIMIT}). Skipping sends.`);
    return { scraped: jobs.length, emailsFound, sent: 0, skipped };
  }

  const readyLeads = await db
    .select()
    .from(pitchLeads)
    .where(eq(pitchLeads.status, "pending_review"))
    .limit(remainingQuota);

  console.log(`[PitchOutreach] Sending to ${readyLeads.length} leads (quota: ${remainingQuota})`);

  for (const lead of readyLeads) {
    if (!lead.contactEmail) continue;

    try {
      // AI 生成 pitch email（若尚未生成）
      let subject = lead.aiPitchSubject;
      let body = lead.aiPitchBody;

      if (!subject || !body) {
        const generated = await generatePitchEmail({
          companyName: lead.companyName,
          jobTitle: lead.jobTitle,
          jobDescription: lead.jobDescription ?? undefined,
          industry: lead.industry ?? undefined,
          contactName: lead.contactName ?? undefined,
          source: lead.source ?? undefined,
        });
        subject = generated.subject;
        body = generated.body;

        // 儲存 AI 生成內容
        await db
          .update(pitchLeads)
          .set({ aiPitchSubject: subject, aiPitchBody: body })
          .where(eq(pitchLeads.id, lead.id));
      }

      // 建立 HTML email
      const htmlBody = buildEmailHtml({
        contactName: lead.contactName ?? undefined,
        body: body ?? "",
        companyName: lead.companyName,
      });

      // 發送
      const result = await sendViaGmail({
        to: lead.contactEmail,
        subject: subject ?? "Photography & Video Production Services — JD STUDIO HK",
        html: htmlBody,
      });

      // 記錄發送結果
      await db.insert(pitchSendLog).values({
        leadId: lead.id,
        emailSubject: subject ?? "",
        emailBody: body ?? "",
        toEmail: lead.contactEmail,
        result: result.success ? "success" : "failed",
        errorMessage: result.error,
        gmailMessageId: result.messageId,
      });

      if (result.success) {
        await db
          .update(pitchLeads)
          .set({
            status: "sent",
            pitchSentAt: new Date(),
            gmailMessageId: result.messageId,
          })
          .where(eq(pitchLeads.id, lead.id));
        sent++;
        console.log(`[PitchOutreach] Sent to ${lead.contactEmail} (${lead.companyName})`);
      } else {
        await db
          .update(pitchLeads)
          .set({ status: "skipped", notes: `Send failed: ${result.error}` })
          .where(eq(pitchLeads.id, lead.id));
        console.error(`[PitchOutreach] Failed to send to ${lead.contactEmail}: ${result.error}`);
      }

      // 每封 email 之間等 3 秒，避免觸發 Gmail 限制
      await new Promise((r) => setTimeout(r, 3000));
    } catch (err: any) {
      console.error(`[PitchOutreach] Error processing lead ${lead.id}:`, err?.message);
    }
  }

  console.log(`[PitchOutreach] Pipeline complete. Scraped: ${jobs.length}, Emails found: ${emailsFound}, Sent: ${sent}, Skipped: ${skipped}`);

  return { scraped: jobs.length, emailsFound, sent, skipped };
}
