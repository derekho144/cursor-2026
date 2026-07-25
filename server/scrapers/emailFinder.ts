/**
 * emailFinder.ts
 * 從招聘廣告、公司官網提取聯絡 email
 * 整合 Hunter.io API 搜尋公司 email
 */
import axios from "axios";
import * as cheerio from "cheerio";
import { extractEmailFromText, extractDomain } from "./jobScraper";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-HK,zh;q=0.9,en;q=0.8",
};

export type EmailFoundVia = "job_ad" | "company_website" | "hunter_io" | "manual" | "decision_maker_website";

export interface EmailFindResult {
  email: string | null;
  foundVia: EmailFoundVia | null;
  contactName?: string;
}

// ─── 從職位廣告頁面提取 email ──────────────────────────────────────────────
export async function extractEmailFromJobPage(jobUrl: string): Promise<EmailFindResult> {
  try {
    const resp = await axios.get(jobUrl, {
      headers: HEADERS,
      timeout: 15000,
      maxRedirects: 5,
    });
    const html = resp.data as string;
    const $ = cheerio.load(html);

    // 移除 script 和 style 標籤
    $("script, style, noscript").remove();
    const text = $.text();

    const email = extractEmailFromText(text);
    if (email) {
      return { email, foundVia: "job_ad" };
    }

    // 嘗試從 mailto: 連結提取
    const mailtoEmail = $("a[href^='mailto:']").first().attr("href")?.replace("mailto:", "").split("?")[0].trim() ?? null;
    if (mailtoEmail && mailtoEmail.includes("@")) {
      return { email: mailtoEmail, foundVia: "job_ad" };
    }
  } catch (err: any) {
    console.error(`[EmailFinder/JobPage] Error for ${jobUrl}:`, err?.message);
  }
  return { email: null, foundVia: null };
}

// ─── 從公司官網 Contact 頁面提取 email ────────────────────────────────────
export async function extractEmailFromCompanyWebsite(websiteUrl: string): Promise<EmailFindResult> {
  const contactPaths = ["/contact", "/contact-us", "/about", "/about-us", "/team", "/我們", "/聯絡", "/聯絡我們"];

  for (const path of contactPaths) {
    try {
      const url = websiteUrl.replace(/\/$/, "") + path;
      const resp = await axios.get(url, {
        headers: HEADERS,
        timeout: 10000,
        maxRedirects: 3,
      });
      const html = resp.data as string;
      const $ = cheerio.load(html);
      $("script, style, noscript").remove();

      // 優先從 mailto: 連結提取
      const mailtoEmail = $("a[href^='mailto:']").first().attr("href")?.replace("mailto:", "").split("?")[0].trim() ?? null;
      if (mailtoEmail && mailtoEmail.includes("@")) {
        return { email: mailtoEmail, foundVia: "company_website" };
      }

      // 從文字提取
      const text = $.text();
      const email = extractEmailFromText(text);
      if (email) {
        return { email, foundVia: "company_website" };
      }
    } catch {
      // 嘗試下一個路徑
    }
  }

  // 嘗試首頁
  try {
    const resp = await axios.get(websiteUrl, {
      headers: HEADERS,
      timeout: 10000,
      maxRedirects: 3,
    });
    const $ = cheerio.load(resp.data as string);
    const mailtoEmail = $("a[href^='mailto:']").first().attr("href")?.replace("mailto:", "").split("?")[0].trim() ?? null;
    if (mailtoEmail && mailtoEmail.includes("@")) {
      return { email: mailtoEmail, foundVia: "company_website" };
    }
    $("script, style, noscript").remove();
    const text = $.text();
    const email = extractEmailFromText(text);
    if (email) {
      return { email, foundVia: "company_website" };
    }
  } catch {
    // 忽略
  }

  return { email: null, foundVia: null };
}

// ─── Hunter.io API ─────────────────────────────────────────────────────────
export async function findEmailViaHunter(
  domain: string,
  companyName: string,
  hunterApiKey: string
): Promise<EmailFindResult> {
  if (!hunterApiKey || !domain) return { email: null, foundVia: null };

  try {
    // Domain Search：搜尋公司域名下的所有 email
    const resp = await axios.get("https://api.hunter.io/v2/domain-search", {
      params: {
        domain,
        company: companyName,
        api_key: hunterApiKey,
        limit: 5,
        type: "generic", // 優先找 generic email（info@, contact@, hr@）
      },
      timeout: 10000,
    });

    const data = resp.data?.data;
    if (!data) return { email: null, foundVia: null };

    const emails: Array<{ value: string; type: string; first_name?: string; last_name?: string; position?: string }> =
      data.emails ?? [];

    if (emails.length === 0) return { email: null, foundVia: null };

    // 優先選 generic email（info@, contact@, hr@, marketing@）
    const genericPriority = ["info", "contact", "hr", "marketing", "hello", "admin"];
    for (const prefix of genericPriority) {
      const found = emails.find((e) => e.value.startsWith(prefix + "@"));
      if (found) {
        return {
          email: found.value,
          foundVia: "hunter_io",
          contactName: found.first_name && found.last_name ? `${found.first_name} ${found.last_name}` : undefined,
        };
      }
    }

    // 否則選第一個
    const first = emails[0];
    return {
      email: first.value,
      foundVia: "hunter_io",
      contactName: first.first_name && first.last_name ? `${first.first_name} ${first.last_name}` : undefined,
    };
  } catch (err: any) {
    console.error(`[EmailFinder/Hunter] Error for domain "${domain}":`, err?.message);
    return { email: null, foundVia: null };
  }
}

// ─── 搜尋決策者 email（從 LinkedIn 決策者名字搜尋）──────────────────────
export async function findDecisionMakerEmail(params: {
  decisionMakerName: string;
  decisionMakerTitle: string;
  companyName: string;
  companyWebsite?: string;
}): Promise<EmailFindResult> {
  const { decisionMakerName, decisionMakerTitle, companyName, companyWebsite } = params;

  // 嘗試從公司官網 leadership/team 頁面搜尋決策者 email
  if (companyWebsite) {
    const leadershipPaths = ["/leadership", "/team", "/about", "/about-us", "/management", "/executives"];
    for (const path of leadershipPaths) {
      try {
        const url = companyWebsite.replace(/\/$/, "") + path;
        const resp = await axios.get(url, {
          headers: HEADERS,
          timeout: 10000,
          maxRedirects: 3,
        });
        const html = resp.data as string;
        const $ = cheerio.load(html);
        $('script, style, noscript').remove();
        const text = $.text();

        // 搜尋決策者名字是否出現在頁面上
        if (text.toLowerCase().includes(decisionMakerName.toLowerCase())) {
          // 嘗試從該區域提取 email
          const email = extractEmailFromText(text);
          if (email) {
            return { email, foundVia: "decision_maker_website", contactName: decisionMakerName };
          }
        }
      } catch {
        // 嘗試下一個路徑
      }
    }
  }

  return { email: null, foundVia: null };
}

// ─── 主入口：綜合搜尋 email ────────────────────────────────────────────────
export async function findContactEmail(params: {
  jobUrl: string;
  companyWebsite?: string;
  companyName: string;
  hunterApiKey?: string;
}): Promise<EmailFindResult> {
  const { jobUrl, companyWebsite, companyName, hunterApiKey } = params;

  // 1. 先嘗試從職位廣告頁面提取
  const fromJobPage = await extractEmailFromJobPage(jobUrl);
  if (fromJobPage.email) return fromJobPage;

  // 2. 嘗試從公司官網提取
  if (companyWebsite) {
    const fromWebsite = await extractEmailFromCompanyWebsite(companyWebsite);
    if (fromWebsite.email) return fromWebsite;
  }

  // 3. 嘗試 Hunter.io
  if (hunterApiKey) {
    // 3a. 如果有 companyWebsite，先用域名搜索
    if (companyWebsite) {
      const domain = extractDomain(companyWebsite);
      if (domain) {
        const fromHunter = await findEmailViaHunter(domain, companyName, hunterApiKey);
        if (fromHunter.email) return fromHunter;
      }
    }
    
    // 3b. 如果沒有 companyWebsite 或域名搜索失敗，用公司名稱相關域名搜索
    const companyNameLower = companyName.toLowerCase().replace(/\s+/g, '-');
    const possibleDomains = [
      `${companyNameLower}.com.hk`,
      `${companyNameLower}.hk`,
      `${companyNameLower}.com`,
      `www.${companyNameLower}.com.hk`,
      `www.${companyNameLower}.hk`,
      `www.${companyNameLower}.com`,
    ];
    
    for (const domain of possibleDomains) {
      try {
        const fromHunter = await findEmailViaHunter(domain, companyName, hunterApiKey);
        if (fromHunter.email) return fromHunter;
      } catch (err) {
        // 繼續嘗試下一個域名
      }
    }
  }

  return { email: null, foundVia: null };
}
