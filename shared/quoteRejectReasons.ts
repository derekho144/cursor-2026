/**
 * Structured quote rejection reasons for pricing / win-rate learning.
 * Store `label` in quotes.rejected_reason for backward-compatible analytics.
 */

export type QuoteRejectReasonId =
  | "price_budget"
  | "price_package_total"
  | "competitor_cheaper"
  | "competitor_relationship"
  | "schedule"
  | "cancelled"
  | "no_reply"
  | "style"
  | "other";

export type QuoteRejectReasonDef = {
  id: QuoteRejectReasonId;
  label: string;
  /** Price / competition — used in win-rate pricing models */
  priceRelated: boolean;
  needsBudget?: boolean;
  needsCompetitor?: boolean;
  needsCustom?: boolean;
};

export const QUOTE_REJECT_REASONS: QuoteRejectReasonDef[] = [
  {
    id: "price_budget",
    label: "價格太高（預算不足）",
    priceRelated: true,
    needsBudget: true,
  },
  {
    id: "price_package_total",
    label: "價格太高（半日／全日／多日總價）",
    priceRelated: true,
    needsBudget: true,
  },
  {
    id: "competitor_cheaper",
    label: "找到其他攝影師（對手較平）",
    priceRelated: true,
    needsCompetitor: true,
  },
  {
    id: "competitor_relationship",
    label: "找到其他攝影師（關係／舊供應商）",
    priceRelated: false,
  },
  {
    id: "schedule",
    label: "時間不配合",
    priceRelated: false,
  },
  {
    id: "cancelled",
    label: "項目取消",
    priceRelated: false,
  },
  {
    id: "no_reply",
    label: "客戶無回覆",
    priceRelated: false,
  },
  {
    id: "style",
    label: "風格／方向不合",
    priceRelated: false,
  },
  {
    id: "other",
    label: "其他原因",
    priceRelated: false,
    needsCustom: true,
  },
];

export function rejectReasonByLabel(label: string | null | undefined): QuoteRejectReasonDef | null {
  if (!label?.trim()) return null;
  const exact = QUOTE_REJECT_REASONS.find((r) => r.label === label.trim());
  if (exact) return exact;
  // Legacy free-text → category for learning
  const t = label.trim();
  if (t === "價格太高" || /價格太高|預算|太貴|貴/.test(t)) {
    if (/半日|全日|多日|幾日|N\s*日|長時/.test(t)) {
      return QUOTE_REJECT_REASONS.find((r) => r.id === "price_package_total")!;
    }
    return QUOTE_REJECT_REASONS.find((r) => r.id === "price_budget")!;
  }
  if (t === "找到其他攝影師" || /其他攝影師|對手|同行/.test(t)) {
    if (/朋友|舊|曾經|供應商|關係|學校/.test(t)) {
      return QUOTE_REJECT_REASONS.find((r) => r.id === "competitor_relationship")!;
    }
    return QUOTE_REJECT_REASONS.find((r) => r.id === "competitor_cheaper")!;
  }
  if (t === "時間不配合" || /時間|檔期|日期/.test(t)) {
    return QUOTE_REJECT_REASONS.find((r) => r.id === "schedule")!;
  }
  if (t === "項目取消" || /取消/.test(t)) {
    return QUOTE_REJECT_REASONS.find((r) => r.id === "cancelled")!;
  }
  if (t === "客戶無回覆" || /無回覆|沒回|不回/.test(t)) {
    return QUOTE_REJECT_REASONS.find((r) => r.id === "no_reply")!;
  }
  if (/風格|方向/.test(t)) {
    return QUOTE_REJECT_REASONS.find((r) => r.id === "style")!;
  }
  return QUOTE_REJECT_REASONS.find((r) => r.id === "other")!;
}

export function rejectReasonCategoryLabel(label: string | null | undefined): string {
  return rejectReasonByLabel(label)?.label ?? "未填寫原因";
}
