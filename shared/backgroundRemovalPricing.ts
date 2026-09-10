/**
 * Background removal / cutout (去背) — billed per image when explicitly requested.
 * NOT included in corporate_event hourly "retouching included".
 */

export type BackgroundRemovalTier = {
  minImages: number;
  maxImages: number | null;
  unitPrice: number;
};

/** Volume tiers (HKD per image). Larger jobs → lower unit price. */
export const BACKGROUND_REMOVAL_TIERS: BackgroundRemovalTier[] = [
  { minImages: 1, maxImages: 19, unitPrice: 150 },
  { minImages: 20, maxImages: 49, unitPrice: 120 },
  { minImages: 50, maxImages: 99, unitPrice: 100 },
  { minImages: 100, maxImages: null, unitPrice: 80 },
];

export function backgroundRemovalUnitPrice(imageCount: number): number {
  const n = Number(imageCount);
  if (!Number.isFinite(n) || n <= 0) {
    return BACKGROUND_REMOVAL_TIERS[0].unitPrice;
  }
  for (const tier of BACKGROUND_REMOVAL_TIERS) {
    if (n < tier.minImages) continue;
    if (tier.maxImages == null || n <= tier.maxImages) return tier.unitPrice;
  }
  return BACKGROUND_REMOVAL_TIERS[BACKGROUND_REMOVAL_TIERS.length - 1].unitPrice;
}

export function backgroundRemovalLineTotal(imageCount: number): {
  quantity: number;
  unitPrice: number;
  amount: number;
} {
  const quantity = Math.max(0, Math.floor(Number(imageCount) || 0));
  const unitPrice = backgroundRemovalUnitPrice(quantity || 1);
  return { quantity, unitPrice, amount: quantity * unitPrice };
}

/** Prompt snippet injected into email inquiry billing rules. */
export function backgroundRemovalBillingRulesText(): string {
  const tierLines = BACKGROUND_REMOVAL_TIERS.map((t) => {
    const range =
      t.maxImages == null ? `${t.minImages}+` : `${t.minImages}–${t.maxImages}`;
    return `  ${range} images: HKD ${t.unitPrice}/image`;
  }).join("\n");

  return `
background_removal / cutout (去背) — CRITICAL ADD-ON
  - When the client explicitly requests 去背 / 去除背景 / remove background / cut-out / clipping path / knockout background on delivered photos, ALWAYS add a SEPARATE line item:
      description: "Background Removal (Cutout)"
      quantity: number of pieces/images requiring cutout (explicit from email; e.g. 約 200 件 → 200)
      unitPrice: use the tiers below
  - This is EXTRA labour. It is NOT included in corporate_event "retouching included", and NOT free when bundled with event coverage.
  - Volume tiers (HKD per image):
${tierLines}
  - Example: 200 pieces cutout → 200 x HKD 80 = HKD 16,000.
  - If the same inquiry also needs photographing those artworks/products (作品特寫 / product shots), bill the shoot as its own line item(s) PLUS this cutout line when 去背 is stated.
`.trim();
}

/** Prompt snippet: multi-workpackage RFQs must not collapse to event-only. */
export function multiScopeBillingRulesText(): string {
  return `
MULTI-SCOPE INQUIRIES (CRITICAL)
  - Some RFQs combine (A) event / ceremony coverage AND (B) artwork or product documentation (作品特寫 / 約 N 件) AND/OR (C) 去背.
  - You MUST output line items for EVERY explicit work package. Do NOT collapse into only "Event Photography (assumed hours)".
  - Example: award ceremony 5 hours + ~200 artwork close-ups + background removal → Event Photography (hours) + Artwork/Product Photography (per piece) + Background Removal (Cutout) (per piece) + Transportation Fee.
  - Prefer serviceType of the dominant package for historical lookup, but still list all packages in suggestedItems and mention all scopes in notes / missingFields.
`.trim();
}
