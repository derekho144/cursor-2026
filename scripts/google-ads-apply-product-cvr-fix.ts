/**
 * Apply Search #3 → 產品攝影 CVR remediation (authorized 2026-09-29).
 *
 * Scope (no new campaign, no budget/tCPA change):
 *   1. Campaign phrase negatives for video/edit mismatch queries
 *   2. Tighten low-QS product keywords BROAD → PHRASE (remove+create)
 *   3. Add one product-aligned RSA (keep existing ENABLED RSAs)
 *
 *   npx tsx scripts/google-ads-apply-product-cvr-fix.ts --dry-run
 *   npx tsx scripts/google-ads-apply-product-cvr-fix.ts --apply
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
const CAMPAIGN_RN = `customers/${CUSTOMER_ID}/campaigns/${CAMPAIGN_ID}`;
const PRODUCT_AD_GROUP_ID = "203224222492";
const PRODUCT_AD_GROUP_RN = `customers/${CUSTOMER_ID}/adGroups/${PRODUCT_AD_GROUP_ID}`;
const FINAL_URL = "https://www.jdstudiohk.com/services/product-photography";

/** Phrase negatives for video / editing intent (campaign-level). */
const VIDEO_NEGATIVES = [
  "影片拍攝報價",
  "剪片公司",
  "短片製作",
  "剪片",
  "剪輯",
  "影片製作",
  "videographer",
  "video production",
  "video editing",
  "freelance videographer",
];

/** Product ad-group BROAD keywords to replace with PHRASE. */
const TIGHTEN_TEXTS = ["產品拍攝", "商品攝影", "產品攝影"];

/** Avoid full-width ｜ (Symbols policy). CJK width ≈ 2. */
export const PRODUCT_RSA = {
  headlines: [
    "產品攝影 - 香港專業",
    "白底產品攝影報價",
    "WhatsApp即日報價",
    "電商產品拍攝香港",
    "網店產品圖專業拍",
    "JD Studio產品攝影",
    "商品攝影即日出圖",
    "產品拍攝專業燈光",
    "品牌產品影像香港",
    "SKU白底圖拍攝",
    "Product Photo HK",
    "Ecom Product Shot",
    "透明收費快速交付",
    "香港產品攝影師",
    "免費獲取拍攝報價",
  ],
  descriptions: [
    "專業產品及商品攝影：白底電商圖、品牌產品與SKU拍攝。香港本地團隊，高質燈光，快速交付。",
    "JD Studio 產品攝影，服務香港800+企業。透明收費，WhatsApp即日報價，歡迎查詢拍攝方案。",
    "網店、品牌與產品目錄拍攝。專業器材燈光，適合電商上架、廣告及宣傳用途。",
    "Product photography in Hong Kong. E-commerce, brand & catalogue specialists.",
  ],
  path1: "services",
  path2: "product",
};

type Report = Record<string, unknown>;

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
      console.warn(`[product-cvr-fix] DB refresh skip: ${String(e)}`);
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

async function mutate(
  env: Record<string, string>,
  token: string,
  service: string,
  operations: unknown[],
  validateOnly: boolean
) {
  const res = await fetch(
    `https://googleads.googleapis.com/${API_VERSION}/customers/${CUSTOMER_ID}/${service}:mutate`,
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
  if (!res.ok) throw new Error(`${service} mutate failed: ${JSON.stringify(json).slice(0, 2000)}`);
  return json as {
    results?: Array<{ resourceName?: string }>;
    partialFailureError?: { message?: string; details?: unknown[] };
  };
}

function adsWidth(s: string) {
  let n = 0;
  for (const c of s) n += c.codePointAt(0)! > 0x7f ? 2 : 1;
  return n;
}

function assertCopyLimits() {
  for (const h of PRODUCT_RSA.headlines) {
    if (adsWidth(h) > 30) throw new Error(`Headline too long (${adsWidth(h)}): ${h}`);
    if (h.includes("｜") || h.includes("|")) throw new Error(`Forbidden pipe in headline: ${h}`);
  }
  for (const d of PRODUCT_RSA.descriptions) {
    if (adsWidth(d) > 90) throw new Error(`Description too long (${adsWidth(d)}): ${d}`);
  }
}

async function applyNegatives(
  env: Record<string, string>,
  token: string,
  dryRun: boolean,
  report: Report
) {
  const existing = await gaql(
    env,
    token,
    `
    SELECT campaign_criterion.keyword.text, campaign_criterion.keyword.match_type,
           campaign_criterion.negative, campaign_criterion.status
    FROM campaign_criterion
    WHERE campaign.id = ${CAMPAIGN_ID}
      AND campaign_criterion.type = 'KEYWORD'
      AND campaign_criterion.negative = TRUE
      AND campaign_criterion.status != 'REMOVED'
  `
  );
  const have = new Set(
    existing.map((r) => {
      const kw = r.campaignCriterion?.keyword ?? r.campaign_criterion?.keyword ?? {};
      return String(kw.text ?? "")
        .trim()
        .toLowerCase();
    })
  );

  const toCreate = VIDEO_NEGATIVES.filter((t) => !have.has(t.toLowerCase()));
  report.negatives_already = VIDEO_NEGATIVES.filter((t) => have.has(t.toLowerCase()));
  report.negatives_to_create = toCreate;

  if (!toCreate.length) {
    console.log("Negatives: all already present");
    report.negatives_created = [];
    return;
  }

  const ops = toCreate.map((text) => ({
    create: {
      campaign: CAMPAIGN_RN,
      negative: true,
      keyword: { text, matchType: "PHRASE" },
    },
  }));
  console.log(`Negatives: ${dryRun ? "validate" : "create"} ${ops.length}`);
  const result = await mutate(env, token, "campaignCriteria", ops, dryRun);
  report.negatives_mutate = {
    ok: result.results?.filter((r) => r.resourceName).length ?? 0,
    partial: result.partialFailureError?.message ?? null,
    resources: result.results?.map((r) => r.resourceName).filter(Boolean) ?? [],
  };
  if (result.partialFailureError) {
    console.log("Negatives partial:", JSON.stringify(result.partialFailureError).slice(0, 1500));
  }
}

async function tightenKeywords(
  env: Record<string, string>,
  token: string,
  dryRun: boolean,
  report: Report
) {
  const inList = TIGHTEN_TEXTS.map((t) => `"${t}"`).join(", ");
  const rows = await gaql(
    env,
    token,
    `
    SELECT
      ad_group_criterion.resource_name,
      ad_group_criterion.status,
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      ad_group_criterion.cpc_bid_micros
    FROM keyword_view
    WHERE ad_group.id = ${PRODUCT_AD_GROUP_ID}
      AND ad_group_criterion.keyword.text IN (${inList})
      AND ad_group_criterion.status != 'REMOVED'
      AND ad_group_criterion.negative = FALSE
  `
  );

  const parsed = rows.map((r) => {
    const c = r.adGroupCriterion ?? r.ad_group_criterion;
    const kw = c?.keyword ?? {};
    return {
      resourceName: String(c?.resourceName ?? c?.resource_name ?? ""),
      status: String(c?.status ?? ""),
      text: String(kw.text ?? ""),
      matchType: String(kw.matchType ?? kw.match_type ?? ""),
      cpcBidMicros:
        c?.cpcBidMicros != null || c?.cpc_bid_micros != null
          ? Number(c?.cpcBidMicros ?? c?.cpc_bid_micros)
          : null,
    };
  });
  report.keyword_inventory = parsed;

  const removeOps: unknown[] = [];
  const createOps: unknown[] = [];
  const updateOps: unknown[] = [];
  const plan: Array<Record<string, unknown>> = [];
  const phraseCreateQueued = new Set<string>();

  for (const text of TIGHTEN_TEXTS) {
    const variants = parsed.filter((p) => p.text === text);
    const broadEnabled = variants.filter((p) => p.matchType === "BROAD" && p.status === "ENABLED");
    const phrase = variants.find((p) => p.matchType === "PHRASE");

    for (const b of broadEnabled) {
      removeOps.push({ remove: b.resourceName });
      plan.push({ action: "remove_broad", text, resource: b.resourceName });
    }

    if (broadEnabled.length) {
      if (phrase) {
        if (phrase.status !== "ENABLED") {
          updateOps.push({
            update: { resourceName: phrase.resourceName, status: "ENABLED" },
            updateMask: "status",
          });
          plan.push({ action: "enable_existing_phrase", text, resource: phrase.resourceName });
        } else {
          plan.push({ action: "phrase_already_ok", text });
        }
      } else if (!phraseCreateQueued.has(text)) {
        const bid = broadEnabled.find((b) => b.cpcBidMicros != null)?.cpcBidMicros ?? null;
        const create: Record<string, unknown> = {
          adGroup: PRODUCT_AD_GROUP_RN,
          status: "ENABLED",
          keyword: { text, matchType: "PHRASE" },
        };
        if (bid != null) create.cpcBidMicros = bid;
        createOps.push({ create });
        phraseCreateQueued.add(text);
        plan.push({ action: "create_phrase", text, cpcBidMicros: bid });
      }
    } else {
      plan.push({
        action: "no_enabled_broad",
        text,
        variants: variants.map((v) => `${v.matchType}:${v.status}`),
      });
    }
  }

  report.keyword_plan = plan;
  console.log("Keyword plan:", JSON.stringify(plan, null, 2));

  // Separate mutate calls: remove → create → update
  if (removeOps.length) {
    console.log(`Keywords: ${dryRun ? "validate" : "remove"} ${removeOps.length} BROAD`);
    const rem = await mutate(env, token, "adGroupCriteria", removeOps, dryRun);
    report.keyword_remove = {
      ok: rem.results?.filter((r) => r.resourceName).length ?? 0,
      partial: rem.partialFailureError?.message ?? null,
    };
    if (rem.partialFailureError) {
      console.log("Remove partial:", JSON.stringify(rem.partialFailureError).slice(0, 1500));
    }
  }

  if (createOps.length) {
    console.log(`Keywords: ${dryRun ? "validate" : "create"} ${createOps.length} PHRASE`);
    const cr = await mutate(env, token, "adGroupCriteria", createOps, dryRun);
    report.keyword_create = {
      ok: cr.results?.filter((r) => r.resourceName).length ?? 0,
      partial: cr.partialFailureError?.message ?? null,
      resources: cr.results?.map((r) => r.resourceName).filter(Boolean) ?? [],
    };
    if (cr.partialFailureError) {
      console.log("Create partial:", JSON.stringify(cr.partialFailureError).slice(0, 1500));
    }
  }

  if (updateOps.length) {
    console.log(`Keywords: ${dryRun ? "validate" : "enable"} ${updateOps.length} PHRASE`);
    const up = await mutate(env, token, "adGroupCriteria", updateOps, dryRun);
    report.keyword_update = {
      ok: up.results?.filter((r) => r.resourceName).length ?? 0,
      partial: up.partialFailureError?.message ?? null,
    };
    if (up.partialFailureError) {
      console.log("Update partial:", JSON.stringify(up.partialFailureError).slice(0, 1500));
    }
  }

  if (!removeOps.length && !createOps.length && !updateOps.length) {
    console.log("Keywords: nothing to tighten");
  }
}

async function addProductRsa(
  env: Record<string, string>,
  token: string,
  dryRun: boolean,
  report: Report
) {
  const existing = await gaql(
    env,
    token,
    `
    SELECT
      ad_group_ad.resource_name,
      ad_group_ad.status,
      ad_group_ad.ad.id,
      ad_group_ad.ad.responsive_search_ad.headlines,
      ad_group_ad.ad.final_urls
    FROM ad_group_ad
    WHERE ad_group.id = ${PRODUCT_AD_GROUP_ID}
      AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
      AND ad_group_ad.status != 'REMOVED'
  `
  );
  report.existing_rsas = existing.map((r) => {
    const a = r.adGroupAd ?? r.ad_group_ad;
    const ad = a?.ad ?? {};
    const rsa = ad.responsiveSearchAd ?? ad.responsive_search_ad ?? {};
    const headlines = (rsa.headlines ?? []).map((h: any) => h.text).slice(0, 3);
    return {
      resourceName: a?.resourceName ?? a?.resource_name,
      status: a?.status,
      adId: ad.id,
      headlines,
      finalUrls: ad.finalUrls ?? ad.final_urls,
    };
  });

  // Skip create if an ENABLED RSA already has our pinned H1 (idempotent re-run)
  const already = (report.existing_rsas as any[]).some(
    (r) =>
      r.status === "ENABLED" &&
      Array.isArray(r.headlines) &&
      r.headlines.includes(PRODUCT_RSA.headlines[0])
  );
  if (already) {
    console.log("RSA: matching ENABLED ad already present — skip create");
    report.rsa_skipped = true;
    return;
  }

  const createOp = {
    create: {
      adGroup: PRODUCT_AD_GROUP_RN,
      status: "ENABLED",
      ad: {
        responsiveSearchAd: {
          headlines: PRODUCT_RSA.headlines.map((text, i) =>
            i < 3 ? { text, pinnedField: `HEADLINE_${i + 1}` } : { text }
          ),
          descriptions: PRODUCT_RSA.descriptions.map((text) => ({ text })),
          path1: PRODUCT_RSA.path1,
          path2: PRODUCT_RSA.path2,
        },
        finalUrls: [FINAL_URL],
      },
    },
  };

  console.log(`RSA: ${dryRun ? "validate" : "create"} product-aligned ad (keep old ENABLED)`);
  const result = await mutate(env, token, "adGroupAds", [createOp], dryRun);
  report.rsa_mutate = {
    ok: result.results?.filter((r) => r.resourceName).length ?? 0,
    partial: result.partialFailureError?.message ?? null,
    resources: result.results?.map((r) => r.resourceName).filter(Boolean) ?? [],
  };
  if (result.partialFailureError) {
    console.log("RSA partial:", JSON.stringify(result.partialFailureError).slice(0, 2000));
  }
}

async function verify(env: Record<string, string>, token: string, report: Report) {
  const negs = await gaql(
    env,
    token,
    `
    SELECT campaign_criterion.keyword.text, campaign_criterion.keyword.match_type
    FROM campaign_criterion
    WHERE campaign.id = ${CAMPAIGN_ID}
      AND campaign_criterion.negative = TRUE
      AND campaign_criterion.status != 'REMOVED'
      AND campaign_criterion.keyword.text IN (${VIDEO_NEGATIVES.map((t) => `"${t}"`).join(", ")})
  `
  );
  report.verify_negatives = negs.map((r) => {
    const kw = r.campaignCriterion?.keyword ?? r.campaign_criterion?.keyword ?? {};
    return `${kw.matchType ?? kw.match_type}:${kw.text}`;
  });

  const kws = await gaql(
    env,
    token,
    `
    SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
           ad_group_criterion.status
    FROM keyword_view
    WHERE ad_group.id = ${PRODUCT_AD_GROUP_ID}
      AND ad_group_criterion.keyword.text IN (${TIGHTEN_TEXTS.map((t) => `"${t}"`).join(", ")})
      AND ad_group_criterion.status != 'REMOVED'
  `
  );
  report.verify_keywords = kws.map((r) => {
    const c = r.adGroupCriterion ?? r.ad_group_criterion;
    const kw = c?.keyword ?? {};
    return `${c?.status} ${kw.matchType ?? kw.match_type} ${kw.text}`;
  });

  const ads = await gaql(
    env,
    token,
    `
    SELECT ad_group_ad.resource_name, ad_group_ad.status,
           ad_group_ad.ad.responsive_search_ad.headlines,
           ad_group_ad.ad.final_urls
    FROM ad_group_ad
    WHERE ad_group.id = ${PRODUCT_AD_GROUP_ID}
      AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
      AND ad_group_ad.status = 'ENABLED'
  `
  );
  report.verify_enabled_rsas = ads.map((r) => {
    const a = r.adGroupAd ?? r.ad_group_ad;
    const ad = a?.ad ?? {};
    const rsa = ad.responsiveSearchAd ?? ad.responsive_search_ad ?? {};
    return {
      resourceName: a?.resourceName ?? a?.resource_name,
      headlines: (rsa.headlines ?? []).map((h: any) => h.text).slice(0, 5),
      finalUrls: ad.finalUrls ?? ad.final_urls,
    };
  });
}

async function main() {
  const dryRun = !process.argv.includes("--apply");
  assertCopyLimits();

  console.log(`# Product CVR fix (${dryRun ? "DRY-RUN validateOnly" : "LIVE APPLY"})`);
  console.log(`Campaign ${CAMPAIGN_ID} · Ad group 產品攝影 ${PRODUCT_AD_GROUP_ID}`);
  console.log(`Final URL: ${FINAL_URL}`);
  console.log("Budget/tCPA: unchanged\n");

  const env = await loadEnv();
  const token = await getAccessToken(env);
  const report: Report = {
    mode: dryRun ? "dry-run" : "live",
    at: new Date().toISOString(),
    customer: CUSTOMER_ID,
  };

  await applyNegatives(env, token, dryRun, report);
  await tightenKeywords(env, token, dryRun, report);
  await addProductRsa(env, token, dryRun, report);

  if (!dryRun) {
    await verify(env, token, report);
  }

  const out = "/opt/cursor/artifacts/product-cvr-ads-fix-result.json";
  try {
    writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(`\nWrote ${out}`);
  } catch {
    writeFileSync("/tmp/product-cvr-ads-fix-result.json", JSON.stringify(report, null, 2));
    console.log("\nWrote /tmp/product-cvr-ads-fix-result.json");
  }
  console.log(JSON.stringify(report, null, 2).slice(0, 6000));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
