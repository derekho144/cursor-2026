/**
 * Google Search Console (Webmasters) API — readonly analytics.
 * OAuth refresh token stored as platform_credentials.platform = google_search_console.
 */
import { eq } from "drizzle-orm";

const CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET!;
const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
/** Prefer www property; callers may override. */
export const DEFAULT_GSC_SITE_URL =
  process.env.GSC_SITE_URL ?? "https://www.jdstudiohk.com/";

export function gscOAuthScope() {
  return GSC_SCOPE;
}

export async function saveGscRefreshToken(refreshToken: string): Promise<void> {
  const { getDb } = await import("./db");
  const { platformCredentials } = await import("../drizzle/schema");
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .insert(platformCredentials)
    .values({ platform: "google_search_console", refreshToken, isActive: 1 })
    .onDuplicateKeyUpdate({
      set: { refreshToken, isActive: 1, updatedAt: new Date() },
    });
}

async function loadRefreshToken(): Promise<string | null> {
  if (process.env.GOOGLE_GSC_REFRESH_TOKEN?.trim()) {
    return process.env.GOOGLE_GSC_REFRESH_TOKEN.trim();
  }
  const { getPlatformCredential } = await import("./db");
  const cred = await getPlatformCredential("google_search_console");
  return cred?.refreshToken ?? null;
}

export async function getGscAccessToken(): Promise<string> {
  const refreshToken = await loadRefreshToken();
  if (!refreshToken) {
    throw new Error(
      "Missing GSC refresh token. Authorize via /api/google-search-console/auth-url"
    );
  }
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET not configured");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const json = (await res.json()) as { access_token?: string; error?: string };
  if (!json.access_token) {
    throw new Error(`GSC OAuth failed: ${JSON.stringify(json)}`);
  }
  return json.access_token;
}

export async function listGscSites(): Promise<Array<{ siteUrl: string; permissionLevel?: string }>> {
  const token = await getGscAccessToken();
  const res = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json()) as {
    siteEntry?: Array<{ siteUrl?: string; permissionLevel?: string }>;
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(json.error?.message ?? `GSC sites list failed (${res.status})`);
  return (json.siteEntry ?? []).map((s) => ({
    siteUrl: s.siteUrl ?? "",
    permissionLevel: s.permissionLevel,
  }));
}

export type GscSearchAnalyticsRow = {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
};

export async function queryGscSearchAnalytics(opts: {
  siteUrl?: string;
  startDate: string;
  endDate: string;
  dimensions?: string[];
  rowLimit?: number;
  dimensionFilterGroups?: unknown[];
}): Promise<GscSearchAnalyticsRow[]> {
  const siteUrl = opts.siteUrl ?? DEFAULT_GSC_SITE_URL;
  const token = await getGscAccessToken();
  const encoded = encodeURIComponent(siteUrl);
  const body: Record<string, unknown> = {
    startDate: opts.startDate,
    endDate: opts.endDate,
    rowLimit: opts.rowLimit ?? 250,
  };
  if (opts.dimensions?.length) body.dimensions = opts.dimensions;
  if (opts.dimensionFilterGroups?.length) {
    body.dimensionFilterGroups = opts.dimensionFilterGroups;
  }
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encoded}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  const json = (await res.json()) as {
    rows?: GscSearchAnalyticsRow[];
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(json.error?.message ?? `GSC query failed (${res.status})`);
  return json.rows ?? [];
}

export async function testGscConnection(): Promise<{
  success: boolean;
  sites?: Array<{ siteUrl: string; permissionLevel?: string }>;
  hasJdstudio?: boolean;
  error?: string;
}> {
  try {
    const sites = await listGscSites();
    const hasJdstudio = sites.some(
      (s) =>
        s.siteUrl.includes("jdstudiohk.com") ||
        s.siteUrl === "sc-domain:jdstudiohk.com"
    );
    return { success: true, sites, hasJdstudio };
  } catch (e: any) {
    return { success: false, error: e?.message ?? String(e) };
  }
}

/** Mark lastVerifiedAt when connection ok (best-effort). */
export async function touchGscCredentialVerified(): Promise<void> {
  try {
    const { getDb } = await import("./db");
    const { platformCredentials } = await import("../drizzle/schema");
    const db = await getDb();
    if (!db) return;
    await db
      .update(platformCredentials)
      .set({ lastVerifiedAt: new Date(), isActive: 1 })
      .where(eq(platformCredentials.platform, "google_search_console"));
  } catch {
    /* ignore */
  }
}
