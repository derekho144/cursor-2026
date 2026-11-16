import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const { envState, processAirwallexPaymentNotification } = vi.hoisted(() => ({
  envState: {
    airwallexWebhookSecret: "",
    isProduction: true,
  },
  processAirwallexPaymentNotification: vi.fn(async () => ({
    applied: false,
    reason: "should_not_run",
  })),
}));

vi.mock("./_core/env", () => ({
  ENV: envState,
}));

vi.mock("./airwallex", () => ({
  verifyAirwallexWebhookSignature: vi.fn(() => false),
}));

vi.mock("./airwallexPayment", () => ({
  processAirwallexPaymentNotification,
}));

import { handleAirwallexWebhook } from "./airwallexWebhook";

function mockRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe("handleAirwallexWebhook auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envState.airwallexWebhookSecret = "";
    envState.isProduction = true;
  });

  it("rejects unsigned webhooks in production when secret is missing", async () => {
    const req = {
      body: Buffer.from(
        JSON.stringify({
          name: "payment_intent.succeeded",
          data: { object: { id: "int_fake", amount: 1, metadata: { quoteId: "1" } } },
        })
      ),
      headers: {},
    } as unknown as Request;
    const res = mockRes();

    await handleAirwallexWebhook(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({
      received: false,
      error: "webhook secret not configured",
    });
    expect(processAirwallexPaymentNotification).not.toHaveBeenCalled();
  });

  it("allows unsigned webhooks outside production when secret is missing", async () => {
    envState.isProduction = false;
    const req = {
      body: Buffer.from(
        JSON.stringify({
          name: "payment_link.paid",
          data: { object: { id: "link_dev", amount: 100 } },
        })
      ),
      headers: {},
    } as unknown as Request;
    const res = mockRes();

    await handleAirwallexWebhook(req, res);

    expect(processAirwallexPaymentNotification).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });
});
