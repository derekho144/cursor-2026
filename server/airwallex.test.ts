import crypto from "crypto";
import { describe, expect, it } from "vitest";
import {
  computeQuoteBalanceAmount,
  computeQuoteDepositAmount,
  paymentAmountForKind,
  roundMoney,
  suggestPaymentKind,
  verifyAirwallexWebhookSignature,
} from "./airwallex";
import { buildQuotePaymentPatch } from "./airwallexPayment";

describe("Airwallex payment amounts", () => {
  it("computes percent deposit", () => {
    expect(
      computeQuoteDepositAmount({
        total: 10000,
        depositMode: "percent",
        depositPercent: 50,
      })
    ).toBe(5000);
  });

  it("computes fixed deposit", () => {
    expect(
      computeQuoteDepositAmount({
        total: 10000,
        depositMode: "fixed",
        depositFixedAmount: 3000,
      })
    ).toBe(3000);
  });

  it("suggests balance after deposit paid", () => {
    expect(
      suggestPaymentKind({
        paymentStatus: "deposit_paid",
        total: 10000,
        depositMode: "percent",
        depositPercent: 50,
      })
    ).toBe("balance");
  });

  it("computes balance from total minus deposit paid", () => {
    expect(computeQuoteBalanceAmount({ total: 10000 }, 4000)).toBe(6000);
    expect(
      paymentAmountForKind(
        {
          total: 10000,
          depositPaidAmount: 4000,
          depositMode: "percent",
          depositPercent: 50,
        },
        "balance"
      )
    ).toBe(6000);
  });

  it("rounds money to 2 decimals", () => {
    expect(roundMoney(123.456)).toBe(123.46);
  });
});

describe("buildQuotePaymentPatch", () => {
  it("records deposit on accepted quote", () => {
    const patch = buildQuotePaymentPatch({
      quote: {
        total: "10000",
        paymentStatus: "unpaid",
        depositPaidAmount: null,
        depositPaidAt: null,
        balancePaidAmount: null,
        balancePaidAt: null,
        paymentNotes: null,
        currency: "HKD",
      },
      kind: "deposit",
      amount: 5000,
      paidAt: new Date("2026-08-18T10:00:00Z"),
      paymentIntentId: "int_test_deposit",
    });
    expect(patch.paymentStatus).toBe("deposit_paid");
    expect(Number(patch.depositPaidAmount)).toBe(5000);
    expect(patch.depositPaidAt).toBeTruthy();
    expect(patch.paymentNotes).toContain("訂金");
    expect(patch.paymentNotes).toContain("int_test_deposit");
  });

  it("records balance and marks fully paid", () => {
    const patch = buildQuotePaymentPatch({
      quote: {
        total: "10000",
        paymentStatus: "deposit_paid",
        depositPaidAmount: "5000",
        depositPaidAt: new Date("2026-08-10"),
        balancePaidAmount: null,
        balancePaidAt: null,
        paymentNotes: "✓ Airwallex 訂金 HKD 5,000",
        currency: "HKD",
      },
      kind: "balance",
      amount: 5000,
      paidAt: new Date("2026-08-18T12:00:00Z"),
      paymentIntentId: "int_test_balance",
    });
    expect(patch.paymentStatus).toBe("fully_paid");
    expect(Number(patch.balancePaidAmount)).toBe(5000);
    expect(patch.paymentNotes).toContain("尾款");
  });
});

describe("verifyAirwallexWebhookSignature", () => {
  it("accepts valid HMAC signature", () => {
    const secret = "test-webhook-secret";
    const timestamp = String(Date.now());
    const rawBody = JSON.stringify({
      name: "payment_intent.succeeded",
      data: { object: { id: "int_test" } },
    });
    const signature = crypto
      .createHmac("sha256", secret)
      .update(`${timestamp}${rawBody}`)
      .digest("hex");

    expect(
      verifyAirwallexWebhookSignature({
        rawBody,
        timestamp,
        signature,
        secret,
      })
    ).toBe(true);
  });

  it("rejects tampered body", () => {
    const secret = "test-webhook-secret";
    const timestamp = String(Date.now());
    const rawBody = '{"name":"payment_intent.succeeded"}';
    const signature = crypto
      .createHmac("sha256", secret)
      .update(`${timestamp}${rawBody}`)
      .digest("hex");

    expect(
      verifyAirwallexWebhookSignature({
        rawBody: '{"name":"payment_intent.failed"}',
        timestamp,
        signature,
        secret,
      })
    ).toBe(false);
  });
});
