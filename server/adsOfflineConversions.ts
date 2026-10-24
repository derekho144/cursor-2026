/**
 * Upload quote conversions to Google Ads (offline click conversions).
 *
 * - Inquiry: when a quote is created with gclid/gbraid/wbraid
 * - Accepted: when quote status becomes accepted (value = quote total HKD)
 *
 * Conversion actions (UPLOAD_CLICKS) are auto-created once if missing, or
 * overridden via:
 *   GOOGLE_ADS_QUOTE_INQUIRY_CONVERSION_ACTION_ID
 *   GOOGLE_ADS_QUOTE_ACCEPTED_CONVERSION_ACTION_ID
 */
import {
  ensureUploadClickConversionAction,
  formatAdsConversionDateTime,
  uploadClickConversions,
  type ClickConversionUpload,
} from "./googleAds";
import { getDb } from "./db";
import { quotes } from "../drizzle/schema";
import { eq, sql } from "drizzle-orm";

const INQUIRY_ACTION_NAME = "JD Quote Inquiry (Offline)";
const ACCEPTED_ACTION_NAME = "JD Quote Accepted (Offline)";

export type QuoteConversionRow = {
  id: number;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  total?: string | number | null;
  currency?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  adsOfflineInquiryUploadedAt?: Date | string | null;
  adsOfflineAcceptedUploadedAt?: Date | string | null;
};

function clickId(row: QuoteConversionRow): { kind: "gclid" | "gbraid" | "wbraid"; value: string } | null {
  const gclid = (row.gclid || "").trim();
  if (gclid) return { kind: "gclid", value: gclid };
  const gbraid = (row.gbraid || "").trim();
  if (gbraid) return { kind: "gbraid", value: gbraid };
  const wbraid = (row.wbraid || "").trim();
  if (wbraid) return { kind: "wbraid", value: wbraid };
  return null;
}

function buildConversion(
  row: QuoteConversionRow,
  actionResource: string,
  kind: "inquiry" | "accepted",
  when: Date
): ClickConversionUpload | null {
  const click = clickId(row);
  if (!click) return null;
  const value =
    kind === "accepted"
      ? Number(row.total ?? 0)
      : 1;
  const conv: ClickConversionUpload = {
    conversionAction: actionResource,
    conversionDateTime: formatAdsConversionDateTime(when),
    conversionValue: Number.isFinite(value) ? value : kind === "accepted" ? 0 : 1,
    currencyCode: (row.currency || "HKD").toUpperCase().slice(0, 3) || "HKD",
    orderId: `jd-quote-${row.id}-${kind}`,
    consent: { adUserData: "GRANTED" },
  };
  if (click.kind === "gclid") conv.gclid = click.value;
  if (click.kind === "gbraid") conv.gbraid = click.value;
  if (click.kind === "wbraid") conv.wbraid = click.value;
  return conv;
}

async function markUploaded(
  quoteId: number,
  kind: "inquiry" | "accepted",
  error: string | null
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(quotes)
    .set({
      ...(kind === "inquiry" && !error ? { adsOfflineInquiryUploadedAt: new Date() } : {}),
      ...(kind === "accepted" && !error ? { adsOfflineAcceptedUploadedAt: new Date() } : {}),
      adsOfflineLastError: error,
    })
    .where(eq(quotes.id, quoteId));
}

export async function uploadQuoteInquiryConversion(row: QuoteConversionRow): Promise<{
  ok: boolean;
  skipped?: string;
  error?: string;
}> {
  if (row.adsOfflineInquiryUploadedAt) return { ok: true, skipped: "already_uploaded" };
  if (!clickId(row)) return { ok: true, skipped: "no_click_id" };

  try {
    await ensureAdsOfflineConversionSchema();
    const envId = (process.env.GOOGLE_ADS_QUOTE_INQUIRY_CONVERSION_ACTION_ID || "").trim();
    const action = envId
      ? `customers/${(process.env.GOOGLE_ADS_AD_ACCOUNT_ID ?? "4839352747").replace(/-/g, "")}/conversionActions/${envId}`
      : await ensureUploadClickConversionAction(INQUIRY_ACTION_NAME, "SUBMIT_LEAD_FORM");
    const when = row.createdAt ? new Date(row.createdAt) : new Date();
    const conv = buildConversion(row, action, "inquiry", when);
    if (!conv) return { ok: true, skipped: "no_click_id" };

    const result = await uploadClickConversions([conv]);
    if (result.partialFailure) {
      const err = result.errorMessage || "partial_failure";
      await markUploaded(row.id, "inquiry", err.slice(0, 512));
      return { ok: false, error: err };
    }
    await markUploaded(row.id, "inquiry", null);
    return { ok: true };
  } catch (err) {
    const msg = String((err as Error)?.message || err).slice(0, 512);
    try {
      await markUploaded(row.id, "inquiry", msg);
    } catch (_) {}
    return { ok: false, error: msg };
  }
}

export async function uploadQuoteAcceptedConversion(row: QuoteConversionRow): Promise<{
  ok: boolean;
  skipped?: string;
  error?: string;
}> {
  if (row.adsOfflineAcceptedUploadedAt) return { ok: true, skipped: "already_uploaded" };
  if (!clickId(row)) return { ok: true, skipped: "no_click_id" };

  try {
    await ensureAdsOfflineConversionSchema();
    const envId = (process.env.GOOGLE_ADS_QUOTE_ACCEPTED_CONVERSION_ACTION_ID || "").trim();
    const action = envId
      ? `customers/${(process.env.GOOGLE_ADS_AD_ACCOUNT_ID ?? "4839352747").replace(/-/g, "")}/conversionActions/${envId}`
      : await ensureUploadClickConversionAction(ACCEPTED_ACTION_NAME, "PURCHASE");
    const when = new Date();
    const conv = buildConversion(row, action, "accepted", when);
    if (!conv) return { ok: true, skipped: "no_click_id" };

    const result = await uploadClickConversions([conv]);
    if (result.partialFailure) {
      const err = result.errorMessage || "partial_failure";
      await markUploaded(row.id, "accepted", err.slice(0, 512));
      return { ok: false, error: err };
    }
    await markUploaded(row.id, "accepted", null);
    return { ok: true };
  } catch (err) {
    const msg = String((err as Error)?.message || err).slice(0, 512);
    try {
      await markUploaded(row.id, "accepted", msg);
    } catch (_) {}
    return { ok: false, error: msg };
  }
}

/** Fire-and-forget wrappers used by quote router. */
export function scheduleQuoteInquiryConversionUpload(row: QuoteConversionRow): void {
  void uploadQuoteInquiryConversion(row).then((r) => {
    if (!r.ok) console.warn(`[Ads OCI] inquiry quote #${row.id}:`, r.error);
    else if (!r.skipped) console.log(`[Ads OCI] inquiry uploaded quote #${row.id}`);
  });
}

export function scheduleQuoteAcceptedConversionUpload(row: QuoteConversionRow): void {
  void uploadQuoteAcceptedConversion(row).then((r) => {
    if (!r.ok) console.warn(`[Ads OCI] accepted quote #${row.id}:`, r.error);
    else if (!r.skipped) console.log(`[Ads OCI] accepted uploaded quote #${row.id}`);
  });
}

/** Ensure schema columns exist (idempotent). */
export async function ensureAdsOfflineConversionSchema(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const add = async (col: string, ddl: string) => {
      try {
        await db.execute(sql.raw(`ALTER TABLE \`quotes\` ADD \`${col}\` ${ddl}`));
      } catch (err) {
        const msg = String((err as any)?.message || err);
        if (!/Duplicate column|already exists/i.test(msg)) {
          console.warn(`[Ads OCI] ADD quotes.${col}:`, msg.slice(0, 200));
        }
      }
    };
    await add("ads_offline_inquiry_uploaded_at", "timestamp NULL");
    await add("ads_offline_accepted_uploaded_at", "timestamp NULL");
    await add("ads_offline_last_error", "varchar(512)");
  } catch (err) {
    // Tests / environments without full db mock — ignore
    console.warn("[Ads OCI] ensure schema skipped:", String((err as Error)?.message || err).slice(0, 160));
  }
}
