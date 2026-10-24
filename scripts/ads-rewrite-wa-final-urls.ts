/**
 * List (and optionally rewrite) Google Ads final URLs that still point at raw wa.me.
 * Target template:
 *   https://jdsys.biz/api/track/wa?src=google_ads&gclid={gclid}&campaign_id={campaignid}&lp={lpurl}
 *
 *   npx tsx scripts/ads-rewrite-wa-final-urls.ts
 *   npx tsx scripts/ads-rewrite-wa-final-urls.ts --apply
 */
import { join } from "node:path";
import { homedir } from "node:os";
import { readFileSync, existsSync } from "node:fs";

const CUSTOMER_ID = (process.env.GOOGLE_ADS_AD_ACCOUNT_ID ?? "4839352747").replace(/-/g, "");
const MCC_ID = (
  process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ??
  process.env.GOOGLE_ADS_CUSTOMER_ID ??
  "9876630892"
).replace(/-/g, "");

const TRACK_TEMPLATE =
  "https://jdsys.biz/api/track/wa?src=google_ads&gclid={gclid}&campaign_id={campaignid}&lp={lpurl}";

function loadEnvFile() {
  const path = process.env.GOOGLE_ADS_ENV_FILE ?? join(homedir(), ".config/jd-studio/google-ads.env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

function isRawWaUrl(url: string): boolean {
  return /wa\.me\/85291531976/i.test(url) || /api\.whatsapp\.com\/send\?.*phone=852?91531976/i.test(url);
}

async function main() {
  loadEnvFile();
  const apply = process.argv.includes("--apply");

  const needed = [
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_REFRESH_TOKEN",
    "GOOGLE_ADS_DEVELOPER_TOKEN",
  ] as const;
  const missing = needed.filter((k) => !process.env[k]?.trim());
  if (missing.length) {
    console.error("Missing Ads credentials:", missing.join(", "));
    console.error("Set Cloud secrets or ~/.config/jd-studio/google-ads.env then re-run.");
    console.error("Recommended Click-to-WA / WA final URL template:");
    console.error(" ", TRACK_TEMPLATE);
    process.exit(2);
  }

  const { GoogleAdsApi } = await import("google-ads-api");
  const client = new GoogleAdsApi({
    client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
    developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
  });
  const customer = client.Customer({
    customer_id: CUSTOMER_ID,
    refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN!,
    login_customer_id: MCC_ID,
  });

  const rows = await customer.query(`
    SELECT
      ad_group_ad.ad.resource_name,
      ad_group_ad.ad.final_urls,
      campaign.id,
      campaign.name
    FROM ad_group_ad
    WHERE ad_group_ad.status != 'REMOVED'
      AND campaign.status != 'REMOVED'
      AND ad_group.status != 'REMOVED'
  `);

  const hits: Array<{
    resourceName: string;
    campaignId: string;
    campaignName: string;
    finalUrls: string[];
    nextUrls: string[];
  }> = [];

  for (const row of rows as any[]) {
    const ad = row.ad_group_ad?.ad ?? row.adGroupAd?.ad;
    const urls: string[] = ad?.final_urls ?? ad?.finalUrls ?? [];
    if (!Array.isArray(urls) || !urls.some(isRawWaUrl)) continue;
    hits.push({
      resourceName: String(ad.resource_name ?? ad.resourceName),
      campaignId: String(row.campaign?.id ?? ""),
      campaignName: String(row.campaign?.name ?? ""),
      finalUrls: urls,
      nextUrls: urls.map((u) => (isRawWaUrl(u) ? TRACK_TEMPLATE : u)),
    });
  }

  console.log(`Found ${hits.length} ad(s) with raw WhatsApp final URL`);
  for (const h of hits) {
    console.log(`- ${h.campaignName} (${h.campaignId})`);
    console.log(`  ${h.resourceName}`);
    console.log(`  from: ${h.finalUrls.join(" | ")}`);
    console.log(`  to:   ${h.nextUrls.join(" | ")}`);
  }

  if (!hits.length) {
    console.log("No raw wa.me final URLs on RSA/ETA ads.");
    console.log("If you use Click-to-WhatsApp assets, set their URL to:");
    console.log(" ", TRACK_TEMPLATE);
    return;
  }

  if (!apply) {
    console.log("Dry-run only. Re-run with --apply to mutate final URLs.");
    return;
  }

  for (const h of hits) {
    // google-ads-api: update ad final URLs via ads service
    await customer.ads.update([
      {
        resource_name: h.resourceName.includes("/ads/")
          ? h.resourceName
          : h.resourceName.replace(/adGroupAds/, "ads").replace(/~\d+$/, (m) => m.replace("~", "/")),
        final_urls: h.nextUrls,
      } as any,
    ]);
    console.log("updated", h.resourceName);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
