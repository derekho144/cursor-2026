/**
 * 多層次電郵搜尋模組
 * 
 * 搜尋層次（按優先順序）：
 * 1. Hunter.io domain search（現有）
 * 2. Snov.io domain search（新增，小公司覆蓋更好）
 * 3. 公司官網爬取（/contact, /about, /team 頁面）
 * 4. 電郵格式猜測 + SMTP 驗證（完全免費）
 */

import net from 'net';
import dns from 'dns/promises';

// ─── 公司名稱 → 域名自動尋找 ─────────────────────────────────────────────────

/**
 * 從公司名稱自動尋找官方域名
 * 策略：
 * 1. Firecrawl Search 搜尋公司官網
 * 2. 嘗試常見香港域名格式
 */
export async function findDomainForCompany(companyName: string): Promise<string | undefined> {
  // 清理公司名稱（移除 Limited、HK 等後綴）
  const cleanName = companyName
    .replace(/\s*(limited|ltd|hk|hong kong|company|co\.|inc\.?)\s*/gi, ' ')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');

  // ── 策略 1：Firecrawl Search ──────────────────────────────────────────────
  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  if (firecrawlKey) {
    try {
      const query = `"${companyName}" Hong Kong official website`;
      const res = await fetch('https://api.firecrawl.dev/v1/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${firecrawlKey}`,
        },
        body: JSON.stringify({ query, limit: 5 }),
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const data = await res.json() as {
          data?: Array<{ url?: string; metadata?: { sourceURL?: string } }>;
        };
        const results = data.data ?? [];

        for (const result of results) {
          const url = result.url ?? result.metadata?.sourceURL;
          if (!url) continue;
          try {
            const parsed = new URL(url);
            const hostname = parsed.hostname.replace(/^www\./, '');
            // 排除社交媒體和招聘網站
            const EXCLUDED = ['linkedin.com', 'facebook.com', 'instagram.com', 'jobsdb.com',
              'indeed.com', 'ctgoodjobs.hk', 'freehunter.com', 'wikipedia.org',
              'bloomberg.com', 'crunchbase.com', 'glassdoor.com'];
            if (EXCLUDED.some(ex => hostname.includes(ex))) continue;
            // 驗證域名包含公司名稱關鍵字
            const hostnameClean = hostname.replace(/\.(com|hk|net|org|io).*$/, '');
            if (hostnameClean.includes(cleanName.slice(0, 4)) || cleanName.includes(hostnameClean.slice(0, 4))) {
              return hostname;
            }
            // 如果是第一個非社交媒體結果，也接受
            if (results.indexOf(result) === 0) {
              return hostname;
            }
          } catch {
            continue;
          }
        }
      }
    } catch {
      // 繼續嘗試其他策略
    }
  }

  // ── 策略 2：嘗試常見香港域名格式 ─────────────────────────────────────────
  const domainCandidates = [
    `${cleanName}.com.hk`,
    `${cleanName}.hk`,
    `${cleanName}.com`,
    `${cleanName}.co`,
  ];

  for (const domain of domainCandidates) {
    try {
      const mxRecords = await dns.resolveMx(domain);
      if (mxRecords.length > 0) {
        return domain;
      }
    } catch {
      // 域名不存在，嘗試下一個
    }
  }

  return undefined;
}

// ─── 類型定義 ────────────────────────────────────────────────────────────────

export interface EmailCandidate {
  email: string;
  name?: string;
  position?: string;
  confidence: number; // 0-100
  source: 'hunter' | 'snovio' | 'website' | 'smtp_guess';
}

export interface EmailSearchResult {
  candidates: EmailCandidate[];
  domain?: string;
  searchedLayers: string[];
}

// ─── Snov.io API ─────────────────────────────────────────────────────────────

async function getSnovioToken(): Promise<string | null> {
  const clientId = process.env.SNOVIO_CLIENT_ID;
  const clientSecret = process.env.SNOVIO_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch('https://api.snov.io/v1/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    const data = await res.json() as { access_token?: string };
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

async function searchSnovioByDomain(domain: string): Promise<EmailCandidate[]> {
  const token = await getSnovioToken();
  if (!token) return [];

  try {
    // Snov.io domain search API
    const res = await fetch(`https://api.snov.io/v2/domain-emails-with-info?domain=${encodeURIComponent(domain)}&type=all&limit=10`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];

    const data = await res.json() as {
      emails?: Array<{
        email: string;
        firstName?: string;
        lastName?: string;
        position?: string;
        confidence?: number;
      }>;
    };

    if (!data.emails?.length) return [];

    return data.emails
      .filter(e => e.email)
      .map(e => {
        return {
          email: e.email,
          name: [e.firstName, e.lastName].filter(Boolean).join(' ') || undefined,
          position: e.position,
          confidence: e.confidence ?? 70,
          source: 'snovio' as const,
        };
      });
  } catch {
    return [];
  }
}

// ─── 公司官網電郵爬取 ─────────────────────────────────────────────────────────

async function extractEmailsFromWebsite(websiteUrl: string): Promise<EmailCandidate[]> {
  if (!websiteUrl) return [];

  const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const CONTACT_PATHS = ['/contact', '/contact-us', '/about', '/about-us', '/team', '/our-team', '/staff'];

  const candidates: EmailCandidate[] = [];
  const seen = new Set<string>();

  // 嘗試爬取聯絡頁面
  const baseUrl = websiteUrl.replace(/\/$/, '');
  const urlsToTry = [baseUrl, ...CONTACT_PATHS.map(p => baseUrl + p)];

  for (const url of urlsToTry.slice(0, 4)) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JDStudioBot/1.0)' },
      });
      clearTimeout(timeout);

      if (!res.ok) continue;
      const html = await res.text();
      const emails = html.match(EMAIL_REGEX) ?? [];

      for (const email of emails) {
        const lower = email.toLowerCase();
        // 過濾無效電郵
        if (seen.has(lower)) continue;
        if (lower.includes('example') || lower.includes('placeholder') || lower.endsWith('.png') || lower.endsWith('.jpg')) continue;
        seen.add(lower);

        // 過濾通用信箱（info@, admin@, contact@ 等）
        const isGeneric = /^(info|contact|hello|support|admin|mail|enquiry|enquiries|general|webmaster|noreply)@/.test(lower);
        if (isGeneric) continue; // 完全跳過通用信箱
        
        candidates.push({
          email: lower,
          confidence: 75,
          source: 'website',
        });
      }

      if (candidates.length >= 3) break;
    } catch {
      // 繼續嘗試下一個 URL
    }
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

// ─── SMTP 驗證 ────────────────────────────────────────────────────────────────

async function verifyEmailViaSMTP(email: string): Promise<boolean> {
  const domain = email.split('@')[1];
  if (!domain) return false;

  try {
    // 查詢 MX 記錄
    const mxRecords = await dns.resolveMx(domain);
    if (!mxRecords.length) return false;

    const mxHost = mxRecords.sort((a, b) => a.priority - b.priority)[0].exchange;

    return await new Promise<boolean>((resolve) => {
      const socket = net.createConnection(25, mxHost);
      let response = '';
      let verified = false;

      socket.setTimeout(8000);

      socket.on('data', (data) => {
        response += data.toString();

        if (response.includes('220') && !response.includes('RCPT')) {
          socket.write(`EHLO jdstudio.hk\r\n`);
        } else if (response.includes('250') && response.includes('EHLO')) {
          socket.write(`MAIL FROM:<verify@jdstudio.hk>\r\n`);
        } else if (response.includes('250') && response.includes('MAIL')) {
          socket.write(`RCPT TO:<${email}>\r\n`);
        } else if (response.includes('RCPT')) {
          if (response.includes('250') || response.includes('251')) {
            verified = true;
          }
          socket.write('QUIT\r\n');
          socket.end();
        }
      });

      socket.on('close', () => resolve(verified));
      socket.on('error', () => resolve(false));
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
    });
  } catch {
    return false;
  }
}

// ─── 電郵格式猜測 ─────────────────────────────────────────────────────────────

async function guessEmailsForDomain(domain: string, companyName: string): Promise<EmailCandidate[]> {
  // 通用聯絡電郵格式（不需要人名）
  const GENERIC_PATTERNS = [
    'info', 'contact', 'hello', 'hr', 'hiring', 'jobs',
    'enquiry', 'enquiries', 'admin', 'office',
  ];

  const candidates: EmailCandidate[] = [];

  // 先驗證域名是否有 MX 記錄
  try {
    const mxRecords = await dns.resolveMx(domain);
    if (!mxRecords.length) return [];
  } catch {
    return [];
  }

  // 嘗試通用格式（並行驗證，最多 5 個）
  const toVerify = GENERIC_PATTERNS.slice(0, 5).map(prefix => `${prefix}@${domain}`);

  const results = await Promise.allSettled(
    toVerify.map(async (email) => {
      const valid = await verifyEmailViaSMTP(email);
      return { email, valid };
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.valid) {
      const prefix = result.value.email.split('@')[0];
      const isHR = ['hr', 'hiring', 'jobs'].includes(prefix);
      candidates.push({
        email: result.value.email,
        confidence: isHR ? 80 : 65,
        source: 'smtp_guess',
      });
    }
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

// ─── 主函數：多層次搜尋 ───────────────────────────────────────────────────────

export async function multiLayerEmailSearch(params: {
  companyName: string;
  companyWebsite?: string;
  hunterApiKey?: string;
  jobUrl?: string;
}): Promise<EmailSearchResult> {
  const { companyName, companyWebsite, hunterApiKey } = params;
  const searchedLayers: string[] = [];
  const allCandidates: EmailCandidate[] = [];
  const seen = new Set<string>();

  // 提取域名（優先使用已知官網，否則自動尋找）
  let domain: string | undefined;
  if (companyWebsite) {
    try {
      domain = new URL(companyWebsite).hostname.replace(/^www\./, '');
    } catch {
      domain = undefined;
    }
  }

  // ── 層次 0：自動尋找域名（當沒有官網時）──────────────────────────────────
  if (!domain && companyName) {
    try {
      searchedLayers.push('域名搜尋');
      domain = await findDomainForCompany(companyName);
    } catch {
      // 繼續
    }
  }

  // 通用信箱過濾（適用所有來源）
  const GENERIC_EMAIL_PATTERN = /^(info|contact|hello|support|admin|mail|enquiry|enquiries|general|webmaster|noreply|no-reply|sales|marketing|office|reception|accounts|billing|hr|jobs|careers|recruit|media|press|legal|privacy|security|abuse|postmaster|hostmaster|team|service|services)@/;

  const addCandidates = (candidates: EmailCandidate[]) => {
    for (const c of candidates) {
      const lower = c.email.toLowerCase();
      if (!seen.has(lower)) {
        // 過濾通用信箱（所有來源統一過濾）
        if (GENERIC_EMAIL_PATTERN.test(lower)) continue;
        seen.add(lower);
        allCandidates.push({ ...c, email: lower });
      }
    }
  };

  // ── 層次 1：Hunter.io ──────────────────────────────────────────────────────
  if (hunterApiKey && domain) {
    try {
      searchedLayers.push('Hunter.io');
      const res = await fetch(
        `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${hunterApiKey}&limit=10`
      );
      if (res.ok) {
        const data = await res.json() as {
          data?: {
            emails?: Array<{
              value: string;
              first_name?: string;
              last_name?: string;
              position?: string;
              confidence?: number;
            }>;
          };
        };
        const emails = (data.data?.emails ?? []).map(e => {
          return {
            email: e.value,
            name: [e.first_name, e.last_name].filter(Boolean).join(' ') || undefined,
            position: e.position,
            confidence: e.confidence ?? 70,
            source: 'hunter' as const,
          };
        });
        addCandidates(emails);
      }
    } catch {
      // 繼續下一層
    }
  }

  // ── 層次 2：Snov.io ────────────────────────────────────────────────────────
  if (domain && process.env.SNOVIO_CLIENT_ID) {
    try {
      searchedLayers.push('Snov.io');
      const snovCandidates = await searchSnovioByDomain(domain);
      addCandidates(snovCandidates);
    } catch {
      // 繼續下一層
    }
  }

  // 如果已找到高信心度電郵，可以提前返回
  const highConfidence = allCandidates.filter(c => c.confidence >= 80);
  if (highConfidence.length >= 2) {
    return { candidates: allCandidates, domain, searchedLayers };
  }

  // ── 層次 3：官網爬取 ───────────────────────────────────────────────────────
  if (companyWebsite) {
    try {
      searchedLayers.push('官網爬取');
      const websiteCandidates = await extractEmailsFromWebsite(companyWebsite);
      addCandidates(websiteCandidates);
    } catch {
      // 繼續下一層
    }
  }

  // ── 層次 4：電郵格式猜測 + SMTP 驗證 ──────────────────────────────────────
  if (domain && allCandidates.length === 0) {
    try {
      searchedLayers.push('SMTP 驗證');
      const guessCandidates = await guessEmailsForDomain(domain, companyName);
      addCandidates(guessCandidates);
    } catch {
      // 搜尋失敗
    }
  }

  // 按決策者優先級 + 信心度排序
  // 優先級：CEO/Founder/Owner > Director/Head > HR/Manager > 其他
  const DECISION_MAKER_TIERS = {
    tier1: ['ceo', 'founder', 'co-founder', 'owner', 'chief'],
    tier2: ['director', 'head of', 'head'],
    tier3: ['hr', 'human resources', 'talent', 'people', 'recruiting', 'manager', 'marketing'],
  };

  const getDecisionMakerTier = (position?: string): number => {
    if (!position) return 99; // 無職位資訊最後
    const pos = position.toLowerCase();
    if (DECISION_MAKER_TIERS.tier1.some(t => pos.includes(t))) return 0;
    if (DECISION_MAKER_TIERS.tier2.some(t => pos.includes(t))) return 1;
    if (DECISION_MAKER_TIERS.tier3.some(t => pos.includes(t))) return 2;
    return 3; // 其他職位
  };

  allCandidates.sort((a, b) => {
    const tierA = getDecisionMakerTier(a.position);
    const tierB = getDecisionMakerTier(b.position);
    if (tierA !== tierB) return tierA - tierB; // 先按決策者等級排序
    return b.confidence - a.confidence; // 同等級按信心度排序
  });

  return { candidates: allCandidates, domain, searchedLayers };
}
