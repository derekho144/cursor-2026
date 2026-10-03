/**
 * Limited restore for Search #3 → 活動攝影: Phrase keywords only.
 * Does not re-enable Broad volume drivers. No budget change.
 *
 *   npx tsx scripts/google-ads-restore-event-phrase.ts --dry-run
 *   npx tsx scripts/google-ads-restore-event-phrase.ts --apply
 */
import { readFileSync, writeFileSync } from "fs";
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
const EVENT_AD_GROUP_NAME = "活動攝影";

const PHRASE_TEXTS = [
  "活動攝影",
  "活動攝影師 香港",
  "公司活動攝影",
  "企業活動攝影",
  "corporate event photography hong kong",
  "研討會攝影",
  "開幕攝影",
];

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
  } catch { /* optional */ }
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
      console.warn(`[restore-event-phrase] DB refresh skip: ${String(e)}`);
    }
  }
  for (const k of keys) if (!env[k]) throw new Error(`Missing credential: ${k}`);
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
  const json = (await res.json()) as { access_token?: string };
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
  const json = (await res.json()) as { results?: any[] };
  if (!res.ok) throw new Error(`GAQL failed: ${JSON.stringify(json).slice(0, 1200)}`);
  return json.results ?? [];
}

async function mutate(
  env: Record<string, string>,
  token: string,
  operations: unknown[],
  validateOnly: boolean
) {
  const res = await fetch(
    `https://googleads.googleapis.com/${API_VERSION}/customers/${CUSTOMER_ID}/adGroupCriteria:mutate`,
    {
      method: "POST",
      headers: headers(env, token),
      body: JSON.stringify({ operations, partialFailure: true, validateOnly }),
    }
  );
  const json = await res.json();
  if (!res.ok) throw new Error(`mutate failed: ${JSON.stringify(json).slice(0, 2000)}`);
  return json as {
    results?: Array<{ resourceName?: string }>;
    partialFailureError?: { message?: string };
  };
}

async function main() {
  const dryRun = !process.argv.includes("--apply");
  console.log(`# Restore 活動攝影 Phrase (${dryRun ? "DRY-RUN" : "LIVE"})`);

  const env = await loadEnv();
  const token = await getAccessToken(env);

  const agRows = await gaql(
    env,
    token,
    `
    SELECT ad_group.id, ad_group.name, ad_group.resource_name, ad_group.status
    FROM ad_group
    WHERE campaign.id = ${CAMPAIGN_ID}
      AND ad_group.name = '${EVENT_AD_GROUP_NAME}'
      AND ad_group.status != 'REMOVED'
  `
  );
  if (!agRows.length) throw new Error("活動攝影 ad group not found");
  const ag = agRows[0].adGroup ?? agRows[0].ad_group;
  const adGroupId = String(ag.id);
  const adGroupRn = String(ag.resourceName ?? ag.resource_name);
  console.log(`Ad group ${adGroupId} status=${ag.status}`);

  const inList = PHRASE_TEXTS.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(", ");
  const kwRows = await gaql(
    env,
    token,
    `
    SELECT
      ad_group_criterion.resource_name,
      ad_group_criterion.status,
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type
    FROM keyword_view
    WHERE ad_group.id = ${adGroupId}
      AND ad_group_criterion.keyword.text IN (${inList})
      AND ad_group_criterion.status != 'REMOVED'
      AND ad_group_criterion.negative = FALSE
  `
  );

  type Row = { rn: string; status: string; text: string; match: string };
  const parsed: Row[] = kwRows.map((r) => {
    const c = r.adGroupCriterion ?? r.ad_group_criterion;
    const kw = c?.keyword ?? {};
    return {
      rn: String(c?.resourceName ?? c?.resource_name ?? ""),
      status: String(c?.status ?? ""),
      text: String(kw.text ?? ""),
      match: String(kw.matchType ?? kw.match_type ?? ""),
    };
  });
  console.log("Inventory:", parsed);

  const createOps: unknown[] = [];
  const updateOps: unknown[] = [];
  const plan: Array<Record<string, unknown>> = [];

  for (const text of PHRASE_TEXTS) {
    const phrase = parsed.find((p) => p.text === text && p.match === "PHRASE");
    if (phrase) {
      if (phrase.status === "ENABLED") {
        plan.push({ action: "skip_phrase_enabled", text });
      } else {
        updateOps.push({
          update: { resourceName: phrase.rn, status: "ENABLED" },
          updateMask: "status",
        });
        plan.push({ action: "enable_phrase", text, resource: phrase.rn });
      }
      continue;
    }
    createOps.push({
      create: {
        adGroup: adGroupRn,
        status: "ENABLED",
        keyword: { text, matchType: "PHRASE" },
      },
    });
    plan.push({ action: "create_phrase", text });
  }

  // Explicitly do NOT enable BROAD variants
  for (const p of parsed.filter((x) => x.match === "BROAD")) {
    plan.push({ action: "leave_broad_unchanged", text: p.text, status: p.status });
  }

  console.log("Plan:", JSON.stringify(plan, null, 2));
  const report: Record<string, unknown> = { mode: dryRun ? "dry-run" : "live", plan };

  if (updateOps.length) {
    const up = await mutate(env, token, updateOps, dryRun);
    report.update = up;
    console.log("Update:", JSON.stringify(up).slice(0, 800));
  }
  if (createOps.length) {
    const cr = await mutate(env, token, createOps, dryRun);
    report.create = cr;
    console.log("Create:", JSON.stringify(cr).slice(0, 800));
  }
  if (!updateOps.length && !createOps.length) console.log("Nothing to mutate");

  if (!dryRun) {
    const after = await gaql(
      env,
      token,
      `
      SELECT ad_group_criterion.status, ad_group_criterion.keyword.text,
             ad_group_criterion.keyword.match_type
      FROM keyword_view
      WHERE ad_group.id = ${adGroupId}
        AND ad_group_criterion.keyword.text IN (${inList})
        AND ad_group_criterion.status != 'REMOVED'
    `
    );
    report.verify = after.map((r) => {
      const c = r.adGroupCriterion ?? r.ad_group_criterion;
      const kw = c?.keyword ?? {};
      return `${c?.status} ${kw.matchType ?? kw.match_type} ${kw.text}`;
    });
    console.log("Verify:", report.verify);
  }

  try {
    writeFileSync("/opt/cursor/artifacts/event-phrase-restore-result.json", JSON.stringify(report, null, 2));
  } catch {
    writeFileSync("/tmp/event-phrase-restore-result.json", JSON.stringify(report, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
