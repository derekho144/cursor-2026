/**
 * Improve RSA + sitelinks for Search #3 → 室內攝影 ad group.
 *
 * Final URL: https://www.jdstudiohk.com/services/interior-photography
 * Ad group: customers/4839352747/adGroups/203224222452
 *
 *   npx tsx scripts/google-ads-interior-rsa.ts --dry-run
 *   npx tsx scripts/google-ads-interior-rsa.ts --apply   # requires Ads creds + explicit --apply
 *
 * Character widths follow Google Ads rules (CJK ≈ 2).
 */
import { readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CUSTOMER_ID = (process.env.GOOGLE_ADS_AD_ACCOUNT_ID ?? "4839352747").replace(/-/g, "");
const MCC_ID = (process.env.GOOGLE_ADS_CUSTOMER_ID ?? "9876630892").replace(/-/g, "");
const API_VERSION = "v23";
const AD_GROUP_RN = `customers/${CUSTOMER_ID}/adGroups/203224222452`;
const FINAL_URL = "https://www.jdstudiohk.com/services/interior-photography";

/** Pin first 3 headlines in Google Ads UI if possible (keyword + offer + CTA). */
export const INTERIOR_RSA = {
  headlines: [
    "室內攝影｜香港專業",
    "地產盤攝影即日出圖",
    "WhatsApp即日報價",
    "房地產攝影｜報價",
    "建築攝影服務香港",
    "商舖餐廳空間拍攝",
    "酒店室內攝影服務",
    "Airbnb空間專業拍",
    "室內設計項目拍攝",
    "JD Studio室內攝影",
    "透明收費｜快速交付",
    "香港室內攝影師",
    "Interior Photo HK",
    "Property Photo HK",
    "免費獲取拍攝報價",
  ],
  descriptions: [
    "專業室內及建築攝影：地產樓盤、商舖餐廳、酒店與Airbnb。香港本地團隊，高質燈光，快速交付。",
    "JD Studio 室內攝影｜服務1,250+企業。透明收費，WhatsApp即日報價，歡迎查詢拍攝方案。",
    "地產盤、房地產與建築空間拍攝。專業器材與燈光，適合推廣、招租及項目紀錄。",
    "Interior & architecture photography in Hong Kong. Property, retail & hotel specialists.",
  ],
  path1: "services",
  path2: "interior",
};

export const INTERIOR_SITELINKS = [
  {
    text: "室內攝影作品",
    url: "https://www.jdstudiohk.com/services/interior-photography",
    desc1: "查看空間拍攝案例",
    desc2: "地產·商舖·酒店影像",
  },
  {
    text: "立即查詢報價",
    url: "https://www.jdstudiohk.com/contact-us",
    desc1: "WhatsApp即日回覆",
    desc2: "透明收費無隱藏費用",
  },
  {
    text: "產品攝影服務",
    url: "https://www.jdstudiohk.com/services/product-photography",
    desc1: "電商與品牌產品拍攝",
    desc2: "同屬商業攝影團隊",
  },
  {
    text: "作品集 Gallery",
    url: "https://www.jdstudiohk.com/services/gallery",
    desc1: "瀏覽更多商業作品",
    desc2: "了解拍攝風格質素",
  },
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
      console.warn(`[interior-rsa] DB refresh skip: ${String(e)}`);
    }
  }
  return env;
}

function printCopy() {
  console.log("# Search #3 → 室內攝影 RSA + Sitelinks\n");
  console.log(`Final URL: ${FINAL_URL}`);
  console.log(`Display path: jdstudiohk.com/${INTERIOR_RSA.path1}/${INTERIOR_RSA.path2}\n`);
  console.log("## Headlines (15)");
  INTERIOR_RSA.headlines.forEach((h, i) => console.log(`${i + 1}. ${h}`));
  console.log("\n## Descriptions (4)");
  INTERIOR_RSA.descriptions.forEach((d, i) => console.log(`${i + 1}. ${d}`));
  console.log("\n## Sitelinks (4)");
  for (const s of INTERIOR_SITELINKS) {
    console.log(`- ${s.text}`);
    console.log(`  ${s.url}`);
    console.log(`  ${s.desc1} | ${s.desc2}`);
  }
  console.log(`\n## Pin tip`);
  console.log(`Pin H1「${INTERIOR_RSA.headlines[0]}」、H2「${INTERIOR_RSA.headlines[1]}」、H3「${INTERIOR_RSA.headlines[2]}」`);
}

async function main() {
  const apply = process.argv.includes("--apply");
  printCopy();

  const md = [
    `# 室內攝影 RSA 文案（Search #3）`,
    ``,
    `**Ad group:** 室內攝影 (\`203224222452\`)  `,
    `**Final URL:** ${FINAL_URL}  `,
    `**Path:** \`/${INTERIOR_RSA.path1}/${INTERIOR_RSA.path2}\``,
    ``,
    `## 廣告標題（15）`,
    ...INTERIOR_RSA.headlines.map((h, i) => `${i + 1}. ${h}`),
    ``,
    `## 說明（4）`,
    ...INTERIOR_RSA.descriptions.map((d, i) => `${i + 1}. ${d}`),
    ``,
    `## 網站連結（Sitelinks）`,
    ...INTERIOR_SITELINKS.flatMap((s) => [
      `### ${s.text}`,
      `- URL: ${s.url}`,
      `- 說明1: ${s.desc1}`,
      `- 說明2: ${s.desc2}`,
      ``,
    ]),
    `## UI 操作建議`,
    `1. Ads → Search #3 → 室內攝影 → 回應式搜尋廣告 → 新增／編輯`,
    `2. 貼上標題與說明；路徑填 \`${INTERIOR_RSA.path1}\` / \`${INTERIOR_RSA.path2}\``,
    `3. 資產 → 網站連結：新增上表 4 條（或帳戶層共用）`,
    `4. 建議釘選：標題1「室內攝影｜香港專業」、標題2「地產盤攝影即日出圖」、標題3「WhatsApp即日報價」`,
  ].join("\n");
  writeFileSync("/opt/cursor/artifacts/interior-rsa-copy.md", md, "utf8");
  writeFileSync("/workspace/interior-rsa-copy.md", md, "utf8");
  console.log("\nWrote /opt/cursor/artifacts/interior-rsa-copy.md");

  if (!apply) {
    console.log("\nDry copy only. Pass --apply to mutate Google Ads (needs credentials).");
    return;
  }

  const env = await loadEnv();
  for (const k of [
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_REFRESH_TOKEN",
  ]) {
    if (!env[k]) throw new Error(`Missing ${k}`);
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_ADS_CLIENT_ID,
      client_secret: env.GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: env.GOOGLE_ADS_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) throw new Error(`OAuth failed: ${JSON.stringify(tokenJson)}`);
  const token = tokenJson.access_token;
  const headers = {
    Authorization: `Bearer ${token}`,
    "developer-token": env.GOOGLE_ADS_DEVELOPER_TOKEN,
    "login-customer-id": MCC_ID,
    "Content-Type": "application/json",
  };

  async function gaql(query: string) {
    const res = await fetch(
      `https://googleads.googleapis.com/${API_VERSION}/customers/${CUSTOMER_ID}/googleAds:search`,
      { method: "POST", headers, body: JSON.stringify({ query }) },
    );
    const json = (await res.json()) as { results?: any[]; error?: unknown };
    if (!res.ok) throw new Error(`GAQL failed: ${JSON.stringify(json).slice(0, 600)}`);
    return json.results ?? [];
  }

  async function mutate(service: string, operations: unknown[]) {
    const res = await fetch(
      `https://googleads.googleapis.com/${API_VERSION}/customers/${CUSTOMER_ID}/${service}:mutate`,
      { method: "POST", headers, body: JSON.stringify({ operations }) },
    );
    const json = await res.json();
    if (!res.ok) throw new Error(`${service} mutate failed: ${JSON.stringify(json).slice(0, 900)}`);
    return json;
  }

  // 1) Pause existing ENABLED RSAs in 室內攝影 (keep history; new ad goes live)
  const existing = await gaql(`
    SELECT ad_group_ad.resource_name, ad_group_ad.status, ad_group_ad.ad.type
    FROM ad_group_ad
    WHERE ad_group.id = 203224222452
      AND ad_group_ad.status = 'ENABLED'
      AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
  `);
  if (existing.length) {
    const pauseOps = existing.map((row) => ({
      update: { resourceName: row.adGroupAd.resourceName, status: "PAUSED" },
      updateMask: "status",
    }));
    console.log(`Pausing ${pauseOps.length} existing ENABLED RSA(s)…`);
    console.log(JSON.stringify(await mutate("adGroupAds", pauseOps), null, 2).slice(0, 600));
  } else {
    console.log("No ENABLED RSA to pause.");
  }

  // 2) Create improved RSA
  const createOp = {
    create: {
      adGroup: AD_GROUP_RN,
      status: "ENABLED",
      ad: {
        responsiveSearchAd: {
          headlines: INTERIOR_RSA.headlines.map((text, i) =>
            i < 3 ? { text, pinnedField: `HEADLINE_${i + 1}` } : { text },
          ),
          descriptions: INTERIOR_RSA.descriptions.map((text) => ({ text })),
          path1: INTERIOR_RSA.path1,
          path2: INTERIOR_RSA.path2,
        },
        finalUrls: [FINAL_URL],
      },
    },
  };
  console.log("Creating new interior RSA…");
  const created = await mutate("adGroupAds", [createOp]);
  console.log(JSON.stringify(created, null, 2).slice(0, 1200));

  // 3) Create sitelink assets + link to campaign Search #3
  const CAMPAIGN_RN = `customers/${CUSTOMER_ID}/campaigns/24002224927`;
  const assetOps = INTERIOR_SITELINKS.map((s) => ({
    create: {
      type: "SITELINK",
      sitelinkAsset: {
        linkText: s.text,
        description1: s.desc1,
        description2: s.desc2,
      },
      finalUrls: [s.url],
    },
  }));
  console.log("Creating sitelink assets…");
  const assetRes = await mutate("assets", assetOps);
  const assetRns: string[] = (assetRes?.results ?? [])
    .map((r: any) => r?.resourceName)
    .filter(Boolean);
  console.log("Assets:", assetRns);

  if (assetRns.length) {
    const linkOps = assetRns.map((resourceName) => ({
      create: {
        campaign: CAMPAIGN_RN,
        asset: resourceName,
        fieldType: "SITELINK",
      },
    }));
    console.log("Linking sitelinks to Search #3 campaign…");
    console.log(JSON.stringify(await mutate("campaignAssets", linkOps), null, 2).slice(0, 800));
  }

  console.log("\nDone. Verify in Google Ads → Search #3 → 室內攝影.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
