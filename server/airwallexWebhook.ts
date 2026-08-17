import type { Request, Response } from "express";
import { ENV } from "./_core/env";
import { verifyAirwallexWebhookSignature, type AirwallexPaymentLinkKind } from "./airwallex";
import {
  applyAirwallexPaymentToQuote,
  getAirwallexPaymentLinkByAirwallexId,
  markAirwallexLinkPaid,
} from "./airwallexPayment";

type WebhookPayload = {
  id?: string;
  name?: string;
  data?: {
    object?: Record<string, unknown>;
  };
};

function asString(value: unknown): string | undefined {
  if (value == null) return undefined;
  const s = String(value).trim();
  return s || undefined;
}

function parseKind(value: unknown): AirwallexPaymentLinkKind | undefined {
  const s = asString(value);
  if (s === "deposit" || s === "balance" || s === "full") return s;
  return undefined;
}

function parseAmount(value: unknown): number | undefined {
  if (value == null) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

export async function handleAirwallexWebhook(req: Request, res: Response): Promise<void> {
  const rawBody = Buffer.isBuffer(req.body)
    ? req.body.toString("utf8")
    : typeof req.body === "string"
      ? req.body
      : "";

  const timestamp = asString(req.headers["x-timestamp"]);
  const signature = asString(req.headers["x-signature"]);

  if (ENV.airwallexWebhookSecret) {
    const ok = verifyAirwallexWebhookSignature({
      rawBody,
      timestamp,
      signature,
      secret: ENV.airwallexWebhookSecret,
    });
    if (!ok) {
      console.warn("[Airwallex Webhook] Invalid signature");
      res.status(401).json({ received: false, error: "invalid signature" });
      return;
    }
  } else if (ENV.isProduction) {
    console.warn("[Airwallex Webhook] AIRWALLEX_WEBHOOK_SECRET not set — accepting unsigned webhook");
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    res.status(400).json({ received: false, error: "invalid json" });
    return;
  }

  const eventName = payload.name ?? "";
  console.log(`[Airwallex Webhook] Event: ${eventName} id=${payload.id ?? "?"}`);

  if (eventName !== "payment_intent.succeeded") {
    res.status(200).json({ received: true, ignored: eventName });
    return;
  }

  const obj = payload.data?.object ?? {};
  const paymentIntentId = asString(obj.id);
  const paymentLinkId =
    asString(obj.payment_link_id) ??
    asString((obj.payment_link as Record<string, unknown> | undefined)?.id);
  const metadataRaw =
    (obj.metadata as Record<string, unknown> | undefined) ??
    ((obj.payment_link as Record<string, unknown> | undefined)?.metadata as
      | Record<string, unknown>
      | undefined) ??
    {};

  const quoteIdFromMeta = Number(asString(metadataRaw.quoteId));
  let kind = parseKind(metadataRaw.kind);
  let quoteId = Number.isFinite(quoteIdFromMeta) && quoteIdFromMeta > 0 ? quoteIdFromMeta : 0;
  let amount = parseAmount(obj.amount);

  let link = paymentLinkId
    ? await getAirwallexPaymentLinkByAirwallexId(paymentLinkId)
    : null;

  if (link) {
    if (!quoteId) quoteId = link.quoteId;
    if (!kind) kind = link.kind as AirwallexPaymentLinkKind;
    if (!amount) amount = Number(link.amount);
    if (link.status === "PAID") {
      res.status(200).json({ received: true, duplicate: true });
      return;
    }
  }

  if (!quoteId || !kind || !amount) {
    console.warn("[Airwallex Webhook] Missing quote/kind/amount", {
      quoteId,
      kind,
      amount,
      paymentLinkId,
    });
    res.status(200).json({ received: true, skipped: "missing fields" });
    return;
  }

  const paidAt = new Date(
    asString(obj.updated_at) ?? asString(obj.created_at) ?? Date.now()
  );

  if (paymentLinkId) {
    await markAirwallexLinkPaid({
      airwallexId: paymentLinkId,
      paymentIntentId,
      paidAt,
    });
  }

  await applyAirwallexPaymentToQuote({
    quoteId,
    kind,
    amount,
    paidAt,
    paymentIntentId,
    source: "webhook",
  });

  console.log(
    `[Airwallex Webhook] Quote #${quoteId} marked ${kind} paid (${amount})`
  );
  res.status(200).json({ received: true, quoteId, kind });
}
