/**
 * Service-type default lines for quote 「備註 / Notes」.
 *
 * Product photography: clients ship samples to the studio — always show
 * the receiving address on new / switched-to product quotes.
 */

/** Studio receiving address for product sample drop-off. */
export const PRODUCT_RECEIVING_ADDRESS =
  "新蒲崗八達街安達工業中心5樓507C";

/** Managed notes line injected for product quotes. */
export const PRODUCT_RECEIVING_ADDRESS_NOTE = `收貨地址：${PRODUCT_RECEIVING_ADDRESS}`;

/** Detect our managed product receiving-address line (exact or close variants). */
export function isProductReceivingAddressNote(
  line: string | null | undefined
): boolean {
  const t = String(line ?? "").trim();
  if (!t) return false;
  if (t === PRODUCT_RECEIVING_ADDRESS_NOTE) return true;
  return /收貨地址/.test(t) && /安達工業中心/.test(t) && /507\s*C?/i.test(t);
}

function stripManagedProductNotes(notes: string): string {
  return notes
    .split("\n")
    .filter((line) => !isProductReceivingAddressNote(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Ensure product quotes include the studio receiving-address note;
 * remove it when switching away from product so other categories stay clean.
 */
export function applyServiceNotes(
  notes: string | null | undefined,
  serviceType: string
): string {
  const stripped = stripManagedProductNotes(String(notes ?? ""));
  if (serviceType !== "product") return stripped;
  if (!stripped) return PRODUCT_RECEIVING_ADDRESS_NOTE;
  if (stripped.split("\n").some((l) => isProductReceivingAddressNote(l))) {
    return stripped;
  }
  return `${stripped}\n${PRODUCT_RECEIVING_ADDRESS_NOTE}`;
}
