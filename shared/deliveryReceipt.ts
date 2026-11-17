/** Whether the client delivery page may show / open receipt download. */
export function isDeliveryReceiptEnabled(delivery: {
  receiptEnabled?: boolean | null;
  quoteId?: number | null;
}): boolean {
  if (typeof delivery.receiptEnabled === "boolean") return delivery.receiptEnabled;
  // Pre-migration / null column: keep previous behaviour for linked quotes
  return delivery.quoteId != null;
}
