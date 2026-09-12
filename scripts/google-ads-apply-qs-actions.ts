/**
 * Apply QS remediation: pause wasteful keywords + lower max CPC on keepers.
 *
 * Auth: user confirmed 2026-09-12.
 *
 *   npx tsx scripts/google-ads-apply-qs-actions.ts --dry-run
 *   npx tsx scripts/google-ads-apply-qs-actions.ts --apply
 */
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CUSTOMER_ID = (process.env.GOOGLE_ADS_AD_ACCOUNT_ID ?? "4839352747").replace(/-/g, "");
const MCC_ID = (process.env.GOOGLE_ADS_CUSTOMER_ID ?? "9876630892").replace(/-/g, "");
const API_VERSION = "v23";

/** Exact keyword text match (trimmed, case-insensitive for Latin). */
const PAUSE_TEXTS = [
  "product photography",
  "香港攝影師",
  "餐牌設計",
  "餐單設計",
  "菜單設計",
  "restaurant menu design",
];

/** Target max CPC in HKD for ENABLED keepers. */
const BID_HKD: Record<string, number> = {
  產品拍攝: 7.0,
  商品攝影: 10.0,
  食物攝影: 9.0,
  美食攝影: 5.0,
};

type KwRow = {
  resourceName: string;
  criterionId: string;
  adGroupId: string;
  adGroupName: string;
  text: string;
  matchType: string;
  status: string;
  cpcBidMicros: number | null;
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
      console.warn(`[apply-qs-actions] DB refresh skip: ${String(e)}`);
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
  const url = `https://googleads.googleapis.com/${API_VERSION}/customers/${CUSTOMER_ID}/googleAds:search`;
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
  const json = (await res.json()) as { results?: any[]; error?: unknown };
  if (!res.ok) throw new Error(JSON.stringify(json, null, 2));
  return json.results ?? [];
}

async function mutateCriteria(
  env: Record<string, string>,
  token: string,
  operations: unknown[],
  dryRun: boolean
) {
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

async function listTargetKeywords(env: Record<string, string>, token: string): Promise<KwRow[]> {
  const texts = [...PAUSE_TEXTS, ...Object.keys(BID_HKD)];
  const inList = texts.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(", ");
  const query = `
    SELECT
      ad_group_criterion.resource_name,
      ad_group_criterion.criterion_id,
      ad_group_criterion.status,
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      ad_group_criterion.cpc_bid_micros,
      ad_group.id,
      ad_group.name
    FROM keyword_view
    WHERE ad_group_criterion.keyword.text IN (${inList})
      AND campaign.status != 'REMOVED'
      AND ad_group.status != 'REMOVED'
      AND ad_group_criterion.status != 'REMOVED'
  `;
  const rows = await search(env, token, query);
  return rows.map((r) => {
    const c = r.adGroupCriterion ?? r.ad_group_criterion;
    const ag = r.adGroup ?? r.ad_group;
    const kw = c?.keyword ?? {};
    return {
      resourceName: String(c?.resourceName ?? c?.resource_name ?? ""),
      criterionId: String(c?.criterionId ?? c?.criterion_id ?? ""),
      adGroupId: String(ag?.id ?? ""),
      adGroupName: String(ag?.name ?? ""),
      text: String(kw.text ?? ""),
      matchType: String(kw.matchType ?? kw.match_type ?? ""),
      status: String(c?.status ?? ""),
      cpcBidMicros:
        c?.cpcBidMicros != null || c?.cpc_bid_micros != null
          ? Number(c?.cpcBidMicros ?? c?.cpc_bid_micros)
          : null,
    };
  });
}

function buildOperations(rows: KwRow[]) {
  const pauseSet = new Set(PAUSE_TEXTS.map(norm));
  const ops: unknown[] = [];
  const plan: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    const key = norm(row.text);
    const pause = pauseSet.has(key);
    const bidHkd = BID_HKD[row.text] ?? BID_HKD[Object.keys(BID_HKD).find((k) => norm(k) === key) ?? ""];

    if (pause) {
      if (row.status === "PAUSED") {
        plan.push({ action: "skip_already_paused", text: row.text, matchType: row.matchType, resource: row.resourceName });
        continue;
      }
      ops.push({
        update: {
          resourceName: row.resourceName,
          status: "PAUSED",
        },
        updateMask: "status",
      });
      plan.push({
        action: "pause",
        text: row.text,
        matchType: row.matchType,
        adGroup: row.adGroupName,
        fromStatus: row.status,
        resource: row.resourceName,
      });
      continue;
    }

    if (bidHkd != null) {
      const micros = Math.round(bidHkd * 1_000_000);
      const cur = row.cpcBidMicros;
      if (cur != null && cur === micros && row.status === "ENABLED") {
        plan.push({
          action: "skip_bid_unchanged",
          text: row.text,
          matchType: row.matchType,
          cpcHkd: bidHkd,
          resource: row.resourceName,
        });
        continue;
      }
      ops.push({
        update: {
          resourceName: row.resourceName,
          cpcBidMicros: micros,
          status: "ENABLED",
        },
        updateMask: "cpc_bid_micros,status",
      });
      plan.push({
        action: "set_bid",
        text: row.text,
        matchType: row.matchType,
        adGroup: row.adGroupName,
        fromMicros: cur,
        toHkd: bidHkd,
        toMicros: micros,
        resource: row.resourceName,
      });
    }
  }

  return { ops, plan };
}

async function main() {
  const dryRun = !process.argv.includes("--apply");
  if (!dryRun && !process.argv.includes("--apply")) {
    throw new Error("Refuse live run without --apply");
  }

  const env = await loadEnv();
  const token = await getAccessToken(env);
  const rows = await listTargetKeywords(env, token);
  console.log(`Matched keyword rows: ${rows.length}`);
  for (const r of rows) {
    console.log(
      `  [${r.status}] ${r.matchType} "${r.text}" ag=${r.adGroupName} cpc=${
        r.cpcBidMicros != null ? (r.cpcBidMicros / 1e6).toFixed(2) : "—"
      } ${r.resourceName}`
    );
  }

  const foundTexts = new Set(rows.map((r) => norm(r.text)));
  for (const t of [...PAUSE_TEXTS, ...Object.keys(BID_HKD)]) {
    if (![...foundTexts].some((f) => f === norm(t))) {
      console.warn(`WARNING: keyword not found in account: "${t}"`);
    }
  }

  const { ops, plan } = buildOperations(rows);
  console.log(`\nPlan (${dryRun ? "DRY-RUN validateOnly" : "LIVE APPLY"}):`);
  console.log(JSON.stringify(plan, null, 2));
  console.log(`Operations: ${ops.length}`);

  if (ops.length === 0) {
    console.log("Nothing to mutate.");
    return;
  }

  const result = await mutateCriteria(env, token, ops, dryRun);
  const ok = result.results?.filter((r) => r.resourceName).length ?? 0;
  console.log(`\nMutate OK: ${ok}/${ops.length}`);
  if (result.partialFailureError) {
    console.log("Partial failure:", JSON.stringify(result.partialFailureError, null, 2).slice(0, 4000));
  }

  if (!dryRun) {
    const after = await listTargetKeywords(env, token);
    console.log("\n# Verification");
    for (const r of after) {
      console.log(
        `  [${r.status}] ${r.matchType} "${r.text}" cpc=${
          r.cpcBidMicros != null ? (r.cpcBidMicros / 1e6).toFixed(2) : "—"
        }`
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
