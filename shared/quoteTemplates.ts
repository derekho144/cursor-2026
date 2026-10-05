/**
 * Quote form quick templates — multi-select friendly merge helpers.
 * Selecting 攝影 + 攝影加錄影 keeps both packages' billable lines (deduped)
 * and callers should preserve managed Section B rows separately.
 */

export type QuoteTemplateId = "photoshoot" | "photo_video" | "video_only";

export type QuoteTemplateItemSeed = {
  description: string;
  quantity: number;
  unitPrice: number;
  isIncluded?: boolean;
};

export type QuoteTemplateDef = {
  id: QuoteTemplateId;
  label: string;
  equipment: string;
  deliveryMethod: string;
  items: QuoteTemplateItemSeed[];
};

const TEMPLATE_DEFAULT_EQUIPMENT =
  "CAMERA/ Sony A7R4  Lighting AD200 / AD600 / FLASHLIGHT X2";
const TEMPLATE_DEFAULT_PHOTO_DELIVERY = "BY LINKS  5-10 DAY";
const TEMPLATE_DEFAULT_VIDEO_DELIVERY =
  "Video first cut BY LINKS  7-10 DAY";

export const QUOTE_TEMPLATES: QuoteTemplateDef[] = [
  {
    id: "photoshoot",
    label: "攝影 Photoshoot",
    equipment: TEMPLATE_DEFAULT_EQUIPMENT,
    deliveryMethod: TEMPLATE_DEFAULT_PHOTO_DELIVERY,
    items: [
      { description: "Event Photoshoot", quantity: 1, unitPrice: 0 },
      {
        description:
          "Retouch (Post image editing included fine retouch of lighting, colour, sharpen, dust)",
        quantity: 1,
        unitPrice: 0,
      },
      { description: "Transportation Fee", quantity: 1, unitPrice: 320 },
    ],
  },
  {
    id: "photo_video",
    label: "攝影加錄影 Photo + Video",
    equipment: TEMPLATE_DEFAULT_EQUIPMENT,
    deliveryMethod: `Photo: ${TEMPLATE_DEFAULT_PHOTO_DELIVERY} | ${TEMPLATE_DEFAULT_VIDEO_DELIVERY}`,
    items: [
      { description: "Short Film Video Production", quantity: 1, unitPrice: 0 },
      {
        description:
          "Post-Production (Video Editing 1min, Color Grading, Background Mixing)",
        quantity: 1,
        unitPrice: 0,
      },
      { description: "Event Photoshoot", quantity: 1, unitPrice: 0 },
      {
        description:
          "Retouch (Post image editing included fine retouch of lighting, colour, sharpen, dust)",
        quantity: 1,
        unitPrice: 0,
      },
      { description: "Transportation Fee", quantity: 1, unitPrice: 320 },
    ],
  },
  {
    id: "video_only",
    label: "純錄影 Video Only",
    equipment: TEMPLATE_DEFAULT_EQUIPMENT,
    deliveryMethod: TEMPLATE_DEFAULT_VIDEO_DELIVERY,
    items: [
      { description: "Short Film Video Production", quantity: 1, unitPrice: 0 },
      {
        description:
          "Post-Production (Video Editing 1min, Color Grading, Background Mixing)",
        quantity: 1,
        unitPrice: 0,
      },
      { description: "Transportation Fee", quantity: 1, unitPrice: 320 },
    ],
  },
];

export function isQuoteTemplateId(raw: unknown): raw is QuoteTemplateId {
  return raw === "photoshoot" || raw === "photo_video" || raw === "video_only";
}

/** Stable merge order: photoshoot → photo_video → video_only. */
const TEMPLATE_ORDER: QuoteTemplateId[] = [
  "photoshoot",
  "photo_video",
  "video_only",
];

export function normalizeSelectedTemplates(
  selected: Iterable<string>
): QuoteTemplateId[] {
  const set = new Set(
    Array.from(selected).filter(isQuoteTemplateId) as QuoteTemplateId[]
  );
  return TEMPLATE_ORDER.filter((id) => set.has(id));
}

/**
 * Toggle one template in the multi-select set.
 * 攝影 and 攝影加錄影 may both stay on; 純錄影 can combine with 攝影 as well.
 */
export function toggleQuoteTemplateSelection(
  selected: Iterable<string>,
  templateId: string
): QuoteTemplateId[] {
  if (!isQuoteTemplateId(templateId)) {
    return normalizeSelectedTemplates(selected);
  }
  const set = new Set(normalizeSelectedTemplates(selected));
  if (set.has(templateId)) set.delete(templateId);
  else set.add(templateId);
  return normalizeSelectedTemplates(set);
}

/** Merge billable lines from all selected templates; first description wins. */
export function mergeQuoteTemplateItems(
  selected: Iterable<string>
): QuoteTemplateItemSeed[] {
  let ids = normalizeSelectedTemplates(selected);
  // 攝影加錄影 already includes 攝影 billables — keep both buttons on, avoid dup work
  if (ids.includes("photo_video") && ids.includes("photoshoot")) {
    ids = ids.filter((id) => id !== "photoshoot");
  }
  const byDesc = new Map<string, QuoteTemplateItemSeed>();
  const order: string[] = [];

  for (const id of ids) {
    const tpl = QUOTE_TEMPLATES.find((t) => t.id === id);
    if (!tpl) continue;
    for (const item of tpl.items) {
      const key = item.description.trim().toLowerCase();
      if (!key || byDesc.has(key)) continue;
      byDesc.set(key, { ...item });
      order.push(key);
    }
  }

  return order.map((key) => byDesc.get(key)!);
}

/** Prefer the richest selected template for equipment / delivery extras. */
export function extrasFromSelectedTemplates(selected: Iterable<string>): {
  equipment: string;
  deliveryMethod: string;
  primaryTemplateId?: QuoteTemplateId;
} {
  const ids = normalizeSelectedTemplates(selected);
  if (ids.length === 0) {
    return { equipment: "", deliveryMethod: "" };
  }
  // photo_video is richest; else last selected in order
  const primary =
    ids.find((id) => id === "photo_video") ??
    ids.find((id) => id === "photoshoot") ??
    ids[ids.length - 1]!;
  const tpl = QUOTE_TEMPLATES.find((t) => t.id === primary)!;
  return {
    equipment: tpl.equipment,
    deliveryMethod: tpl.deliveryMethod,
    primaryTemplateId: primary,
  };
}
