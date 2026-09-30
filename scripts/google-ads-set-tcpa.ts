/**
 * Search #3 — set Maximize Conversions target CPA (raise effective CPC / Rank).
 *
 * Default: tCPA HK$90, daily budget UNCHANGED.
 * Budget bump is a separate last-resort step (only when Rank improves AND Budget lost ≥10–15%).
 *
 *   npx tsx scripts/google-ads-set-tcpa.ts --dry-run
 *   npx tsx scripts/google-ads-set-tcpa.ts --apply
 *   npx tsx scripts/google-ads-set-tcpa.ts --apply --tcpa 90
 */
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CUSTOMER_ID = (process.env.GOOGLE_ADS_AD_ACCOUNT_ID ?? "4839352747").replace(/-/g, "");
const MCC_ID = (
  process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ??
  process.env.GOOGLE_ADS_CUSTOMER_ID ??
  "9876630892"
).replace(/-/g, "");
const API_VERSION = "v23";
const CAMPAIGN_ID = "24002224927";
const CAMPAIGN_RN = `customers/${CUSTOMER_ID}/campaigns/${CAMPAIGN_ID}`;
const DEFAULT_TCPA_HKD = 90;

async function loadEnv() {
  const keys = [
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_REFRESH_TOKEN",
  ] as const;
  const env: Record<string, string> = {};
  for (const k of keys) {
    const v = process.env[k]?.trim();
    if (v) env[k] = v;
  }
  const path = process.env.GOOGLE_ADS_ENV_FILE ?? join(homedir(), ".config/jd-studio/google-ads.env");
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const s = line.trim();
      if (!s || s.startsWith("#") || !s.includes("=")) continue;
      const i = s.indexOf("=");
      const k = s.slice(0, i).trim();
      const v = s.slice(i + 1).trim();
      if (v && !env[k]) env[k] = v;
    }
  } catch {
    /* optional */
  }
  if (process.env.SKIP_DB !== "1") {
    try {
      const { getPlatformCredential } = await import("../server/db");
      const cred = await Promise.race([
        getPlatformCredential("google_ads"),
        new Promise<null>((_, rej) => setTimeout(() => rej(new Error("DB timeout")), 8_000)),
      ]);
      if (cred?.refreshToken) {
        env.GOOGLE_ADS_REFRESH_TOKEN = cred.refreshToken;
        console.log("Using refresh token from DB");
      }
    } catch (e) {
      console.warn(`[set-tcpa] DB refresh skip: ${String(e)}`);
    }
  }
  for (const k of keys) {
    if (!env[k]) throw new Error(`Missing credential: ${k}`);
  }
  return env;
}

async function getAccessToken(env: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_ADS_CLIENT_ID,
      client_secret: env.GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: env.GOOGLE_ADS_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const json = (await res.json()) as { access_token?: string; error?: string };
  if (!json.access_token) throw new Error(`OAuth failed: ${JSON.stringify(json)}`);
  return json.access_token;
}

function headers(env: Record<string, string>, token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "developer-token": env.GOOGLE_ADS_DEVELOPER_TOKEN,
    "login-customer-id": MCC_ID,
    "Content-Type": "application/json",
  };
}

async function gaql(env: Record<string, string>, token: string, query: string) {
  const res = await fetch(
    `https://googleads.googleapis.com/${API_VERSION}/customers/${CUSTOMER_ID}/googleAds:search`,
    { method: "POST", headers: headers(env, token), body: JSON.stringify({ query }) }
  );
  const json = (await res.json()) as { results?: any[]; error?: unknown };
  if (!res.ok) throw new Error(`GAQL failed: ${JSON.stringify(json).slice(0, 1200)}`);
  return json.results ?? [];
}

async function mutateCampaigns(
  env: Record<string, string>,
  token: string,
  operations: unknown[],
  validateOnly: boolean
) {
  const res = await fetch(
    `https://googleads.googleapis.com/${API_VERSION}/customers/${CUSTOMER_ID}/campaigns:mutate`,
    {
      method: "POST",
      headers: headers(env, token),
      body: JSON.stringify({
        operations,
        partialFailure: true,
        validateOnly,
      }),
    }
  );
  const json = await res.json();
  if (!res.ok) throw new Error(`campaigns mutate failed: ${JSON.stringify(json).slice(0, 2000)}`);
  return json as {
    results?: Array<{ resourceName?: string }>;
    partialFailureError?: { message?: string; details?: unknown[] };
  };
}

function microsToHkd(micros: string | number | undefined | null): number | null {
  if (micros === undefined || micros === null || micros === "") return null;
  const n = typeof micros === "string" ? Number(micros) : micros;
  if (!Number.isFinite(n)) return null;
  return Math.round((n / 1_000_000) * 100) / 100;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const dryRun = args.includes("--dry-run") || !apply;
  let tcpa = DEFAULT_TCPA_HKD;
  const i = args.indexOf("--tcpa");
  if (i >= 0 && args[i + 1]) {
    const n = Number(args[i + 1]);
    if (!Number.isFinite(n) || n < 20 || n > 500) {
      throw new Error(`Invalid --tcpa ${args[i + 1]} (expect 20–500 HKD)`);
    }
    tcpa = n;
  }
  return { apply, dryRun, tcpa };
}

async function readSettings(env: Record<string, string>, token: string) {
  const rows = await gaql(
    env,
    token,
    `SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.bidding_strategy_type,
      campaign.maximize_conversions.target_cpa_micros,
      campaign_budget.amount_micros,
      campaign_budget.delivery_method
    FROM campaign
    WHERE campaign.id = ${CAMPAIGN_ID}`
  );
  const r = rows[0];
  if (!r) throw new Error(`Campaign ${CAMPAIGN_ID} not found`);
  return {
    name: r.campaign?.name as string,
    status: r.campaign?.status as string,
    bidding: r.campaign?.biddingStrategyType as string,
    tCpaHkd: microsToHkd(r.campaign?.maximizeConversions?.targetCpaMicros),
    budgetHkd: microsToHkd(r.campaignBudget?.amountMicros),
    delivery: r.campaignBudget?.deliveryMethod as string | undefined,
  };
}

async function main() {
  const { apply, dryRun, tcpa } = parseArgs();
  const targetMicros = String(Math.round(tcpa * 1_000_000));
  console.log(`Search #3 set tCPA → HK$${tcpa} (${dryRun ? "DRY-RUN validateOnly" : "LIVE APPLY"})`);
  console.log("Budget: UNCHANGED (last-resort lever only)\n");

  const env = await loadEnv();
  const token = await getAccessToken(env);
  console.log("oauth_ok: true");

  const before = await readSettings(env, token);
  console.log("settings_before:", JSON.stringify(before, null, 2));

  if (before.bidding && !String(before.bidding).includes("MAXIMIZE_CONVERSIONS")) {
    throw new Error(`Unexpected bidding strategy: ${before.bidding} (expected MAXIMIZE_CONVERSIONS)`);
  }

  const op = {
    update: {
      resourceName: CAMPAIGN_RN,
      maximizeConversions: {
        targetCpaMicros: targetMicros,
      },
    },
    updateMask: "maximizeConversions.targetCpaMicros",
  };

  const result = await mutateCampaigns(env, token, [op], dryRun);
  console.log(
    "mutate:",
    JSON.stringify(
      {
        validateOnly: dryRun,
        results: result.results,
        partialFailureError: result.partialFailureError ?? null,
      },
      null,
      2
    )
  );

  if (apply && !dryRun) {
    const after = await readSettings(env, token);
    console.log("settings_after:", JSON.stringify(after, null, 2));
    if (after.tCpaHkd !== tcpa) {
      console.warn(`WARN: expected tCPA HK$${tcpa}, got ${after.tCpaHkd}`);
    }
    if (after.budgetHkd !== before.budgetHkd) {
      throw new Error(`Budget changed unexpectedly: ${before.budgetHkd} → ${after.budgetHkd}`);
    }
    console.log("\nOK: tCPA applied; budget unchanged.");
  } else {
    console.log("\nDRY-RUN OK (no live change). Re-run with --apply to mutate.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
