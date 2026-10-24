import { describe, expect, it } from "vitest";
import {
  normalizeWaPhone,
  parseWhatsappWebhookPayload,
  pickAdsClickForInbound,
  verifyWhatsappSignature,
  verifyWhatsappWebhookChallenge,
} from "./whatsappCloud";

describe("normalizeWaPhone", () => {
  it("normalizes HK local and E.164", () => {
    expect(normalizeWaPhone("9123 4567")).toBe("85291234567");
    expect(normalizeWaPhone("+85291234567")).toBe("85291234567");
    expect(normalizeWaPhone("85291234567")).toBe("85291234567");
  });
});

describe("parseWhatsappWebhookPayload", () => {
  it("extracts text messages and contact name", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                contacts: [{ wa_id: "85291234567", profile: { name: "Amy" } }],
                messages: [
                  {
                    id: "wamid.ABC",
                    from: "85291234567",
                    timestamp: "1729747200",
                    type: "text",
                    text: { body: "你好，我想查詢JD Studio的攝影服務" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const msgs = parseWhatsappWebhookPayload(payload);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.fromPhone).toBe("85291234567");
    expect(msgs[0]?.contactName).toBe("Amy");
    expect(msgs[0]?.body).toContain("JD Studio");
    expect(msgs[0]?.waMessageId).toBe("wamid.ABC");
  });
});

describe("pickAdsClickForInbound", () => {
  const t0 = new Date("2026-10-24T04:30:00Z");
  it("matches when exactly one unmatched click in window", () => {
    const result = pickAdsClickForInbound(
      [
        { id: 1, clickedAt: new Date("2026-10-24T04:00:00Z"), quoteId: null },
        { id: 2, clickedAt: new Date("2026-10-20T04:00:00Z"), quoteId: null },
      ],
      t0
    );
    expect(result).toEqual({ clickId: 1, reason: "single_recent" });
  });

  it("picks most recent click when multiple unmatched in window", () => {
    const result = pickAdsClickForInbound(
      [
        { id: 1, clickedAt: new Date("2026-10-24T04:00:00Z"), quoteId: null },
        { id: 2, clickedAt: new Date("2026-10-24T04:10:00Z"), quoteId: null },
      ],
      t0
    );
    // t0 = 04:30; both before message → last click is id 2 at 04:10
    expect(result).toEqual({ clickId: 2, reason: "last_click" });
  });

  it("ignores already matched / quoted clicks", () => {
    const result = pickAdsClickForInbound(
      [
        {
          id: 1,
          clickedAt: new Date("2026-10-24T04:00:00Z"),
          quoteId: null,
          matchedPhone: "85291112222",
        },
        { id: 2, clickedAt: new Date("2026-10-24T04:05:00Z"), quoteId: 99 },
      ],
      t0
    );
    expect(result.reason).toBe("none");
  });
});

describe("webhook verify helpers", () => {
  const keys = [
    "WHATSAPP_TOKEN",
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_VERIFY_TOKEN",
    "WHATSAPP_APP_SECRET",
  ] as const;

  function withEnv(values: Partial<Record<(typeof keys)[number], string>>, fn: () => void | Promise<void>) {
    const prev: Record<string, string | undefined> = {};
    for (const k of keys) {
      prev[k] = process.env[k];
      if (values[k] === undefined) delete process.env[k];
      else process.env[k] = values[k];
    }
    return Promise.resolve(fn()).finally(() => {
      for (const k of keys) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
    });
  }

  it("challenge requires configured verify token", async () => {
    await withEnv(
      {
        WHATSAPP_TOKEN: "t",
        WHATSAPP_PHONE_NUMBER_ID: "1",
        WHATSAPP_VERIFY_TOKEN: "secret-verify",
      },
      () => {
        expect(
          verifyWhatsappWebhookChallenge({
            "hub.mode": "subscribe",
            "hub.verify_token": "secret-verify",
            "hub.challenge": "12345",
          })
        ).toBe("12345");
        expect(
          verifyWhatsappWebhookChallenge({
            "hub.mode": "subscribe",
            "hub.verify_token": "wrong",
            "hub.challenge": "12345",
          })
        ).toBeNull();
      }
    );
  });

  it("signature check passes with matching HMAC when secret set", async () => {
    await withEnv(
      {
        WHATSAPP_TOKEN: "t",
        WHATSAPP_PHONE_NUMBER_ID: "1",
        WHATSAPP_VERIFY_TOKEN: "v",
        WHATSAPP_APP_SECRET: "app-secret",
      },
      async () => {
        const crypto = await import("crypto");
        const body = Buffer.from('{"ok":true}');
        const sig =
          "sha256=" +
          crypto.createHmac("sha256", "app-secret").update(body).digest("hex");
        expect(verifyWhatsappSignature(body, sig)).toBe(true);
        expect(verifyWhatsappSignature(body, "sha256=deadbeef")).toBe(false);
      }
    );
  });
});
