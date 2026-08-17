import { and, desc, eq } from "drizzle-orm";
import {
  airwallexPaymentLinks,
  quotes as quotesTable,
  type AirwallexPaymentLink,
} from "../drizzle/schema";
import { getDb } from "./db";
import {
  createAirwallexPaymentLink,
  paymentAmountForKind,
  paymentKindLabel,
  roundMoney,
  suggestPaymentKind,
  type AirwallexPaymentLinkKind,
} from "./airwallex";
import { resyncClientMembershipFromQuotes } from "./db";

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
        KEY airwallex_payment_links_quote_id (quote_id)
      )
    `);
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

export async function applyAirwallexPaymentToQuote(input: {
  quoteId: number;
  kind: AirwallexPaymentLinkKind;
  amount: number;
  paidAt: Date;
  paymentIntentId?: string;
  source?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [quote] = await db
    .select()
    .from(quotesTable)
    .where(eq(quotesTable.id, input.quoteId))
    .limit(1);
  if (!quote) throw new Error("Quote not found");

  const amount = roundMoney(input.amount);
  const total = Number(quote.total) || 0;
  const noteLine = `Airwallex ${input.kind}${input.paymentIntentId ? ` (${input.paymentIntentId})` : ""}`;

  let paymentStatus: "unpaid" | "deposit_paid" | "fully_paid" = quote.paymentStatus;
  let depositPaidAmount = quote.depositPaidAmount;
  let depositPaidAt = quote.depositPaidAt;
  let balancePaidAmount = quote.balancePaidAmount;
  let balancePaidAt = quote.balancePaidAt;

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

  const existingNotes = quote.paymentNotes?.trim();
  const paymentNotes = existingNotes
    ? `${existingNotes}\n${noteLine}`
    : noteLine;

  await db
    .update(quotesTable)
    .set({
      paymentStatus,
      depositPaidAmount,
      depositPaidAt,
      balancePaidAmount,
      balancePaidAt,
      paymentNotes,
    })
    .where(eq(quotesTable.id, input.quoteId));

  if (paymentStatus === "fully_paid" && quote.clientId) {
    try {
      await resyncClientMembershipFromQuotes(quote.clientId);
    } catch (err) {
      console.error("[Airwallex] membership resync failed:", err);
    }
  }
}
