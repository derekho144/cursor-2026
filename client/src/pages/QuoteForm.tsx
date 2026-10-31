import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";
import { Plus, Trash2, ArrowLeft, Save, Loader2, Search, UserPlus, X, Check, GripVertical, Phone } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  DESIGN_SERVICE_TYPES,
  quotePricingMode,
  isPricingLearningServiceType,
} from "@shared/quotePricingMode";
import {
  campaignIdFromLandingUrl,
  isProbeAdsWaClick,
  rankAdsWaClicksForPicker,
} from "@shared/adsWaClickQuality";
import {
  formatHourlyQuantityAdjustments,
  reconcileHourlyQuoteItems,
} from "@shared/quoteItemHours";
import {
  DURATION_PACKAGE_OPTIONS,
  inferDurationPackageFromHours,
  type DurationPackage,
} from "@shared/quoteDurationPackage";
import {
  classifyQuoteLineItem,
  isQuoteLineItemCategory,
  QUOTE_LINE_ITEM_CATEGORY_OPTIONS,
  type QuoteLineItemCategory,
} from "@shared/quoteLineItemKind";
import { QuoteMoneySummary } from "@/components/QuoteMoneySummary";
import { computeQuoteDiscountAmount } from "@shared/quoteDiscount";
import {
  computeQuoteTotalsFromItems,
  quoteMoneyDiffers,
} from "@shared/quoteTotals";
import {
  applySectionBForServiceType,
  canToggleQuoteWaive,
  hasConditionalSectionB,
  isManagedSectionBItem,
  isQuoteSectionHeader,
  isQuoteWaivedPrice,
  toggleQuoteItemWaived,
} from "@shared/quoteSectionB";
import {
  applyServiceNotes,
  isProductReceivingAddressNote,
} from "@shared/quoteServiceNotes";
import {
  QUOTE_TEMPLATES,
  extrasFromSelectedTemplates,
  mergeQuoteTemplateItems,
  toggleQuoteTemplateSelection,
  type QuoteTemplateId,
} from "@shared/quoteTemplates";

const SERVICE_OPTIONS = [
  { value: "corporate_event", label: "企業活動攝影" },
  { value: "product", label: "產品攝影" },
  { value: "food_beverage", label: "食物攝影" },
  { value: "jewelry", label: "珠寶攝影" },
  { value: "artwork", label: "藝術品攝影" },
  { value: "interior", label: "建築/室內攝影" },
  { value: "video_production", label: "影片製作" },
  { value: "graphic_design", label: "平面設計" },
  { value: "ad_video", label: "廣告影片" },
  { value: "web_development", label: "網頁製作" },
  { value: "ai_photography", label: "AI攝影" },
  { value: "menu_design", label: "餐牌設計" },
  { value: "portrait", label: "人像拍攝" },
  { value: "360_photography", label: "360 拍攝" },
  { value: "drone", label: "航拍拍攝" },
  { value: "kol_mi", label: "KOL/MI 推廣" },
  { value: "other", label: "其他服務" },
];

/** Must match SelectItem values below — unknown DB values would crash Radix Select. */
const LEAD_SOURCE_VALUES = new Set([
  "HelloToby",
  "PRO360",
  "FreelanceHunter",
  "88DB",
  "Instagram",
  "Facebook",
  "Google",
  "Organic",
  "AI",
  "Referral",
  "Website",
  "Repeat",
  "Other",
]);

function normalizeLeadSource(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  return LEAD_SOURCE_VALUES.has(s) ? s : "";
}

// Re-export for any legacy imports; source of truth is @shared/quoteTemplates
export { QUOTE_TEMPLATES };

const DEFAULT_ITEMS_BY_TYPE: Record<string, { description: string; quantity: number; unitPrice: number }[]> = {};

type QuoteItem = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  isIncluded?: boolean;
  /** Explicit split category; empty = auto-detect from description */
  category: "" | QuoteLineItemCategory;
};

type FormData = {
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  clientCompany: string;
  serviceType: string;
  shootingDate: string;
  shootingLocation: string;
  notes: string;
  discountPercent: number; // 0-100, e.g. 10 = 10% off
  discountAmount: number; // computed: discountableSubtotal * discountPercent / 100
  depositPercent: number; // e.g. 50 = 50% deposit
  depositMode: "percent" | "fixed"; // 訂金輸入模式
  depositFixedAmount: number; // 固定金額模式下的訂金金額
  currency: string;
  validUntil: string;
  equipment: string;
  team: string;
  /** Structured hours for event/time-based pricing */
  shootHours: string;
  /** hours | half_day | full_day | multi_day */
  durationPackage: "" | Exclude<DurationPackage, "unknown">;
  /** Delivered shot count for product-style pricing (張數) */
  shotCount: string;
  crewPhotographers: number;
  crewAssistants: number;
  crewVideographers: number;
  crewOthers: number;
  deliveryMethod: string;
  leadSource: string;
  /** Google Ads / WA track attribution (persisted on quote) */
  gclid: string;
  gbraid: string;
  wbraid: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  utmTerm: string;
  adsCampaignId: string;
  adsCampaignName: string;
  landingPageUrl: string;
  whatsappClickId?: number | undefined;
  items: QuoteItem[];
  clientId?: number;
  saveAsNewClient?: boolean;
  syncToClients?: boolean;
  emailInquiryId?: number | undefined;
};

const emptyForm: FormData = {
  clientName: "",
  clientEmail: "",
  clientPhone: "",
  clientCompany: "",
  serviceType: "corporate_event",
  shootingDate: "",
  shootingLocation: "",
  notes: "",
  discountPercent: 0,
  discountAmount: 0,
  depositPercent: 50,
  depositMode: "percent",
  depositFixedAmount: 0,
  currency: "HKD",
  validUntil: "",
  equipment: "",
  team: "",
  shootHours: "",
  durationPackage: "",
  shotCount: "",
  crewPhotographers: 0,
  crewAssistants: 0,
  crewVideographers: 0,
  crewOthers: 0,
  deliveryMethod: "",
  leadSource: "",
  gclid: "",
  gbraid: "",
  wbraid: "",
  utmSource: "",
  utmMedium: "",
  utmCampaign: "",
  utmContent: "",
  utmTerm: "",
  adsCampaignId: "",
  adsCampaignName: "",
  landingPageUrl: "",
  whatsappClickId: undefined,
  items: [{ id: crypto.randomUUID(), description: "", quantity: 1, unitPrice: 0, amount: 0, category: "" }],
  clientId: undefined,
  saveAsNewClient: false,
  syncToClients: true,
  emailInquiryId: undefined,
};

function strOrEmpty(v: unknown): string {
  if (v == null) return "";
  return String(v);
}

type EditDraftEnvelope = {
  v: 1;
  serverUpdatedAt: string | null;
  savedAt: string;
  form: FormData;
};

function parseEditDraft(raw: string | null): EditDraftEnvelope | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.v === 1 && parsed.form && typeof parsed.form === "object") {
      return {
        v: 1,
        serverUpdatedAt:
          parsed.serverUpdatedAt != null ? String(parsed.serverUpdatedAt) : null,
        savedAt: String(parsed.savedAt ?? ""),
        form: parsed.form as FormData,
      };
    }
    // Legacy: bare FormData blob
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.items)) {
      return {
        v: 1,
        serverUpdatedAt: null,
        savedAt: "",
        form: parsed as FormData,
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function formDataFromExistingQuote(existingQuote: any): FormData {
  return normalizeFormData({
    clientName: existingQuote.clientName,
    clientEmail: existingQuote.clientEmail ?? "",
    clientPhone: existingQuote.clientPhone ?? "",
    clientCompany: existingQuote.clientCompany ?? "",
    serviceType: existingQuote.serviceType,
    shootingDate: existingQuote.shootingDate ?? "",
    shootingLocation: existingQuote.shootingLocation ?? "",
    notes: existingQuote.notes ?? "",
    discountPercent: Number(existingQuote.discountPercent ?? 0),
    discountAmount: Number(existingQuote.discountAmount),
    depositPercent: Number(existingQuote.depositPercent ?? 50),
    depositMode: (existingQuote.depositMode ?? "percent") as "percent" | "fixed",
    depositFixedAmount: Number(existingQuote.depositFixedAmount ?? 0),
    currency: existingQuote.currency,
    validUntil: existingQuote.validUntil ?? "",
    clientId: existingQuote.clientId ?? undefined,
    saveAsNewClient: false,
    equipment: existingQuote.equipment ?? "",
    team: existingQuote.team ?? "",
    shootHours:
      existingQuote.shootHours != null && Number(existingQuote.shootHours) > 0
        ? String(Number(existingQuote.shootHours))
        : "",
    durationPackage:
      existingQuote.durationPackage === "hours" ||
      existingQuote.durationPackage === "half_day" ||
      existingQuote.durationPackage === "full_day" ||
      existingQuote.durationPackage === "multi_day"
        ? (existingQuote.durationPackage as FormData["durationPackage"])
        : "",
    shotCount:
      existingQuote.shotCount != null && Number(existingQuote.shotCount) > 0
        ? String(Number(existingQuote.shotCount))
        : "",
    crewPhotographers: Number(existingQuote.crewPhotographers ?? 0),
    crewAssistants: Number(existingQuote.crewAssistants ?? 0),
    crewVideographers: Number(existingQuote.crewVideographers ?? 0),
    crewOthers: Number(existingQuote.crewOthers ?? 0),
    deliveryMethod: existingQuote.deliveryMethod ?? "",
    leadSource: normalizeLeadSource(existingQuote.leadSource),
    gclid: strOrEmpty(existingQuote.gclid),
    gbraid: strOrEmpty(existingQuote.gbraid),
    wbraid: strOrEmpty(existingQuote.wbraid),
    utmSource: strOrEmpty(existingQuote.utmSource),
    utmMedium: strOrEmpty(existingQuote.utmMedium),
    utmCampaign: strOrEmpty(existingQuote.utmCampaign),
    utmContent: strOrEmpty(existingQuote.utmContent),
    utmTerm: strOrEmpty(existingQuote.utmTerm),
    adsCampaignId: strOrEmpty(existingQuote.adsCampaignId),
    adsCampaignName: strOrEmpty(existingQuote.adsCampaignName),
    landingPageUrl: strOrEmpty(existingQuote.landingPageUrl),
    whatsappClickId:
      existingQuote.whatsappClickId != null &&
      Number(existingQuote.whatsappClickId) > 0
        ? Number(existingQuote.whatsappClickId)
        : undefined,
    items: (existingQuote.items ?? []).map((item: any) => ({
      id: crypto.randomUUID(),
      description: item.description,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      amount: Number(item.amount),
      category: isQuoteLineItemCategory(item.category)
        ? (item.category as QuoteLineItemCategory)
        : ("" as const),
    })),
  });
}

/** Merge saved drafts / partial payloads onto emptyForm so new fields never crash .trim(). */
function normalizeFormData(raw: Partial<FormData> | null | undefined): FormData {
  const base = { ...emptyForm, items: emptyForm.items.map((i) => ({ ...i, id: crypto.randomUUID() })) };
  if (!raw || typeof raw !== "object") return base;
  const items = Array.isArray(raw.items)
    ? raw.items.map((item) => {
        const desc = item?.description ?? "";
        const rawCat = (item as any)?.category;
        const category: "" | QuoteLineItemCategory = isQuoteLineItemCategory(rawCat)
          ? rawCat
          : "";
        return {
          id: item?.id || crypto.randomUUID(),
          description: desc,
          quantity: Number(item?.quantity) || 0,
          unitPrice: Number(item?.unitPrice) || 0,
          amount: Number(item?.amount) || 0,
          isIncluded: !!(item as any)?.isIncluded,
          category,
        };
      })
    : base.items;
  return {
    ...base,
    ...raw,
    shootHours: raw.shootHours != null ? String(raw.shootHours) : "",
    durationPackage:
      raw.durationPackage === "hours" ||
      raw.durationPackage === "half_day" ||
      raw.durationPackage === "full_day" ||
      raw.durationPackage === "multi_day"
        ? raw.durationPackage
        : "",
    shotCount: raw.shotCount != null ? String(raw.shotCount) : "",
    equipment: raw.equipment ?? "",
    team: raw.team ?? "",
    deliveryMethod: raw.deliveryMethod ?? "",
    leadSource: normalizeLeadSource(raw.leadSource),
    gclid: strOrEmpty(raw.gclid),
    gbraid: strOrEmpty(raw.gbraid),
    wbraid: strOrEmpty(raw.wbraid),
    utmSource: strOrEmpty(raw.utmSource),
    utmMedium: strOrEmpty(raw.utmMedium),
    utmCampaign: strOrEmpty(raw.utmCampaign),
    utmContent: strOrEmpty(raw.utmContent),
    utmTerm: strOrEmpty(raw.utmTerm),
    adsCampaignId: strOrEmpty(raw.adsCampaignId),
    adsCampaignName: strOrEmpty(raw.adsCampaignName),
    landingPageUrl: strOrEmpty(raw.landingPageUrl),
    whatsappClickId:
      raw.whatsappClickId != null && Number(raw.whatsappClickId) > 0
        ? Number(raw.whatsappClickId)
        : undefined,
    notes: raw.notes ?? "",
    crewPhotographers: Number(raw.crewPhotographers) || 0,
    crewAssistants: Number(raw.crewAssistants) || 0,
    crewVideographers: Number(raw.crewVideographers) || 0,
    crewOthers: Number(raw.crewOthers) || 0,
    depositMode: raw.depositMode === "fixed" ? "fixed" : "percent",
    items: items.length > 0 ? items : base.items,
  };
}

function buildTeamLabel(crew: {
  crewPhotographers: number;
  crewAssistants: number;
  crewVideographers: number;
  crewOthers: number;
}): string {
  const parts: string[] = [];
  if (crew.crewPhotographers > 0) parts.push(`攝影師×${crew.crewPhotographers}`);
  if (crew.crewVideographers > 0) parts.push(`錄影×${crew.crewVideographers}`);
  if (crew.crewAssistants > 0) parts.push(`助理×${crew.crewAssistants}`);
  if (crew.crewOthers > 0) parts.push(`其他×${crew.crewOthers}`);
  return parts.join(" + ");
}

function crewHeadcount(crew: {
  crewPhotographers: number;
  crewAssistants: number;
  crewVideographers: number;
  crewOthers: number;
}): number {
  return (
    (crew.crewPhotographers || 0) +
    (crew.crewAssistants || 0) +
    (crew.crewVideographers || 0) +
    (crew.crewOthers || 0)
  );
}

/** Sync included "Team XP" line item with structured headcount. */
function syncTeamLineItem(
  items: QuoteItem[],
  headcount: number
): QuoteItem[] {
  if (headcount <= 0) return items;
  const teamRe = /^team\s*\d+\s*p\b/i;
  const idx = items.findIndex((i) => teamRe.test(i.description.trim()));
  const label = `Team ${headcount}P`;
  if (idx >= 0) {
    if (items[idx].description === label) return items;
    const next = [...items];
    next[idx] = { ...next[idx], description: label };
    return next;
  }
  return items;
}

/** Read Team XP / 人手 from item lines into structured defaults. */
function crewFromTemplateItems(
  items: Array<{ description: string }>,
  templateId?: string
): {
  crewPhotographers: number;
  crewAssistants: number;
  crewVideographers: number;
  crewOthers: number;
} {
  let pax = 0;
  for (const it of items) {
    const m = it.description.match(/team\s*(\d+)\s*p\b/i);
    if (m) pax = Math.max(pax, Number(m[1]) || 0);
  }
  if (pax <= 0) pax = 1;
  if (templateId === "video_only") {
    return {
      crewPhotographers: 0,
      crewAssistants: 0,
      crewVideographers: pax,
      crewOthers: 0,
    };
  }
  // 攝影加錄影：固定 1 攝影師 + 1 錄影
  if (templateId === "photo_video") {
    return {
      crewPhotographers: 1,
      crewAssistants: 0,
      crewVideographers: 1,
      crewOthers: 0,
    };
  }
  return {
    crewPhotographers: pax,
    crewAssistants: 0,
    crewVideographers: 0,
    crewOthers: 0,
  };
}

// Sortable row component for drag-and-drop reordering
function SortableQuoteItem({
  item,
  idx,
  inputStyle,
  onUpdate,
  onRemove,
  canRemove,
  onToggleWaive,
}: {
  item: QuoteItem;
  idx: number;
  inputStyle: React.CSSProperties;
  onUpdate: (
    idx: number,
    field: keyof QuoteItem,
    value: string | number | boolean
  ) => void;
  onRemove: (idx: number) => void;
  canRemove: boolean;
  onToggleWaive?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  const inferred = classifyQuoteLineItem(item.description);
  const categoryValue = item.category || "auto";
  const isSection = isQuoteSectionHeader(item.description);
  const canWaive = canToggleQuoteWaive(item);
  const isWaived = isQuoteWaivedPrice(
    Number(item.unitPrice),
    Number(item.amount),
    Number(item.quantity)
  );
  const waiveLabelAmount = Number(item.unitPrice).toLocaleString();
  return (
    <div ref={setNodeRef} style={style}>
      {isSection && (
        <div
          className="mb-1 flex items-center gap-2 px-3 py-2 text-xs font-semibold tracking-[0.14em]"
          style={{
            background: "rgba(245,245,245,0.08)",
            borderLeft: "3px solid #e8e0d0",
            color: "#e8e0d0",
          }}
        >
          {item.description}
        </div>
      )}
      {/* Desktop layout */}
      <div className="hidden md:grid gap-2 items-center" style={{ gridTemplateColumns: "20px 1fr 118px 70px 100px 44px 100px 36px" }}>
        <div {...attributes} {...listeners} className="flex items-center justify-center cursor-grab active:cursor-grabbing" style={{ color: "rgba(212,168,67,0.4)", touchAction: "none" }}>
          <GripVertical className="h-4 w-4" />
        </div>
        <div className="space-y-1">
          <Input value={item.description} onChange={(e) => onUpdate(idx, "description", e.target.value)} placeholder="服務項目說明" style={inputStyle} />
        </div>
        <Select
          value={categoryValue}
          onValueChange={(v) =>
            onUpdate(idx, "category", v === "auto" ? "" : v)
          }
        >
          <SelectTrigger style={{ ...inputStyle, height: "36px" }}>
            <SelectValue placeholder="類別" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">
              自動（{QUOTE_LINE_ITEM_CATEGORY_OPTIONS.find((o) => o.value === inferred)?.label ?? inferred}）
            </SelectItem>
            {QUOTE_LINE_ITEM_CATEGORY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="number" value={item.quantity} onChange={(e) => onUpdate(idx, "quantity", parseFloat(e.target.value) || 0)} min={0} style={inputStyle} disabled={isSection} />
        <div className="space-y-0.5">
          <Input type="number" value={item.unitPrice} onChange={(e) => onUpdate(idx, "unitPrice", parseFloat(e.target.value) || 0)} min={0} style={inputStyle} disabled={isSection} />
          {isWaived && (
            <div className="text-[10px] text-right pr-1" style={{ color: "#86efac" }}>
              列印顯示 <span style={{ textDecoration: "line-through" }}>{waiveLabelAmount}</span> 豁免
            </div>
          )}
        </div>
        <div className="flex items-center justify-center">
          <Checkbox
            checked={isWaived}
            disabled={!canWaive || !onToggleWaive || isSection}
            onCheckedChange={() => onToggleWaive?.()}
            aria-label={isWaived ? `取消豁免（恢復 $${waiveLabelAmount}）` : `豁免此項目（$${waiveLabelAmount}）`}
            title={
              !canWaive
                ? "有單價嘅項目先可以豁免"
                : isWaived
                  ? `已豁免 · 取消後恢復 $${waiveLabelAmount}`
                  : `剔選豁免（客戶見到劃線 $${waiveLabelAmount}）`
            }
            className="size-4 border-[rgba(212,168,67,0.55)] data-[state=checked]:bg-[#d4a843] data-[state=checked]:border-[#d4a843] data-[state=checked]:text-[#1a1a1a]"
          />
        </div>
        <div className="text-sm font-medium text-right pr-2" style={{ color: isWaived ? "#86efac" : "#d4a843" }}>
          {isWaived ? "0（豁免）" : item.amount.toLocaleString()}
        </div>
        <button onClick={() => onRemove(idx)} disabled={!canRemove} className="p-1.5 rounded hover:bg-red-500/10 transition-colors disabled:opacity-20">
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </button>
      </div>

      {/* Mobile layout - card style */}
      <div className="md:hidden rounded-lg p-3 space-y-2" style={{ background: "rgba(212,168,67,0.05)", border: "1px solid rgba(212,168,67,0.15)" }}>
        <div className="flex items-center justify-between gap-2">
          <div {...attributes} {...listeners} className="flex items-center justify-center cursor-grab active:cursor-grabbing flex-shrink-0" style={{ color: "rgba(212,168,67,0.4)", touchAction: "none" }}>
            <GripVertical className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <div className="text-xs mb-1" style={{ color: "rgba(212,168,67,0.6)", fontSize: "0.6rem", letterSpacing: "0.1em" }}>服務項目說明</div>
            <Input value={item.description} onChange={(e) => onUpdate(idx, "description", e.target.value)} placeholder="服務項目說明" style={inputStyle} className="w-full" />
          </div>
          <button onClick={() => onRemove(idx)} disabled={!canRemove} className="p-1.5 rounded hover:bg-red-500/10 transition-colors disabled:opacity-20 flex-shrink-0">
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </button>
        </div>
        <div>
          <div className="text-xs mb-1" style={{ color: "rgba(212,168,67,0.6)", fontSize: "0.6rem", letterSpacing: "0.1em" }}>項目類別</div>
          <Select
            value={categoryValue}
            onValueChange={(v) =>
              onUpdate(idx, "category", v === "auto" ? "" : v)
            }
          >
            <SelectTrigger style={{ ...inputStyle, height: "36px" }}>
              <SelectValue placeholder="類別" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">
                自動（{QUOTE_LINE_ITEM_CATEGORY_OPTIONS.find((o) => o.value === inferred)?.label ?? inferred}）
              </SelectItem>
              {QUOTE_LINE_ITEM_CATEGORY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-xs mb-1" style={{ color: "rgba(212,168,67,0.6)", fontSize: "0.6rem", letterSpacing: "0.1em" }}>數量</div>
            <Input type="number" value={item.quantity} onChange={(e) => onUpdate(idx, "quantity", parseFloat(e.target.value) || 0)} min={0} style={inputStyle} disabled={isSection} />
          </div>
          <div>
            <div className="text-xs mb-1" style={{ color: "rgba(212,168,67,0.6)", fontSize: "0.6rem", letterSpacing: "0.1em" }}>單價 (HKD)</div>
            <Input type="number" value={item.unitPrice} onChange={(e) => onUpdate(idx, "unitPrice", parseFloat(e.target.value) || 0)} min={0} style={inputStyle} disabled={isSection} />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <label
            className={`flex items-center gap-2 text-xs ${canWaive && onToggleWaive && !isSection ? "cursor-pointer" : "opacity-40"}`}
            style={{ color: isWaived ? "#86efac" : "#d4a843" }}
          >
            <Checkbox
              checked={isWaived}
              disabled={!canWaive || !onToggleWaive || isSection}
              onCheckedChange={() => onToggleWaive?.()}
              aria-label={isWaived ? `取消豁免（恢復 $${waiveLabelAmount}）` : `豁免此項目（$${waiveLabelAmount}）`}
              className="size-4 border-[rgba(212,168,67,0.55)] data-[state=checked]:bg-[#d4a843] data-[state=checked]:border-[#d4a843] data-[state=checked]:text-[#1a1a1a]"
            />
            豁免費用
          </label>
          <div className="text-sm font-medium" style={{ color: isWaived ? "#86efac" : "#d4a843" }}>
            金額：HKD {isWaived ? "0（豁免）" : item.amount.toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  );
}

// Safe localStorage helpers
function safeLSGet(key: string): string | null {
  try { return typeof window !== 'undefined' ? localStorage.getItem(key) : null; } catch { return null; }
}
function safeLSSet(key: string, value: string): void {
  try { if (typeof window !== 'undefined') localStorage.setItem(key, value); } catch { /* ignore */ }
}
function safeLSRemove(key: string): void {
  try { if (typeof window !== 'undefined') localStorage.removeItem(key); } catch { /* ignore */ }
}

export default function QuoteForm() {
  const params = useParams<{ id?: string }>();
  const isEdit = !!params.id && params.id !== "new";
  const quoteId = isEdit ? parseInt(params.id!) : undefined;
  const [location, setLocation] = useLocation();

  // Initialize form state: try to restore from localStorage draft first (new quotes only)
  const [form, setForm] = useState<FormData>(() => {
    // For new quotes, try to restore draft from localStorage
    if (!isEdit) {
      const saved = safeLSGet('quote_draft_new');
      if (saved) {
        try {
          return normalizeFormData(JSON.parse(saved) as FormData);
        } catch { /* ignore */ }
      }
    }
    return normalizeFormData(emptyForm);
  });

  // Heal incomplete drafts (e.g. missing shotCount after schema upgrade)
  useEffect(() => {
    if (form.shotCount == null || form.shootHours == null) {
      setForm((p) => normalizeFormData(p));
    }
  }, [form.shotCount, form.shootHours]);

  // New quotes default to corporate_event — inject Section B once if missing
  useEffect(() => {
    if (isEdit) return;
    if (!hasConditionalSectionB(form.serviceType)) return;
    if (form.items.some((it) => isManagedSectionBItem(it.description))) return;
    setForm((p) => ({
      ...p,
      items: applySectionBForServiceType(p.items, p.serviceType, () => crypto.randomUUID()),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only seed once for new forms
  }, [isEdit]);

  // Product quotes: ensure studio 收貨地址 is in notes (new + when switching to product)
  useEffect(() => {
    if (form.serviceType !== "product") return;
    if (form.notes.split("\n").some((l) => isProductReceivingAddressNote(l))) return;
    setForm((p) => ({
      ...p,
      notes: applyServiceNotes(p.notes, p.serviceType),
    }));
  }, [form.serviceType, form.notes]);
  const [hasDraft, setHasDraft] = useState(() => !isEdit && !!safeLSGet('quote_draft_new'));
  // Multi-select quick templates (攝影 + 攝影加錄影 can both stay on)
  const [selectedTemplates, setSelectedTemplates] = useState<QuoteTemplateId[]>([]);
  // For edit mode: per-quote draft key
  const editDraftKey = isEdit && quoteId ? `quote_draft_edit_${quoteId}` : null;
  const [hasEditDraft, setHasEditDraft] = useState(false);
  /** Parked local draft that differs from server — never auto-apply (was causing total mismatch). */
  const [pendingEditDraft, setPendingEditDraft] = useState<EditDraftEnvelope | null>(
    null
  );
  const [savedServerTotal, setSavedServerTotal] = useState<number | null>(null);
  // Track whether server data has been loaded (to avoid saving empty form before data arrives)
  const editFormLoadedRef = useRef(!isEdit);
  // Must wait for hydrate before rendering Selects — Radix Select throws if value="" with no matching item.
  const [editHydrated, setEditHydrated] = useState(!isEdit);
  const [clientSearch, setClientSearch] = useState("");
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  // Restore selectedClientName from draft if available
  const [selectedClientName, setSelectedClientName] = useState(() => {
    if (!isEdit) {
      const saved = safeLSGet('quote_draft_new');
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as FormData;
          if (parsed.clientId && parsed.clientName) return parsed.clientName;
        } catch { /* ignore */ }
      }
    }
    return "";
  });
  const clientSearchRef = useRef<HTMLDivElement>(null);

  // Inquiry linking state
  const [inquirySearch, setInquirySearch] = useState("");
  const [showInquiryDropdown, setShowInquiryDropdown] = useState(false);
  const [selectedInquiryLabel, setSelectedInquiryLabel] = useState("");
  const inquirySearchRef = useRef<HTMLDivElement>(null);
  const { data: inquiryResults } = trpc.emailInquiries.searchForLinking.useQuery(
    { query: inquirySearch, limit: 8 },
    { enabled: showInquiryDropdown }
  );

  const pricingMode = quotePricingMode(form.serviceType);
  const suggestHours = form.shootHours.trim() ? Number(form.shootHours) : null;
  const suggestCrew =
    form.crewPhotographers +
    form.crewAssistants +
    form.crewVideographers +
    form.crewOthers;
  const suggestShots = form.shotCount.trim() ? Number(form.shotCount) : null;
  const { data: priceSuggest } = trpc.pricingLearning.suggest.useQuery(
    {
      serviceType: form.serviceType as any,
      hours:
        suggestHours != null && Number.isFinite(suggestHours)
          ? suggestHours
          : null,
      crewSize: suggestCrew > 0 ? suggestCrew : null,
      shotCount:
        suggestShots != null && Number.isFinite(suggestShots)
          ? suggestShots
          : null,
      durationPackage: form.durationPackage || null,
      leadSource: form.leadSource || null,
    },
    {
      enabled: !!form.serviceType && isPricingLearningServiceType(form.serviceType),
      refetchOnWindowFocus: false,
    }
  );

  // Phone auto-lookup state
  const [phoneQuery, setPhoneQuery] = useState("");
  const [showPhoneSuggestion, setShowPhoneSuggestion] = useState(false);
  const phoneRef = useRef<HTMLDivElement>(null);

  // Stamped when edit form hydrates from server — used for draft envelopes
  const serverUpdatedAtRef = useRef<string | null>(null);
  // Auto-save draft to localStorage on form change
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => {
      if (!isEdit) {
        safeLSSet("quote_draft_new", JSON.stringify(form));
        setHasDraft(true);
      } else if (editDraftKey && editFormLoadedRef.current) {
        // Only save after server data has been loaded into the form
        const envelope: EditDraftEnvelope = {
          v: 1,
          serverUpdatedAt: serverUpdatedAtRef.current,
          savedAt: new Date().toISOString(),
          form,
        };
        safeLSSet(editDraftKey, JSON.stringify(envelope));
        setHasEditDraft(true);
      }
    }, 500); // debounce 500ms
    return () => {
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    };
  }, [form, isEdit, editDraftKey]);

  // Clear draft on successful save
  const clearDraft = useCallback(() => {
    safeLSRemove("quote_draft_new");
    setHasDraft(false);
    if (editDraftKey) {
      safeLSRemove(editDraftKey);
      setHasEditDraft(false);
    }
    setPendingEditDraft(null);
  }, [editDraftKey]);

  // Read clientId from URL query param (e.g. from ClientDetail page)
  useEffect(() => {
    const searchStr = window.location.search;
    const urlParams = new URLSearchParams(searchStr);
    const clientIdParam = urlParams.get("clientId");
    if (clientIdParam && !isEdit) {
      const cid = parseInt(clientIdParam);
      if (!isNaN(cid)) {
        setForm(p => ({ ...p, clientId: cid }));
      }
    }
  }, []);

  const utils = trpc.useUtils();
  const phoneForAds = (form.clientPhone || "").replace(/\D/g, "");
  const { data: recentAdsWaClicks } = trpc.quotes.recentAdsWaClicks.useQuery(
    { limit: 30 },
    {
      // Load when Google is selected OR staff typed a phone (auto-match by matchedPhone)
      enabled: form.leadSource === "Google" || phoneForAds.length >= 8,
      refetchOnWindowFocus: false,
    }
  );
  const [showManualAdsPick, setShowManualAdsPick] = useState(false);

  type AdsWaClickRow = {
    id: number;
    refCode?: string | null;
    gclid?: string | null;
    gbraid?: string | null;
    wbraid?: string | null;
    utmSource?: string | null;
    utmMedium?: string | null;
    utmCampaign?: string | null;
    utmContent?: string | null;
    utmTerm?: string | null;
    adsCampaignId?: string | null;
    adsCampaignName?: string | null;
    landingPageUrl?: string | null;
    matchedPhone?: string | null;
    quoteId?: number | null;
    clickedAt?: Date | string | null;
  };

  const formatAdsWaPhone = (phone?: string | null) => {
    const d = (phone || "").replace(/\D/g, "");
    if (!d) return "";
    if (d.startsWith("852") && d.length === 11) {
      return `${d.slice(3, 7)} ${d.slice(7)}`;
    }
    if (d.length === 8) return `${d.slice(0, 4)} ${d.slice(4)}`;
    return d;
  };

  const shortLandingLabel = (url?: string | null) => {
    const raw = (url || "").trim();
    if (!raw) return "";
    try {
      const u = new URL(raw);
      const path = `${u.pathname}${u.search}`.replace(/\/$/, "") || "/";
      return path.length > 40 ? `${path.slice(0, 37)}…` : path;
    } catch {
      return raw.length > 40 ? `${raw.slice(0, 37)}…` : raw;
    }
  };

  const applyAdsWaClickRow = useCallback((click: AdsWaClickRow, opts?: { toastMsg?: string }) => {
    const campFromLp = campaignIdFromLandingUrl(click.landingPageUrl) || "";
    setForm((p) => ({
      ...p,
      leadSource: "Google",
      whatsappClickId: click.id,
      gclid: strOrEmpty(click.gclid) || p.gclid,
      gbraid: strOrEmpty(click.gbraid) || p.gbraid,
      wbraid: strOrEmpty(click.wbraid) || p.wbraid,
      utmSource: strOrEmpty(click.utmSource) || p.utmSource,
      utmMedium: strOrEmpty(click.utmMedium) || p.utmMedium,
      utmCampaign: strOrEmpty(click.utmCampaign) || p.utmCampaign,
      utmContent: strOrEmpty(click.utmContent) || p.utmContent,
      utmTerm: strOrEmpty(click.utmTerm) || p.utmTerm,
      adsCampaignId: strOrEmpty(click.adsCampaignId) || campFromLp || p.adsCampaignId,
      adsCampaignName: strOrEmpty(click.adsCampaignName) || p.adsCampaignName,
      landingPageUrl: strOrEmpty(click.landingPageUrl) || p.landingPageUrl,
    }));
    if (opts?.toastMsg) toast.success(opts.toastMsg);
  }, []);

  const applyAdsWaClick = (clickId: string) => {
    if (clickId === "__none__") {
      setForm((p) => ({ ...p, whatsappClickId: undefined }));
      return;
    }
    const click = recentAdsWaClicks?.find((c) => String(c.id) === clickId);
    if (!click) return;
    applyAdsWaClickRow(click);
  };

  // Full automation path: WhatsApp Cloud API inbound matched this phone → Ads click.
  // (No longer auto-pick "the only unmatched click in 48h" — that becomes wrong as
  // volume grows. Phone / WhatsApp match is the accurate path.)
  const { data: phoneAdsAttr } = trpc.whatsapp.attributionForPhone.useQuery(
    { phone: form.clientPhone },
    {
      enabled: !isEdit && phoneForAds.length >= 8,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    }
  );
  const phoneAdsAttachedRef = useRef<string | null>(null);
  useEffect(() => {
    if (isEdit) return;
    if (!phoneAdsAttr?.matched || !phoneAdsAttr.attribution) return;
    const key = `${phoneAdsAttr.phone}:${phoneAdsAttr.attribution.whatsappClickId}`;
    if (phoneAdsAttachedRef.current === key) return;
    if (
      form.whatsappClickId != null &&
      form.whatsappClickId === phoneAdsAttr.attribution.whatsappClickId
    ) {
      phoneAdsAttachedRef.current = key;
      return;
    }
    phoneAdsAttachedRef.current = key;
    applyAdsWaClickRow(
      {
        id: phoneAdsAttr.attribution.whatsappClickId,
        ...phoneAdsAttr.attribution,
      },
      {
        toastMsg: `WhatsApp API 已自動對上 Google Ads（電話 ${phoneAdsAttr.phone}${
          phoneAdsAttr.contactName ? ` · ${phoneAdsAttr.contactName}` : ""
        }）`,
      }
    );
    if (phoneAdsAttr.contactName && !form.clientName.trim()) {
      setForm((p) => ({ ...p, clientName: phoneAdsAttr.contactName || p.clientName }));
    }
  }, [
    isEdit,
    phoneAdsAttr,
    form.whatsappClickId,
    form.clientName,
    applyAdsWaClickRow,
  ]);

  // Client fallback: match recent Ads WA click by matchedPhone when API
  // attribution is slow/misses (e.g. older first-message match outside limit).
  useEffect(() => {
    if (isEdit) return;
    if (form.whatsappClickId != null) return;
    if (phoneAdsAttr?.matched) return;
    if (phoneForAds.length < 8) return;
    if (!recentAdsWaClicks?.length) return;
    const normalized =
      phoneForAds.length === 8 && /^[4-9]/.test(phoneForAds)
        ? `852${phoneForAds}`
        : phoneForAds;
    const hit = recentAdsWaClicks.find((c) => {
      if (c.quoteId != null) return false;
      if (isProbeAdsWaClick(c)) return false;
      const mp = (c.matchedPhone || "").replace(/\D/g, "");
      if (!mp) return false;
      return mp === normalized || mp.endsWith(phoneForAds) || normalized.endsWith(mp);
    });
    if (!hit) return;
    const key = `matchedPhone:${normalized}:${hit.id}`;
    if (phoneAdsAttachedRef.current === key) return;
    phoneAdsAttachedRef.current = key;
    applyAdsWaClickRow(hit, {
      toastMsg: `已按電話自動帶入 Ads WA 點擊 #${hit.id}${
        hit.refCode ? `（${hit.refCode}）` : ""
      }`,
    });
  }, [
    isEdit,
    form.whatsappClickId,
    phoneAdsAttr?.matched,
    phoneForAds,
    recentAdsWaClicks,
    applyAdsWaClickRow,
  ]);

  const { data: existingQuote, isLoading: loadingQuote } = trpc.quotes.getById.useQuery(
    { id: quoteId! },
    { enabled: isEdit }
  );

  // Client search (by name/company/email)
  const { data: clientSearchResults } = trpc.clients.search.useQuery(
    { query: clientSearch, limit: 8 },
    { enabled: showClientDropdown }
  );

  // Phone lookup: search by phone number
  const { data: phoneSearchResults } = trpc.clients.search.useQuery(
    { query: phoneQuery, limit: 5 },
    { enabled: phoneQuery.length >= 4 }
  );

  // Auto-load client when clientId is set from URL
  const { data: preloadedClient } = trpc.clients.getById.useQuery(
    { id: form.clientId! },
    { enabled: !!form.clientId && !isEdit }
  );

  useEffect(() => {
    if (preloadedClient && !isEdit) {
      setForm(p => ({
        ...p,
        clientName: preloadedClient.name,
        clientEmail: preloadedClient.email ?? "",
        clientPhone: preloadedClient.phone ?? "",
        clientCompany: preloadedClient.company ?? "",
      }));
      setSelectedClientName(preloadedClient.name);
    }
  }, [preloadedClient]);

  // 查詢客戶的會員折扣
  const { data: clientDiscount } = trpc.loyalty.getClientDiscount.useQuery(
    { clientId: form.clientId! },
    { enabled: !!form.clientId }
  );

  // 當客戶有會員折扣時，自動填入折扣金額（僅新增模式且折扣尚未手動修改時）
  const [discountAutoApplied, setDiscountAutoApplied] = useState(false);
  useEffect(() => {
    if (!isEdit && clientDiscount && clientDiscount.discount > 0 && !discountAutoApplied) {
      setForm(p => ({ ...p, discountPercent: clientDiscount.discount }));
      setDiscountAutoApplied(true);
      toast.success(`已自動套用 ${clientDiscount.tierLabel} 會員折扣 ${clientDiscount.discount}%`);
    }
    if (!form.clientId) {
      setDiscountAutoApplied(false);
    }
  }, [clientDiscount, form.clientId, isEdit]);

  // DnD sensors for sortable items
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setForm((prev) => {
        const oldIndex = prev.items.findIndex((i) => i.id === active.id);
        const newIndex = prev.items.findIndex((i) => i.id === over.id);
        return { ...prev, items: arrayMove(prev.items, oldIndex, newIndex) };
      });
    }
  };

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (clientSearchRef.current && !clientSearchRef.current.contains(e.target as Node)) {
        setShowClientDropdown(false);
      }
      if (phoneRef.current && !phoneRef.current.contains(e.target as Node)) {
        setShowPhoneSuggestion(false);
      }
      if (inquirySearchRef.current && !inquirySearchRef.current.contains(e.target as Node)) {
        setShowInquiryDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Show phone suggestion when results arrive
  useEffect(() => {
    if (phoneSearchResults && phoneSearchResults.length > 0 && phoneQuery.length >= 4 && !form.clientId) {
      setShowPhoneSuggestion(true);
    } else {
      setShowPhoneSuggestion(false);
    }
  }, [phoneSearchResults, phoneQuery, form.clientId]);

  const handleSelectClient = (client: { id: number; name: string; company?: string | null; email?: string | null; phone?: string | null }) => {
    setForm(p => ({
      ...p,
      clientId: client.id,
      clientName: client.name,
      clientEmail: client.email ?? "",
      clientPhone: client.phone ?? "",
      clientCompany: client.company ?? "",
      saveAsNewClient: false,
    }));
    setSelectedClientName(client.name);
    setClientSearch("");
    setShowClientDropdown(false);
  };

  const handleClearClient = () => {
    setForm(p => ({ ...p, clientId: undefined, clientName: "", clientEmail: "", clientPhone: "", clientCompany: "", saveAsNewClient: false }));
    setSelectedClientName("");
  };

  const createClientMutation = trpc.clients.create.useMutation();

  useEffect(() => {
    if (!existingQuote) return;

    // Always hydrate from server first (source of truth for detail ↔ edit totals).
    const serverForm = formDataFromExistingQuote(existingQuote);
    serverUpdatedAtRef.current =
      (existingQuote as any).updatedAt != null
        ? String((existingQuote as any).updatedAt)
        : null;
    setSavedServerTotal(Number(existingQuote.total) || 0);
    setForm(serverForm);
    setForm((p) => {
      if (crewHeadcount(p) > 0) return p;
      const fromItems = crewFromTemplateItems(p.items);
      if (crewHeadcount(fromItems) <= 0) return p;
      const auto = buildTeamLabel(fromItems);
      return {
        ...p,
        ...fromItems,
        team: p.team.trim() || auto,
      };
    });
    if ((existingQuote as any).clientId) {
      setSelectedClientName(existingQuote.clientName);
    }

    // Park local draft if it still matches this server version and differs — never auto-apply.
    const draft = editDraftKey ? parseEditDraft(safeLSGet(editDraftKey)) : null;
    const serverUpdatedAt = serverUpdatedAtRef.current;
    if (draft) {
      const stale =
        draft.serverUpdatedAt != null &&
        serverUpdatedAt != null &&
        draft.serverUpdatedAt !== serverUpdatedAt;
      if (stale) {
        safeLSRemove(editDraftKey!);
        setPendingEditDraft(null);
        setHasEditDraft(false);
      } else {
        const draftTotals = computeQuoteTotalsFromItems(
          draft.form.items ?? [],
          Number(draft.form.discountPercent) || 0
        );
        const serverTotals = computeQuoteTotalsFromItems(
          serverForm.items,
          Number(serverForm.discountPercent) || 0
        );
        if (quoteMoneyDiffers(draftTotals.total, serverTotals.total)) {
          setPendingEditDraft(draft);
          setHasEditDraft(true);
        } else {
          setPendingEditDraft(null);
          // Keep ls in sync with envelope format; no conflict UI
          setHasEditDraft(false);
        }
      }
    } else {
      setPendingEditDraft(null);
      setHasEditDraft(false);
    }

    editFormLoadedRef.current = true;
    setEditHydrated(true);
  }, [existingQuote, editDraftKey]);

  const createMutation = trpc.quotes.create.useMutation({
    onSuccess: (data) => {
      clearDraft(); // Clear draft after successful save
      toast.success("報價單已建立");
      utils.quotes.list.invalidate();
      setLocation(`/quotes/${data.id}`);
    },
    onError: (e) => toast.error(`建立失敗：${(e.data as any)?.zodError ? JSON.stringify((e.data as any).zodError) : e.message}`),
  });

  const updateMutation = trpc.quotes.update.useMutation({
    onSuccess: async (updatedQuote) => {
      clearDraft(); // Same as create — avoid stale localStorage overwriting next edit
      toast.success("報價單已更新");
      // 直接將更新結果寫入 getById 快取，避免跟轉頁面時讀到舊資料
      if (quoteId && updatedQuote) {
        utils.quotes.getById.setData({ id: quoteId }, updatedQuote as any);
      }
      // 同步清除 list 快取
      await utils.quotes.list.invalidate();
      setLocation(`/quotes/${quoteId}`);
    },
    onError: (e) => toast.error(`更新失敗：${(e.data as any)?.zodError ? JSON.stringify((e.data as any).zodError) : e.message}`),
  });

  const subtotal = useMemo(
    () => form.items.reduce((sum, item) => sum + item.amount, 0),
    [form.items]
  );
  const discountAmount = computeQuoteDiscountAmount(
    form.items,
    form.discountPercent || 0
  );
  const total = Math.max(0, subtotal - discountAmount);

  const updateItem = (
    idx: number,
    field: keyof QuoteItem,
    value: string | number | boolean
  ) => {
    setForm((prev) => {
      const items = [...prev.items];
      const item = { ...items[idx], [field]: value } as QuoteItem;
      if (field === "quantity" || field === "unitPrice") {
        // Preserve waived rush (amount 0 with list unitPrice) unless user edits unitPrice while charged
        const wasWaived = isQuoteWaivedPrice(
          Number(items[idx].unitPrice),
          Number(items[idx].amount),
          Number(items[idx].quantity)
        );
        if (wasWaived && field === "quantity") {
          item.amount = 0;
        } else if (wasWaived && field === "unitPrice") {
          item.amount = 0;
        } else {
          item.amount = Number(item.quantity) * Number(item.unitPrice);
        }
      }
      items[idx] = item;
      return { ...prev, items };
    });
  };

  const addItem = () => {
    setForm((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          id: crypto.randomUUID(),
          description: "",
          quantity: 1,
          unitPrice: 0,
          amount: 0,
          category: "",
        },
      ],
    }));
  };

  const removeItem = (idx: number) => {
    if (form.items.length <= 1) return;
    setForm((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }));
  };

  /** Multi-select templates: keep Section B, rebuild billable lines from selected set. */
  const handleToggleTemplate = (templateId: QuoteTemplateId) => {
    const nextSelected = toggleQuoteTemplateSelection(selectedTemplates, templateId);
    setSelectedTemplates(nextSelected);

    setForm((prev) => {
      const sectionB = prev.items.filter((it) => isManagedSectionBItem(it.description));
      const merged = mergeQuoteTemplateItems(nextSelected);
      const extras = extrasFromSelectedTemplates(nextSelected);

      let core: QuoteItem[] =
        merged.length > 0
          ? merged.map((item) => ({
              id: crypto.randomUUID(),
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              amount: item.quantity * item.unitPrice,
              isIncluded: item.isIncluded ?? false,
              category: "" as const,
            }))
          : [];

      // No template selected → keep a blank starter if Section B is also empty
      if (core.length === 0 && sectionB.length === 0) {
        core = [
          {
            id: crypto.randomUUID(),
            description: "",
            quantity: 1,
            unitPrice: 0,
            amount: 0,
            category: "",
          },
        ];
      }

      const crew = extras.primaryTemplateId
        ? crewFromTemplateItems([], extras.primaryTemplateId)
        : {
            crewPhotographers: prev.crewPhotographers,
            crewAssistants: prev.crewAssistants,
            crewVideographers: prev.crewVideographers,
            crewOthers: prev.crewOthers,
          };
      const auto = buildTeamLabel(crew);

      let items = [...core, ...sectionB];
      if (hasConditionalSectionB(prev.serviceType) && sectionB.length === 0) {
        items = applySectionBForServiceType(items, prev.serviceType, () =>
          crypto.randomUUID()
        );
      }

      return {
        ...prev,
        items,
        ...(extras.primaryTemplateId ? crew : {}),
        team: extras.primaryTemplateId ? auto || prev.team : prev.team,
        equipment: extras.equipment || prev.equipment,
        deliveryMethod: extras.deliveryMethod || prev.deliveryMethod,
        shootHours: prev.shootHours,
      };
    });
  };

  const handleServiceTypeChange = (value: string) => {
    setForm((prev) => {
      const nextItems = hasConditionalSectionB(value)
        ? applySectionBForServiceType(prev.items, value, () => crypto.randomUUID())
        : prev.items.filter((it) => !isManagedSectionBItem(it.description));
      return {
        ...prev,
        serviceType: value,
        notes: applyServiceNotes(prev.notes, value),
        items:
          nextItems.length > 0
            ? nextItems
            : [{ id: crypto.randomUUID(), description: "", quantity: 1, unitPrice: 0, amount: 0, category: "" }],
      };
    });
  };

  const handleToggleItemWaive = (idx: number) => {
    setForm((prev) => ({
      ...prev,
      items: toggleQuoteItemWaived(prev.items, idx),
    }));
  };

  const handleSubmit = async () => {
    if (!form.clientName.trim()) { toast.error("請填寫客戶名稱"); return; }
    if (!form.leadSource) { toast.error("請選擇詢價來源"); return; }
    if (form.items.some((i) => !i.description.trim())) { toast.error("請填寫所有服務項目說明"); return; }

    const pricingMode = quotePricingMode(form.serviceType);
    const shootHoursStr = form.shootHours ?? "";
    const shotCountStr = form.shotCount ?? "";
    const hoursNum = shootHoursStr.trim() ? Number(shootHoursStr) : null;
    let shootHours =
      hoursNum != null && Number.isFinite(hoursNum) && hoursNum > 0
        ? hoursNum
        : null;

    const shotNum = shotCountStr.trim() ? Number(shotCountStr) : null;
    const shotCount =
      shotNum != null && Number.isFinite(shotNum) && shotNum > 0
        ? Math.floor(shotNum)
        : null;

    let crew = {
      crewPhotographers: Math.max(0, Math.floor(form.crewPhotographers) || 0),
      crewAssistants: Math.max(0, Math.floor(form.crewAssistants) || 0),
      crewVideographers: Math.max(0, Math.floor(form.crewVideographers) || 0),
      crewOthers: Math.max(0, Math.floor(form.crewOthers) || 0),
    };

    // If structured crew empty, try read from Team XP line / team text
    if (crewHeadcount(crew) <= 0) {
      const fromItems = crewFromTemplateItems(form.items);
      if (crewHeadcount(fromItems) > 0) crew = fromItems;
    }

    if (pricingMode === "time_crew") {
      if (shootHours == null) {
        toast.error("請填寫拍攝時數（服務資料）");
        return;
      }
      if (crewHeadcount(crew) <= 0) {
        toast.error("請填寫人手人數（至少一位攝影師／錄影／助理）");
        return;
      }
    } else if (pricingMode === "shot_count") {
      if (shotCount == null) {
        toast.error("請填寫交付張數（產品／靜物報價以張數計）");
        return;
      }
    }

    // Qty 0 + $0 = client-choice Option (not free). Qty > 0 + $0 = included/free reminder.
    const optionItems = form.items.filter(
      (i) =>
        !i.isIncluded &&
        Number(i.unitPrice) === 0 &&
        !(Number(i.quantity) > 0) &&
        i.description.trim() &&
        !isQuoteSectionHeader(i.description)
    );
    const freeItems = form.items.filter(
      (i) =>
        !i.isIncluded &&
        Number(i.unitPrice) === 0 &&
        Number(i.quantity) > 0 &&
        i.description.trim()
    );
    if (optionItems.length > 0) {
      toast(
        `提示：以下項目數量／單價為 0，客戶可見為 Option（待揀）：${optionItems.map((i) => i.description).join("、")}`,
        { icon: "ℹ️", duration: 5000 }
      );
    }
    if (freeItems.length > 0) {
      toast(
        `提示：以下項目金額為 $0，已記錄為免費／套餐內含：${freeItems.map((i) => i.description).join("、")}`,
        { icon: "ℹ️", duration: 5000 }
      );
    }

    let resolvedClientId = form.clientId;

    // If "save as new client" is checked and no existing client selected (legacy path for edit mode)
    if (form.saveAsNewClient && !form.clientId && form.clientName.trim() && isEdit) {
      try {
        const newClient = await createClientMutation.mutateAsync({
          name: form.clientName.trim(),
          company: form.clientCompany || undefined,
          email: form.clientEmail || undefined,
          phone: form.clientPhone || undefined,
        });
        resolvedClientId = newClient?.id;
      } catch {
        // non-fatal: proceed without clientId
      }
    }

    // 固定金額模式：直接存 depositFixedAmount，depositPercent 設為 0（不轉換，避免浮點誤差）
    // 百分比模式：depositPercent 正常，depositFixedAmount 設為 undefined
    const finalDepositPercent = form.depositMode === "fixed" ? 0 : form.depositPercent;
    const finalDepositFixedAmount = form.depositMode === "fixed" ? form.depositFixedAmount : undefined;

    const autoTeam = buildTeamLabel(crew);
    const team =
      form.team.trim() ||
      autoTeam ||
      "";
    const syncedItems = syncTeamLineItem(form.items, crewHeadcount(crew)).map(
      (item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        amount: item.amount,
        isIncluded: item.isIncluded,
        category: item.category ? item.category : null,
      })
    );

    const { items: reconciledItems, adjustments } = reconcileHourlyQuoteItems(
      form.serviceType,
      syncedItems
    );
    if (adjustments.length > 0) {
      toast(
        `已按描述內時數調整項目數量：${formatHourlyQuantityAdjustments(adjustments)}`,
        { icon: "ℹ️", duration: 6000 }
      );
    }
    const items = reconciledItems;

    const reconciledSubtotal = items.reduce((sum, item) => sum + item.amount, 0);
    // Keep same rule as live preview: never discount transport / rush fees
    const reconciledDiscountAmount =
      form.discountPercent > 0
        ? computeQuoteDiscountAmount(items, form.discountPercent)
        : discountAmount;
    const reconciledTotal =
      Math.round((reconciledSubtotal - reconciledDiscountAmount) * 100) / 100;

    const emptyToNull = (v: string) => {
      const s = (v ?? "").trim();
      return s ? s : null;
    };
    const payload = {
      ...form,
      serviceType: form.serviceType as any,
      subtotal: reconciledSubtotal,
      discountPercent: form.discountPercent,
      discountAmount: reconciledDiscountAmount,
      total: reconciledTotal,
      depositPercent: finalDepositPercent,
      depositFixedAmount: finalDepositFixedAmount,
      depositMode: form.depositMode,
      clientId: resolvedClientId,
      items,
      shootHours,
      shotCount,
      durationPackage: form.durationPackage || null,
      ...crew,
      team,
      // For new quotes: use backend syncToClients to upsert client automatically
      syncToClients: !isEdit ? (form.syncToClients ?? true) : undefined,
      // Ensure null is not passed (use undefined to omit)
      emailInquiryId: form.emailInquiryId ?? undefined,
      gclid: emptyToNull(form.gclid),
      gbraid: emptyToNull(form.gbraid),
      wbraid: emptyToNull(form.wbraid),
      utmSource: emptyToNull(form.utmSource),
      utmMedium: emptyToNull(form.utmMedium),
      utmCampaign: emptyToNull(form.utmCampaign),
      utmContent: emptyToNull(form.utmContent),
      utmTerm: emptyToNull(form.utmTerm),
      adsCampaignId: emptyToNull(form.adsCampaignId),
      adsCampaignName: emptyToNull(form.adsCampaignName),
      landingPageUrl: emptyToNull(form.landingPageUrl),
      whatsappClickId: form.whatsappClickId ?? null,
    };

    if (isEdit && quoteId) {
      updateMutation.mutate({ id: quoteId, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  // Wait until edit form is hydrated — otherwise Selects render with value="" and Radix crashes.
  if (isEdit && (loadingQuote || !editHydrated)) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-6 w-6 animate-spin" style={{ color: "#d4a843" }} />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => setLocation("/quotes")}
            className="p-2 rounded hover:bg-white/5 transition-colors"
          >
            <ArrowLeft className="h-4 w-4 text-muted-foreground" />
          </button>
          <div>
            <div style={{ fontSize: "0.6rem", letterSpacing: "0.2em", color: "#d4a843", textTransform: "uppercase", marginBottom: "4px" }}>
              {isEdit ? "Edit Quote" : "New Quote"}
            </div>
            <h1 className="text-2xl font-light">{isEdit ? "編輯報價單" : "新增報價單"}</h1>
          </div>
          {/* Draft indicator */}
          {!isEdit && hasDraft && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs" style={{ color: "rgba(212,168,67,0.7)" }}>草稿已自動儲存</span>
              <button
                onClick={() => { setForm(normalizeFormData(emptyForm)); clearDraft(); setSelectedClientName(""); }}
                className="text-xs px-2 py-0.5 rounded hover:opacity-70 transition-opacity"
                style={{ border: "1px solid rgba(255,255,255,0.15)", color: "#888" }}
              >
                清除草稿
              </button>
            </div>
          )}
        </div>

        {isEdit && pendingEditDraft && (
          <div
            className="flex flex-wrap items-center gap-2 rounded px-3 py-2 text-xs"
            style={{
              background: "rgba(245,166,35,0.1)",
              border: "1px solid rgba(245,166,35,0.35)",
              color: "#f5a623",
            }}
          >
            <span>
              偵測到本機未儲存草稿（草稿總計 HKD{" "}
              {computeQuoteTotalsFromItems(
                pendingEditDraft.form.items ?? [],
                Number(pendingEditDraft.form.discountPercent) || 0
              ).total.toLocaleString()}
              ；已儲存 HKD {(savedServerTotal ?? 0).toLocaleString()}
              ）。而家顯示已儲存版本。
            </span>
            <button
              type="button"
              onClick={() => {
                const draftForm = normalizeFormData(pendingEditDraft.form);
                setForm(draftForm);
                if (draftForm.clientId && draftForm.clientName) {
                  setSelectedClientName(draftForm.clientName);
                }
                setPendingEditDraft(null);
                setHasEditDraft(true);
                toast("已套用本機草稿 — 記得儲存先會寫入伺服器");
              }}
              className="px-2 py-0.5 rounded hover:opacity-80"
              style={{ border: "1px solid rgba(245,166,35,0.5)", color: "#f5a623" }}
            >
              套用草稿
            </button>
            <button
              type="button"
              onClick={() => {
                if (editDraftKey) safeLSRemove(editDraftKey);
                setPendingEditDraft(null);
                setHasEditDraft(false);
                toast.success("已丟棄本機草稿");
              }}
              className="px-2 py-0.5 rounded hover:opacity-80"
              style={{ border: "1px solid rgba(255,255,255,0.2)", color: "#aaa" }}
            >
              丟棄草稿
            </button>
          </div>
        )}

        {isEdit &&
          savedServerTotal != null &&
          quoteMoneyDiffers(total, savedServerTotal) &&
          !pendingEditDraft && (
            <div
              className="rounded px-3 py-2 text-xs"
              style={{
                background: "rgba(33,150,243,0.08)",
                border: "1px solid rgba(33,150,243,0.3)",
                color: "#64b5f6",
              }}
            >
              項目加總 HKD {total.toLocaleString()} 同詳情頁已儲存總計 HKD{" "}
              {savedServerTotal.toLocaleString()}{" "}
              唔一致（常見原因：舊資料用 qty×單價計咗豁免項目）。儲存後會以項目金額對齊。
            </div>
          )}

        <div style={{ height: "1px", background: "linear-gradient(to right, #d4a843, rgba(212,168,67,0.1), transparent)" }} />

        {/* Client Info */}
        <Section title="客戶資料" subtitle="Client Information">
          {/* Client Search */}
          <div className="mb-4" ref={clientSearchRef}>
            <div style={{ fontSize: "0.6rem", letterSpacing: "0.15em", color: "#888", textTransform: "uppercase", marginBottom: "6px" }}>
              從客戶資料庫選擇
            </div>
            {selectedClientName ? (
              <div className="flex items-center gap-3 px-3 py-2 rounded" style={{ background: "rgba(212,168,67,0.08)", border: "1px solid rgba(212,168,67,0.3)" }}>
                <Check className="h-4 w-4 flex-shrink-0" style={{ color: "#d4a843" }} />
                <span className="text-sm flex-1">{selectedClientName} 已選擇</span>
                <button onClick={handleClearClient} className="p-0.5 hover:opacity-70 transition-opacity">
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={clientSearch}
                  onChange={(e) => { setClientSearch(e.target.value); setShowClientDropdown(true); }}
                  onFocus={() => setShowClientDropdown(true)}
                  placeholder="搜尋現有客戶（姓名 / 公司 / 電郵）..."
                  className="pl-9"
                  style={inputStyle}
                />
                {showClientDropdown && (
                  <div className="absolute z-50 w-full mt-1 rounded shadow-xl" style={{ background: "#1a1a1a", border: "1px solid rgba(212,168,67,0.25)", maxHeight: "240px", overflowY: "auto" }}>
                    {!clientSearchResults || clientSearchResults.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-muted-foreground">
                        {clientSearch ? "找不到符合的客戶" : "輸入關鍵字搜尋客戶"}
                      </div>
                    ) : (
                      clientSearchResults.map((c) => (
                        <button
                          key={c.id}
                          className="w-full text-left px-4 py-2.5 hover:bg-white/5 transition-colors border-b last:border-0"
                          style={{ borderColor: "rgba(255,255,255,0.05)" }}
                          onMouseDown={(e) => { e.preventDefault(); handleSelectClient(c); }}
                        >
                          <div className="text-sm font-medium">{c.name}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {[c.company, c.email, c.phone].filter(Boolean).join(" · ")}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="客戶名稱 *">
              <Input
                value={form.clientName}
                onChange={(e) => setForm((p) => ({ ...p, clientName: e.target.value }))}
                placeholder="輸入客戶姓名或公司名稱"
                style={inputStyle}
              />
            </FormField>
            <FormField label="公司名稱">
              <Input
                value={form.clientCompany}
                onChange={(e) => setForm((p) => ({ ...p, clientCompany: e.target.value }))}
                placeholder="選填"
                style={inputStyle}
              />
            </FormField>
            <FormField label="電郵地址">
              <Input
                type="email"
                value={form.clientEmail}
                onChange={(e) => setForm((p) => ({ ...p, clientEmail: e.target.value }))}
                placeholder="client@example.com"
                style={inputStyle}
              />
            </FormField>
            <FormField label="聯絡電話">
              <div className="relative" ref={phoneRef}>
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none" style={{ color: "rgba(212,168,67,0.5)" }} />
                <Input
                  value={form.clientPhone}
                  onChange={(e) => {
                    const val = e.target.value;
                    setForm((p) => ({ ...p, clientPhone: val }));
                    if (!form.clientId) {
                      setPhoneQuery(val);
                    }
                  }}
                  onFocus={() => {
                    if (phoneQuery.length >= 4 && !form.clientId) setShowPhoneSuggestion(true);
                  }}
                  placeholder="+852 xxxx xxxx"
                  style={{ ...inputStyle, paddingLeft: "2.25rem" }}
                />
                {showPhoneSuggestion && phoneSearchResults && phoneSearchResults.length > 0 && (
                  <div
                    className="absolute z-50 w-full mt-1 rounded shadow-xl"
                    style={{ background: "#1a1a1a", border: "1px solid rgba(212,168,67,0.4)", maxHeight: "200px", overflowY: "auto" }}
                  >
                    <div className="px-3 py-2 text-xs" style={{ color: "#d4a843", borderBottom: "1px solid rgba(212,168,67,0.15)", letterSpacing: "0.08em" }}>
                      找到相符客戶，點擊自動填入
                    </div>
                    {phoneSearchResults.map((c) => (
                      <button
                        key={c.id}
                        className="w-full text-left px-3 py-2.5 hover:bg-white/5 transition-colors border-b last:border-0"
                        style={{ borderColor: "rgba(255,255,255,0.05)" }}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSelectClient(c);
                          setPhoneQuery("");
                          setShowPhoneSuggestion(false);
                        }}
                      >
                        <div className="text-sm font-medium">{c.name}</div>
                        <div className="text-xs mt-0.5" style={{ color: "#888" }}>
                          {[c.phone, c.company, c.email].filter(Boolean).join(" · ")}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </FormField>
          </div>

          {/* Sync to clients option */}
          {!isEdit && (
            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setForm(p => ({ ...p, syncToClients: !(p.syncToClients ?? true) }))}
                className="flex items-center gap-2 text-xs transition-colors"
                style={{ color: (form.syncToClients ?? true) ? "#d4a843" : "#666" }}
              >
                <div
                  className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                  style={{ border: `1px solid ${(form.syncToClients ?? true) ? "#d4a843" : "rgba(255,255,255,0.2)"}`, background: (form.syncToClients ?? true) ? "rgba(212,168,67,0.15)" : "transparent" }}
                >
                  {(form.syncToClients ?? true) && <Check className="h-2.5 w-2.5" style={{ color: "#d4a843" }} />}
                </div>
                <UserPlus className="h-3.5 w-3.5" />
                {form.clientId ? "已連結現有客戶，資料將自動更新" : "自動同步到客戶資料庫（若已有相同電話或姓名則更新，否則新增）"}
              </button>
            </div>
          )}
        </Section>

        {/* Service Info */}
        <Section title="服務資料" subtitle="Service Details">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="服務類型 *">
              <Select value={form.serviceType} onValueChange={handleServiceTypeChange}>
                <SelectTrigger style={inputStyle}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SERVICE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            {!DESIGN_SERVICE_TYPES.has(form.serviceType) && (
              <FormField label="拍攝日期">
                <Input
                  type="date"
                  value={form.shootingDate}
                  onChange={(e) => {
                    const newShootingDate = e.target.value;
                    setForm((p) => {
                      // Auto-set validUntil to 14 days before shooting date
                      // only if validUntil is empty or was previously auto-set (same as old shooting date - 14 days)
                      let newValidUntil = p.validUntil;
                      if (newShootingDate) {
                        const shootDate = new Date(newShootingDate);
                        const autoValid = new Date(shootDate);
                        autoValid.setDate(autoValid.getDate() - 14);
                        const autoValidStr = autoValid.toISOString().split('T')[0];
                        // Check if current validUntil was auto-set from old shooting date
                        const oldAutoValid = p.shootingDate ? (() => {
                          const old = new Date(p.shootingDate);
                          old.setDate(old.getDate() - 14);
                          return old.toISOString().split('T')[0];
                        })() : null;
                        if (!p.validUntil || p.validUntil === p.shootingDate || p.validUntil === oldAutoValid) {
                          newValidUntil = autoValidStr;
                        }
                      }
                      return { ...p, shootingDate: newShootingDate, validUntil: newValidUntil };
                    });
                  }}
                  style={inputStyle}
                />
              </FormField>
            )}
            <FormField label="拍攝地點">
              <Input
                value={form.shootingLocation}
                onChange={(e) => setForm((p) => ({ ...p, shootingLocation: e.target.value }))}
                placeholder="拍攝地址或地點描述"
                style={inputStyle}
              />
            </FormField>
            {!DESIGN_SERVICE_TYPES.has(form.serviceType) && (
              <FormField label="報價有效期至">
                <Input
                  type="date"
                  value={form.validUntil}
                  onChange={(e) => setForm((p) => ({ ...p, validUntil: e.target.value }))}
                  style={inputStyle}
                />
              </FormField>
            )}
            {quotePricingMode(form.serviceType) === "time_crew" && (
              <FormField label={<span>拍攝時數 <span style={{ color: "#ef4444", fontWeight: "bold" }}>*</span></span>}>
                <Input
                  type="number"
                  min={0.5}
                  max={72}
                  step={0.5}
                  value={form.shootHours ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setForm((p) => {
                      const n = v.trim() ? Number(v) : null;
                      const inferred =
                        n != null && Number.isFinite(n)
                          ? inferDurationPackageFromHours(n)
                          : "unknown";
                      const nextPkg =
                        !p.durationPackage &&
                        inferred !== "unknown"
                          ? (inferred as FormData["durationPackage"])
                          : p.durationPackage;
                      return { ...p, shootHours: v, durationPackage: nextPkg };
                    });
                  }}
                  placeholder="例如 4"
                  style={{
                    ...inputStyle,
                    borderColor: !(form.shootHours ?? "").trim()
                      ? "rgba(239,68,68,0.55)"
                      : undefined,
                  }}
                />
              </FormField>
            )}
            {quotePricingMode(form.serviceType) === "time_crew" && (
              <FormField label="時長套餐">
                <Select
                  value={form.durationPackage || undefined}
                  onValueChange={(v) =>
                    setForm((p) => ({
                      ...p,
                      durationPackage: v as FormData["durationPackage"],
                    }))
                  }
                >
                  <SelectTrigger style={inputStyle}>
                    <SelectValue placeholder="按小時／半日／全日／多日" />
                  </SelectTrigger>
                  <SelectContent>
                    {DURATION_PACKAGE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}（{o.hint}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="text-[11px] text-muted-foreground mt-1">
                  半日／全日／多日成功率較低；用套餐標記方便學習勝率
                </div>
              </FormField>
            )}
            {quotePricingMode(form.serviceType) === "shot_count" && (
              <FormField label={<span>交付張數 <span style={{ color: "#ef4444", fontWeight: "bold" }}>*</span></span>}>
                <Input
                  type="number"
                  min={1}
                  max={5000}
                  step={1}
                  value={form.shotCount ?? ""}
                  onChange={(e) => setForm((p) => ({ ...p, shotCount: e.target.value }))}
                  placeholder="例如 20"
                  style={{
                    ...inputStyle,
                    borderColor: !(form.shotCount ?? "").trim()
                      ? "rgba(239,68,68,0.55)"
                      : undefined,
                  }}
                />
                <div className="text-[11px] text-muted-foreground mt-1">
                  產品／靜物報價以張數計價（唔強制時數／人手）
                </div>
              </FormField>
            )}
            <FormField label={<span>詢價來源 <span style={{color:'#ef4444',fontWeight:'bold'}}>*</span></span>}>
              <Select
                value={form.leadSource || undefined}
                onValueChange={(v) => setForm((p) => ({ ...p, leadSource: v }))}
              >
                <SelectTrigger style={{...inputStyle, borderColor: !form.leadSource ? 'rgba(239,68,68,0.6)' : undefined}}>
                  <SelectValue placeholder="請選擇詢價來源（必填）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HelloToby">HelloToby</SelectItem>
                  <SelectItem value="PRO360">PRO360</SelectItem>
                  <SelectItem value="FreelanceHunter">Freelance Hunter</SelectItem>
                  <SelectItem value="88DB">88DB</SelectItem>
                  <SelectItem value="Instagram">Instagram</SelectItem>
                  <SelectItem value="Facebook">Facebook</SelectItem>
                  <SelectItem value="Google">Google Ads</SelectItem>
                  <SelectItem value="Organic">SEO／GEO 自然搜尋</SelectItem>
                  <SelectItem value="AI">AI／AEO（ChatGPT 等）</SelectItem>
                  <SelectItem value="Referral">朋友介紹</SelectItem>
                  <SelectItem value="Website">網站直訪</SelectItem>
                  <SelectItem value="Repeat">舊客回頭</SelectItem>
                  <SelectItem value="Other">其他</SelectItem>
                </SelectContent>
              </Select>
              <div className="text-[11px] text-muted-foreground mt-1">
                Ads＝有 gclid／付費 UTM；SEO／GEO＝utm_medium=organic 或搜尋 referrer；AI／AEO＝ChatGPT 等；網站直訪＝無來源訊號
              </div>
            </FormField>

            {form.leadSource === "Google" && (() => {
              const normalizedPhone =
                phoneForAds.length === 8 && /^[4-9]/.test(phoneForAds)
                  ? `852${phoneForAds}`
                  : phoneForAds;
              const pickerClicks = rankAdsWaClicksForPicker(recentAdsWaClicks ?? [], {
                preferPhoneDigits: normalizedPhone,
              });
              const linkedClick =
                form.whatsappClickId != null
                  ? pickerClicks.find((c) => c.id === form.whatsappClickId) ||
                    (recentAdsWaClicks ?? []).find((c) => c.id === form.whatsappClickId)
                  : null;
              const autoMatched =
                form.whatsappClickId != null &&
                (phoneAdsAttr?.matched === true ||
                  (!!linkedClick?.matchedPhone &&
                    !!normalizedPhone &&
                    (linkedClick.matchedPhone.replace(/\D/g, "") === normalizedPhone ||
                      linkedClick.matchedPhone.replace(/\D/g, "").endsWith(phoneForAds))));
              const waitingPhone = phoneForAds.length < 8;
              const noMatchYet =
                !waitingPhone && form.whatsappClickId == null && phoneAdsAttr && !phoneAdsAttr.matched;

              return (
              <div className="md:col-span-2 space-y-3 rounded-md border border-[rgba(212,168,67,0.25)] p-3">
                <div
                  className="text-xs"
                  style={{ color: "rgba(212,168,67,0.9)", letterSpacing: "0.06em" }}
                >
                  Google Ads 歸因
                </div>

                {autoMatched ? (
                  <div className="rounded-md bg-[rgba(212,168,67,0.08)] px-3 py-2 text-sm space-y-1">
                    <div className="flex items-center gap-2 font-medium">
                      <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                      已按電話自動配對，唔使揀列表
                    </div>
                    <div className="text-xs text-muted-foreground pl-6">
                      {formatAdsWaPhone(linkedClick?.matchedPhone || phoneAdsAttr?.phone) ||
                        formatAdsWaPhone(normalizedPhone) ||
                        phoneForAds}
                      {linkedClick?.clickedAt
                        ? ` · ${new Date(linkedClick.clickedAt).toLocaleString("zh-HK", {
                            timeZone: "Asia/Hong_Kong",
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}`
                        : ""}
                      {" · "}
                      {shortLandingLabel(linkedClick?.landingPageUrl || form.landingPageUrl) ||
                        linkedClick?.adsCampaignName ||
                        form.adsCampaignName ||
                        `click #${form.whatsappClickId}`}
                    </div>
                    <div className="pl-6 flex flex-wrap gap-3 text-[11px]">
                      <button
                        type="button"
                        className="underline text-muted-foreground hover:text-foreground"
                        onClick={() => setShowManualAdsPick((v) => !v)}
                      >
                        {showManualAdsPick ? "收起手動選項" : "改手動／解除連結"}
                      </button>
                    </div>
                  </div>
                ) : waitingPhone ? (
                  <div className="text-xs text-muted-foreground">
                    填客戶電話後會自動對上 WhatsApp Ads click（GCLID／landing／campaign），一般唔使開列表。
                  </div>
                ) : noMatchYet ? (
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div>呢個電話暫時未對到近期 Ads WhatsApp click（可能係自然流，或者未撳過追蹤連結）。</div>
                    <button
                      type="button"
                      className="underline"
                      onClick={() => setShowManualAdsPick(true)}
                    >
                      進階：人手揀 click（少用）
                    </button>
                  </div>
                ) : form.whatsappClickId != null ? (
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                    已連結 WA click #{form.whatsappClickId}
                    <button
                      type="button"
                      className="underline"
                      onClick={() => setShowManualAdsPick((v) => !v)}
                    >
                      {showManualAdsPick ? "收起" : "更改"}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="text-xs underline text-muted-foreground"
                    onClick={() => setShowManualAdsPick(true)}
                  >
                    進階：人手揀 click（少用）
                  </button>
                )}

                {(showManualAdsPick || (!autoMatched && form.whatsappClickId == null && phoneForAds.length >= 8 && phoneAdsAttr?.matched === false)) && (
                  <FormField label="手動揀 Ads WA 點擊（可選）">
                    <Select
                      value={
                        form.whatsappClickId != null
                          ? String(form.whatsappClickId)
                          : "__none__"
                      }
                      onValueChange={(v) => {
                        applyAdsWaClick(v);
                        if (v !== "__none__") setShowManualAdsPick(false);
                      }}
                    >
                      <SelectTrigger style={inputStyle}>
                        <SelectValue placeholder="選擇近期追蹤點擊（可選）" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">不連結 WA 點擊</SelectItem>
                        {pickerClicks.map((c) => {
                          const when = c.clickedAt
                            ? new Date(c.clickedAt).toLocaleString("zh-HK", {
                                timeZone: "Asia/Hong_Kong",
                                month: "2-digit",
                                day: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "";
                          const phone = formatAdsWaPhone(c.matchedPhone) || "未配對電話";
                          const page =
                            shortLandingLabel(c.landingPageUrl) ||
                            c.adsCampaignName ||
                            c.utmCampaign ||
                            "—";
                          const linked = c.quoteId ? " · 已連結報價" : "";
                          return (
                            <SelectItem key={c.id} value={String(c.id)}>
                              {phone} · {when} · {page}
                              {linked}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </FormField>
                )}

                {(form.gclid || form.landingPageUrl || form.adsCampaignId || showManualAdsPick) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <FormField label="GCLID">
                    <Input
                      value={form.gclid}
                      onChange={(e) => setForm((p) => ({ ...p, gclid: e.target.value }))}
                      placeholder="自動帶入"
                      style={inputStyle}
                      readOnly={autoMatched && !showManualAdsPick}
                    />
                  </FormField>
                  <FormField label="Landing page">
                    <Input
                      value={form.landingPageUrl}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, landingPageUrl: e.target.value }))
                      }
                      placeholder="自動帶入"
                      style={inputStyle}
                      readOnly={autoMatched && !showManualAdsPick}
                    />
                  </FormField>
                  <FormField label="Campaign ID">
                    <Input
                      value={form.adsCampaignId}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, adsCampaignId: e.target.value }))
                      }
                      placeholder="自動帶入"
                      style={inputStyle}
                      readOnly={autoMatched && !showManualAdsPick}
                    />
                  </FormField>
                  <FormField label="Campaign 名稱">
                    <Input
                      value={form.adsCampaignName}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, adsCampaignName: e.target.value }))
                      }
                      placeholder="可選"
                      style={inputStyle}
                    />
                  </FormField>
                </div>
                )}
              </div>
              );
            })()}

            {quotePricingMode(form.serviceType) === "time_crew" && (
              <div className="md:col-span-2">
                <div
                  className="text-xs mb-2"
                  style={{ color: "rgba(212,168,67,0.85)", letterSpacing: "0.08em" }}
                >
                  人手安排 <span style={{ color: "#ef4444" }}>*</span>
                  <span className="ml-2 text-muted-foreground normal-case tracking-normal">
                    （會同步明細「Team XP」同 Team 欄）
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {(
                    [
                      ["crewPhotographers", "攝影師"],
                      ["crewAssistants", "助理"],
                      ["crewVideographers", "錄影"],
                      ["crewOthers", "其他"],
                    ] as const
                  ).map(([key, label]) => (
                    <FormField key={key} label={label}>
                      <Input
                        type="number"
                        min={0}
                        max={20}
                        step={1}
                        value={form[key]}
                        onChange={(e) => {
                          const n = Math.max(0, Math.min(20, parseInt(e.target.value, 10) || 0));
                          setForm((p) => {
                            const next = { ...p, [key]: n };
                            const auto = buildTeamLabel(next);
                            const prevAuto = buildTeamLabel(p);
                            const team =
                              !p.team.trim() || p.team.trim() === prevAuto
                                ? auto
                                : p.team;
                            const items = syncTeamLineItem(
                              p.items,
                              crewHeadcount(next)
                            );
                            return { ...next, team, items };
                          });
                        }}
                        style={inputStyle}
                      />
                    </FormField>
                  ))}
                </div>
              </div>
            )}

            {priceSuggest?.suggestion && (
              <div
                className="md:col-span-2 p-3 rounded space-y-2"
                style={{
                  background: "rgba(212,168,67,0.06)",
                  border: "1px solid rgba(212,168,67,0.22)",
                }}
              >
                <div
                  className="text-xs"
                  style={{ color: "#d4a843", letterSpacing: "0.1em" }}
                >
                  定價參考（學習）
                  {priceSuggest.confidenceShortLabel
                    ? ` · ${priceSuggest.confidenceShortLabel}`
                    : ""}
                  {priceSuggest.winRate?.winPct != null
                    ? ` · 同類勝率 ${priceSuggest.winRate.winPct}%（${priceSuggest.winRate.accepted}/${priceSuggest.winRate.decided}）`
                    : ""}
                  {form.leadSource
                    ? ` · 來源 ${form.leadSource}`
                    : " · 未選來源"}
                </div>
                {priceSuggest.leadSourceContext?.note && (
                  <div className="text-[11px]" style={{ color: "rgba(232,224,208,0.75)" }}>
                    {priceSuggest.leadSourceContext.note}
                    {priceSuggest.platformWinRate?.winPct != null
                      ? ` 該平台勝率 ${priceSuggest.platformWinRate.winPct}%（${priceSuggest.platformWinRate.accepted}/${priceSuggest.platformWinRate.decided}）。`
                      : ""}
                    {priceSuggest.platformAvgOverBudgetOnPriceRejects != null
                      ? ` 該平台價拒平均高出預算約 HK$${priceSuggest.platformAvgOverBudgetOnPriceRejects.toLocaleString("en-HK")}。`
                      : ""}
                  </div>
                )}
                {!form.leadSource && (
                  <div className="text-[11px]" style={{ color: "#fbbf24" }}>
                    請先選「詢價來源」：建議價會跟該平台已接受成交中位（唔係人工打折）。
                  </div>
                )}
                {priceSuggest.confidence === "advisory" && (
                  <div className="text-[11px]" style={{ color: "#fbbf24" }}>
                    僅供參考 — 樣本仍少，唔好直接當開價。
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                  {priceSuggest.packages &&
                    (
                      [
                        ["essential", priceSuggest.packages.essential],
                        ["standard", priceSuggest.packages.standard],
                        ["coverage", priceSuggest.packages.coverage],
                      ] as const
                    ).map(([key, pkg]) => (
                      <div
                        key={key}
                        className="p-2 rounded"
                        style={{ background: "rgba(0,0,0,0.25)" }}
                      >
                        <div className="text-muted-foreground">{pkg.label}</div>
                        <div style={{ color: "#e8e0d0", fontSize: "1.05rem" }}>
                          HK$ {pkg.mid.toLocaleString("en-HK")}
                        </div>
                        <div className="text-muted-foreground mt-0.5">{pkg.note}</div>
                      </div>
                    ))}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {priceSuggest.note}
                  {" "}
                  {priceSuggest.costFloorNote}
                  {pricingMode === "time_crew" &&
                  (form.durationPackage === "half_day" ||
                    form.durationPackage === "full_day" ||
                    form.durationPackage === "multi_day")
                    ? " 半日／全日／多日請用套餐思維，唔好死跟 $1000×小時。"
                    : ""}
                </div>
              </div>
            )}

            {priceSuggest &&
              !priceSuggest.suggestion &&
              form.serviceType &&
              form.serviceType !== "other" &&
              !DESIGN_SERVICE_TYPES.has(form.serviceType) && (
              <div
                className="md:col-span-2 p-3 rounded text-xs text-muted-foreground"
                style={{
                  background: "rgba(212,168,67,0.04)",
                  border: "1px solid rgba(212,168,67,0.15)",
                }}
              >
                <div style={{ color: "#d4a843", marginBottom: 4 }}>
                  {priceSuggest.confidenceLabel ?? "建議價未達門檻"}
                </div>
                {priceSuggest.note ??
                  `定價學習由 ${priceSuggest.learningStartLabel ?? "指定日期"}（香港時間）起計；舊報價唔作參考。`}
                {priceSuggest.trustProgress ? (
                  <div className="mt-1">
                    進度：已接受 {priceSuggest.trustProgress.accepted} /{" "}
                    {priceSuggest.trustProgress.needForShow} 筆先顯示；
                    {priceSuggest.trustProgress.needForUsable} 筆先「可參考」；
                    {priceSuggest.trustProgress.needForTrusted} 筆先「較可信」。
                  </div>
                ) : null}
              </div>
            )}

            {/* 關聯詢盤 */}
            <FormField label="關聯詢盤（選填）">
              <div ref={inquirySearchRef} style={{ position: "relative" }}>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <Input
                    style={inputStyle}
                    placeholder="搜尋詢盤主題或客戶名稱..."
                    value={selectedInquiryLabel || inquirySearch}
                    onFocus={() => { setShowInquiryDropdown(true); if (selectedInquiryLabel) setInquirySearch(""); }}
                    onChange={(e) => { setInquirySearch(e.target.value); setSelectedInquiryLabel(""); setForm(p => ({ ...p, emailInquiryId: undefined })); }}
                    readOnly={!!selectedInquiryLabel && !showInquiryDropdown}
                  />
                  {form.emailInquiryId && (
                    <button
                      type="button"
                      onClick={() => { setForm(p => ({ ...p, emailInquiryId: undefined })); setSelectedInquiryLabel(""); setInquirySearch(""); }}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#888", fontSize: "18px", lineHeight: 1 }}
                    >
                      ×
                    </button>
                  )}
                </div>
                {showInquiryDropdown && inquiryResults && inquiryResults.length > 0 && (
                  <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, background: "#1a1a1a", border: "1px solid #333", borderRadius: "6px", marginTop: "4px", maxHeight: "240px", overflowY: "auto" }}>
                    {inquiryResults.map((inq) => (
                      <div
                        key={inq.id}
                        onMouseDown={(e) => { e.preventDefault(); setForm(p => ({ ...p, emailInquiryId: inq.id })); setSelectedInquiryLabel(`#${inq.id} ${inq.subject}`); setInquirySearch(""); setShowInquiryDropdown(false); }}
                        style={{ padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid #2a2a2a", transition: "background 0.15s" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "#2a2a2a")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                      >
                        <div style={{ fontSize: "0.85rem", color: "#e0e0e0", fontWeight: 500, marginBottom: "2px" }}>{inq.subject}</div>
                        <div style={{ fontSize: "0.75rem", color: "#888" }}>
                          {inq.fromName || inq.fromEmail}
                          {inq.estimatedTotal ? ` · AI 估價 HK$${inq.estimatedTotal.toLocaleString()}` : ""}
                          {inq.receivedAt ? ` · ${new Date(inq.receivedAt).toLocaleDateString("zh-HK")}` : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {showInquiryDropdown && inquiryResults && inquiryResults.length === 0 && inquirySearch && (
                  <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, background: "#1a1a1a", border: "1px solid #333", borderRadius: "6px", marginTop: "4px", padding: "12px 14px", color: "#888", fontSize: "0.85rem" }}>
                    找不到相關詢盤
                  </div>
                )}
              </div>
              {form.emailInquiryId && (
                <div style={{ fontSize: "0.75rem", color: "#4ade80", marginTop: "4px" }}>✓ 已關聯詢盤 #{form.emailInquiryId}，AI 估價準確度將自動記錄</div>
              )}
            </FormField>
          </div>
        </Section>

        {/* Items */}
        <Section title="報價明細" subtitle="Quote Items">
          {/* Template picker */}
          {!isEdit && (
            <div className="mb-4">
              <div style={{ fontSize: "0.6rem", letterSpacing: "0.15em", color: "#888", textTransform: "uppercase", marginBottom: "8px" }}>
                快速模板（可多選：攝影 + 攝影加錄影）
              </div>
              <div className="flex flex-wrap gap-2">
                {QUOTE_TEMPLATES.map((tpl) => {
                  const active = selectedTemplates.includes(tpl.id);
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => handleToggleTemplate(tpl.id)}
                      className="px-4 py-2 text-xs font-medium transition-all hover:opacity-80"
                      aria-pressed={active}
                      style={{
                        border: active
                          ? "1px solid #d4a843"
                          : "1px solid rgba(212,168,67,0.35)",
                        color: active ? "#1a1a1a" : "#d4a843",
                        borderRadius: "2px",
                        background: active
                          ? "#d4a843"
                          : "rgba(212,168,67,0.06)",
                        fontWeight: active ? 700 : 500,
                      }}
                    >
                      {tpl.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-3">
            {/* Header - desktop only */}
            <div className="hidden md:grid gap-2" style={{ gridTemplateColumns: "20px 1fr 118px 70px 100px 44px 100px 36px" }}>
              {["", "服務項目說明", "類別", "數量", "單價 (HKD)", "豁免", "金額 (HKD)", ""].map((h, i) => (
                <div
                  key={i}
                  className={h === "豁免" ? "text-center" : undefined}
                  style={{ fontSize: "0.6rem", letterSpacing: "0.12em", color: "#d4a843", textTransform: "uppercase" }}
                >
                  {h}
                </div>
              ))}
            </div>

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={form.items.map(i => i.id)} strategy={verticalListSortingStrategy}>
                {form.items.map((item, idx) => (
                  <SortableQuoteItem
                    key={item.id}
                    item={item}
                    idx={idx}
                    inputStyle={inputStyle}
                    onUpdate={updateItem}
                    onRemove={removeItem}
                    canRemove={form.items.length > 1}
                    onToggleWaive={
                      canToggleQuoteWaive(item) ? () => handleToggleItemWaive(idx) : undefined
                    }
                  />
                ))}
              </SortableContext>
            </DndContext>

            <button
              onClick={addItem}
              className="flex items-center gap-2 text-xs py-2 px-3 rounded transition-all hover:opacity-80"
              style={{ border: "1px dashed rgba(212,168,67,0.3)", color: "#d4a843" }}
            >
              <Plus className="h-3.5 w-3.5" />
              新增項目
            </button>
          </div>

          {/* Totals — same component as Quote Detail (總計 is the only gold headline) */}
          <div className="mt-6 ml-auto">
            <QuoteMoneySummary
              items={form.items}
              currency={form.currency}
              subtotal={subtotal}
              discountPercent={form.discountPercent}
              discountAmount={discountAmount}
              total={total}
              discountSlot={
                <div className="flex justify-between items-center text-sm">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-muted-foreground">折扣</span>
                    {clientDiscount && clientDiscount.discount > 0 && (
                      <span className="text-xs" style={{ color: "#d4a843" }}>
                        {clientDiscount.tierLabel} {clientDiscount.discount}%
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-20">
                      <Input
                        type="number"
                        value={form.discountPercent}
                        onChange={(e) =>
                          setForm((p) => ({
                            ...p,
                            discountPercent: parseFloat(e.target.value) || 0,
                          }))
                        }
                        min={0}
                        max={100}
                        step={1}
                        style={{
                          ...inputStyle,
                          textAlign: "right",
                          padding: "4px 8px",
                          height: "32px",
                        }}
                      />
                    </div>
                    <span className="text-sm text-muted-foreground">%</span>
                    {discountAmount > 0 && (
                      <span
                        className="text-xs"
                        style={{ color: "rgba(212,168,67,0.7)" }}
                      >
                        - HKD {discountAmount.toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              }
              depositSlot={(() => {
                const depositAmt =
                  form.depositMode === "fixed"
                    ? form.depositFixedAmount
                    : total * (form.depositPercent / 100);
                const netAmt = total - depositAmt;
                const hasDeposit = depositAmt > 0 && depositAmt < total;
                return (
                  <>
                    <div className="flex justify-between items-center text-sm pt-1">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">訂金</span>
                        <div
                          className="flex rounded overflow-hidden"
                          style={{
                            border: "1px solid rgba(212,168,67,0.3)",
                            height: "22px",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setForm((p) => ({ ...p, depositMode: "percent" }))
                            }
                            className="px-2 text-xs transition-colors"
                            style={{
                              background:
                                form.depositMode === "percent"
                                  ? "rgba(212,168,67,0.25)"
                                  : "transparent",
                              color:
                                form.depositMode === "percent"
                                  ? "#d4a843"
                                  : "rgba(212,168,67,0.5)",
                              borderRight: "1px solid rgba(212,168,67,0.3)",
                            }}
                          >
                            %
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setForm((p) => ({
                                ...p,
                                depositMode: "fixed",
                                depositFixedAmount:
                                  p.depositFixedAmount ||
                                  Math.round((total * p.depositPercent) / 100),
                              }))
                            }
                            className="px-2 text-xs transition-colors"
                            style={{
                              background:
                                form.depositMode === "fixed"
                                  ? "rgba(212,168,67,0.25)"
                                  : "transparent",
                              color:
                                form.depositMode === "fixed"
                                  ? "#d4a843"
                                  : "rgba(212,168,67,0.5)",
                            }}
                          >
                            HKD
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {form.depositMode === "percent" ? (
                          <>
                            <div className="w-16">
                              <Input
                                type="number"
                                value={form.depositPercent}
                                onChange={(e) =>
                                  setForm((p) => ({
                                    ...p,
                                    depositPercent:
                                      parseFloat(e.target.value) || 0,
                                  }))
                                }
                                min={0}
                                max={100}
                                step={5}
                                style={{
                                  ...inputStyle,
                                  textAlign: "right",
                                  padding: "4px 8px",
                                  height: "32px",
                                }}
                              />
                            </div>
                            <span className="text-sm text-muted-foreground">
                              %
                            </span>
                            <span className="text-xs" style={{ color: "#d4a843" }}>
                              = HKD{" "}
                              {depositAmt.toLocaleString("en-HK", {
                                minimumFractionDigits: 0,
                                maximumFractionDigits: 0,
                              })}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="text-sm text-muted-foreground">
                              HKD
                            </span>
                            <div className="w-28">
                              <Input
                                type="number"
                                value={form.depositFixedAmount}
                                onChange={(e) =>
                                  setForm((p) => ({
                                    ...p,
                                    depositFixedAmount:
                                      parseFloat(e.target.value) || 0,
                                  }))
                                }
                                min={0}
                                step={100}
                                style={{
                                  ...inputStyle,
                                  textAlign: "right",
                                  padding: "4px 8px",
                                  height: "32px",
                                }}
                              />
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                    {hasDeposit && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Net（餘款）</span>
                        <span style={{ color: "rgba(212,168,67,0.7)" }}>
                          HKD{" "}
                          {netAmt.toLocaleString("en-HK", {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 0,
                          })}
                        </span>
                      </div>
                    )}
                  </>
                );
              })()}
            />
          </div>
        </Section>

        {/* Extra Info */}
        <Section title="額外資訊" subtitle="Additional Details">
          <div className="space-y-4">
            <FormField label="Lighting &amp; Equipment">
              <Input
                value={form.equipment}
                onChange={(e) => setForm((p) => ({ ...p, equipment: e.target.value }))}
                placeholder="e.g. CAMERA/ Sony A7R4 | Lighting: AD200 / AD600"
                style={inputStyle}
              />
            </FormField>
            <FormField label="Team（顯示用／後備）">
              <Input
                value={form.team}
                onChange={(e) => setForm((p) => ({ ...p, team: e.target.value }))}
                placeholder="人手數字會自動帶入；亦可手動改寫"
                style={inputStyle}
              />
            </FormField>
            <FormField label="Delivery Method（相片／影片）">
              <Input
                value={form.deliveryMethod}
                onChange={(e) => setForm((p) => ({ ...p, deliveryMethod: e.target.value }))}
                placeholder="e.g. BY LINKS | 5-10 DAYS"
                style={inputStyle}
              />
            </FormField>
          </div>
        </Section>

        {/* Notes */}
        <Section title="備註" subtitle="Additional Notes">
          <textarea
            value={form.notes}
            onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            placeholder="付款條款、特別要求或其他備注..."
            rows={4}
            className="w-full rounded px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1"
            style={{
              background: "#111",
              border: "1px solid rgba(212,168,67,0.2)",
              color: "#e8e0d0",
              "--tw-ring-color": "#d4a843",
            } as React.CSSProperties}
          />
        </Section>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center sm:justify-end gap-3 pt-4">
          <button
            onClick={() => setLocation("/quotes")}
            className="px-5 py-3 sm:py-2.5 text-xs rounded transition-all hover:opacity-70 order-2 sm:order-1"
            style={{ border: "1px solid rgba(255,255,255,0.1)", color: "#888", letterSpacing: "0.1em" }}
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSaving}
            className="flex items-center justify-center gap-2 px-6 py-3 sm:py-2.5 text-xs font-semibold rounded transition-all hover:opacity-80 disabled:opacity-50 order-1 sm:order-2"
            style={{
              background: "#d4a843",
              color: "#0a0a0a",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isEdit ? "更新報價單" : "建立報價單"}
          </button>
        </div>
      </div>
    </DashboardLayout>
  );
}

const inputStyle: React.CSSProperties = {
  background: "#111",
  border: "1px solid rgba(212,168,67,0.2)",
  color: "#e8e0d0",
  borderRadius: "2px",
};

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="rounded p-6" style={{ background: "#0f0f0f", border: "1px solid rgba(212,168,67,0.12)" }}>
      <div className="mb-5">
        <div style={{ fontSize: "0.6rem", letterSpacing: "0.2em", color: "#d4a843", textTransform: "uppercase" }}>{subtitle}</div>
        <h3 className="text-sm font-light mt-1">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function FormField({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label style={{ fontSize: "0.65rem", letterSpacing: "0.1em", color: "#888", textTransform: "uppercase" }}>
        {label}
      </label>
      {children}
    </div>
  );
}
