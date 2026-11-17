import { describe, expect, it } from "vitest";
import {
  checkDeliveryReceiptAccess,
  isDeliveryReceiptEnabled,
} from "./deliveryReceipt";

describe("isDeliveryReceiptEnabled", () => {
  it("respects explicit flag", () => {
    expect(isDeliveryReceiptEnabled({ receiptEnabled: true, quoteId: null })).toBe(true);
    expect(isDeliveryReceiptEnabled({ receiptEnabled: false, quoteId: 12 })).toBe(false);
  });

  it("falls back to quote linkage when flag missing", () => {
    expect(isDeliveryReceiptEnabled({ quoteId: 9 })).toBe(true);
    expect(isDeliveryReceiptEnabled({ quoteId: null })).toBe(false);
    expect(isDeliveryReceiptEnabled({})).toBe(false);
  });
});

describe("checkDeliveryReceiptAccess", () => {
  const base = {
    status: "active",
    receiptEnabled: true,
    quoteId: 42,
    password: null as string | null,
    expiresAt: null as Date | null,
  };

  it("allows active non-expired receipt-enabled delivery", () => {
    expect(checkDeliveryReceiptAccess(base)).toEqual({ ok: true });
  });

  it("rejects expired deliveries even when receipt is enabled", () => {
    const result = checkDeliveryReceiptAccess(
      { ...base, expiresAt: new Date("2020-01-01T00:00:00Z") },
      { now: new Date("2026-11-17T00:00:00Z") }
    );
    expect(result).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "此交付連結已過期",
    });
  });

  it("rejects password-protected delivery without matching password", () => {
    const locked = { ...base, password: "secret" };
    expect(checkDeliveryReceiptAccess(locked).ok).toBe(false);
    expect(checkDeliveryReceiptAccess(locked, { password: "wrong" })).toEqual({
      ok: false,
      code: "UNAUTHORIZED",
      message: "密碼錯誤，請重試",
    });
    expect(checkDeliveryReceiptAccess(locked, { password: "secret" })).toEqual({
      ok: true,
    });
  });

  it("rejects when receipt download is disabled", () => {
    expect(
      checkDeliveryReceiptAccess({ ...base, receiptEnabled: false })
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});
