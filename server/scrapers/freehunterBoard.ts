/**
 * FreelanceHunter Job Board Scraper
 *
 * Scrapes the FreelanceHunter job board for photography-related jobs.
 * Uses Playwright to log in, render the page, and extract job listings from DOM.
 *
 * Photography industry: 攝影及影音製作 (category link)
 */

import { fetchFreehunterJobContact, getOrLoginFreehunter, renewFreehunterSessionExpiry } from "../freehunter";
import { getDb } from "../db";
import { freehunterJobs } from "../../drizzle/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { chromium } from "playwright";
import { invokeLLM } from "../_core/llm";
import { sendFHFirstEmail } from "../routers/emailInquiries";
import { createEmailInquiry } from "../db";
import { emailInquiries } from "../../drizzle/schema";

// AI relevance score threshold for auto-action
const AUTO_ACTION_THRESHOLD = 80;

/**
 * Use AI to score the relevance of a FH job for JD Studio HK (photography/video services).
 * Returns a score 0-100 and a brief reason.
 */
async function scoreJobRelevance(job: ScrapedFreehunterJob): Promise<{ score: number; reason: string }> {
  try {
    const prompt = `You are a scoring assistant for JD Studio HK, a Hong Kong professional photography, videography, and design company.

Evaluate how relevant this FreelanceHunter job posting is for JD Studio HK to bid on.

Job Title: ${job.title}
Categories: ${job.categories || "(none)"}
Budget: ${job.budget || "(unknown)"}
Location: ${job.location || "(unknown)"}
Description: ${(job.description || "").slice(0, 800)}

JD Studio HK services:
- Photography: event, corporate, product, food, portrait, wedding, real estate
- Videography: corporate video, event filming, promotional video, social media video, documentary
- Design: graphic design, branding, logo design, annual report design, poster/flyer design, event collateral design, social media design, print design, namecard design

Scoring criteria:
- Score 80-100: Clearly requires any of JD Studio's services — photography, videography, OR design (graphic design, branding, logo, annual report, poster, flyer, social media design, print design, namecard, etc.). JD Studio can directly fulfill this.
- Score 50-79: Partially related (e.g. needs both design AND web dev, or mentions media/visual content but unclear if design/photo/video is the main need)
- Score 0-49: Not relevant (app development, SEO, copywriting, voice acting, translation, proofreading, accounting, IT, engineering, etc.)

Respond with JSON only.`;

    const result = await invokeLLM({
      messages: [
        { role: "system", content: "You are a job relevance scorer. Respond with valid JSON only." },
        { role: "user", content: prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "job_score",
          strict: true,
          schema: {
            type: "object",
            properties: {
              score: { type: "number", description: "Relevance score 0-100" },
              reason: { type: "string", description: "Brief reason in Traditional Chinese, max 100 chars" },
            },
            required: ["score", "reason"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = result.choices?.[0]?.message?.content;
    const parsed = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score))));
    return { score, reason: String(parsed.reason || "").slice(0, 512) };
  } catch (e) {
    console.warn(`[FreehunterBoard] AI scoring failed for job ${job.jobId}:`, e);
    return { score: 50, reason: "AI 評分失敗，使用預設中等分數" };
  }
}

const FREEHUNTER_BASE = "https://freehunter.hk";

export interface ScrapedFreehunterJob {
  jobId: string;
  title: string;
  clientName?: string;
  budget?: string;
  location?: string;
  description?: string;
  jobUrl: string;
  categories?: string;
  postedAt?: Date;
}

export interface FreehunterBoardScrapeResult {
  success: boolean;
  jobs: ScrapedFreehunterJob[];
  newJobs: number;
  emailsFetched: number;
  autoEmailsSent?: number;
  error?: string;
}

/**
 * Fetch jobs from the FH public API with cursor-based pagination.
 * The visitorGet15Job API returns 16 jobs per page, sorted by newest first.
 * We paginate until we've seen all jobs newer than the last known job ID.
 *
 * @param lastKnownJobId - The highest job ID already in our DB (stop when we reach it)
 * @param maxPages - Maximum pages to fetch (safety limit)
 */
async function fetchJobsFromAPI(
  lastKnownJobId: number,
  maxPages: number = 10
): Promise<ScrapedFreehunterJob[]> {
  const allJobs: ScrapedFreehunterJob[] = [];
  let cursor: number | undefined = undefined; // undefined = fetch latest page

  for (let page = 0; page < maxPages; page++) {
    const url = cursor
      ? `${FREEHUNTER_BASE}/apis/jobs/visitorGet15Job?lastId=${cursor}`
      : `${FREEHUNTER_BASE}/apis/jobs/visitorGet15Job`;

    try {
      const resp = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          Accept: "application/json",
        },
      });
      if (!resp.ok) {
        console.warn(`[FreehunterBoard] API returned ${resp.status} for ${url}`);
        break;
      }
      const data = await resp.json();
      const jobs: any[] = data.result || [];

      if (jobs.length === 0) break;

      // The API returns jobs in NON-SEQUENTIAL order (e.g. [34689, 34688, 34685, 34690, 34679, ...]).
      // We must collect ALL jobs with id > lastKnownJobId from this page, then stop pagination
      // only when the MINIMUM job ID on the page is <= lastKnownJobId.
      // This ensures we don't miss newer jobs that appear after an older job in the list.
      let newJobsOnPage = 0;
      for (const job of jobs) {
        if (job.id <= lastKnownJobId) {
          continue; // skip already-known jobs, but don't stop yet
        }
        // Map API response to ScrapedFreehunterJob
        allJobs.push({
          jobId: String(job.id),
          title: job.title || "",
          clientName: job.user_name || undefined,
          budget: job.budget || undefined,
          location: job.poster_location || job.location || undefined,
          description: job.detail || job.description || undefined,
          jobUrl: `${FREEHUNTER_BASE}/freelancejobs/${job.id}/${encodeURIComponent((job.title || "").replace(/\s+/g, "-"))}`,
          categories: job.category_name || undefined,
          postedAt: job.created_at_datetime?._seconds
            ? new Date(job.created_at_datetime._seconds * 1000)
            : undefined,
        });
        newJobsOnPage++;
      }

      // Stop pagination when the minimum job ID on this page is <= lastKnownJobId.
      // This means we've gone back far enough that all remaining pages are older history.
      const minIdOnPage = Math.min(...jobs.map((j: any) => j.id));
      if (minIdOnPage <= lastKnownJobId) {
        console.log(`[FreehunterBoard] Min ID on page ${page + 1} is ${minIdOnPage} (<= ${lastKnownJobId}), stopping. Found ${newJobsOnPage} new jobs on this page.`);
        break;
      }

      // Set cursor to the minimum job ID on this page for next page
      cursor = minIdOnPage;
      console.log(`[FreehunterBoard] API page ${page + 1}: ${jobs.length} jobs (${newJobsOnPage} new), next cursor=${cursor}`);

      // Rate limit between pages
      await new Promise((r) => setTimeout(r, 1000));
    } catch (e) {
      console.warn(`[FreehunterBoard] API fetch error at page ${page + 1}:`, e);
      break;
    }
  }

  console.log(`[FreehunterBoard] API fetch complete: ${allJobs.length} new jobs found`);
  return allJobs;
}

/**
 * Use Playwright to load the FreelanceHunter job board and extract job listings from DOM.
 * Uses the existing authenticated browser session (storageState) for proper Firebase auth.
 */
async function scrapeJobsWithPlaywright(
  categoryUrl: string
): Promise<ScrapedFreehunterJob[]> {
  // Launch a fresh browser for this scrape
  // Note: The FH job listing page is publicly accessible (no auth required to view jobs)
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();
  try {
    console.log(`[FreehunterBoard] Navigating to ${categoryUrl}...`);
    await page.goto(categoryUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Wait for job cards to render (CSR)
    await page.waitForTimeout(3000);

    // Try to wait for job links to appear
    try {
      await page.waitForSelector('a[href*="/freelancejobs/"]', { timeout: 10000 });
    } catch {
      console.warn("[FreehunterBoard] No job links found after waiting");
    }

    // Scroll down to trigger infinite scroll / load more jobs
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);
    }

    // Extract job data from DOM
    const jobs = await page.evaluate((baseUrl: string) => {
      const results: any[] = [];
      const seen = new Set<string>();

      // Find all job card links
      const cards = document.querySelectorAll('a[href*="/freelancejobs/"]');

      cards.forEach((card) => {
        const href = card.getAttribute("href") || "";
        const match = href.match(/\/freelancejobs\/(\d+)\//)
        if (!match || seen.has(match[1])) return;
        seen.add(match[1]);

        const jobId = match[1];
        const fullUrl = href.startsWith("http") ? href : `${baseUrl}${href}`;

        // Extract title from URL slug (most reliable - DOM has no dedicated title element)
        let title = "";
        const slugMatch = href.match(/\/freelancejobs\/\d+\/(.+)$/);
        if (slugMatch) {
          title = decodeURIComponent(slugMatch[1]).replace(/-/g, " ").trim();
        }

        // Extract full text content for parsing
        const fullText = card.textContent?.trim() || "";

        // Parse client name: appears after title in linkText pattern "<title><ClientName>. 查看工作"
        // Fix: Only extract the LAST period-separated segment before "查看工作" to avoid including job title
        let clientName: string | undefined;
        const clientMatch = fullText.match(/\.\s*([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z\s]{0,30})\s*\.\s*查看工作/);
        if (clientMatch) {
          clientName = clientMatch[1].trim();
        }

        // Parse budget: "HKD $X,XXX-$X,XXX" or "HKD $X,XXX 或以上"
        let budget: string | undefined;
        const budgetMatch = fullText.match(/HKD\s*\$[\d,]+(?:[\s\-~至]+\$[\d,]+|\s*或以上)?/);
        if (budgetMatch) {
          budget = budgetMatch[0].trim();
        }

        // Parse location: appears before 工作位置
        let location: string | undefined;
        const locationMatch = fullText.match(/([\u4e00-\u9fa5A-Za-z\/\s]{2,20})工作位置/);
        if (locationMatch) {
          location = locationMatch[1].trim();
        }

        const descText = fullText.substring(0, 500);

        results.push({
          jobId,
          title: title || fullText.substring(0, 80),
          clientName: clientName || undefined,
          budget: budget || undefined,
          location: location || undefined,
          description: descText,
          jobUrl: fullUrl,
        });
      });

      return results;
    }, FREEHUNTER_BASE);

    console.log(`[FreehunterBoard] Extracted ${jobs.length} jobs from DOM`);
    return jobs;
  } finally {
    await page.close();
  }
}

/**
 * Main scraping function: fetch photography job listings and optionally fetch client emails.
 *
 * @param fetchEmails - If true, also fetch client email for each job (requires Premium)
 * @param maxJobs - Maximum number of new jobs to process (to avoid rate limiting)
 */
export async function scrapeFreehunterBoard(
  fetchEmails: boolean = true,
  maxJobs: number = 20
): Promise<FreehunterBoardScrapeResult> {
  const db = await getDb();
  if (!db) {
    return { success: false, jobs: [], newJobs: 0, emailsFetched: 0, error: "DB not available" };
  }

  console.log("[FreehunterBoard] Starting job board scrape...");

  // Ensure we have a valid browser session (needed for Playwright scraping and email fetching)
  try {
    await getOrLoginFreehunter();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Login failed";
    console.error("[FreehunterBoard] Login error:", msg);
    return { success: false, jobs: [], newJobs: 0, emailsFetched: 0, error: `登入失敗: ${msg}` };
  }

  // ── Strategy: Use public API for comprehensive job discovery ──────
  // The visitorGet15Job API returns all jobs (not filtered by category).
  // We paginate using cursor-based pagination (lastId) to get all new jobs
  // since the last scrape. Then use AI scoring to filter relevant ones.
  //
  // Additionally, scrape the photography category page (catalog_id=2) via
  // Playwright to catch any jobs that may not appear in the API listing.

  // Get the highest job ID already in our DB to use as pagination stop
  // Use SQL MAX to get the true maximum jobId across ALL rows (not just the last 100)
  const maxResult = await db
    .select({ maxJobId: sql<string>`MAX(CAST(${freehunterJobs.jobId} AS UNSIGNED))` })
    .from(freehunterJobs);
  const maxKnownJobId = parseInt(maxResult[0]?.maxJobId ?? "0", 10) || 0;
  console.log(`[FreehunterBoard] Max known job ID in DB: ${maxKnownJobId}`);

  const allJobs: ScrapedFreehunterJob[] = [];

  // 1. Fetch from public API with pagination (primary source)
  try {
    const apiJobs = await fetchJobsFromAPI(maxKnownJobId, 10);
    console.log(`[FreehunterBoard] API: found ${apiJobs.length} new jobs`);
    allJobs.push(...apiJobs);
  } catch (e) {
    console.warn(`[FreehunterBoard] API fetch failed:`, e);
  }

  // 2. Also scrape the photography/video category page via Playwright (backup)
  // This catches jobs that may not appear in the API listing
  const categoryUrls = [
    `${FREEHUNTER_BASE}/freelancejobs?catalog_id=2`, // 攝影及影音製作
  ];

  for (const url of categoryUrls) {
    try {
      const jobs = await scrapeJobsWithPlaywright(url);
      console.log(`[FreehunterBoard] Playwright ${url}: found ${jobs.length} jobs`);
      allJobs.push(...jobs);

      // Delay between category requests
      await new Promise((r) => setTimeout(r, 2000));
    } catch (e) {
      console.warn(`[FreehunterBoard] Failed to scrape ${url}:`, e);
    }
  }

  if (allJobs.length === 0) {
    return { success: true, jobs: [], newJobs: 0, emailsFetched: 0 };
  }

  // Deduplicate by jobId
  const uniqueJobs = Array.from(new Map(allJobs.map((j) => [j.jobId, j])).values());
  console.log(`[FreehunterBoard] Total unique jobs found: ${uniqueJobs.length}`);

  // Check which jobs are already in DB
  const jobIds = uniqueJobs.map((j) => j.jobId);
  const existingJobs = await db
    .select({ jobId: freehunterJobs.jobId })
    .from(freehunterJobs)
    .where(inArray(freehunterJobs.jobId, jobIds));
  const existingJobIds = new Set(existingJobs.map((j) => j.jobId));

  // Filter to only new jobs
  const newJobsList = uniqueJobs.filter((j) => !existingJobIds.has(j.jobId));
  console.log(`[FreehunterBoard] New jobs to insert: ${newJobsList.length}`);

  if (newJobsList.length === 0) {
    return { success: true, jobs: uniqueJobs, newJobs: 0, emailsFetched: 0 };
  }

  // Limit to maxJobs
  const jobsToProcess = newJobsList.slice(0, maxJobs);

  // Insert new jobs into DB
  let emailsFetched = 0;
  let autoEmailsSent = 0;
  const insertedJobs: ScrapedFreehunterJob[] = [];

  for (const job of jobsToProcess) {
    // AI relevance scoring
    const { score: aiScore, reason: aiScoreReason } = await scoreJobRelevance(job);
    console.log(`[FreehunterBoard] AI score for "${job.title}": ${aiScore} — ${aiScoreReason}`);

    let clientEmail: string | undefined;
    let finalStatus: "new" | "email_fetched" | "first_email_sent" = "new";
    let firstEmailSentAt: Date | undefined;

    // Auto-action for high-confidence jobs (score >= threshold)
    const isHighConfidence = aiScore >= AUTO_ACTION_THRESHOLD;

    // Always try to fetch client email for every new job (regardless of score or fetchEmails flag)
    // Low-confidence jobs will stop at email_fetched for manual AI compose
    // High-confidence jobs (>= 80%) will auto-send the first email
    {
      try {
        await new Promise((r) => setTimeout(r, 1500)); // Rate limit: 1.5s between requests
        // 90-second per-email timeout: if Playwright hangs, skip this job and continue
        const EMAIL_FETCH_TIMEOUT_MS = 90 * 1000;
        const contact = await Promise.race([
          fetchFreehunterJobContact(parseInt(job.jobId, 10)),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Email fetch timed out after 90s for job ${job.jobId}`)), EMAIL_FETCH_TIMEOUT_MS)
          ),
        ]);
        if (contact.email) {
          clientEmail = contact.email;
          if (contact.clientName && !job.clientName) {
            job.clientName = contact.clientName;
          }
          emailsFetched++;
          finalStatus = "email_fetched";
          console.log(`[FreehunterBoard] Got email for job ${job.jobId}: ${clientEmail}`);

          // Auto-send first email for high-confidence jobs
          if (isHighConfidence) {
            console.log(`[FreehunterBoard] High confidence (${aiScore}%), auto-sending first email to ${clientEmail} for: ${job.title}`);
            try {
              // Step 1: Insert job first to get DB ID
              const insertedId = await db.insert(freehunterJobs).values({
                jobId: job.jobId,
                title: job.title,
                clientName: job.clientName || null,
                clientEmail: clientEmail || null,
                budget: job.budget || null,
                location: job.location || null,
                description: job.description || null,
                jobUrl: job.jobUrl,
                categories: job.categories || null,
                postedAt: job.postedAt || null,
                status: "email_fetched",
                aiScore,
                aiScoreReason,
                firstEmailSentAt: null,
                scrapedAt: new Date(),
              });
              insertedJobs.push(job);
              const [insertedJob] = await db.select({ id: freehunterJobs.id }).from(freehunterJobs).where(eq(freehunterJobs.jobId, job.jobId)).limit(1);
              // Step 2: Create emailInquiry record with fhJobId for tracking
              let fhInquiryId: number | undefined;
              if (insertedJob) {
                try {
                  const gmailMessageId = `fh-auto-${job.jobId}-${Date.now()}`;
                  // Generate a unique tracking ID for the reply email open tracking
                  const replyTrackingId = `fh-${job.jobId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                  const inquiry = await createEmailInquiry({
                    gmailMessageId,
                    fromEmail: clientEmail,
                    fromName: job.clientName || "FreelanceHunter 客戶",
                    subject: job.title,
                    bodyText: job.description || "",
                    receivedAt: job.postedAt || new Date(),
                    aiConfidence: "high",
                    externalLink: job.jobUrl,
                    status: "pending_send", // 等待跟進（第一封郵件即將發送）
                    fhJobId: insertedJob.id,
                    replyTrackingId,
                  });
                  fhInquiryId = inquiry?.id;
                } catch (inquiryErr) {
                  console.warn(`[FreehunterBoard] Failed to create emailInquiry for tracking:`, inquiryErr);
                }
              }
              // Step 3: Send email with tracking pixel + AI personalised opening
              const emailResult = await sendFHFirstEmail(clientEmail, job.clientName || "", job.title, fhInquiryId, job.description || "");
              if (emailResult.success) {
                finalStatus = "first_email_sent";
                firstEmailSentAt = new Date();
                autoEmailsSent++;
                // Update job status to first_email_sent
                await db.update(freehunterJobs).set({ status: "first_email_sent", firstEmailSentAt: new Date(), updatedAt: new Date() }).where(eq(freehunterJobs.jobId, job.jobId));
                // Update emailInquiry status to pending (first email sent, awaiting follow-up)
                if (fhInquiryId) {
                  await db.update(emailInquiries).set({ status: "pending" }).where(eq(emailInquiries.id, fhInquiryId));
                }
                console.log(`[FreehunterBoard] Auto first email sent for job ${job.jobId} (inquiryId: ${fhInquiryId})`);
              }
              // Skip the normal insert below since we already inserted
              continue;
            } catch (emailErr) {
              console.warn(`[FreehunterBoard] Auto email send failed for job ${job.jobId}:`, emailErr);
            }
          }
        }
      } catch (e) {
        console.warn(`[FreehunterBoard] Could not fetch email for job ${job.jobId}:`, e);
      }
    }

    // Insert into DB (or update if already exists from API fetch)
    try {
      await db.insert(freehunterJobs).values({
        jobId: job.jobId,
        title: job.title,
        clientName: job.clientName || null,
        clientEmail: clientEmail || null,
        budget: job.budget || null,
        location: job.location || null,
        description: job.description || null,
        jobUrl: job.jobUrl,
        categories: job.categories || null,
        postedAt: job.postedAt || null,
        status: finalStatus,
        aiScore,
        aiScoreReason,
        firstEmailSentAt: firstEmailSentAt || null,
        scrapedAt: new Date(),
      });
      insertedJobs.push(job);
    } catch (e: any) {
      // If duplicate (job already inserted by API fetch), update email/status if we have new info
      const isDuplicate = e?.cause?.sqlMessage?.includes('Duplicate entry') ||
        e?.message?.includes('Duplicate entry') ||
        e?.cause?.code === 'ER_DUP_ENTRY';
      if (isDuplicate && clientEmail) {
        try {
          const [existing] = await db.select({ id: freehunterJobs.id, clientEmail: freehunterJobs.clientEmail, status: freehunterJobs.status })
            .from(freehunterJobs).where(eq(freehunterJobs.jobId, job.jobId)).limit(1);
          if (existing && !existing.clientEmail) {
            // Job exists but has no email — update it
            await db.update(freehunterJobs)
              .set({ 
                clientEmail, 
                clientName: job.clientName || undefined,
                status: finalStatus,
                firstEmailSentAt: firstEmailSentAt || undefined,
                scrapedAt: new Date(),
              })
              .where(eq(freehunterJobs.jobId, job.jobId));
            console.log(`[FreehunterBoard] Updated email for existing job ${job.jobId}: ${clientEmail}`);
            insertedJobs.push(job);
          } else if (existing?.clientEmail) {
            console.log(`[FreehunterBoard] Job ${job.jobId} already has email (${existing.clientEmail}), skipping duplicate`);
          }
        } catch (updateErr) {
          console.warn(`[FreehunterBoard] Failed to update email for job ${job.jobId}:`, updateErr);
        }
      } else if (!isDuplicate) {
        console.warn(`[FreehunterBoard] Failed to insert job ${job.jobId}:`, e);
      } else {
        console.log(`[FreehunterBoard] Job ${job.jobId} already in DB (no email to update), skipping`);
      }
    }
  }

  console.log(
    `[FreehunterBoard] Scrape complete: ${insertedJobs.length} new jobs inserted, ${emailsFetched} emails fetched, ${autoEmailsSent} auto emails sent`
  );

  // Renew session expiry after successful scrape so "connected" status stays green
  renewFreehunterSessionExpiry().catch(() => {});

  return {
    success: true,
    jobs: uniqueJobs,
    newJobs: insertedJobs.length,
    emailsFetched,
    autoEmailsSent,
  };
}

/**
 * Fetch client email for an existing job that doesn't have one yet.
 * Returns `{ email }` on success, or `{ email: null, error }` with a concrete reason.
 */
export type FetchEmailForJobResult = {
  email: string | null;
  error?: string;
};

export async function fetchEmailForJob(
  jobId: string
): Promise<FetchEmailForJobResult> {
  const db = await getDb();
  if (!db) return { email: null, error: "資料庫不可用" };
  try {
    // 90-second timeout to prevent hanging if Playwright gets stuck
    const contact = await Promise.race([
      fetchFreehunterJobContact(parseInt(jobId, 10)),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `取得電郵逾時（90秒）— 伺服器瀏覽器可能卡住，請稍後再試或重新登入 Freehunter`
              )
            ),
          90_000
        )
      ),
    ]);
    if (contact.email) {
      await db
        .update(freehunterJobs)
        .set({
          clientEmail: contact.email,
          clientName: contact.clientName || undefined,
          status: "email_fetched",
          updatedAt: new Date(),
        })
        .where(eq(freehunterJobs.jobId, jobId));
      return { email: contact.email };
    }
    return {
      email: null,
      error:
        "Freehunter 未回傳客戶電郵（常見：工作已過期／已關閉、需要 Premium 接 JOB、或該工作不公開電郵）",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[FreehunterBoard] fetchEmailForJob(${jobId}) error:`, e);
    return { email: null, error: msg };
  }
}
