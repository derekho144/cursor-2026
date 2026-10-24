/**
 * Helpers for Ads WhatsApp click rows shown/attached on quote create.
 * Probe / template clicks must not pollute auto-match or the staff picker.
 */

export type AdsWaClickLike = {
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  landingPageUrl?: string | null;
  adsCampaignId?: string | null;
  matchedPhone?: string | null;
  quoteId?: number | null;
  refCode?: string | null;
};

/** Deploy / template / fake tracking rows — never auto-attach or list by default. */
export function isProbeAdsWaClick(c: AdsWaClickLike): boolean {
  const gclid = String(c.gclid || "").trim();
  const gLower = gclid.toLowerCase();
  if (
    gclid &&
    (gLower === "{gclid}" ||
      gLower === "…" ||
      gLower === "..." ||
      gLower.startsWith("test") ||
      gLower.includes("deploy-check") ||
      gLower.includes("test-deploy") ||
      gLower.includes("testgclid"))
  ) {
    return true;
  }
  const lp = String(c.landingPageUrl || "");
  if (lp.includes("{lpurl}") || lp.includes("%7Blpurl%7D")) return true;
  const camp = String(c.adsCampaignId || "").toLowerCase();
  if (camp.includes("{campaignid}")) return true;
  const ref = String(c.refCode || "").toLowerCase();
  if (ref === "wa-test" || ref.startsWith("wa-test")) return true;
  return false;
}

/** Prefer phone-matched, unquoted, real clicks for staff / auto paths. */
export function rankAdsWaClicksForPicker<
  T extends AdsWaClickLike & { clickedAt?: Date | string | null; id: number },
>(rows: T[], opts?: { preferPhoneDigits?: string }): T[] {
  const prefer = (opts?.preferPhoneDigits || "").replace(/\D/g, "");
  const real = rows.filter((c) => !isProbeAdsWaClick(c));
  const score = (c: T) => {
    let s = 0;
    const mp = (c.matchedPhone || "").replace(/\D/g, "");
    if (mp) s += 100;
    if (prefer && mp && (mp === prefer || mp.endsWith(prefer) || prefer.endsWith(mp))) {
      s += 1000;
    }
    if (c.quoteId == null) s += 10;
    const t = c.clickedAt ? new Date(c.clickedAt).getTime() : 0;
    return s * 1e15 + t;
  };
  return [...real].sort((a, b) => score(b) - score(a));
}

/** Pull gad_campaignid / campaignid from landing URL when DB column empty. */
export function campaignIdFromLandingUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, "https://www.jdstudiohk.com");
    const id =
      u.searchParams.get("gad_campaignid") ||
      u.searchParams.get("campaignid") ||
      u.searchParams.get("utm_campaign_id");
    return id && /^\d{5,}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
