/**
 * linkedinDecisionMaker.ts
 * 用 Firecrawl 爬取 LinkedIn 公司頁面，提取 leadership 決策者
 * 目標職位：Founder, Co-founder, CEO, HR Director, Marketing Director, VP, Head of
 */
import axios from "axios";

export interface LinkedInDecisionMaker {
  name: string;
  title: string;
  linkedinUrl?: string;
  companyName: string;
}

const DECISION_MAKER_KEYWORDS = [
  "founder",
  "co-founder",
  "owner",
  "ceo",
  "chief executive",
  "chief",
  "director",
  "head of",
  "head hr",
  "head of hr",
  "hr director",
  "hr manager",
  "human resources",
  "talent",
  "people",
  "recruiting",
  "vp",
  "vice president",
  "manager",
  "lead",
];

/**
 * 用 Firecrawl 爬取 LinkedIn 公司頁面
 */
async function firecrawlScrapeLI(url: string): Promise<string> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY not set");

  try {
    const resp = await axios.post(
      "https://api.firecrawl.dev/v1/scrape",
      { url, formats: ["markdown"], onlyMainContent: true },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );
    return resp.data?.data?.markdown ?? "";
  } catch (err: any) {
    console.error(`[LinkedInDecisionMaker] Firecrawl error for ${url}:`, err?.message);
    return "";
  }
}

/**
 * 根據公司名稱搜尋 LinkedIn 公司頁面 URL
 * 返回類似 https://www.linkedin.com/company/apple/
 */
function buildLinkedInCompanySearchUrl(companyName: string): string {
  const encoded = encodeURIComponent(companyName.toLowerCase().replace(/\s+/g, "-"));
  return `https://www.linkedin.com/company/${encoded}/`;
}

/**
 * 從 markdown 中提取決策者名單
 * 尋找包含職位關鍵字的人名
 */
function extractDecisionMakers(markdown: string, companyName: string): LinkedInDecisionMaker[] {
  const makers: LinkedInDecisionMaker[] = [];
  const lines = markdown.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 尋找包含決策者職位關鍵字的行
    const isDecisionMaker = DECISION_MAKER_KEYWORDS.some((kw) =>
      line.toLowerCase().includes(kw)
    );

    if (isDecisionMaker && line.length > 5) {
      // 嘗試提取名字和職位
      // 格式可能是：Name, Title at Company 或 Name - Title
      const nameMatch = line.match(/^([A-Z][a-zA-Z\s]+?)(?:\s*[-,]|at\s)/);
      if (nameMatch) {
        const name = nameMatch[1].trim();
        const title = line.replace(name, "").replace(/^[-,\s]+/, "").trim();

        if (name && title && name.length > 2) {
          makers.push({
            name,
            title,
            companyName,
          });
        }
      }
    }
  }

  return makers;
}

/**
 * 主函數：根據公司名稱搜尋 LinkedIn 決策者
 */
export async function findLinkedInDecisionMakers(
  companyName: string
): Promise<LinkedInDecisionMaker[]> {
  try {
    console.log(`[LinkedInDecisionMaker] Searching for decision makers at "${companyName}"`);

    // 構建 LinkedIn 公司頁面 URL
    const companyUrl = buildLinkedInCompanySearchUrl(companyName);
    console.log(`[LinkedInDecisionMaker] Scraping ${companyUrl}`);

    // 用 Firecrawl 爬取
    const markdown = await firecrawlScrapeLI(companyUrl);

    if (!markdown) {
      console.log(`[LinkedInDecisionMaker] No content found for "${companyName}"`);
      return [];
    }

    // 提取決策者
    const makers = extractDecisionMakers(markdown, companyName);
    console.log(
      `[LinkedInDecisionMaker] Found ${makers.length} decision makers for "${companyName}"`
    );

    return makers;
  } catch (err: any) {
    console.error(`[LinkedInDecisionMaker] Error for "${companyName}":`, err?.message);
    return [];
  }
}

/**
 * 備用：直接搜尋 LinkedIn 人員
 * 格式：https://www.linkedin.com/search/results/people/?keywords=founder%20at%20Apple
 */
export function buildLinkedInPeopleSearchUrl(
  keywords: string,
  companyName?: string
): string {
  let q = keywords;
  if (companyName) {
    q = `${keywords} at ${companyName}`;
  }
  const encoded = encodeURIComponent(q);
  return `https://www.linkedin.com/search/results/people/?keywords=${encoded}`;
}
