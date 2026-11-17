/** Whether the client delivery page may show / open receipt download. */
export function isDeliveryReceiptEnabled(delivery: {
  receiptEnabled?: boolean | null;
  quoteId?: number | null;
}): boolean {
  if (typeof delivery.receiptEnabled === "boolean") return delivery.receiptEnabled;
  // Pre-migration / null column: keep previous behaviour for linked quotes
  return delivery.quoteId != null;
}

export type DeliveryReceiptAccessDenial = {
  ok: false;
  code: "FORBIDDEN" | "UNAUTHORIZED" | "NOT_FOUND";
  message: string;
};

export type DeliveryReceiptAccessResult =
  | { ok: true }
  | DeliveryReceiptAccessDenial;

/**
 * Shared gates for /receipt/:token (getQuoteByDeliveryToken).
 * Must stay aligned with other public delivery endpoints for expiry + password.
 */
export function checkDeliveryReceiptAccess(
  delivery: {
    status: string;
    expiresAt?: Date | string | null;
    password?: string | null;
    receiptEnabled?: boolean | null;
    quoteId?: number | null;
  },
  opts?: { password?: string; now?: Date }
): DeliveryReceiptAccessResult {
  if (delivery.status !== "active") {
    return { ok: false, code: "FORBIDDEN", message: "此交付連結已停用" };
  }

  if (delivery.expiresAt) {
    const expiresAt = new Date(delivery.expiresAt);
    if (!Number.isNaN(expiresAt.getTime()) && (opts?.now ?? new Date()) > expiresAt) {
      return { ok: false, code: "FORBIDDEN", message: "此交付連結已過期" };
    }
  }

  if (!isDeliveryReceiptEnabled(delivery)) {
    return { ok: false, code: "FORBIDDEN", message: "此交付連結未開放收據下載" };
  }

  if (delivery.password) {
    const provided = opts?.password?.trim() ?? "";
    if (!provided || delivery.password !== provided) {
      return { ok: false, code: "UNAUTHORIZED", message: "密碼錯誤，請重試" };
    }
  }

  if (!delivery.quoteId) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "此交付連結尚未連結報價單，請聯絡 JD Studio 設定",
    };
  }

  return { ok: true };
}
