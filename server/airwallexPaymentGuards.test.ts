import { beforeEach, describe, expect, it, vi } from "vitest";

const quoteUpdateSet = vi.fn();
const quoteUpdateWhere = vi.fn().mockResolvedValue(undefined);

const quoteRow = {
  id: 42,
  quoteNumber: "JD202611-TEST",
  status: "accepted",
  clientId: null,
  total: "10000",
  currency: "HKD",
  paymentStatus: "deposit_paid" as string,
  depositPaidAmount: "5000",
  depositPaidAt: new Date("2026-11-10"),
  balancePaidAmount: null,
  balancePaidAt: null,
  paymentNotes: "✓ Airwallex 訂金 HKD 5,000 · int_dep",
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
  update: vi.fn(() => ({
    set: (values: unknown) => {
      quoteUpdateSet(values);
      return { where: quoteUpdateWhere };
    },
  })),
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

describe("applyAirwallexPaymentToQuote guards after deposit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    quoteRow.paymentStatus = "deposit_paid";
    quoteRow.paymentNotes = "✓ Airwallex 訂金 HKD 5,000 · int_dep";
  });

  it("rejects full payment after deposit already booked", async () => {
    const result = await applyAirwallexPaymentToQuote({
      quoteId: 42,
      kind: "full",
      amount: 10000,
      paidAt: new Date("2026-11-16T04:00:00.000Z"),
      paymentIntentId: "int_full_after_dep",
      paymentLinkId: "link_full",
    });
    expect(result).toEqual({
      applied: false,
      reason: "deposit_already_paid_use_balance",
      quoteId: 42,
    });
    expect(quoteUpdateSet).not.toHaveBeenCalled();
  });

  it("rejects a second deposit after deposit already booked", async () => {
    const result = await applyAirwallexPaymentToQuote({
      quoteId: 42,
      kind: "deposit",
      amount: 5000,
      paidAt: new Date("2026-11-16T04:00:00.000Z"),
      paymentIntentId: "int_dep_2",
    });
    expect(result).toEqual({
      applied: false,
      reason: "deposit_already_paid",
      quoteId: 42,
    });
    expect(quoteUpdateSet).not.toHaveBeenCalled();
  });

  it("still accepts balance after deposit", async () => {
    const result = await applyAirwallexPaymentToQuote({
      quoteId: 42,
      kind: "balance",
      amount: 5000,
      paidAt: new Date("2026-11-16T04:00:00.000Z"),
      paymentIntentId: "int_bal",
    });
    expect(result).toMatchObject({
      applied: true,
      kind: "balance",
      paymentStatus: "fully_paid",
    });
    expect(quoteUpdateSet).toHaveBeenCalled();
  });
});
