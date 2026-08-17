import crypto from "crypto";
import { ENV } from "./_core/env";

export type AirwallexPaymentLinkKind = "deposit" | "balance" | "full";

export type AirwallexPaymentLinkResult = {
  id: string;
  url: string;
  amount: number;
  currency: string;
  status?: string;
  expiresAt?: string | null;
};

type TokenCache = {
  token: string;
  expiresAtMs: number;
};

let tokenCache: TokenCache | null = null;

export function isAirwallexConfigured(): boolean {
  return Boolean(ENV.airwallexApiKey && ENV.airwallexClientId);
}

export function getAirwallexBaseUrl(): string {
  return ENV.airwallexEnv === "sandbox"
    ? "https://api.sandbox.airwallex.com"
    : "https://api.airwallex.com";
}

/** Round to 2 decimal places for HKD payment links. */
export function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function computeQuoteDepositAmount(quote: {
  total: string | number;
  depositMode?: string | null;
  depositPercent?: string | number | null;
  depositFixedAmount?: string | number | null;
}): number {
  const total = Number(quote.total) || 0;
  const depositMode = quote.depositMode ?? "percent";
  const depositPct = Number(quote.depositPercent ?? 0);
  const depositFixedAmt = Number(quote.depositFixedAmount ?? 0);
  const hasDeposit =
    depositMode === "fixed" ? depositFixedAmt > 0 : depositPct > 0;
  if (!hasDeposit) return total;
  const raw =
    depositMode === "fixed" ? depositFixedAmt : (total * depositPct) / 100;
  return roundMoney(raw);
}

export function computeQuoteBalanceAmount(
  quote: { total: string | number },
  depositPaid = 0
): number {
  const total = Number(quote.total) || 0;
  return roundMoney(Math.max(0, total - depositPaid));
}

export function suggestPaymentKind(quote: {
  paymentStatus?: string | null;
  total: string | number;
  depositMode?: string | null;
  depositPercent?: string | number | null;
  depositFixedAmount?: string | number | null;
  depositPaidAmount?: string | number | null;
}): AirwallexPaymentLinkKind {
  if (quote.paymentStatus === "fully_paid") {
    throw new Error("Quote is already fully paid");
  }
  if (quote.paymentStatus === "deposit_paid") {
    return "balance";
  }
  const total = Number(quote.total) || 0;
  const deposit = computeQuoteDepositAmount(quote);
  if (deposit <= 0 || deposit >= total) return "full";
  return "deposit";
}

export function paymentAmountForKind(
  quote: {
    total: string | number;
    depositMode?: string | null;
    depositPercent?: string | number | null;
    depositFixedAmount?: string | number | null;
    depositPaidAmount?: string | number | null;
  },
  kind: AirwallexPaymentLinkKind
): number {
  const total = Number(quote.total) || 0;
  if (kind === "full") return roundMoney(total);
  if (kind === "deposit") return computeQuoteDepositAmount(quote);
  const depositPaid = Number(quote.depositPaidAmount ?? 0);
  return computeQuoteBalanceAmount(quote, depositPaid);
}

export function paymentKindLabel(kind: AirwallexPaymentLinkKind): string {
  if (kind === "deposit") return "Deposit";
  if (kind === "balance") return "Balance";
  return "Full payment";
}

export function paymentKindLabelZh(kind: AirwallexPaymentLinkKind): string {
  if (kind === "deposit") return "訂金";
  if (kind === "balance") return "尾款";
  return "全數";
}

export function verifyAirwallexWebhookSignature(params: {
  rawBody: string;
  timestamp: string | undefined;
  signature: string | undefined;
  secret: string;
  maxSkewMs?: number;
}): boolean {
  const { rawBody, timestamp, signature, secret } = params;
  const maxSkewMs = params.maxSkewMs ?? 5 * 60 * 1000;
  if (!timestamp || !signature || !secret) return false;

  const tsMs = Number(timestamp);
  if (!Number.isFinite(tsMs)) return false;
  if (Math.abs(Date.now() - tsMs) > maxSkewMs) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}${rawBody}`)
    .digest("hex");

  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(signature, "utf8");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function parseTokenExpiry(expiresAt: string | undefined): number {
  if (!expiresAt) return Date.now() + 25 * 60 * 1000;
  const ms = Date.parse(expiresAt);
  if (!Number.isFinite(ms)) return Date.now() + 25 * 60 * 1000;
  return ms - 60_000;
}

export async function getAirwallexAccessToken(): Promise<string> {
  if (!isAirwallexConfigured()) {
    throw new Error("Airwallex is not configured");
  }
  if (tokenCache && Date.now() < tokenCache.expiresAtMs) {
    return tokenCache.token;
  }

  const resp = await fetch(`${getAirwallexBaseUrl()}/api/v1/authentication/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ENV.airwallexApiKey,
      "x-client-id": ENV.airwallexClientId,
    },
    body: "{}",
  });

  const body = (await resp.json().catch(() => ({}))) as {
    token?: string;
    expires_at?: string;
    message?: string;
  };

  if (!resp.ok || !body.token) {
    throw new Error(body.message || `Airwallex login failed (${resp.status})`);
  }

  tokenCache = {
    token: body.token,
    expiresAtMs: parseTokenExpiry(body.expires_at),
  };
  return body.token;
}

export async function createAirwallexPaymentLink(input: {
  title: string;
  amount: number;
  currency: string;
  reference: string;
  metadata: Record<string, string>;
  expiresAt?: string;
}): Promise<AirwallexPaymentLinkResult> {
  const token = await getAirwallexAccessToken();
  const payload: Record<string, unknown> = {
    reusable: false,
    title: input.title,
    amount: roundMoney(input.amount),
    currency: input.currency,
    reference: input.reference,
    metadata: input.metadata,
  };
  if (input.expiresAt) payload.expires_at = input.expiresAt;

  const resp = await fetch(
    `${getAirwallexBaseUrl()}/api/v1/pa/payment_links/create`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  const body = (await resp.json().catch(() => ({}))) as {
    id?: string;
    url?: string;
    amount?: number;
    currency?: string;
    status?: string;
    expires_at?: string | null;
    message?: string;
  };

  if (!resp.ok || !body.id || !body.url) {
    throw new Error(body.message || `Airwallex payment link failed (${resp.status})`);
  }

  return {
    id: body.id,
    url: body.url,
    amount: Number(body.amount ?? input.amount),
    currency: body.currency ?? input.currency,
    status: body.status,
    expiresAt: body.expires_at ?? null,
  };
}
