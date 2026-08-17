import { and, desc, eq } from "drizzle-orm";
import {
  airwallexPaymentLinks,
  quotes as quotesTable,
  type AirwallexPaymentLink,
  type Quote,
} from "../drizzle/schema";
import { getDb } from "./db";
import {
  createAirwallexPaymentLink,
  inferPaymentKindForQuote,
  listRecentSucceededPaymentIntents,
  paymentAmountForKind,
  paymentKindLabel,
  paymentKindLabelZh,
  roundMoney,
  suggestPaymentKind,
  type AirwallexPaymentLinkKind,
} from "./airwallex";
import { resyncClientMembershipFromQuotes } from "./db";

export type AirwallexPaymentApplyResult =
  | { applied: true; quoteId: number; kind: AirwallexPaymentLinkKind; paymentStatus: string }
  | { applied: false; reason: string; quoteId?: number };

export type AirwallexPaymentNotification = {
  paymentIntentId?: string;
  paymentLinkId?: string;
  quoteId?: number;
  quoteNumber?: string;
  kind?: AirwallexPaymentLinkKind;
  amount?: number;
  paidAt: Date;
};

export async function ensureAirwallexPaymentLinksTable(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS airwallex_payment_links (
        id int AUTO_INCREMENT NOT NULL,
        quote_id int NOT NULL,
        kind enum('deposit','balance','full') NOT NULL,
        airwallex_id varchar(64) NOT NULL,
        url varchar(1024) NOT NULL,
        amount decimal(10,2) NOT NULL,
        currency varchar(8) NOT NULL DEFAULT 'HKD',
        status varchar(32) NOT NULL DEFAULT 'UNPAID',
        payment_intent_id varchar(64) NULL,
        paid_at timestamp NULL,
        expires_at timestamp NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT airwallex_payment_links_id PRIMARY KEY(id),
        UNIQUE KEY airwallex_payment_links_airwallex_id (airwallex_id),
        KEY airwallex_payment_links_quote_id (quote_id),
        KEY airwallex_payment_links_payment_intent_id (payment_intent_id)
      )
    `);
    try {
      await db.execute(`
        CREATE INDEX airwallex_payment_links_payment_intent_id
        ON airwallex_payment_links (payment_intent_id)
      `);
    } catch {
      // index may already exist
    }
  } catch (err) {
    console.error("[Airwallex] ensureTable error:", err);
  }
}

export async function listAirwallexPaymentLinksForQuote(
  quoteId: number
): Promise<AirwallexPaymentLink[]> {
  await ensureAirwallexPaymentLinksTable();
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(airwallexPaymentLinks)
    .where(eq(airwallexPaymentLinks.quoteId, quoteId))
    .orderBy(desc(airwallexPaymentLinks.createdAt));
}

export async function getAirwallexPaymentLinkByAirwallexId(
  airwallexId: string
): Promise<AirwallexPaymentLink | null> {
  await ensureAirwallexPaymentLinksTable();
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(airwallexPaymentLinks)
    .where(eq(airwallexPaymentLinks.airwallexId, airwallexId))
    .limit(1);
  return row ?? null;
}

async function getAirwallexLinkByPaymentIntentId(
  paymentIntentId: string
): Promise<AirwallexPaymentLink | null> {
  await ensureAirwallexPaymentLinksTable();
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(airwallexPaymentLinks)
    .where(eq(airwallexPaymentLinks.paymentIntentId, paymentIntentId))
    .limit(1);
  return row ?? null;
}

async function getAcceptedQuoteById(quoteId: number): Promise<Quote | null> {
  const db = await getDb();
  if (!db) return null;
  const [quote] = await db
    .select()
    .from(quotesTable)
    .where(and(eq(quotesTable.id, quoteId), eq(quotesTable.status, "accepted")))
    .limit(1);
  return quote ?? null;
}

function paymentIntentAlreadyRecorded(notes: string | null | undefined, paymentIntentId: string): boolean {
  return Boolean(notes?.includes(paymentIntentId));
}

async function getAcceptedQuoteByNumber(quoteNumber: string): Promise<Quote | null> {
  const db = await getDb();
  if (!db) return null;
  const [quote] = await db
    .select()
    .from(quotesTable)
    .where(and(eq(quotesTable.quoteNumber, quoteNumber), eq(quotesTable.status, "accepted")))
    .limit(1);
  return quote ?? null;
}

/** Pure payment field update for an accepted quote (deposit / balance / full). */
export function buildQuotePaymentPatch(input: {
  quote: Pick<
    Quote,
    | "total"
    | "paymentStatus"
    | "depositPaidAmount"
    | "depositPaidAt"
    | "balancePaidAmount"
    | "balancePaidAt"
    | "paymentNotes"
    | "currency"
  >;
  kind: AirwallexPaymentLinkKind;
  amount: number;
  paidAt: Date;
  paymentIntentId?: string;
}): {
  paymentStatus: "unpaid" | "deposit_paid" | "fully_paid";
  depositPaidAmount: string | null;
  depositPaidAt: Date | null;
  balancePaidAmount: string | null;
  balancePaidAt: Date | null;
  paymentNotes: string;
} {
  const amount = roundMoney(input.amount);
  const total = Number(input.quote.total) || 0;
  const label = paymentKindLabelZh(input.kind);
  const dateStr = input.paidAt.toISOString().slice(0, 10);
  const noteLine = `✓ Airwallex ${label} ${input.quote.currency || "HKD"} ${amount.toLocaleString("en-HK")} · ${dateStr}${
    input.paymentIntentId ? ` · ${input.paymentIntentId}` : ""
  }`;

  let paymentStatus: "unpaid" | "deposit_paid" | "fully_paid" = input.quote.paymentStatus;
  let depositPaidAmount = input.quote.depositPaidAmount;
  let depositPaidAt = input.quote.depositPaidAt;
  let balancePaidAmount = input.quote.balancePaidAmount;
  let balancePaidAt = input.quote.balancePaidAt;

  if (input.kind === "deposit") {
    depositPaidAmount = String(amount);
    depositPaidAt = input.paidAt;
    paymentStatus = amount >= total ? "fully_paid" : "deposit_paid";
    if (paymentStatus === "fully_paid") {
      balancePaidAmount = null;
      balancePaidAt = null;
    }
  } else if (input.kind === "balance") {
    balancePaidAmount = String(amount);
    balancePaidAt = input.paidAt;
    paymentStatus = "fully_paid";
  } else {
    depositPaidAmount = String(amount);
    depositPaidAt = input.paidAt;
    if (amount >= total) {
      paymentStatus = "fully_paid";
      balancePaidAmount = null;
      balancePaidAt = null;
    } else {
      paymentStatus = "deposit_paid";
    }
  }

  const existingNotes = input.quote.paymentNotes?.trim();
  const paymentNotes = existingNotes ? `${existingNotes}\n${noteLine}` : noteLine;

  return {
    paymentStatus,
    depositPaidAmount,
    depositPaidAt,
    balancePaidAmount,
    balancePaidAt,
    paymentNotes,
  };
}

export async function createQuoteAirwallexPaymentLink(input: {
  quoteId: number;
  kind?: AirwallexPaymentLinkKind;
  forceNew?: boolean;
}): Promise<AirwallexPaymentLink> {
  await ensureAirwallexPaymentLinksTable();
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [quote] = await db
    .select()
    .from(quotesTable)
    .where(eq(quotesTable.id, input.quoteId))
    .limit(1);
  if (!quote) throw new Error("Quote not found");
  if (quote.status !== "accepted") {
    throw new Error("只限已接受報價單可建立 Airwallex 付款連結");
  }

  const kind = input.kind ?? suggestPaymentKind(quote);
  const amount = paymentAmountForKind(quote, kind);
  if (amount <= 0) throw new Error("Payment amount must be greater than zero");

  if (!input.forceNew) {
    const [existing] = await db
      .select()
      .from(airwallexPaymentLinks)
      .where(
        and(
          eq(airwallexPaymentLinks.quoteId, input.quoteId),
          eq(airwallexPaymentLinks.kind, kind),
          eq(airwallexPaymentLinks.status, "UNPAID")
        )
      )
      .orderBy(desc(airwallexPaymentLinks.createdAt))
      .limit(1);
    if (existing?.url) return existing;
  }

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const created = await createAirwallexPaymentLink({
    title: `JD Studio ${quote.quoteNumber} — ${paymentKindLabel(kind)}`,
    amount,
    currency: quote.currency || "HKD",
    reference: quote.quoteNumber,
    metadata: {
      quoteId: String(quote.id),
      quoteNumber: quote.quoteNumber,
      kind,
    },
    expiresAt,
  });

  await db.insert(airwallexPaymentLinks).values({
    quoteId: quote.id,
    kind,
    airwallexId: created.id,
    url: created.url,
    amount: String(roundMoney(amount)),
    currency: created.currency,
    status: created.status ?? "UNPAID",
    expiresAt: created.expiresAt ? new Date(created.expiresAt) : new Date(expiresAt),
  });

  const [saved] = await db
    .select()
    .from(airwallexPaymentLinks)
    .where(eq(airwallexPaymentLinks.airwallexId, created.id))
    .limit(1);
  if (!saved) throw new Error("Failed to save payment link");
  return saved;
}

export async function markAirwallexLinkPaid(input: {
  airwallexId: string;
  paymentIntentId?: string;
  paidAt: Date;
}): Promise<AirwallexPaymentLink | null> {
  await ensureAirwallexPaymentLinksTable();
  const db = await getDb();
  if (!db) return null;

  await db
    .update(airwallexPaymentLinks)
    .set({
      status: "PAID",
      paymentIntentId: input.paymentIntentId ?? null,
      paidAt: input.paidAt,
    })
    .where(eq(airwallexPaymentLinks.airwallexId, input.airwallexId));

  return getAirwallexPaymentLinkByAirwallexId(input.airwallexId);
}

/** Resolve quote + kind + amount from webhook / payment_link.paid payload. */
export async function resolveAirwallexPaymentNotification(
  notification: AirwallexPaymentNotification
): Promise<{
  quoteId: number;
  kind: AirwallexPaymentLinkKind;
  amount: number;
  paymentLinkId?: string;
  paymentIntentId?: string;
  paidAt: Date;
} | null> {
  let quoteId = notification.quoteId && notification.quoteId > 0 ? notification.quoteId : 0;
  let kind = notification.kind;
  let amount = notification.amount;
  let paymentLinkId = notification.paymentLinkId;
  const paymentIntentId = notification.paymentIntentId;

  if (paymentIntentId) {
    const byIntent = await getAirwallexLinkByPaymentIntentId(paymentIntentId);
    if (byIntent?.status === "PAID") return null;
  }

  let link = paymentLinkId
    ? await getAirwallexPaymentLinkByAirwallexId(paymentLinkId)
    : null;

  if (!link && paymentIntentId) {
    link = await getAirwallexLinkByPaymentIntentId(paymentIntentId);
  }

  if (link) {
    if (link.status === "PAID" && paymentIntentId && link.paymentIntentId === paymentIntentId) {
      return null;
    }
    quoteId = quoteId || link.quoteId;
    kind = kind || (link.kind as AirwallexPaymentLinkKind);
    amount = amount || Number(link.amount);
    paymentLinkId = paymentLinkId || link.airwallexId;
  }

  if (!quoteId && notification.quoteNumber) {
    const quote = await getAcceptedQuoteByNumber(notification.quoteNumber);
    if (quote) quoteId = quote.id;
  }

  if (quoteId && (!kind || !amount)) {
    const quote = await getAcceptedQuoteById(quoteId);
    if (quote) {
      if (!kind && amount) {
        kind = inferPaymentKindForQuote(quote, amount) ?? undefined;
      } else if (kind && !amount) {
        amount = paymentAmountForKind(quote, kind);
      } else if (!kind && !amount) {
        kind = suggestPaymentKind(quote);
        amount = paymentAmountForKind(quote, kind);
      }
    }
  }

  if (!quoteId || !kind || !amount || amount <= 0) return null;

  return {
    quoteId,
    kind,
    amount,
    paymentLinkId,
    paymentIntentId,
    paidAt: notification.paidAt,
  };
}

/** Apply Airwallex payment to an accepted quote — idempotent by payment intent. */
export async function applyAirwallexPaymentToQuote(input: {
  quoteId: number;
  kind: AirwallexPaymentLinkKind;
  amount: number;
  paidAt: Date;
  paymentIntentId?: string;
  paymentLinkId?: string;
  source?: string;
}): Promise<AirwallexPaymentApplyResult> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  if (input.paymentIntentId) {
    const existing = await getAirwallexLinkByPaymentIntentId(input.paymentIntentId);
    if (existing?.status === "PAID") {
      return {
        applied: false,
        reason: "duplicate_payment_intent",
        quoteId: existing.quoteId,
      };
    }
  }

  const [quote] = await db
    .select()
    .from(quotesTable)
    .where(eq(quotesTable.id, input.quoteId))
    .limit(1);
  if (!quote) {
    return { applied: false, reason: "quote_not_found" };
  }
  if (quote.status !== "accepted") {
    return {
      applied: false,
      reason: "quote_not_accepted",
      quoteId: quote.id,
    };
  }

  if (
    input.paymentIntentId &&
    paymentIntentAlreadyRecorded(quote.paymentNotes, input.paymentIntentId)
  ) {
    return {
      applied: false,
      reason: "duplicate_payment_intent",
      quoteId: quote.id,
    };
  }

  if (input.kind === "deposit" && quote.paymentStatus === "fully_paid") {
    return { applied: false, reason: "already_fully_paid", quoteId: quote.id };
  }
  if (input.kind === "balance" && quote.paymentStatus === "fully_paid") {
    return { applied: false, reason: "already_fully_paid", quoteId: quote.id };
  }

  const patch = buildQuotePaymentPatch({
    quote,
    kind: input.kind,
    amount: input.amount,
    paidAt: input.paidAt,
    paymentIntentId: input.paymentIntentId,
  });

  if (input.paymentLinkId) {
    await markAirwallexLinkPaid({
      airwallexId: input.paymentLinkId,
      paymentIntentId: input.paymentIntentId,
      paidAt: input.paidAt,
    });
  }

  await db
    .update(quotesTable)
    .set({
      paymentStatus: patch.paymentStatus,
      depositPaidAmount: patch.depositPaidAmount,
      depositPaidAt: patch.depositPaidAt,
      balancePaidAmount: patch.balancePaidAmount,
      balancePaidAt: patch.balancePaidAt,
      paymentNotes: patch.paymentNotes,
    })
    .where(eq(quotesTable.id, input.quoteId));

  if (patch.paymentStatus === "fully_paid" && quote.clientId) {
    try {
      await resyncClientMembershipFromQuotes(quote.clientId);
    } catch (err) {
      console.error("[Airwallex] membership resync failed:", err);
    }
  }

  console.log(
    `[Airwallex] Quote ${quote.quoteNumber} #${input.quoteId}: ${input.kind} confirmed → ${patch.paymentStatus} (${input.source ?? "webhook"})`
  );

  return {
    applied: true,
    quoteId: input.quoteId,
    kind: input.kind,
    paymentStatus: patch.paymentStatus,
  };
}

export async function processAirwallexPaymentNotification(
  notification: AirwallexPaymentNotification
): Promise<AirwallexPaymentApplyResult> {
  const resolved = await resolveAirwallexPaymentNotification(notification);
  if (!resolved) {
    return { applied: false, reason: "unresolved_notification" };
  }

  return applyAirwallexPaymentToQuote({
    quoteId: resolved.quoteId,
    kind: resolved.kind,
    amount: resolved.amount,
    paidAt: resolved.paidAt,
    paymentIntentId: resolved.paymentIntentId,
    paymentLinkId: resolved.paymentLinkId,
    source: "webhook",
  });
}

/** Pull recent succeeded Airwallex payments and apply any not yet recorded. */
export async function syncRecentAirwallexPayments(sinceHours = 72): Promise<{
  scanned: number;
  applied: number;
  skipped: number;
  results: AirwallexPaymentApplyResult[];
}> {
  const intents = await listRecentSucceededPaymentIntents(sinceHours);
  const results: AirwallexPaymentApplyResult[] = [];
  let applied = 0;
  let skipped = 0;

  for (const intent of intents) {
    const meta = intent.metadata ?? {};
    const quoteNumber =
      meta.quoteNumber ?? intent.reference ?? intent.merchantOrderId;
    const result = await processAirwallexPaymentNotification({
      paymentIntentId: intent.id,
      paymentLinkId: intent.paymentLinkId,
      quoteId: Number(meta.quoteId) || undefined,
      quoteNumber,
      kind:
        meta.kind === "deposit" || meta.kind === "balance" || meta.kind === "full"
          ? meta.kind
          : undefined,
      amount: intent.amount,
      paidAt: new Date(intent.updatedAt ?? intent.createdAt ?? Date.now()),
    });
    results.push(result);
    if (result.applied) applied += 1;
    else skipped += 1;
  }

  return { scanned: intents.length, applied, skipped, results };
}
