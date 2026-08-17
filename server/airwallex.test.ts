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
