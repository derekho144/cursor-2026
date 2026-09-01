/**
 * Production-only helper: print ~/.config/jd-studio/google-ads.env contents.
 * Run on Manus / jdsys with production env + DB (never commit output).
 *
 *   npx tsx scripts/google-ads-mcp/export-local-env.ts
 *   npx tsx scripts/google-ads-mcp/export-local-env.ts --check   # keys only, no secrets
 */
import { getPlatformCredential } from "../../server/db";

const CHECK_ONLY = process.argv.includes("--check");

function line(key: string, value: string | undefined): string {
  return `${key}=${value ?? ""}`;
}

function inferProjectId(clientId: string | undefined): string {
  if (!clientId) return "";
  const m = /^(\d+)-/.exec(clientId);
  return m?.[1] ?? "";
}

async function main() {
  const envKeys = [
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_REFRESH_TOKEN",
    "GOOGLE_ADS_CUSTOMER_ID",
  ] as const;

  const fromEnv = Object.fromEntries(envKeys.map((k) => [k, process.env[k]?.trim() || ""]));

  let refreshToken = fromEnv.GOOGLE_ADS_REFRESH_TOKEN;
  // Skip DB when --env-only / SKIP_DB=1 (avoids hung MySQL on some sandboxes)
  const skipDb =
    process.argv.includes("--env-only") || process.env.SKIP_DB === "1";
  if (!skipDb) {
    try {
      const cred = await Promise.race([
        getPlatformCredential("google_ads"),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error("DB credential lookup timeout")), 8_000)
        ),
      ]);
      if (cred?.refreshToken) refreshToken = cred.refreshToken;
    } catch (err) {
      console.error(`[export-local-env] DB skip: ${String(err)}`);
      // continue with env refresh token
    }
  }

  const loginCustomerId = (
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ||
    fromEnv.GOOGLE_ADS_CUSTOMER_ID ||
    "9876630892"
  ).replace(/-/g, "");

  const projectId =
    process.env.GOOGLE_PROJECT_ID?.trim() || inferProjectId(fromEnv.GOOGLE_ADS_CLIENT_ID);

  if (CHECK_ONLY) {
    const status = (k: string, v: string) => (v ? "✅" : "❌");
    console.log("Google Ads MCP env check (production):");
    for (const k of envKeys) console.log(`  ${k}: ${status(k, fromEnv[k])}`);
    console.log(`  refresh_token (DB override): ${refreshToken ? "✅" : "❌"}`);
    console.log(`  GOOGLE_PROJECT_ID (inferred): ${projectId ? "✅" : "❌"}`);
    process.exit(0);
  }

  const missing = envKeys.filter((k) => k !== "GOOGLE_ADS_REFRESH_TOKEN" && !fromEnv[k]);
  if (!refreshToken) missing.push("GOOGLE_ADS_REFRESH_TOKEN");
  if (missing.length) {
    console.error(`Missing: ${missing.join(", ")}`);
    process.exit(1);
  }

  const out = [
    "# Paste into ~/.config/jd-studio/google-ads.env on your Mac",
    line("GOOGLE_ADS_DEVELOPER_TOKEN", fromEnv.GOOGLE_ADS_DEVELOPER_TOKEN),
    line("GOOGLE_ADS_CLIENT_ID", fromEnv.GOOGLE_ADS_CLIENT_ID),
    line("GOOGLE_ADS_CLIENT_SECRET", fromEnv.GOOGLE_ADS_CLIENT_SECRET),
    line("GOOGLE_ADS_REFRESH_TOKEN", refreshToken),
    line("GOOGLE_ADS_CUSTOMER_ID", loginCustomerId),
    line("GOOGLE_ADS_LOGIN_CUSTOMER_ID", loginCustomerId),
    line("GOOGLE_ADS_AD_ACCOUNT_ID", process.env.GOOGLE_ADS_AD_ACCOUNT_ID?.trim() || "4839352747"),
    line("GOOGLE_PROJECT_ID", projectId),
    "",
  ].join("\n");

  process.stdout.write(out);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
