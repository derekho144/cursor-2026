import type { ReactNode } from "react";
import {
  splitQuoteLineItemMoney,
  type QuoteLineAmountInput,
} from "@shared/quoteLineItemKind";

type Props = {
  items: QuoteLineAmountInput[];
  currency?: string;
  subtotal: number;
  discountPercent?: number;
  discountAmount?: number;
  total: number;
  /** Optional deposit row (detail / form both use this). */
  depositSlot?: ReactNode;
  /** When set, replaces the read-only discount row (edit form %). */
  discountSlot?: ReactNode;
  /** Show pricing-learning split (collapsed by default — avoids 10,500 vs 10,820 confusion). */
  showLearningSplit?: boolean;
};

/**
 * Same 小計／總計 block for Quote Detail and Quote Edit.
 * Learning split is behind <details> so the gold total always matches across pages.
 */
export function QuoteMoneySummary({
  items,
  currency = "HKD",
  subtotal,
  discountPercent = 0,
  discountAmount = 0,
  total,
  depositSlot,
  discountSlot,
  showLearningSplit = true,
}: Props) {
  const split = splitQuoteLineItemMoney(items);
  const parts: string[] = [];
  if (split.photographerCrewSubtotal > 0) {
    parts.push(`攝影 ${split.photographerCrewSubtotal.toLocaleString()}`);
  }
  if (split.photoboothSubtotal > 0) {
    parts.push(`Booth ${split.photoboothSubtotal.toLocaleString()}`);
  }
  if (split.videoSubtotal > 0) {
    parts.push(`錄影 ${split.videoSubtotal.toLocaleString()}`);
  }
  if (split.transportSubtotal > 0) {
    parts.push(`交通 ${split.transportSubtotal.toLocaleString()}`);
  }
  if (split.otherBillableSubtotal > 0) {
    parts.push(`其他 ${split.otherBillableSubtotal.toLocaleString()}`);
  }

  return (
    <div className="w-full sm:w-64 space-y-2">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">小計</span>
        <span>HKD {subtotal.toLocaleString()}</span>
      </div>

      {showLearningSplit && split.hasPhotographerCrewLines && (
        <details
          className="rounded text-xs"
          style={{
            background: "rgba(212,168,67,0.06)",
            border: "1px solid rgba(212,168,67,0.2)",
          }}
        >
          <summary
            className="cursor-pointer select-none px-2 py-1.5 text-muted-foreground"
            style={{ listStyle: "none" }}
          >
            定價學習拆分（內部）
            {parts.length > 0 ? ` · ${parts.join(" + ")}` : ""}
          </summary>
          <div className="px-2 pb-2 space-y-1">
            {split.photographerCrewSubtotal > 0 && (
              <div className="flex justify-between" style={{ color: "rgba(212,168,67,0.85)" }}>
                <span>攝影師項目</span>
                <span>HKD {split.photographerCrewSubtotal.toLocaleString()}</span>
              </div>
            )}
            {split.photoboothSubtotal > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Photobooth</span>
                <span>HKD {split.photoboothSubtotal.toLocaleString()}</span>
              </div>
            )}
            {split.videoSubtotal > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>錄影</span>
                <span>HKD {split.videoSubtotal.toLocaleString()}</span>
              </div>
            )}
            {split.transportSubtotal > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>交通</span>
                <span>HKD {split.transportSubtotal.toLocaleString()}</span>
              </div>
            )}
            {split.otherBillableSubtotal > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>其他服務</span>
                <span>HKD {split.otherBillableSubtotal.toLocaleString()}</span>
              </div>
            )}
            {split.includedMetaSubtotal > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>附註項目</span>
                <span>HKD {split.includedMetaSubtotal.toLocaleString()}</span>
              </div>
            )}
            <div className="text-muted-foreground leading-snug pt-0.5 border-t border-white/5">
              加總 = 小計 HKD {subtotal.toLocaleString()}（同下面總計一致；拆分只供定價學習）
            </div>
          </div>
        </details>
      )}

      {discountSlot ??
        (discountAmount > 0 ? (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">
              折扣{discountPercent > 0 ? ` (${discountPercent}%)` : ""}
            </span>
            <span>- HKD {discountAmount.toLocaleString()}</span>
          </div>
        ) : null)}

      <div
        className="flex justify-between text-base font-semibold pt-2"
        style={{ borderTop: "1px solid #d4a843", color: "#d4a843" }}
      >
        <span>總計 ({currency})</span>
        <span>HKD {total.toLocaleString()}</span>
      </div>

      {depositSlot}
    </div>
  );
}
