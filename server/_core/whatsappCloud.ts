/**
 * WhatsApp Cloud API (Meta) — receive inbound messages and auto-match
 * recent Ads WA track clicks so quotes can attribute without guessing.
 *
 * Required env (Manus / Cloud secrets):
 *   WHATSAPP_TOKEN              — permanent System User token
 *   WHATSAPP_PHONE_NUMBER_ID    — Cloud API phone number id
 *   WHATSAPP_VERIFY_TOKEN       — webhook verify string you choose
 *   WHATSAPP_APP_SECRET         — Meta app secret (HMAC of raw body)
 *
 * Webhook URL (Meta callback):
 *   https://jdsys.biz/api/webhooks/whatsapp
 */

import crypto from "crypto";
import { ENV } from "./env";

export type WhatsappCloudConfig = {
  token: string;
  phoneNumberId: string;
  verifyToken: string;
  appSecret: string;
};

export function getWhatsappCloudConfig(): WhatsappCloudConfig | null {
  const token = (process.env.WHATSAPP_TOKEN || "").trim();
  const phoneNumberId = (process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim();
  const verifyToken = (process.env.WHATSAPP_VERIFY_TOKEN || "").trim();
  const appSecret = (process.env.WHATSAPP_APP_SECRET || "").trim();
  if (!token || !phoneNumberId || !verifyToken) return null;
  return { token, phoneNumberId, verifyToken, appSecret };
}

export function isWhatsappCloudConfigured(): boolean {
  return getWhatsappCloudConfig() != null;
}

/** Meta webhook verification (GET hub.challenge). */
export function verifyWhatsappWebhookChallenge(query: {
  "hub.mode"?: string;
  "hub.verify_token"?: string;
  "hub.challenge"?: string;
}): string | null {
  const cfg = getWhatsappCloudConfig();
  if (!cfg) return null;
  if (query["hub.mode"] !== "subscribe") return null;
  if (query["hub.verify_token"] !== cfg.verifyToken) return null;
  return query["hub.challenge"] ?? null;
}

/** Validate X-Hub-Signature-256 when app secret is set. */
export function verifyWhatsappSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined
): boolean {
  const cfg = getWhatsappCloudConfig();
  if (!cfg) return false;
  if (!cfg.appSecret) {
    // Allow receive without HMAC in early setup; log elsewhere.
    return true;
  }
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = signatureHeader.slice("sha256=".length);
  const raw = typeof rawBody === "string" ? Buffer.from(rawBody) : rawBody;
  const digest = crypto.createHmac("sha256", cfg.appSecret).update(raw).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(digest, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

/** Normalize to digits only; HK mobiles often arrive as 8529xxxxxxx. */
export function normalizeWaPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, "");
  if (!d) return null;
  // Local HK 8-digit → 852 prefix
  if (d.length === 8 && /^[4-9]/.test(d)) d = `852${d}`;
  // Strip leading 00
  if (d.startsWith("00")) d = d.slice(2);
  return d.slice(0, 32);
}

export type ParsedInboundWaMessage = {
  waMessageId: string;
  fromPhone: string;
  contactName: string | null;
  body: string | null;
  waTimestamp: Date | null;
};

/** Extract text messages from a Cloud API webhook payload. */
export function parseWhatsappWebhookPayload(payload: unknown): ParsedInboundWaMessage[] {
  const out: ParsedInboundWaMessage[] = [];
  const root = payload as any;
  const entries = root?.entry;
  if (!Array.isArray(entries)) return out;

  for (const entry of entries) {
    const changes = entry?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = change?.value;
      if (!value || change?.field !== "messages") continue;
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      const nameByWaId = new Map<string, string>();
      for (const c of contacts) {
        const wid = c?.wa_id != null ? String(c.wa_id) : "";
        const name = c?.profile?.name != null ? String(c.profile.name) : "";
        if (wid && name) nameByWaId.set(wid, name);
      }
      const messages = Array.isArray(value.messages) ? value.messages : [];
      for (const msg of messages) {
        const id = msg?.id != null ? String(msg.id) : "";
        const from = normalizeWaPhone(msg?.from);
        if (!id || !from) continue;
        let body: string | null = null;
        if (msg?.type === "text" && msg?.text?.body != null) {
          body = String(msg.text.body).slice(0, 8000);
        } else if (msg?.type) {
          body = `[${String(msg.type)}]`;
        }
        let waTimestamp: Date | null = null;
        if (msg?.timestamp != null) {
          const sec = Number(msg.timestamp);
          if (Number.isFinite(sec) && sec > 0) waTimestamp = new Date(sec * 1000);
        }
        out.push({
          waMessageId: id.slice(0, 128),
          fromPhone: from,
          contactName: nameByWaId.get(String(msg.from)) ?? nameByWaId.get(from) ?? null,
          body,
          waTimestamp,
        });
      }
    }
  }
  return out;
}

export type AdsClickMatchCandidate = {
  id: number;
  clickedAt: Date | string | null;
  quoteId?: number | null;
  matchedPhone?: string | null;
};

/**
 * Auto-match rule: among unmatched Ads clicks in the lookback window ending at
 * message time, if exactly one → that click. Otherwise none (avoid wrong bind).
 */
export function pickAdsClickForInbound(
  candidates: AdsClickMatchCandidate[],
  messageAt: Date,
  lookbackMs = 48 * 60 * 60 * 1000
): { clickId: number; reason: "single_recent" } | { clickId: null; reason: "none" } {
  const end = messageAt.getTime();
  const start = end - lookbackMs;
  const open = candidates.filter((c) => {
    if (c.quoteId != null) return false;
    if (c.matchedPhone) return false;
    const t = c.clickedAt ? new Date(c.clickedAt).getTime() : NaN;
    if (!Number.isFinite(t)) return false;
    return t >= start && t <= end + 5 * 60 * 1000; // allow 5m clock skew after message
  });
  if (open.length === 1) {
    return { clickId: open[0]!.id, reason: "single_recent" };
  }
  return { clickId: null, reason: "none" };
}

/** Graph API send text (optional staff reply path). */
export async function sendWhatsappText(toPhone: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const cfg = getWhatsappCloudConfig();
  if (!cfg) return { ok: false, error: "WhatsApp Cloud API not configured" };
  const to = normalizeWaPhone(toPhone);
  if (!to) return { ok: false, error: "invalid phone" };
  const url = `https://graph.facebook.com/v21.0/${cfg.phoneNumberId}/messages`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { preview_url: false, body: body.slice(0, 4000) },
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { ok: false, error: `${res.status} ${errText.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message || err) };
  }
}

export function whatsappWebhookPublicUrl(): string {
  const base = (ENV.publicBaseUrl || "https://jdsys.biz").replace(/\/$/, "");
  return `${base}/api/webhooks/whatsapp`;
}
