import type { Request, Response } from "express";
import { ENV } from "./_core/env";
import { verifyAirwallexWebhookSignature, type AirwallexPaymentLinkKind } from "./airwallex";
import { processAirwallexPaymentNotification } from "./airwallexPayment";

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

function parsePaidAt(obj: Record<string, unknown>): Date {
  return new Date(
    asString(obj.updated_at) ??
      asString(obj.paid_at) ??
      asString(obj.created_at) ??
      Date.now()
  );
}

function metadataFrom(obj: Record<string, unknown>): Record<string, unknown> {
  return (
    (obj.metadata as Record<string, unknown> | undefined) ??
    ((obj.payment_link as Record<string, unknown> | undefined)?.metadata as
      | Record<string, unknown>
      | undefined) ??
    {}
  );
}

/** Build notification from payment_intent.succeeded payload. */
function notificationFromPaymentIntent(obj: Record<string, unknown>) {
  const meta = metadataFrom(obj);
  return {
    paymentIntentId: asString(obj.id),
    paymentLinkId:
      asString(obj.payment_link_id) ??
      asString((obj.payment_link as Record<string, unknown> | undefined)?.id),
    quoteId: Number(asString(meta.quoteId)),
    quoteNumber: asString(meta.quoteNumber) ?? asString(obj.merchant_order_id) ?? asString(obj.reference),
    kind: parseKind(meta.kind),
    amount: parseAmount(obj.amount),
    paidAt: parsePaidAt(obj),
  };
}

/** Build notification from payment_link.paid payload. */
function notificationFromPaymentLink(obj: Record<string, unknown>) {
  const meta = metadataFrom(obj);
  return {
    paymentIntentId: asString(obj.latest_successful_payment_intent_id),
    paymentLinkId: asString(obj.id),
    quoteId: Number(asString(meta.quoteId)),
    quoteNumber: asString(meta.quoteNumber) ?? asString(obj.reference),
    kind: parseKind(meta.kind),
    amount: parseAmount(obj.amount),
    paidAt: parsePaidAt(obj),
  };
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

  if (eventName !== "payment_intent.succeeded" && eventName !== "payment_link.paid") {
    res.status(200).json({ received: true, ignored: eventName });
    return;
  }

  const obj = payload.data?.object ?? {};
  const notification =
    eventName === "payment_link.paid"
      ? notificationFromPaymentLink(obj)
      : notificationFromPaymentIntent(obj);

  const result = await processAirwallexPaymentNotification(notification);

  if (!result.applied) {
    console.log(`[Airwallex Webhook] Not applied: ${result.reason}`, notification);
    res.status(200).json({ received: true, applied: false, reason: result.reason });
    return;
  }

  res.status(200).json({
    received: true,
    applied: true,
    quoteId: result.quoteId,
    kind: result.kind,
    paymentStatus: result.paymentStatus,
  });
}
