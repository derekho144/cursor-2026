/**
 * Page permission catalog — shared by client nav + server ACL.
 * `id` must match DashboardLayout menu item ids.
 */

export type PageId =
  | "dashboard"
  | "quotes"
  | "email-inquiries"
  | "clients"
  | "loyalty"
  | "deliveries"
  | "ad-expenses"
  | "platform-efficiency"
  | "ad-sync"
  | "reports"
  | "freehunter-board"
  | "expenses"
  | "follow-up"
  | "pitch-outreach"
  | "linkedin-ops"
  | "employees"
  | "pricing-learning";

export interface PageDef {
  id: PageId;
  label: string;
  /** Path prefixes that require this page permission */
  pathPrefixes: string[];
  /** Only admins can be granted / see this page */
  adminOnly?: boolean;
}

export const PAGE_CATALOG: PageDef[] = [
  { id: "dashboard", label: "儀表板", pathPrefixes: ["/"] },
  { id: "quotes", label: "報價單", pathPrefixes: ["/quotes"] },
  { id: "email-inquiries", label: "詢價郵件", pathPrefixes: ["/email-inquiries"] },
  { id: "clients", label: "客戶管理", pathPrefixes: ["/clients"] },
  { id: "loyalty", label: "會員方案", pathPrefixes: ["/loyalty"] },
  { id: "deliveries", label: "相片交付", pathPrefixes: ["/deliveries"] },
  { id: "ad-expenses", label: "廣告開支", pathPrefixes: ["/ad-expenses"] },
  { id: "platform-efficiency", label: "平台效益分析", pathPrefixes: ["/platform-efficiency"] },
  { id: "ad-sync", label: "平台同步", pathPrefixes: ["/ad-sync"] },
  { id: "reports", label: "月度報表", pathPrefixes: ["/reports"] },
  { id: "freehunter-board", label: "FH 工作板", pathPrefixes: ["/freehunter-board"] },
  { id: "expenses", label: "收入及支出", pathPrefixes: ["/expenses"] },
  { id: "follow-up", label: "報價跟進", pathPrefixes: ["/follow-up"] },
  { id: "pitch-outreach", label: "開拓客戶", pathPrefixes: ["/pitch-outreach"] },
  { id: "linkedin-ops", label: "LinkedIn 內容", pathPrefixes: ["/linkedin-ops"] },
  { id: "pricing-learning", label: "定價學習", pathPrefixes: ["/pricing-learning"] },
  { id: "employees", label: "員工管理", pathPrefixes: ["/employees"], adminOnly: true },
];

export const ALL_PAGE_IDS: PageId[] = PAGE_CATALOG.map((p) => p.id);

export const ASSIGNABLE_PAGE_IDS: PageId[] = PAGE_CATALOG.filter(
  (p) => !p.adminOnly
).map((p) => p.id);

/** Public routes that never need page ACL (token pages, oauth). */
export const PUBLIC_PATH_PREFIXES = [
  "/delivery/",
  "/sign/",
  "/receipt/",
  "/print/",
  "/api/",
];

export function parseAllowedPages(raw: unknown): PageId[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(ALL_PAGE_IDS);
  return raw.filter((x): x is PageId => typeof x === "string" && allowed.has(x as PageId));
}

export function userCanAccessPage(opts: {
  role: string | null | undefined;
  isActive?: boolean | number | null;
  allowedPages: unknown;
  pageId: PageId;
}): boolean {
  if (opts.role === "admin") return true;
  if (opts.isActive === false || opts.isActive === 0) return false;
  const pages = parseAllowedPages(opts.allowedPages);
  return pages.includes(opts.pageId);
}

/**
 * Resolve which page permission a pathname needs.
 * Longer prefixes win (e.g. /quotes over /).
 */
export function resolvePageIdForPath(pathname: string): PageId | null {
  const path = pathname.split("?")[0] || "/";
  if (PUBLIC_PATH_PREFIXES.some((p) => path.startsWith(p))) return null;

  let best: { id: PageId; len: number } | null = null;
  for (const page of PAGE_CATALOG) {
    for (const prefix of page.pathPrefixes) {
      if (prefix === "/") {
        if (path === "/") {
          if (!best || 1 > best.len) best = { id: page.id, len: 1 };
        }
        continue;
      }
      if (path === prefix || path.startsWith(prefix + "/")) {
        if (!best || prefix.length > best.len) {
          best = { id: page.id, len: prefix.length };
        }
      }
    }
  }
  return best?.id ?? null;
}
