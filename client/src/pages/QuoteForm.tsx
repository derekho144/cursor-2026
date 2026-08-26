import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";
import { Plus, Trash2, ArrowLeft, Save, Loader2, Search, UserPlus, X, Check, GripVertical, Phone } from "lucide-react";
import { Input } from "@/components/ui/input";
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
import { quotePricingMode, isPricingLearningServiceType } from "@shared/quotePricingMode";
import {
  DURATION_PACKAGE_OPTIONS,
  inferDurationPackageFromHours,
  type DurationPackage,
} from "@shared/quoteDurationPackage";

// 設計類別（不需要拍攝日期和報價有效期）
const DESIGN_SERVICE_TYPES = new Set([
  "graphic_design",
  "web_development",
  "menu_design",
]);

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

// Two universal quote templates
export const QUOTE_TEMPLATES = [
  {
    id: "photoshoot",
    label: "攝影 Photoshoot",
    items: [
      { description: "Event Photoshoot", quantity: 1, unitPrice: 0 },
      { description: "Retouch (Post image editing included fine retouch of lighting, colour, sharpen, dust)", quantity: 1, unitPrice: 0 },
      { description: "Transportation Fee", quantity: 1, unitPrice: 320 },
      { description: "Team 1P", quantity: 1, unitPrice: 0, isIncluded: true },
      { description: "Lighting & Equipment  CAMERA/ Sony A7R4  Lighting AD200 / AD600 / FLASHLIGHT X2", quantity: 1, unitPrice: 0, isIncluded: true },
      { description: "Photo delivery method  BY LINKS  5-10 DAY", quantity: 1, unitPrice: 0, isIncluded: true },
    ],
  },
  {
    id: "photo_video",
    label: "攝影加錄影 Photo + Video",
    items: [
      { description: "Short Film Video Production", quantity: 1, unitPrice: 0 },
      { description: "Post-Production (Video Editing 1min, Color Grading, Background Mixing)", quantity: 1, unitPrice: 0 },
      { description: "Event Photoshoot", quantity: 1, unitPrice: 0 },
      { description: "Retouch (Post image editing included fine retouch of lighting, colour, sharpen, dust)", quantity: 1, unitPrice: 0 },
      { description: "Transportation Fee", quantity: 1, unitPrice: 320 },
      { description: "Team 1P", quantity: 1, unitPrice: 0, isIncluded: true },
      { description: "Lighting & Equipment  CAMERA/ Sony A7R4  Lighting AD200 / AD600 / FLASHLIGHT X2", quantity: 1, unitPrice: 0, isIncluded: true },
      { description: "Photo delivery method  BY LINKS  5-10 DAY", quantity: 1, unitPrice: 0, isIncluded: true },
      { description: "Video first cut delivery method  BY LINKS  7-10 DAY", quantity: 1, unitPrice: 0, isIncluded: true },
    ],
  },
  {
    id: "video_only",
    label: "純錄影 Video Only",
    items: [
      { description: "Short Film Video Production", quantity: 1, unitPrice: 0 },
      { description: "Post-Production (Video Editing 1min, Color Grading, Background Mixing)", quantity: 1, unitPrice: 0 },
      { description: "Transportation Fee", quantity: 1, unitPrice: 320 },
      { description: "Team 1P", quantity: 1, unitPrice: 0, isIncluded: true },
      { description: "Lighting & Equipment  CAMERA/ Sony A7R4  Lighting AD200 / AD600 / FLASHLIGHT X2", quantity: 1, unitPrice: 0, isIncluded: true },
      { description: "Video first cut delivery method  BY LINKS  7-10 DAY", quantity: 1, unitPrice: 0, isIncluded: true },
    ],
  },
];

const DEFAULT_ITEMS_BY_TYPE: Record<string, { description: string; quantity: number; unitPrice: number }[]> = {};

type QuoteItem = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  isIncluded?: boolean;
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
  items: [{ id: crypto.randomUUID(), description: "", quantity: 1, unitPrice: 0, amount: 0 }],
  clientId: undefined,
  saveAsNewClient: false,
  syncToClients: true,
  emailInquiryId: undefined,
};

/** Merge saved drafts / partial payloads onto emptyForm so new fields never crash .trim(). */
function normalizeFormData(raw: Partial<FormData> | null | undefined): FormData {
  const base = { ...emptyForm, items: emptyForm.items.map((i) => ({ ...i, id: crypto.randomUUID() })) };
  if (!raw || typeof raw !== "object") return base;
  const items = Array.isArray(raw.items)
    ? raw.items.map((item) => ({
        id: item?.id || crypto.randomUUID(),
        description: item?.description ?? "",
        quantity: Number(item?.quantity) || 0,
        unitPrice: Number(item?.unitPrice) || 0,
        amount: Number(item?.amount) || 0,
        isIncluded: !!(item as any)?.isIncluded,
      }))
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
    leadSource: raw.leadSource ?? "",
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
  if (templateId === "photo_video" && pax >= 2) {
    return {
      crewPhotographers: 1,
      crewAssistants: 0,
      crewVideographers: Math.max(1, pax - 1),
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
}: {
  item: QuoteItem;
  idx: number;
  inputStyle: React.CSSProperties;
  onUpdate: (idx: number, field: keyof QuoteItem, value: string | number) => void;
  onRemove: (idx: number) => void;
  canRemove: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style}>
      {/* Desktop layout */}
      <div className="hidden md:grid gap-2 items-center" style={{ gridTemplateColumns: "20px 1fr 80px 110px 110px 36px" }}>
        <div {...attributes} {...listeners} className="flex items-center justify-center cursor-grab active:cursor-grabbing" style={{ color: "rgba(212,168,67,0.4)", touchAction: "none" }}>
          <GripVertical className="h-4 w-4" />
        </div>
        <Input value={item.description} onChange={(e) => onUpdate(idx, "description", e.target.value)} placeholder="服務項目說明" style={inputStyle} />
        <Input type="number" value={item.quantity} onChange={(e) => onUpdate(idx, "quantity", parseFloat(e.target.value) || 0)} min={0} style={inputStyle} />
        <Input type="number" value={item.unitPrice} onChange={(e) => onUpdate(idx, "unitPrice", parseFloat(e.target.value) || 0)} min={0} style={inputStyle} />
        <div className="text-sm font-medium text-right pr-2" style={{ color: "#d4a843" }}>{item.amount.toLocaleString()}</div>
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
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-xs mb-1" style={{ color: "rgba(212,168,67,0.6)", fontSize: "0.6rem", letterSpacing: "0.1em" }}>數量</div>
            <Input type="number" value={item.quantity} onChange={(e) => onUpdate(idx, "quantity", parseFloat(e.target.value) || 0)} min={0} style={inputStyle} />
          </div>
          <div>
            <div className="text-xs mb-1" style={{ color: "rgba(212,168,67,0.6)", fontSize: "0.6rem", letterSpacing: "0.1em" }}>單價 (HKD)</div>
            <Input type="number" value={item.unitPrice} onChange={(e) => onUpdate(idx, "unitPrice", parseFloat(e.target.value) || 0)} min={0} style={inputStyle} />
          </div>
        </div>
        <div className="flex justify-end">
          <div className="text-sm font-medium" style={{ color: "#d4a843" }}>金額：HKD {item.amount.toLocaleString()}</div>
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
  const [hasDraft, setHasDraft] = useState(() => !isEdit && !!safeLSGet('quote_draft_new'));
  // For edit mode: per-quote draft key
  const editDraftKey = isEdit && quoteId ? `quote_draft_edit_${quoteId}` : null;
  const [hasEditDraft, setHasEditDraft] = useState(() => !!(editDraftKey && safeLSGet(editDraftKey)));
  // Track whether server data has been loaded (to avoid saving empty form before data arrives)
  const editFormLoadedRef = useRef(!isEdit);
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

  // Auto-save draft to localStorage on form change
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => {
      if (!isEdit) {
        safeLSSet('quote_draft_new', JSON.stringify(form));
        setHasDraft(true);
      } else if (editDraftKey && editFormLoadedRef.current) {
        // Only save after server data has been loaded into the form
        safeLSSet(editDraftKey, JSON.stringify(form));
        setHasEditDraft(true);
      }
    }, 500); // debounce 500ms
    return () => { if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current); };
  }, [form, isEdit, editDraftKey]);

  // Clear draft on successful save
  const clearDraft = useCallback(() => {
    safeLSRemove('quote_draft_new');
    setHasDraft(false);
    if (editDraftKey) {
      safeLSRemove(editDraftKey);
      setHasEditDraft(false);
    }
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
    if (existingQuote) {
      // Check if there's a saved edit draft for this quote
      const savedEditDraft = editDraftKey ? safeLSGet(editDraftKey) : null;
      if (savedEditDraft) {
        try {
          setForm(normalizeFormData(JSON.parse(savedEditDraft) as FormData));
          const parsed = JSON.parse(savedEditDraft) as FormData;
          if ((parsed as any).clientId && parsed.clientName) {
            setSelectedClientName(parsed.clientName);
          }
          editFormLoadedRef.current = true;
          return; // Use saved draft instead of server data
        } catch { /* fall through to server data */ }
      }
      // Load from server
      setForm(normalizeFormData({
        clientName: existingQuote.clientName,
        clientEmail: existingQuote.clientEmail ?? "",
        clientPhone: existingQuote.clientPhone ?? "",
        clientCompany: existingQuote.clientCompany ?? "",
        serviceType: existingQuote.serviceType,
        shootingDate: existingQuote.shootingDate ?? "",
        shootingLocation: existingQuote.shootingLocation ?? "",
        notes: existingQuote.notes ?? "",
        discountPercent: Number((existingQuote as any).discountPercent ?? 0),
        discountAmount: Number(existingQuote.discountAmount),
        depositPercent: Number((existingQuote as any).depositPercent ?? 50),
        depositMode: ((existingQuote as any).depositMode ?? "percent") as "percent" | "fixed",
        depositFixedAmount: Number((existingQuote as any).depositFixedAmount ?? 0),
        currency: existingQuote.currency,
        validUntil: existingQuote.validUntil ?? "",
        clientId: (existingQuote as any).clientId ?? undefined,
        saveAsNewClient: false,
        equipment: (existingQuote as any).equipment ?? "",
        team: (existingQuote as any).team ?? "",
        shootHours:
          (existingQuote as any).shootHours != null &&
          Number((existingQuote as any).shootHours) > 0
            ? String(Number((existingQuote as any).shootHours))
            : "",
        durationPackage:
          (existingQuote as any).durationPackage === "hours" ||
          (existingQuote as any).durationPackage === "half_day" ||
          (existingQuote as any).durationPackage === "full_day" ||
          (existingQuote as any).durationPackage === "multi_day"
            ? ((existingQuote as any).durationPackage as FormData["durationPackage"])
            : "",
        shotCount:
          (existingQuote as any).shotCount != null &&
          Number((existingQuote as any).shotCount) > 0
            ? String(Number((existingQuote as any).shotCount))
            : "",
        crewPhotographers: Number((existingQuote as any).crewPhotographers ?? 0),
        crewAssistants: Number((existingQuote as any).crewAssistants ?? 0),
        crewVideographers: Number((existingQuote as any).crewVideographers ?? 0),
        crewOthers: Number((existingQuote as any).crewOthers ?? 0),
        deliveryMethod: (existingQuote as any).deliveryMethod ?? "",
        leadSource: (existingQuote as any).leadSource ?? "",
        items: existingQuote.items.map((item) => ({
          id: crypto.randomUUID(),
          description: item.description,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          amount: Number(item.amount),
        })),
      }));
      // Hydrate structured crew from Team XP line if DB crew empty
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
      editFormLoadedRef.current = true;
    }
  }, [existingQuote, editDraftKey]);

  const utils = trpc.useUtils();
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
  // Items excluded from discount: transportation / 車費, expedited fee / 加急費用
  const discountableSubtotal = useMemo(
    () => form.items.reduce((sum, item) => {
      const desc = item.description.toLowerCase();
      const isTransport = ["transportation", "transport", "車費", "交通", "travel"].some(k => desc.includes(k));
      const isExpedited = ["expedited", "加急", "urgent fee", "rush fee", "express fee"].some(k => desc.includes(k));
      return (isTransport || isExpedited) ? sum : sum + item.amount;
    }, 0),
    [form.items]
  );
  const discountAmount = Math.round(discountableSubtotal * (form.discountPercent || 0) / 100);
  const total = Math.max(0, subtotal - discountAmount);

  const updateItem = (idx: number, field: keyof QuoteItem, value: string | number) => {
    setForm((prev) => {
      const items = [...prev.items];
      const item = { ...items[idx], [field]: value };
      if (field === "quantity" || field === "unitPrice") {
        item.amount = Number(item.quantity) * Number(item.unitPrice);
      }
      items[idx] = item;
      return { ...prev, items };
    });
  };

  const addItem = () => {
    setForm((prev) => ({
      ...prev,
      items: [...prev.items, { id: crypto.randomUUID(), description: "", quantity: 1, unitPrice: 0, amount: 0 }],
    }));
  };

  const removeItem = (idx: number) => {
    if (form.items.length <= 1) return;
    setForm((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }));
  };

  const handleServiceTypeChange = (value: string) => {
    setForm((prev) => ({
      ...prev,
      serviceType: value,
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

    // Warn if non-included items have $0 price (data quality reminder)
    const zeroItems = form.items.filter((i) => !i.isIncluded && i.unitPrice === 0 && i.description.trim());
    if (zeroItems.length > 0) {
      const names = zeroItems.map((i) => i.description).join('、');
      toast(`提示：以下項目金額為 $0，已記錄為免費服務：${names}`, { icon: 'ℹ️', duration: 5000 });
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
    const items = syncTeamLineItem(form.items, crewHeadcount(crew));

    const payload = {
      ...form,
      serviceType: form.serviceType as any,
      subtotal,
      discountPercent: form.discountPercent,
      discountAmount,
      total,
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
    };

    if (isEdit && quoteId) {
      updateMutation.mutate({ id: quoteId, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  if (isEdit && loadingQuote) {
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
          {isEdit && hasEditDraft && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs" style={{ color: "rgba(212,168,67,0.7)" }}>修改已自動儲存</span>
              <button
                onClick={() => {
                  if (editDraftKey) { safeLSRemove(editDraftKey); setHasEditDraft(false); }
                  if (existingQuote) {
                    editFormLoadedRef.current = false;
                    setForm(normalizeFormData({
                      clientName: existingQuote.clientName,
                      clientEmail: existingQuote.clientEmail ?? "",
                      clientPhone: existingQuote.clientPhone ?? "",
                      clientCompany: existingQuote.clientCompany ?? "",
                      serviceType: existingQuote.serviceType,
                      shootingDate: existingQuote.shootingDate ?? "",
                      shootingLocation: existingQuote.shootingLocation ?? "",
                      notes: existingQuote.notes ?? "",
                      discountPercent: Number((existingQuote as any).discountPercent ?? 0),
                      discountAmount: Number(existingQuote.discountAmount),
                      depositPercent: Number((existingQuote as any).depositPercent ?? 50),
                      depositMode: ((existingQuote as any).depositMode ?? "percent") as "percent" | "fixed",
                      depositFixedAmount: Number((existingQuote as any).depositFixedAmount ?? 0),
                      currency: existingQuote.currency,
                      validUntil: existingQuote.validUntil ?? "",
                      clientId: (existingQuote as any).clientId ?? undefined,
                      saveAsNewClient: false,
                      equipment: (existingQuote as any).equipment ?? "",
                      team: (existingQuote as any).team ?? "",
                      shootHours:
                        (existingQuote as any).shootHours != null &&
                        Number((existingQuote as any).shootHours) > 0
                          ? String(Number((existingQuote as any).shootHours))
                          : "",
                      durationPackage:
                        (existingQuote as any).durationPackage === "hours" ||
                        (existingQuote as any).durationPackage === "half_day" ||
                        (existingQuote as any).durationPackage === "full_day" ||
                        (existingQuote as any).durationPackage === "multi_day"
                          ? ((existingQuote as any)
                              .durationPackage as FormData["durationPackage"])
                          : "",
                      shotCount:
                        (existingQuote as any).shotCount != null &&
                        Number((existingQuote as any).shotCount) > 0
                          ? String(Number((existingQuote as any).shotCount))
                          : "",
                      crewPhotographers: Number((existingQuote as any).crewPhotographers ?? 0),
                      crewAssistants: Number((existingQuote as any).crewAssistants ?? 0),
                      crewVideographers: Number((existingQuote as any).crewVideographers ?? 0),
                      crewOthers: Number((existingQuote as any).crewOthers ?? 0),
                      deliveryMethod: (existingQuote as any).deliveryMethod ?? "",
                      leadSource: (existingQuote as any).leadSource ?? "",
                      items: existingQuote.items.map((item) => ({
                        id: crypto.randomUUID(),
                        description: item.description,
                        quantity: Number(item.quantity),
                        unitPrice: Number(item.unitPrice),
                        amount: Number(item.amount),
                      })),
                    }));
                    if ((existingQuote as any).clientId) setSelectedClientName(existingQuote.clientName);
                    editFormLoadedRef.current = true;
                  }
                }}
                className="text-xs px-2 py-0.5 rounded hover:opacity-70 transition-opacity"
                style={{ border: "1px solid rgba(255,255,255,0.15)", color: "#888" }}
              >
                還原原始資料
              </button>
            </div>
          )}
        </div>

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
                  value={form.durationPackage || ""}
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
              <Select value={form.leadSource || ""} onValueChange={(v) => setForm((p) => ({ ...p, leadSource: v }))}>
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
                  <SelectItem value="Referral">朋友介紹</SelectItem>
                  <SelectItem value="Website">自家網站</SelectItem>
                  <SelectItem value="Repeat">舊客回頭</SelectItem>
                  <SelectItem value="Other">其他</SelectItem>
                </SelectContent>
              </Select>
            </FormField>

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
                </div>
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
                快速模板
              </div>
              <div className="flex gap-2">
                {QUOTE_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() =>
                      setForm((p) => {
                        const items = tpl.items.map((item) => ({
                          id: crypto.randomUUID(),
                          description: item.description,
                          quantity: item.quantity,
                          unitPrice: item.unitPrice,
                          amount: item.quantity * item.unitPrice,
                          isIncluded: (item as any).isIncluded ?? false,
                        }));
                        const crew = crewFromTemplateItems(items, tpl.id);
                        const auto = buildTeamLabel(crew);
                        return {
                          ...p,
                          items,
                          ...crew,
                          team: auto || p.team,
                          // Keep existing hours if user already filled; otherwise leave blank to force fill
                          shootHours: p.shootHours,
                        };
                      })
                    }
                    className="px-4 py-2 text-xs font-medium transition-all hover:opacity-80"
                    style={{ border: "1px solid rgba(212,168,67,0.4)", color: "#d4a843", borderRadius: "2px", background: "rgba(212,168,67,0.06)" }}
                  >
                    {tpl.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            {/* Header - desktop only */}
            <div className="hidden md:grid gap-2" style={{ gridTemplateColumns: "20px 1fr 80px 110px 110px 36px" }}>
              {["", "服務項目說明", "數量", "單價 (HKD)", "金額 (HKD)", ""].map((h, i) => (
                <div key={i} style={{ fontSize: "0.6rem", letterSpacing: "0.12em", color: "#d4a843", textTransform: "uppercase" }}>
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

          {/* Totals */}
          <div className="mt-6 ml-auto w-full sm:w-64 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">小計</span>
              <span>HKD {subtotal.toLocaleString()}</span>
            </div>
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
                    onChange={(e) => setForm((p) => ({ ...p, discountPercent: parseFloat(e.target.value) || 0 }))}
                    min={0}
                    max={100}
                    step={1}
                    style={{ ...inputStyle, textAlign: "right", padding: "4px 8px", height: "32px" }}
                  />
                </div>
                <span className="text-sm text-muted-foreground">%</span>
                {discountAmount > 0 && (
                  <span className="text-xs" style={{ color: "rgba(212,168,67,0.7)" }}>
                    - HKD {discountAmount.toLocaleString()}
                  </span>
                )}
              </div>
            </div>
            <div
              className="flex justify-between text-base font-medium pt-2"
              style={{ borderTop: "1px solid #d4a843", color: "#d4a843" }}
            >
              <span>總計 ({form.currency})</span>
              <span>HKD {total.toLocaleString()}</span>
            </div>
            {/* Deposit */}
            {(() => {
              // 計算訂金金額
              const depositAmt = form.depositMode === "fixed"
                ? form.depositFixedAmount
                : total * (form.depositPercent / 100);
              const netAmt = total - depositAmt;
              const hasDeposit = depositAmt > 0 && depositAmt < total;
              return (
                <>
                  <div className="flex justify-between items-center text-sm pt-1">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">訂金</span>
                      {/* 模式切換按鈕 */}
                      <div className="flex rounded overflow-hidden" style={{ border: "1px solid rgba(212,168,67,0.3)", height: "22px" }}>
                        <button
                          type="button"
                          onClick={() => setForm(p => ({ ...p, depositMode: "percent" }))}
                          className="px-2 text-xs transition-colors"
                          style={{
                            background: form.depositMode === "percent" ? "rgba(212,168,67,0.25)" : "transparent",
                            color: form.depositMode === "percent" ? "#d4a843" : "rgba(212,168,67,0.5)",
                            borderRight: "1px solid rgba(212,168,67,0.3)",
                          }}
                        >%</button>
                        <button
                          type="button"
                          onClick={() => setForm(p => ({ ...p, depositMode: "fixed", depositFixedAmount: p.depositFixedAmount || Math.round(total * p.depositPercent / 100) }))}
                          className="px-2 text-xs transition-colors"
                          style={{
                            background: form.depositMode === "fixed" ? "rgba(212,168,67,0.25)" : "transparent",
                            color: form.depositMode === "fixed" ? "#d4a843" : "rgba(212,168,67,0.5)",
                          }}
                        >HKD</button>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {form.depositMode === "percent" ? (
                        <>
                          <div className="w-16">
                            <Input
                              type="number"
                              value={form.depositPercent}
                              onChange={(e) => setForm((p) => ({ ...p, depositPercent: parseFloat(e.target.value) || 0 }))}
                              min={0}
                              max={100}
                              step={5}
                              style={{ ...inputStyle, textAlign: "right", padding: "4px 8px", height: "32px" }}
                            />
                          </div>
                          <span className="text-sm text-muted-foreground">%</span>
                          <span className="text-xs" style={{ color: "#d4a843" }}>
                            = HKD {depositAmt.toLocaleString('en-HK', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="text-sm text-muted-foreground">HKD</span>
                          <div className="w-28">
                            <Input
                              type="number"
                              value={form.depositFixedAmount}
                              onChange={(e) => setForm((p) => ({ ...p, depositFixedAmount: parseFloat(e.target.value) || 0 }))}
                              min={0}
                              step={100}
                              style={{ ...inputStyle, textAlign: "right", padding: "4px 8px", height: "32px" }}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  {/* Net (餘款) */}
                  {hasDeposit && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Net（餘款）</span>
                      <span style={{ color: "rgba(212,168,67,0.7)" }}>
                        HKD {netAmt.toLocaleString('en-HK', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  )}
                </>
              );
            })()}
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
            <FormField label="Photo Delivery Method">
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
