/**
 * Strengthen Search #3 keywords for three niches:
 *   菜單設計 → 食物攝影 ad group
 *   鐘錶拍攝 → 產品攝影 ad group
 *   珠寶拍攝 → 珠寶攝影 ad group
 *
 *   npx tsx scripts/google-ads-strengthen-keywords.ts --dry-run
 *   npx tsx scripts/google-ads-strengthen-keywords.ts
 */
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CUSTOMER_ID = "4839352747";
const MCC_ID = "9876630892";
const API_VERSION = "v23";

const AD_GROUPS = {
  food: `customers/${CUSTOMER_ID}/adGroups/203224222292`, // 食物攝影
  product: `customers/${CUSTOMER_ID}/adGroups/203224222492`, // 產品攝影
  jewelry: `customers/${CUSTOMER_ID}/adGroups/203224222692`, // 珠寶攝影
} as const;

/** Phrase-match keywords by niche → ad group */
const KEYWORD_BATCHES: Array<{ niche: string; adGroupRn: string; keywords: string[] }> = [
  {
    niche: "菜單設計",
    adGroupRn: AD_GROUPS.food,
    keywords: [
      "菜單設計",
      "餐牌設計",
      "餐廳菜單設計",
      "餐單設計",
      "菜單攝影",
      "餐牌拍攝",
      "餐單拍攝",
      "menu design Hong Kong",
      "menu photography Hong Kong",
      "restaurant menu design",
      "restaurant menu photography",
      "food menu photography",
    ],
  },
  {
    niche: "鐘錶拍攝",
    adGroupRn: AD_GROUPS.product,
    keywords: [
      "鐘錶拍攝",
      "鐘錶攝影",
      "手錶拍攝",
      "手錶攝影",
      "腕錶攝影",
      "鐘錶產品攝影",
      "watch photography Hong Kong",
      "watch product photography",
      "luxury watch photography",
      "watch commercial photography",
      "horology photography",
    ],
  },
  {
    niche: "珠寶拍攝",
    adGroupRn: AD_GROUPS.jewelry,
    keywords: [
      "珠寶拍攝",
      "首飾拍攝",
      "首飾攝影",
      "鑽石攝影",
      "飾物拍攝",
      "珠寶產品攝影",
      "jewelry photography Hong Kong",
      "jewellery photography Hong Kong",
      "fine jewelry photography",
      "jewellery product photography",
      "diamond jewelry photography",
    ],
  },
];

function loadEnvFile() {
  const keys = [
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_REFRESH_TOKEN",
  ] as const;

  // Prefer process.env (Manus / production) so we can skip hung DB export.
  const fromProcess: Record<string, string> = {};
  for (const k of keys) {
    const v = process.env[k]?.trim();
    if (v) fromProcess[k] = v;
  }
  if (keys.every((k) => fromProcess[k])) {
    console.log("Using Google Ads credentials from process.env");
    return fromProcess;
  }

  const path = process.env.GOOGLE_ADS_ENV_FILE ?? join(homedir(), ".config/jd-studio/google-ads.env");
  const env: Record<string, string> = { ...fromProcess };
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#") || !s.includes("=")) continue;
    const i = s.indexOf("=");
    const k = s.slice(0, i);
    const v = s.slice(i + 1).trim();
    if (v && !env[k]) env[k] = v;
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

async function mutate(
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
  if (!res.ok) {
    throw new Error(JSON.stringify(json, null, 2));
  }
  return json as {
    results?: Array<{ resourceName?: string }>;
    partialFailureError?: { message?: string; details?: unknown[] };
  };
}

function buildOps() {
  const ops: unknown[] = [];
  for (const batch of KEYWORD_BATCHES) {
    for (const text of batch.keywords) {
      ops.push({
        create: {
          adGroup: batch.adGroupRn,
          status: "ENABLED",
          keyword: {
            text,
            matchType: "PHRASE",
          },
        },
      });
    }
  }
  return ops;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const env = loadEnvFile();
  const token = await getAccessToken(env);
  const operations = buildOps();

  console.log(`# Strengthen keywords (${dryRun ? "DRY-RUN" : "LIVE"})`);
  for (const batch of KEYWORD_BATCHES) {
    console.log(`- ${batch.niche}: ${batch.keywords.length} phrase keywords → ${batch.adGroupRn}`);
  }
  console.log(`Total creates: ${operations.length}\n`);

  const result = await mutate(env, token, operations, dryRun);

  const ok = result.results?.filter((r) => r.resourceName).length ?? 0;
  console.log(`Created/validated OK: ${ok}/${operations.length}`);

  if (result.partialFailureError) {
    console.log("\nPartial failures (duplicates / policy usually OK to ignore):");
    console.log(JSON.stringify(result.partialFailureError, null, 2).slice(0, 4000));
  }

  if (!dryRun) {
    console.log("\nDone. Review in Google Ads → Search #3 → Keywords.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
