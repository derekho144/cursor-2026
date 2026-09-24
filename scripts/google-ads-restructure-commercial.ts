/**
 * Restructure Search #3 ad group「商業攝影」toward advertising / fashion / ecommerce intent.
 *
 * 1. Pause non-ideal ENABLED positive keywords (generics, portrait, gear, etc.)
 * 2. Create PHRASE + EXACT positives for 廣告 / 時裝 / 電商
 * 3. Ensure ad-group PHRASE negatives for consumer / non-commercial intent
 *
 * Auth: requires GOOGLE_ADS_* env (or ~/.config/jd-studio/google-ads.env / DB refresh token).
 *
 *   npx tsx scripts/google-ads-restructure-commercial.ts --dry-run
 *   npx tsx scripts/google-ads-restructure-commercial.ts --apply
 */
import { readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CUSTOMER_ID = (process.env.GOOGLE_ADS_AD_ACCOUNT_ID ?? "4839352747").replace(/-/g, "");
const MCC_ID = (process.env.GOOGLE_ADS_CUSTOMER_ID ?? process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? "9876630892").replace(
  /-/g,
  ""
);
const API_VERSION = "v23";
const CAMPAIGN_ID = "24002224927";
const AD_GROUP_NAME = "商業攝影";
/** Known id from prior Manus apply; resolved dynamically by name when possible. */
const FALLBACK_AD_GROUP_ID = "203224222252";

/** Pause if ENABLED positive and text matches (case-insensitive for Latin). */
const PAUSE_TEXTS = [
  "專業攝影服務",
  "professional photographer hong kong",
  "攝影報價",
  "二手攝影",
  "人像攝影",
  "免費攝影",
  "相機",
  "風景攝影",
  "professional photography",
  "professional photographer",
  "portrait photography",
  "landscape photography",
  "香港攝影師",
  "商業攝影師",
];

/** Ideal intent — create both PHRASE and EXACT. */
const ADD_KEYWORDS = [
  "廣告攝影",
  "廣告拍攝",
  "廣告製作",
  "advertising photography",
  "advertising production",
  "廣告宣傳攝影",
  "時裝拍攝",
  "時裝攝影",
  "fashion photography",
  "fashion shoot",
  "fashion photography hong kong",
  "電商攝影",
  "電商拍攝",
  "網店攝影",
  "ecommerce photography",
  "e-commerce photography",
  "product ecommerce photography",
];

/** Ad-group PHRASE negatives (consumer / wrong-intent). */
const AG_NEGATIVES = [
  "人像",
  "風景",
  "婚紗",
  "婚禮",
  "寶寶",
  "兒童",
  "證件",
  "護照",
  "相機",
  "二手",
  "免費",
  "自學",
  "課程",
  "求職",
  "portrait",
  "wedding",
  "baby",
  "passport",
];

type KwRow = {
  resourceName: string;
  criterionId: string;
  adGroupId: string;
  text: string;
  matchType: string;
  status: string;
  negative: boolean;
};

function norm(s: string) {
  return s.trim().toLowerCase();
}

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
      console.warn(`[restructure-commercial] DB refresh skip: ${String(e)}`);
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
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error(`OAuth failed: ${JSON.stringify(json)}`);
  return json.access_token;
}

async function search(env: Record<string, string>, token: string, query: string) {
  const url = `https://googleads.googleapis.com/${API_VERSION}/customers/${CUSTOMER_ID}/googleAds:searchStream`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "developer-token": env.GOOGLE_ADS_DEVELOPER_TOKEN,
      "login-customer-id": MCC_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text);
  // searchStream returns NDJSON / JSON array of chunks
  const results: any[] = [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      for (const chunk of parsed) {
        if (Array.isArray(chunk.results)) results.push(...chunk.results);
        else if (chunk.results) results.push(...chunk.results);
      }
    } else if (parsed.results) {
      results.push(...parsed.results);
    }
  } catch {
    for (const line of text.split("\n")) {
      const s = line.trim();
      if (!s) continue;
      try {
        const chunk = JSON.parse(s);
        if (Array.isArray(chunk.results)) results.push(...chunk.results);
        else if (chunk.results) results.push(...chunk.results);
      } catch {
        /* skip */
      }
    }
  }
  return results;
}

async function mutateCriteria(
  env: Record<string, string>,
  token: string,
  operations: unknown[],
  dryRun: boolean
) {
  if (operations.length === 0) {
    return { results: [], partialFailureError: undefined };
  }
  const url = `https://googleads.googleapis.com/${API_VERSION}/customers/${CUSTOMER_ID}/adGroupCriteria:mutate`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "developer-token": env.GOOGLE_ADS_DEVELOPER_TOKEN,
      "login-customer-id": MCC_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      operations,
      partialFailure: true,
      validateOnly: dryRun,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json, null, 2));
  return json as {
    results?: Array<{ resourceName?: string }>;
    partialFailureError?: { message?: string };
  };
}

function mapCriterion(r: any): KwRow {
  const c = r.adGroupCriterion ?? r.ad_group_criterion;
  const ag = r.adGroup ?? r.ad_group;
  const kw = c?.keyword ?? {};
  return {
    resourceName: String(c?.resourceName ?? c?.resource_name ?? ""),
    criterionId: String(c?.criterionId ?? c?.criterion_id ?? ""),
    adGroupId: String(ag?.id ?? ""),
    text: String(kw.text ?? ""),
    matchType: String(kw.matchType ?? kw.match_type ?? ""),
    status: String(c?.status ?? ""),
    negative: Boolean(c?.negative ?? false),
  };
}

async function resolveAdGroupId(env: Record<string, string>, token: string): Promise<string> {
  const query = `
    SELECT ad_group.id, ad_group.name, ad_group.status
    FROM ad_group
    WHERE campaign.id = ${CAMPAIGN_ID}
      AND ad_group.name = '${AD_GROUP_NAME}'
      AND ad_group.status != 'REMOVED'
  `;
  const rows = await search(env, token, query);
  const id = rows[0]?.adGroup?.id ?? rows[0]?.ad_group?.id;
  if (id) return String(id);
  console.warn(`Ad group name lookup failed; using fallback ${FALLBACK_AD_GROUP_ID}`);
  return FALLBACK_AD_GROUP_ID;
}

async function listCriteria(env: Record<string, string>, token: string, adGroupId: string): Promise<KwRow[]> {
  const query = `
    SELECT
      ad_group_criterion.resource_name,
      ad_group_criterion.criterion_id,
      ad_group_criterion.status,
      ad_group_criterion.negative,
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      ad_group.id,
      ad_group.name
    FROM ad_group_criterion
    WHERE ad_group.id = ${adGroupId}
      AND ad_group_criterion.type = 'KEYWORD'
      AND ad_group_criterion.status != 'REMOVED'
  `;
  const rows = await search(env, token, query);
  return rows.map(mapCriterion);
}

function buildPauseOps(rows: KwRow[]) {
  const pauseSet = new Set(PAUSE_TEXTS.map(norm));
  const ops: unknown[] = [];
  const paused: KwRow[] = [];
  for (const row of rows) {
    if (row.negative) continue;
    if (row.status !== "ENABLED") continue;
    if (!pauseSet.has(norm(row.text))) continue;
    ops.push({
      update: {
        resourceName: row.resourceName,
        status: "PAUSED",
      },
      updateMask: "status",
    });
    paused.push(row);
  }
  return { ops, paused };
}

function buildCreateKeywordOps(adGroupRn: string, existing: KwRow[]) {
  const have = new Set(
    existing.filter((r) => !r.negative).map((r) => `${norm(r.text)}|${r.matchType}`)
  );
  const ops: unknown[] = [];
  const planned: Array<{ text: string; matchType: string }> = [];
  for (const text of ADD_KEYWORDS) {
    for (const matchType of ["PHRASE", "EXACT"] as const) {
      const key = `${norm(text)}|${matchType}`;
      if (have.has(key)) continue;
      ops.push({
        create: {
          adGroup: adGroupRn,
          status: "ENABLED",
          negative: false,
          keyword: { text, matchType },
        },
      });
      planned.push({ text, matchType });
    }
  }
  return { ops, planned };
}

function buildNegativeOps(adGroupRn: string, existing: KwRow[]) {
  const have = new Set(
    existing
      .filter((r) => r.negative && r.matchType === "PHRASE")
      .map((r) => norm(r.text))
  );
  const ops: unknown[] = [];
  const planned: string[] = [];
  for (const text of AG_NEGATIVES) {
    if (have.has(norm(text))) continue;
    ops.push({
      create: {
        adGroup: adGroupRn,
        status: "ENABLED",
        negative: true,
        keyword: { text, matchType: "PHRASE" },
      },
    });
    planned.push(text);
  }
  return { ops, planned };
}

function table(rows: string[][]) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
  return rows
    .map((r) => "| " + r.map((c, i) => (c ?? "").padEnd(widths[i])).join(" | ") + " |")
    .join("\n");
}

async function main() {
  const dryRun = process.argv.includes("--dry-run") || !process.argv.includes("--apply");
  if (!process.argv.includes("--apply") && !process.argv.includes("--dry-run")) {
    console.log("No --apply flag: defaulting to --dry-run. Pass --apply for LIVE mutations.\n");
  }

  const env = await loadEnv();
  const token = await getAccessToken(env);
  const adGroupId = await resolveAdGroupId(env, token);
  const adGroupRn = `customers/${CUSTOMER_ID}/adGroups/${adGroupId}`;

  console.log(`# Restructure ${AD_GROUP_NAME} (${dryRun ? "DRY-RUN" : "LIVE"})`);
  console.log(`Campaign ${CAMPAIGN_ID} → ad group ${adGroupId}\n`);

  const before = await listCriteria(env, token, adGroupId);
  const positives = before.filter((r) => !r.negative);
  const negatives = before.filter((r) => r.negative);

  console.log(`## Before: ${positives.length} positives, ${negatives.length} negatives\n`);
  console.log(
    table([
      ["text", "match", "status", "neg"],
      ...positives
        .filter((r) => r.status === "ENABLED")
        .map((r) => [r.text, r.matchType, r.status, String(r.negative)]),
    ])
  );
  console.log("");

  const pause = buildPauseOps(before);
  const createKw = buildCreateKeywordOps(adGroupRn, before);
  const createNeg = buildNegativeOps(adGroupRn, before);

  console.log(`## Plan`);
  console.log(`- Pause positives: ${pause.paused.length}`);
  for (const p of pause.paused) console.log(`  · ${p.text} (${p.matchType})`);
  console.log(`- Create keywords: ${createKw.planned.length}`);
  for (const p of createKw.planned) console.log(`  · ${p.text} (${p.matchType})`);
  console.log(`- Create AG PHRASE negatives: ${createNeg.planned.length}`);
  for (const t of createNeg.planned) console.log(`  · ${t}`);
  console.log("");

  const allOps = [...pause.ops, ...createKw.ops, ...createNeg.ops];
  console.log(`Total mutate ops: ${allOps.length}`);

  const result = await mutateCriteria(env, token, allOps, dryRun);
  const ok = result.results?.filter((r) => r.resourceName).length ?? 0;
  console.log(`Mutate OK (with resourceName): ${ok}/${allOps.length}`);
  if (result.partialFailureError) {
    console.log("Partial failure:", JSON.stringify(result.partialFailureError, null, 2).slice(0, 3000));
  }

  const after = dryRun ? before : await listCriteria(env, token, adGroupId);
  const afterPos = after.filter((r) => !r.negative && r.status === "ENABLED");
  const afterNeg = after.filter((r) => r.negative && r.status === "ENABLED");

  const verifyPause = PAUSE_TEXTS.map((t) => {
    const hits = after.filter((r) => !r.negative && norm(r.text) === norm(t));
    const statuses = hits.map((h) => `${h.matchType}:${h.status}`).join(", ") || "(not present as positive)";
    return [t, statuses];
  });

  const verifyAdd = ADD_KEYWORDS.map((t) => {
    const phrase = after.find((r) => !r.negative && norm(r.text) === norm(t) && r.matchType === "PHRASE");
    const exact = after.find((r) => !r.negative && norm(r.text) === norm(t) && r.matchType === "EXACT");
    return [t, phrase ? phrase.status : "missing", exact ? exact.status : "missing"];
  });

  const verifyNeg = AG_NEGATIVES.map((t) => {
    const hit = after.find((r) => r.negative && norm(r.text) === norm(t) && r.matchType === "PHRASE");
    return [t, hit ? hit.status : "missing"];
  });

  const report = [
    `# Commercial ad group restructure (${dryRun ? "DRY-RUN" : "LIVE"})`,
    "",
    `Ad group: ${AD_GROUP_NAME} (${adGroupId})`,
    `Enabled positives after: ${afterPos.length}; enabled negatives: ${afterNeg.length}`,
    "",
    "## Pause verification",
    table([["keyword", "positive statuses"], ...verifyPause]),
    "",
    "## Add verification (PHRASE / EXACT)",
    table([["keyword", "PHRASE", "EXACT"], ...verifyAdd]),
    "",
    "## Negative verification (PHRASE)",
    table([["negative", "status"], ...verifyNeg]),
    "",
  ].join("\n");

  console.log("\n" + report);
  const out = process.env.REPORT_PATH ?? "/opt/cursor/artifacts/commercial-kw-restructure-result.txt";
  try {
    writeFileSync(out, report, "utf8");
    console.log(`Wrote ${out}`);
  } catch (e) {
    console.warn(`Could not write report: ${e}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
