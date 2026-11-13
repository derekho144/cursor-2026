import { beforeEach, describe, expect, it, vi } from "vitest";

const quoteUpdateSet = vi.fn();
const quoteUpdateWhere = vi.fn().mockResolvedValue(undefined);
const linkUpdateSet = vi.fn();
const linkUpdateWhere = vi.fn().mockResolvedValue(undefined);

const quoteRow = {
  id: 42,
  quoteNumber: "JD202611-TEST",
  status: "accepted",
  clientId: null,
  total: "10000",
  currency: "HKD",
  paymentStatus: "unpaid",
  depositPaidAmount: null,
  depositPaidAt: null,
  balancePaidAmount: null,
  balancePaidAt: null,
  paymentNotes: null,
};

const dbMock = {
  execute: vi.fn().mockResolvedValue(undefined),
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => [{ ...quoteRow }]),
      })),
    })),
  })),
  update: vi.fn(() => {
    // Distinguish quote vs link updates by payload shape; call order is asserted.
    return {
      set: (values: unknown) => {
        if (
          values &&
          typeof values === "object" &&
          "paymentStatus" in (values as object)
        ) {
          quoteUpdateSet(values);
          return { where: quoteUpdateWhere };
        }
        linkUpdateSet(values);
        return { where: linkUpdateWhere };
      },
    };
  }),
};

vi.mock("./db", () => ({
  getDb: vi.fn(async () => dbMock),
  resyncClientMembershipFromQuotes: vi.fn(),
}));

vi.mock("../drizzle/schema", () => ({
  quotes: { id: "quotes.id" },
  airwallexPaymentLinks: {
    airwallexId: "airwallexPaymentLinks.airwallexId",
    paymentIntentId: "airwallexPaymentLinks.paymentIntentId",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  desc: vi.fn((x: unknown) => x),
  eq: vi.fn((a: unknown, b: unknown) => [a, b]),
}));

import { applyAirwallexPaymentToQuote } from "./airwallexPayment";

describe("applyAirwallexPaymentToQuote ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    quoteRow.paymentNotes = null;
    quoteRow.paymentStatus = "unpaid";
    quoteUpdateWhere.mockResolvedValue(undefined);
    linkUpdateWhere.mockResolvedValue(undefined);
  });

  it("updates the quote before marking the payment link PAID", async () => {
    const order: string[] = [];
    quoteUpdateSet.mockImplementation(() => {
      order.push("quote");
    });
    linkUpdateSet.mockImplementation(() => {
      order.push("link");
    });

    const result = await applyAirwallexPaymentToQuote({
      quoteId: 42,
      kind: "deposit",
      amount: 5000,
      paidAt: new Date("2026-11-13T04:00:00.000Z"),
      paymentIntentId: "int_test_1",
      paymentLinkId: "link_test_1",
      source: "test",
    });

    expect(result).toMatchObject({ applied: true, quoteId: 42, kind: "deposit" });
    expect(order).toEqual(["quote", "link"]);
    expect(quoteUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentStatus: "deposit_paid",
        paymentNotes: expect.stringContaining("int_test_1"),
      })
    );
    expect(linkUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "PAID",
        paymentIntentId: "int_test_1",
      })
    );
  });

  it("still applies when link was already PAID but quote notes lack the intent", async () => {
    // Simulate legacy failure mode: link row PAID, quote unpaid / notes empty.
    // Idempotency must not key off the link alone.
    const result = await applyAirwallexPaymentToQuote({
      quoteId: 42,
      kind: "deposit",
      amount: 5000,
      paidAt: new Date("2026-11-13T04:00:00.000Z"),
      paymentIntentId: "int_orphan_paid_link",
      paymentLinkId: "link_orphan",
      source: "retry",
    });

    expect(result.applied).toBe(true);
    expect(quoteUpdateSet).toHaveBeenCalled();
  });

  it("skips when quote paymentNotes already record the payment intent", async () => {
    quoteRow.paymentNotes = "✓ Airwallex 訂金 HKD 5,000 · 2026-11-13 · int_dup";
    quoteRow.paymentStatus = "deposit_paid";

    const result = await applyAirwallexPaymentToQuote({
      quoteId: 42,
      kind: "deposit",
      amount: 5000,
      paidAt: new Date("2026-11-13T04:00:00.000Z"),
      paymentIntentId: "int_dup",
      paymentLinkId: "link_dup",
    });

    expect(result).toEqual({
      applied: false,
      reason: "duplicate_payment_intent",
      quoteId: 42,
    });
    expect(quoteUpdateSet).not.toHaveBeenCalled();
    expect(linkUpdateSet).not.toHaveBeenCalled();
  });
});
