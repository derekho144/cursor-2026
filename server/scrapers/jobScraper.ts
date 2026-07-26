/**
 * jobScraper.ts
 * 從多個招聘網站抓取招聘攝影師/攝錄師的職位
 * 支援: LinkedIn Jobs (Puppeteer), CTgoodjobs (Puppeteer), Indeed HK (Firecrawl), JobsDB (Firecrawl)
 */
import axios from "axios";
import * as cheerio from "cheerio";
// linkedinPuppeteer removed (deprecated) - using fallback scraping
const scrapeLinkedInJobsWithPuppeteer = async (_keyword: string, _location: string, _pages: number): Promise<any[]> => [];
const closeLinkedInBrowser = async () => {};

export interface ScrapedJob {
  companyName: string;
  companyWebsite?: string;
  jobTitle: string;
  jobUrl: string;
  jobDescription?: string;
  source: "jobsdb" | "linkedin" | "indeed" | "ctgoodjobs";
  jobPostedAt?: Date;
  contactEmail?: string;
  industry?: string;
  location?: string;
}

const SEARCH_KEYWORDS = [
  // Photography only — must align with CORE_KEYWORDS in pitchOutreach.saveLeadsToDb
  "product photographer",
  "food photographer",
  "fashion photographer",
  "commercial photographer",
  "攝影師",
  // Videography
  "videographer",
  "video production",
  "cinematographer",
  "攝錄師",
];

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "zh-HK,zh;q=0.9,en;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  Connection: "keep-alive",
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function extractEmailFromText(text: string): string | null {
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const matches = text.match(emailRegex) ?? [];
  const filtered = matches.filter(
    (e) =>
      !e.includes("example.com") &&
      !e.includes("test.com") &&
      !e.includes("noreply") &&
      !e.includes("no-reply") &&
      !e.endsWith(".png") &&
      !e.endsWith(".jpg")
  );
  return filtered[0] ?? null;
}

// ─── Firecrawl helper ──────────────────────────────────────────────────────
async function firecrawlScrape(url: string): Promise<string> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY not set");
  try {
    const resp = await axios.post(
      "https://api.firecrawl.dev/v1/scrape",
      { url, formats: ["markdown"] },  // 移除 onlyMainContent，確保獲取完整內容
      {
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        timeout: 30000, // 增加超時時間到 30 秒
      }
    );
    const markdown = resp.data?.data?.markdown ?? "";
    if (!markdown) {
      console.warn(`[Firecrawl] Empty markdown for ${url}`);
    }
    return markdown;
  } catch (err: any) {
    if (err.code === "ECONNABORTED" || err.message?.includes("timeout")) {
      console.warn(`[Firecrawl] Timeout for ${url}`);
      return ""; // 超時時返回空字符串，避免卡住
    }
    console.error(`[Firecrawl] Error for ${url}:`, err?.message);
    throw err;
  }
}

// ─── JobsDB (via Firecrawl) ────────────────────────────────────────────────
// JobsDB markdown format:
//   ### [Job Title](https://hk.jobsdb.com/job/12345?...)
//   at[Company Name](https://hk.jobsdb.com/Company-jobs)
async function scrapeJobsDB(keyword: string): Promise<ScrapedJob[]> {
  const results: ScrapedJob[] = [];
  try {
    const encodedKeyword = encodeURIComponent(keyword);
    const url = `https://hk.jobsdb.com/jobs?q=${encodedKeyword}&l=Hong+Kong`;
    const markdown = await firecrawlScrape(url);
    const lines = markdown.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match job title line: ### [Title](https://hk.jobsdb.com/job/...)
      const titleMatch = line.match(/^###\s+\[([^\]]+)\]\((https:\/\/hk\.jobsdb\.com\/job\/[^)]+)\)/);
      if (titleMatch) {
        const jobTitle = titleMatch[1].trim();
        const jobUrl = titleMatch[2].split("\\#")[0].split("?")[0]; // clean URL
        let companyName = "";
        // Look ahead up to 4 lines for company name: at[Company](url)
        for (let j = i + 1; j <= i + 4 && j < lines.length; j++) {
          const companyMatch = lines[j].match(/^at\[([^\]]+)\]/);
          if (companyMatch) {
            companyName = companyMatch[1].trim();
            break;
          }
        }
        if (jobTitle && companyName && jobUrl) {
          results.push({ companyName, jobTitle, jobUrl, source: "jobsdb" });
        }
      }
    }

    const seen = new Set<string>();
    return results.filter((j) => {
      if (seen.has(j.jobUrl)) return false;
      seen.add(j.jobUrl);
      return true;
    });
  } catch (err: any) {
    console.error(`[JobScraper/JobsDB] Error for keyword "${keyword}":`, err?.message);
  }
  return results;
}


// ─── Indeed HK (via Firecrawl) ──────────────────────────────────────────────
// Indeed format: | ### [Title](https://hk.indeed.com/rc/clk?jk=JK_ID&...)<br>CompanyName<br>Location...
async function scrapeIndeedHK(keyword: string): Promise<ScrapedJob[]> {
  const results: ScrapedJob[] = [];
  try {
    const encodedKeyword = encodeURIComponent(keyword);
    const url = `https://hk.indeed.com/jobs?q=${encodedKeyword}&l=Hong+Kong&sort=date`;
    const markdown = await firecrawlScrape(url);
    const lines = markdown.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Indeed format: | ### [Title](url)<br>CompanyName<br>Location...
      const titleMatch = line.match(/\|\s*###\s*\[([^\]]+)\]\(https:\/\/hk\.indeed\.com\/rc\/clk\?jk=([^&)]+)[^)]*\)(?:<br>([^<|\n]+))?/);
      if (titleMatch) {
        const jobTitle = titleMatch[1].trim();
        const jk = titleMatch[2];
        const jobUrl = `https://hk.indeed.com/viewjob?jk=${jk}`;
        // Company name is right after the first <br> in the same line
        let companyName = titleMatch[3]?.trim() || "";
        if (!companyName) {
          // Fallback: look for "View all [X jobs in Hong Kong]" in next 15 lines
          for (let j = i + 1; j <= i + 15 && j < lines.length; j++) {
            const viewAllMatch = lines[j].match(/View all \[([^\]]+?) jobs in Hong Kong\]/);
            if (viewAllMatch) {
              companyName = viewAllMatch[1].trim();
              break;
            }
          }
        }
        if (jobTitle && jobUrl) {
          results.push({ companyName: companyName || "Unknown", jobTitle, jobUrl, source: "indeed" });
        }
      }
    }
    const seen = new Set<string>();
    return results.filter((j) => {
      if (seen.has(j.jobUrl)) return false;
      seen.add(j.jobUrl);
      return true;
    });
  } catch (err: any) {
    console.error(`[JobScraper/Indeed] Error for keyword "${keyword}":`, err?.message);
  }
  return results;
}

// ─── LinkedIn Jobs (via Puppeteer) ────────────────────────────────────────
async function scrapeLinkedInJobs(keyword: string): Promise<ScrapedJob[]> {
  const results: ScrapedJob[] = [];
  try {
    const jobs = await scrapeLinkedInJobsWithPuppeteer(keyword, "Hong Kong", 1);
    if (jobs.length > 0) {
      for (const job of jobs) {
        results.push({
          companyName: job.companyName,
          jobTitle: job.jobTitle,
          jobUrl: job.jobUrl,
          location: job.location,
          source: "linkedin",
        });
      }
      return results;
    }
  } catch (err: any) {
    console.error(`[JobScraper/LinkedIn] Puppeteer error for keyword "${keyword}":`, err?.message);
  }
  
  // 如果 Puppeteer 失敗，回退到舊的 Cheerio 爬蟲
  console.log(`[JobScraper/LinkedIn] Falling back to Cheerio scraper for keyword "${keyword}"`);
  try {
    return await scrapeLinkedInJobsOld(keyword);
  } catch (err: any) {
    console.error(`[JobScraper/LinkedIn] Cheerio fallback also failed for keyword "${keyword}":`, err?.message);
    return results;
  }
}

// ─── Old LinkedIn Jobs (Cheerio) - Fallback ────────────────────────────────
async function scrapeLinkedInJobsOld(keyword: string): Promise<ScrapedJob[]> {
  const results: ScrapedJob[] = [];
  try {
    const encodedKeyword = encodeURIComponent(keyword);
    // LinkedIn 公開職位搜尋（不需要登入）
    const url = `https://www.linkedin.com/jobs/search?keywords=${encodedKeyword}&location=Hong+Kong&f_TPR=r86400`;
    const resp = await axios.get(url, {
      headers: {
        ...HEADERS,
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeout: 15000,
    });
    const $ = cheerio.load(resp.data);

    $("div.base-card, li.jobs-search__results-list > div, div[class*='job-search-card']").each((_: number, el: any) => {
      try {
        const titleEl = $(el).find("h3.base-search-card__title, a.base-card__full-link, h3[class*='title']").first();
        const jobTitle = titleEl.text().trim();
        const jobPath = $(el).find("a.base-card__full-link, a[href*='/jobs/view/']").first().attr("href") ?? "";
        const jobUrl = jobPath.startsWith("http") ? jobPath : `https://www.linkedin.com${jobPath}`;

        const companyEl = $(el).find("h4.base-search-card__subtitle, a[class*='company'], span[class*='company']").first();
        const companyName = companyEl.text().trim();

        if (jobTitle && companyName && jobUrl && jobUrl.includes("linkedin.com")) {
          results.push({
            companyName,
            jobTitle,
            jobUrl,
            source: "linkedin",
          });
        }
      } catch {
        // 忽略單個職位解析錯誤
      }
    });
  } catch (err: any) {
    console.error(`[JobScraper/LinkedIn] Error for keyword "${keyword}":`, err?.message);
  }
  return results;
}

// ─── CTgoodjobs (direct HTML — RSC payload embeds job JSON) ─────────────────
// Prefer keyword slug pages (`?search=` returns mostly irrelevant jobs — was why we disabled it).
const CTGOODJOBS_LIST_URLS = [
  "https://jobs.ctgoodjobs.hk/jobs/photographer-jobs",
  "https://jobs.ctgoodjobs.hk/jobs/videographer-jobs",
  "https://jobs.ctgoodjobs.hk/jobs/%E6%94%9D%E5%BD%B1%E5%B8%AB-jobs", // 攝影師
  "https://jobs.ctgoodjobs.hk/jobs/%E6%94%9D%E9%8C%84%E5%B8%AB-jobs", // 攝錄師
];

function stripCtHtml(text: string): string {
  return text
    .replace(/\\u003c\/?strong\\u003e/gi, "")
    .replace(/<\/?strong>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

async function scrapeCTgoodjobsListPage(listUrl: string): Promise<ScrapedJob[]> {
  const results: ScrapedJob[] = [];
  try {
    const resp = await axios.get(listUrl, {
      headers: { ...HEADERS, Accept: "text/html,application/xhtml+xml" },
      timeout: 25000,
      maxRedirects: 5,
    });
    let html = typeof resp.data === "string" ? resp.data : String(resp.data ?? "");
    // RSC payload often stores JSON inside a JS string → quotes appear as \"
    if (html.includes('\\"jobId\\"')) {
      html = html.replace(/\\"/g, '"');
    }

    // {"jobId":"…","jobTitle":"…","url":"…","companyId":"…","companyName":"…",…}
    const re =
      /\{"jobId":"(\d+)","jobTitle":"((?:\\.|[^"\\])*)","url":"(https:\/\/jobs\.ctgoodjobs\.hk\/job\/\d+\/[^"]+)","companyId":"[^"]*","companyName":"((?:\\.|[^"\\])*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      let jobTitle = m[2];
      let companyName = m[4];
      try {
        jobTitle = JSON.parse(`"${jobTitle}"`);
        companyName = JSON.parse(`"${companyName}"`);
      } catch {
        // keep raw
      }
      jobTitle = stripCtHtml(String(jobTitle));
      companyName = stripCtHtml(String(companyName));
      const jobUrl = m[3].split("?")[0];
      if (jobTitle && companyName && jobUrl) {
        results.push({
          companyName,
          jobTitle,
          jobUrl,
          source: "ctgoodjobs",
        });
      }
    }
    console.log(`[JobScraper/CTgoodjobs] ${listUrl} → ${results.length} jobs`);
  } catch (err: any) {
    console.error(`[JobScraper/CTgoodjobs] Error for ${listUrl}:`, err?.message);
  }
  return results;
}

/** Scrape CTgoodjobs photographer/videographer listing pages (once per pipeline run). */
export async function scrapeCTgoodjobs(): Promise<ScrapedJob[]> {
  const all: ScrapedJob[] = [];
  const seen = new Set<string>();
  for (const url of CTGOODJOBS_LIST_URLS) {
    const batch = await scrapeCTgoodjobsListPage(url);
    for (const job of batch) {
      if (!seen.has(job.jobUrl)) {
        seen.add(job.jobUrl);
        all.push(job);
      }
    }
    await sleep(1200);
  }
  console.log(`[JobScraper/CTgoodjobs] Total unique jobs: ${all.length}`);
  return all;
}

// ─── 主入口：抓取所有平台 ──────────────────────────────────────────────────
export async function scrapeAllJobBoards(): Promise<ScrapedJob[]> {
  const allJobs: ScrapedJob[] = [];
  const seen = new Set<string>(); // 去重：jobUrl

  for (const keyword of SEARCH_KEYWORDS) {
    console.log(`[JobScraper] Scraping keyword: "${keyword}"`);

    // JobsDB (Firecrawl)
    let jobsdbResults: ScrapedJob[] = [];
    try {
      jobsdbResults = await scrapeJobsDB(keyword);
    } catch (err: any) {
      console.error(`[JobScraper/JobsDB] Firecrawl error:`, err?.message);
    }
    console.log(`[JobScraper/JobsDB] Found ${jobsdbResults.length} jobs for "${keyword}"`);
    await sleep(1500);

    // Indeed HK (Firecrawl) - primary source for photographer/videographer jobs
    let indeedResults: ScrapedJob[] = [];
    try {
      indeedResults = await scrapeIndeedHK(keyword);
    } catch (err: any) {
      console.error(`[JobScraper/Indeed] Error:`, err?.message);
    }
    console.log(`[JobScraper/Indeed] Found ${indeedResults.length} jobs for "${keyword}"`);
    await sleep(1500);

    // LinkedIn: disabled
    const linkedinResults: ScrapedJob[] = [];

    const combined = [...jobsdbResults, ...indeedResults, ...linkedinResults];
    for (const job of combined) {
      if (!seen.has(job.jobUrl) && job.companyName && job.jobTitle) {
        seen.add(job.jobUrl);
        allJobs.push(job);
      }
    }
  }

  // CTgoodjobs: dedicated photo/video listing pages (once — not per keyword)
  try {
    const ctResults = await scrapeCTgoodjobs();
    for (const job of ctResults) {
      if (!seen.has(job.jobUrl) && job.companyName && job.jobTitle) {
        seen.add(job.jobUrl);
        allJobs.push(job);
      }
    }
  } catch (err: any) {
    console.error(`[JobScraper/CTgoodjobs] Batch error:`, err?.message);
  }

  console.log(`[JobScraper] Total unique jobs found: ${allJobs.length}`);
  return allJobs;
}

// ─── 只用 LinkedIn 爬取（備用）────────────────────────────────────────────
export async function scrapeLinkedInJobsOnly(): Promise<ScrapedJob[]> {
  const allJobs: ScrapedJob[] = [];
  const seen = new Set<string>();
  for (const keyword of SEARCH_KEYWORDS) {
    const results = await scrapeLinkedInJobs(keyword);
    console.log(`[JobScraper/LinkedIn] Found ${results.length} jobs for "${keyword}"`);
    for (const job of results) {
      if (!seen.has(job.jobUrl) && job.companyName && job.jobTitle) {
        seen.add(job.jobUrl);
        allJobs.push(job);
      }
    }
    await sleep(2000);
  }
  console.log(`[JobScraper/LinkedIn] Total unique jobs: ${allJobs.length}`);
  return allJobs;
}

export { extractEmailFromText as default, extractDomain };
