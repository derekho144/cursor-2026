/**
 * Apply a pricing-learning suggested total onto quote line items.
 *
 * Scales the same money bucket learning uses:
 * - photographer_crew lines when that subtotal > 0
 * - otherwise billable non-transport / non-meta lines (other + photographer_crew)
 *
 * Leaves transport, photobooth, video, included_meta, section headers,
 * waived strikethrough lines, and $0 / qty-0 options untouched.
 */

import {
  resolveQuoteLineItemKind,
  splitQuoteLineItemMoney,
  type QuoteLineAmountInput,
  type QuoteLineItemKind,
} from "./quoteLineItemKind";
import { isQuoteSectionHeader, isQuoteWaivedPrice } from "./quoteSectionB";

export type SuggestPackageTier = "essential" | "standard" | "coverage";

export type ApplySuggestedQuotePriceItem = QuoteLineAmountInput & {
  id?: string;
  isIncluded?: boolean;
};

export type ApplySuggestedQuotePriceResult<T extends ApplySuggestedQuotePriceItem> = {
  ok: boolean;
  items: T[];
  previousLearningTotal: number;
  nextLearningTotal: number;
  target: number;
  scaledCount: number;
  learningTotalSource: "photographer_crew" | "items_total";
  error?: string;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function lineAmount(item: QuoteLineAmountInput): number {
  if (item.amount != null && item.amount !== "") {
    const a = Number(item.amount);
    if (Number.isFinite(a)) return a;
  }
  const q = Number(item.quantity ?? 0);
  const u = Number(item.unitPrice ?? 0);
  if (Number.isFinite(q) && Number.isFinite(u)) return q * u;
  return 0;
}

function isWaivedLine(item: QuoteLineAmountInput): boolean {
  return isQuoteWaivedPrice(
    Number(item.unitPrice ?? 0),
    Number(item.amount ?? 0),
    Number(item.quantity ?? 0)
  );
}

function isAdjustableKind(
  kind: QuoteLineItemKind,
  preferCrew: boolean
): boolean {
  if (preferCrew) return kind === "photographer_crew";
  return kind === "photographer_crew" || kind === "other";
}

/**
 * Scale adjustable line items so learning subtotal ≈ target.
 */
export function applySuggestedLearningPriceToItems<
  T extends ApplySuggestedQuotePriceItem,
>(items: T[], targetLearningTotal: number): ApplySuggestedQuotePriceResult<T> {
  const target = round2(Number(targetLearningTotal));
  const split = splitQuoteLineItemMoney(items);
  const previousLearningTotal = split.learningTotal;
  const preferCrew = split.hasPhotographerCrewLines && split.photographerCrewSubtotal > 0;

  if (!(target > 0) || !Number.isFinite(target)) {
    return {
      ok: false,
      items,
      previousLearningTotal,
      nextLearningTotal: previousLearningTotal,
      target,
      scaledCount: 0,
      learningTotalSource: split.learningTotalSource,
      error: "建議價無效",
    };
  }

  const adjustableIdx: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (isQuoteSectionHeader(item.description)) continue;
    if (isWaivedLine(item)) continue;
    const kind = resolveQuoteLineItemKind(item);
    if (!isAdjustableKind(kind, preferCrew)) continue;
    const amount = lineAmount(item);
    if (!(amount > 0)) continue;
    const qty = Number(item.quantity ?? 0);
    if (!(qty > 0)) continue;
    adjustableIdx.push(i);
  }

  if (adjustableIdx.length === 0) {
    return {
      ok: false,
      items,
      previousLearningTotal,
      nextLearningTotal: previousLearningTotal,
      target,
      scaledCount: 0,
      learningTotalSource: split.learningTotalSource,
      error: preferCrew
        ? "未有可調整嘅攝影師項目金額，請先加入攝影明細"
        : "未有可調整嘅報價項目金額，請先加入服務明細",
    };
  }

  const current = round2(
    adjustableIdx.reduce((sum, i) => sum + lineAmount(items[i]!), 0)
  );
  if (!(current > 0)) {
    return {
      ok: false,
      items,
      previousLearningTotal,
      nextLearningTotal: previousLearningTotal,
      target,
      scaledCount: 0,
      learningTotalSource: split.learningTotalSource,
      error: "可調整項目合計為 0",
    };
  }

  const factor = target / current;
  const next = items.map((it) => ({ ...it }));

  // First pass: proportional unit prices
  let allocated = 0;
  for (let k = 0; k < adjustableIdx.length; k++) {
    const i = adjustableIdx[k]!;
    const item = next[i]!;
    const qty = Number(item.quantity);
    const oldUnit = Number(item.unitPrice);
    let newUnit = round2(oldUnit * factor);
    if (newUnit < 0) newUnit = 0;

    if (k === adjustableIdx.length - 1) {
      // Last line absorbs residual so learning subtotal hits target
      const remain = round2(target - allocated);
      newUnit = qty > 0 ? round2(remain / qty) : newUnit;
      if (newUnit < 0) newUnit = 0;
      const amount = round2(qty * newUnit);
      next[i] = { ...item, unitPrice: newUnit, amount, isIncluded: false };
      allocated = round2(allocated + amount);
    } else {
      const amount = round2(qty * newUnit);
      next[i] = { ...item, unitPrice: newUnit, amount, isIncluded: false };
      allocated = round2(allocated + amount);
    }
  }

  // Tiny residual fix on last line amount if unit rounding drifted
  const drift = round2(target - allocated);
  if (Math.abs(drift) >= 0.01) {
    const lastI = adjustableIdx[adjustableIdx.length - 1]!;
    const last = next[lastI]!;
    const qty = Number(last.quantity);
    const amount = round2(Number(last.amount) + drift);
    const unitPrice = qty > 0 ? round2(amount / qty) : Number(last.unitPrice);
    next[lastI] = {
      ...last,
      unitPrice,
      amount: round2(qty * unitPrice),
      isIncluded: false,
    };
  }

  const nextSplit = splitQuoteLineItemMoney(next);
  return {
    ok: true,
    items: next,
    previousLearningTotal,
    nextLearningTotal: nextSplit.learningTotal,
    target,
    scaledCount: adjustableIdx.length,
    learningTotalSource: nextSplit.learningTotalSource,
  };
}
