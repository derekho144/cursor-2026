/**
 * Service-type default lines for quote 「備註 / Notes」.
 *
 * Product photography: clients ship samples to the studio — always show
 * the receiving address on new / switched-to product quotes.
 *
 * Graphic design: fixed revisions + copyright / ownership terms.
 */

/** Studio receiving address for product sample drop-off. */
export const PRODUCT_RECEIVING_ADDRESS =
  "新蒲崗八達街安達工業中心5樓507C";

/** Managed notes line injected for product quotes. */
export const PRODUCT_RECEIVING_ADDRESS_NOTE = `收貨地址：${PRODUCT_RECEIVING_ADDRESS}`;

/** Fixed revisions + copyright terms for 平面設計 quotes. */
export const GRAPHIC_DESIGN_SERVICE_NOTES = [
  "【修改次數與範圍 (Revisions & Changes)】",
  "免費修改：每個設計項目包含 3次免費修改機會（範圍包括排版微調、字體更換、顏色微調等）",
  "額外修改：超過免費次數，或在設計方向確立後要求大幅度推倒重來（例如重新更換整體概念、更改主要視覺架構），將視乎情況額外收取設計費",
  "",
  "【版權與使用權 (Copyright & Ownership)】",
  "版權轉讓：在項目尾數全數付清後，最終完成之設計成品之商業使用權將轉讓予客戶",
  "作品集權利：JD STUDIO HK 保留將是次設計成品用於公司作品集（Portfolio）、官方網站及社交媒體宣傳之權利",
].join("\n");

/** Detect our managed product receiving-address line (exact or close variants). */
export function isProductReceivingAddressNote(
  line: string | null | undefined
): boolean {
  const t = String(line ?? "").trim();
  if (!t) return false;
  if (t === PRODUCT_RECEIVING_ADDRESS_NOTE) return true;
  return /收貨地址/.test(t) && /安達工業中心/.test(t) && /507\s*C?/i.test(t);
}

/** Detect a managed graphic-design terms line (exact or close variants). */
export function isGraphicDesignManagedNote(
  line: string | null | undefined
): boolean {
  const t = String(line ?? "").trim();
  if (!t) return false;
  if (GRAPHIC_DESIGN_SERVICE_NOTES.split("\n").includes(t)) return true;
  if (/修改次數與範圍|Revisions\s*&\s*Changes/i.test(t)) return true;
  if (/^免費修改[：:]/.test(t) && /3\s*次/.test(t)) return true;
  if (/^額外修改[：:]/.test(t) && /設計費/.test(t)) return true;
  if (/版權與使用權|Copyright\s*&\s*Ownership/i.test(t)) return true;
  if (/^版權轉讓[：:]/.test(t) && /商業使用權/.test(t)) return true;
  if (/^作品集權利[：:]/.test(t) && /JD\s*STUDIO/i.test(t)) return true;
  return false;
}

function stripManagedNotes(notes: string): string {
  return notes
    .split("\n")
    .filter(
      (line) =>
        !isProductReceivingAddressNote(line) && !isGraphicDesignManagedNote(line)
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Ensure service-type quotes include the right managed notes;
 * strip managed lines from other categories so they stay clean.
 */
export function applyServiceNotes(
  notes: string | null | undefined,
  serviceType: string
): string {
  const stripped = stripManagedNotes(String(notes ?? ""));
  if (serviceType === "product") {
    if (!stripped) return PRODUCT_RECEIVING_ADDRESS_NOTE;
    return `${stripped}\n${PRODUCT_RECEIVING_ADDRESS_NOTE}`;
  }
  if (serviceType === "graphic_design") {
    if (!stripped) return GRAPHIC_DESIGN_SERVICE_NOTES;
    return `${stripped}\n\n${GRAPHIC_DESIGN_SERVICE_NOTES}`;
  }
  return stripped;
}
