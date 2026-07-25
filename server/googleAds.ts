/**
 * Google Ads API integration using REST API directly.
 *
 * Architecture:
 * - GOOGLE_ADS_CUSTOMER_ID = Manager Account (MCC) ID: 987-663-0892 (9876630892)
 *   Used as login-customer-id header for authentication.
 * - AD_ACCOUNT_ID = The actual advertising account: 4839352747
 *   This is the account that contains campaigns and metrics.
 *
 * The google-ads-api npm package has a bug with error parsing for Manager Accounts,
 * so we use the REST API directly instead.
 */

const DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN!;
const CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET!;
const REFRESH_TOKEN = process.env.GOOGLE_ADS_REFRESH_TOKEN!;
// Manager Account (MCC) ID - used as login-customer-id
const MANAGER_CUSTOMER_ID = (process.env.GOOGLE_ADS_CUSTOMER_ID ?? "").replace(/-/g, "");
// Actual advertising account ID that contains campaigns and metrics
const AD_ACCOUNT_ID = "4839352747";

const GOOGLE_ADS_API_VERSION = "v23";

export interface GoogleAdsDailyCost {
  date: string; // YYYY-MM-DD
  costMicros: number; // cost in micros (divide by 1_000_000 for HKD)
  campaignName?: string;
  campaignId?: string;
}

export interface GoogleAdsSummary {
  date: string;
  totalCostHKD: number;
  totalImpressions: number;
  totalClicks: number;
  campaigns: Array<{
    id: string;
    name: string;
    costHKD: number;
    impressions: number;
    clicks: number;
  }>;
}

/**
 * Check if all required Google Ads env vars are set.
 */
function checkEnvVars(): void {
  const missing = [
    ["GOOGLE_ADS_DEVELOPER_TOKEN", DEVELOPER_TOKEN],
    ["GOOGLE_ADS_CLIENT_ID", CLIENT_ID],
    ["GOOGLE_ADS_CLIENT_SECRET", CLIENT_SECRET],
    ["GOOGLE_ADS_REFRESH_TOKEN", REFRESH_TOKEN],
    ["GOOGLE_ADS_CUSTOMER_ID", MANAGER_CUSTOMER_ID],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length > 0) {
    throw new Error(`Missing Google Ads env vars: ${missing.join(", ")}`);
  }
}

/**
 * Get the active refresh token — prefers DB-stored token over env var.
 * This allows re-auth without redeployment.
 */
async function getActiveRefreshToken(): Promise<string> {
  try {
    const { getPlatformCredential } = await import("./db");
    const cred = await getPlatformCredential("google_ads");
    if (cred?.refreshToken) return cred.refreshToken;
  } catch (_) {}
  return REFRESH_TOKEN;
}

/**
 * Save a new refresh token to the database for google_ads platform.
 */
export async function saveGoogleAdsRefreshToken(refreshToken: string): Promise<void> {
  const { getDb } = await import("./db");
  const { platformCredentials } = await import("../drizzle/schema");
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .insert(platformCredentials)
    .values({ platform: "google_ads", refreshToken, isActive: 1 })
    .onDuplicateKeyUpdate({ set: { refreshToken, isActive: 1, updatedAt: new Date() } });
}

/**
 * Get a fresh OAuth2 access token using the refresh token.
 */
async function getAccessToken(): Promise<string> {
  const activeRefreshToken = await getActiveRefreshToken();
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: activeRefreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const json = await res.json() as any;
  if (!json.access_token) {
    throw new Error(`OAuth2 token refresh failed: ${JSON.stringify(json)}`);
  }
  return json.access_token as string;
}

/**
 * Execute a Google Ads Query Language (GAQL) query via REST API.
 * Queries are run against AD_ACCOUNT_ID, authenticated via MANAGER_CUSTOMER_ID.
 */
async function executeGaqlQuery(query: string): Promise<any[]> {
  const accessToken = await getAccessToken();

  const res = await fetch(
    `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${AD_ACCOUNT_ID}/googleAds:search`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "developer-token": DEVELOPER_TOKEN,
        "login-customer-id": MANAGER_CUSTOMER_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    }
  );

  const json = await res.json() as any;

  if (!res.ok) {
    const errMsg =
      json?.error?.details?.[0]?.errors?.[0]?.message ??
      json?.error?.message ??
      JSON.stringify(json);
    throw new Error(`Google Ads API error (${res.status}): ${errMsg}`);
  }

  return (json.results ?? []) as any[];
}

export async function fetchGoogleAdsCosts(
  startDate: string, // YYYY-MM-DD
  endDate: string    // YYYY-MM-DD
): Promise<GoogleAdsSummary[]> {
  checkEnvVars();

  const query = `
    SELECT
      campaign.id,
      campaign.name,
      segments.date,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND metrics.cost_micros > 0
    ORDER BY segments.date DESC, metrics.cost_micros DESC
  `;

  const rows = await executeGaqlQuery(query);

  // Group by date
  const dateMap = new Map<string, GoogleAdsSummary>();

  for (const row of rows) {
    const date = row.segments?.date as string;
    const campaignId = String(row.campaign?.id ?? "");
    const campaignName = (row.campaign?.name as string) ?? "Unknown";
    const costMicros = Number(row.metrics?.costMicros ?? 0);
    const costHKD = costMicros / 1_000_000;
    const impressions = Number(row.metrics?.impressions ?? 0);
    const clicks = Number(row.metrics?.clicks ?? 0);

    if (!dateMap.has(date)) {
      dateMap.set(date, { date, totalCostHKD: 0, totalImpressions: 0, totalClicks: 0, campaigns: [] });
    }

    const summary = dateMap.get(date)!;
    summary.totalCostHKD += costHKD;
    summary.totalImpressions += impressions;
    summary.totalClicks += clicks;
    summary.campaigns.push({ id: campaignId, name: campaignName, costHKD, impressions, clicks });
  }

  return Array.from(dateMap.values()).sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Fetch total Google Ads cost for a specific month
 * Returns total cost in HKD
 */
export async function fetchGoogleAdsMonthCost(
  year: number,
  month: number // 1-12
): Promise<number> {
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const summaries = await fetchGoogleAdsCosts(startDate, endDate);
  return summaries.reduce((sum, s) => sum + s.totalCostHKD, 0);
}

/**
 * Test connection to Google Ads API
 */
export async function testGoogleAdsConnection(): Promise<{ success: boolean; customerId?: string; error?: string }> {
  try {
    checkEnvVars();
    const rows = await executeGaqlQuery(`
      SELECT customer.id, customer.descriptive_name
      FROM customer
      LIMIT 1
    `);

    return {
      success: true,
      customerId: String(rows[0]?.customer?.id ?? AD_ACCOUNT_ID),
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message ?? String(error),
    };
  }
}
