import { useMemo, useState, type CSSProperties } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  Receipt,
  TrendingDown,
  TrendingUp,
  BarChart3,
  FileText,
  ExternalLink,
  Search,
  Wallet,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Link } from "wouter";

/** Align with quotePdfKit SERVICE_TYPE_LABELS (client-safe copy). */
const SERVICE_TYPE_LABELS: Record<string, string> = {
  corporate_event: "企業活動攝影",
  product: "產品攝影",
  food_beverage: "食物攝影",
  jewelry: "珠寶攝影",
  artwork: "藝術品攝影",
  interior: "建築/室內攝影",
  video_production: "影片製作",
  graphic_design: "平面設計",
  ad_video: "廣告影片",
  web_development: "網頁製作",
  ai_photography: "AI攝影",
  menu_design: "餐牌設計",
  portrait: "人像拍攝",
  "360_photography": "360 拍攝",
  drone: "航拍拍攝",
  kol_mi: "KOL/MI 推廣",
  other: "其他服務",
  wedding: "婚禮攝影",
  commercial: "商業攝影",
  event: "活動攝影",
  video: "影片製作",
  photo_video: "攝影加錄影",
};

/** Match Dashboard warm-dark palette (#111 / #1a1a1a / gold #d4a843 / cream #e8e0d0). */
const C = {
  panel: "#111111",
  panelSoft: "#1a1a1a",
  ink: "#e8e0d0",
  muted: "#888888",
  gold: "#d4a843",
  goldSoft: "rgba(212,168,67,0.14)",
  goldLine: "rgba(212,168,67,0.28)",
  line: "rgba(255,255,255,0.08)",
  lineSoft: "rgba(255,255,255,0.05)",
  hover: "rgba(255,255,255,0.03)",
  income: "#4caf50",
  incomeSoft: "rgba(76,175,80,0.12)",
  expense: "#FF6B6B",
  expenseSoft: "rgba(255,107,107,0.12)",
} as const;

/** Category chips — muted neutrals on dark, no rainbow clash. */
const CATEGORIES = [
  { value: "transport", label: "車費", fg: "#8ec5ff", bg: "rgba(96,165,250,0.12)", border: "rgba(96,165,250,0.28)" },
  { value: "equipment_rent", label: "租用器材", fg: "#c4b5fd", bg: "rgba(167,139,250,0.12)", border: "rgba(167,139,250,0.28)" },
  { value: "equipment_buy", label: "購買器材", fg: "#fdba74", bg: "rgba(251,146,60,0.12)", border: "rgba(251,146,60,0.28)" },
  { value: "staff", label: "員工薪酬", fg: "#86efac", bg: "rgba(74,222,128,0.12)", border: "rgba(74,222,128,0.28)" },
  { value: "post_production", label: "後期製作", fg: "#5eead4", bg: "rgba(45,212,191,0.12)", border: "rgba(45,212,191,0.28)" },
  { value: "software", label: "軟件/訂閱", fg: "#67e8f9", bg: "rgba(34,211,238,0.12)", border: "rgba(34,211,238,0.28)" },
  { value: "marketing", label: "市場推廣", fg: "#f9a8d4", bg: "rgba(244,114,182,0.12)", border: "rgba(244,114,182,0.28)" },
  { value: "office", label: "辦公室/場地", fg: C.gold, bg: C.goldSoft, border: C.goldLine },
  { value: "other", label: "其他", fg: "#b0b0b0", bg: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.12)" },
];

const getCategoryStyle = (cat: string) =>
  CATEGORIES.find((c) => c.value === cat) ?? CATEGORIES[CATEGORIES.length - 1]!;

function categoryBadgeStyle(cat: string): CSSProperties {
  const s = getCategoryStyle(cat);
  return {
    background: s.bg,
    color: s.fg,
    borderColor: s.border,
  };
}

type ExpenseForm = {
  date: string;
  category: string;
  description: string;
  amount: string;
  payee: string;
  notes: string;
};

function fmtHkd(n: number, opts?: { signed?: boolean; digits?: number }) {
  const digits = opts?.digits ?? 0;
  const abs = Math.abs(n).toLocaleString("en-HK", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  if (!opts?.signed) return `HK$${abs}`;
  if (n > 0) return `+HK$${abs}`;
  if (n < 0) return `-HK$${abs}`;
  return `HK$${abs}`;
}

function ymdInMonth(year: number, month: number) {
  const today = new Date();
  if (today.getFullYear() === year && today.getMonth() + 1 === month) {
    return today.toISOString().split("T")[0]!;
  }
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function serviceLabel(serviceType: string | null | undefined) {
  if (!serviceType) return null;
  return SERVICE_TYPE_LABELS[serviceType] ?? serviceType;
}

export default function Expenses() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [filterCategory, setFilterCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("overview");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ExpenseForm>(() => ({
    date: ymdInMonth(now.getFullYear(), now.getMonth() + 1),
    category: "",
    description: "",
    amount: "",
    payee: "",
    notes: "",
  }));
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const utils = trpc.useUtils();

  const emptyFormForMonth = (): ExpenseForm => ({
    date: ymdInMonth(year, month),
    category: "",
    description: "",
    amount: "",
    payee: "",
    notes: "",
  });

  const { data: expenses = [], isLoading: expensesLoading } = trpc.expenses.list.useQuery({
    year,
    month,
    category: filterCategory === "all" ? undefined : filterCategory,
  });

  const { data: summary } = trpc.expenses.monthlySummary.useQuery({ year, month });

  // Server-side month filter (shootingDate → else createdAt) — avoid client-side limit-100 miss
  const { data: acceptedQuotesData, isLoading: incomeLoading } = trpc.quotes.list.useQuery({
    status: "accepted",
    year,
    month,
    limit: 100,
  });

  const incomeRecords = acceptedQuotesData?.data ?? [];
  const incomeTotalCount = acceptedQuotesData?.total ?? incomeRecords.length;
  const totalIncome = incomeRecords.reduce((sum, q) => sum + Number(q.total ?? 0), 0);
  const totalExpenses = summary?.grandTotal ?? 0;
  const net = totalIncome - totalExpenses;

  const q = search.trim().toLowerCase();
  const filteredIncome = useMemo(() => {
    if (!q) return incomeRecords;
    return incomeRecords.filter((row) => {
      const hay = [
        row.quoteNumber,
        row.clientName,
        row.clientCompany,
        row.serviceType,
        serviceLabel(row.serviceType),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [incomeRecords, q]);

  const filteredExpenses = useMemo(() => {
    if (!q) return expenses;
    return expenses.filter((row) => {
      const hay = [row.description, row.payee, row.notes, row.categoryLabel]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [expenses, q]);

  type CashflowRow =
    | {
        kind: "income";
        id: string;
        sortKey: number;
        dateLabel: string;
        title: string;
        subtitle: string | null;
        amount: number;
        href: string;
        meta: string;
      }
    | {
        kind: "expense";
        id: string;
        sortKey: number;
        dateLabel: string;
        title: string;
        subtitle: string | null;
        amount: number;
        expenseId: number;
        categoryLabel: string;
        category: string;
        isFromQuoteCost?: boolean;
      };

  const cashflowRows: CashflowRow[] = useMemo(() => {
    const rows: CashflowRow[] = [];
    for (const quote of filteredIncome) {
      const shootDate = quote.shootingDate ? new Date(quote.shootingDate) : null;
      const displayDate = shootDate ?? new Date(quote.createdAt);
      rows.push({
        kind: "income",
        id: `in-${quote.id}`,
        sortKey: displayDate.getTime(),
        dateLabel: displayDate.toLocaleDateString("zh-HK", { month: "short", day: "numeric" }),
        title: quote.clientName,
        subtitle: serviceLabel(quote.serviceType),
        amount: Number(quote.total ?? 0),
        href: `/quotes/${quote.id}`,
        meta: `${quote.quoteNumber}${shootDate ? " · 拍攝" : " · 建立"}`,
      });
    }
    for (const expense of filteredExpenses) {
      const d = new Date(expense.date);
      rows.push({
        kind: "expense",
        id: `ex-${expense.id}`,
        sortKey: d.getTime(),
        dateLabel: d.toLocaleDateString("zh-HK", { month: "short", day: "numeric" }),
        title: expense.description,
        subtitle: expense.payee || expense.notes || null,
        amount: expense.amount,
        expenseId: expense.id,
        categoryLabel: expense.categoryLabel,
        category: expense.category,
        isFromQuoteCost: expense.isFromQuoteCost,
      });
    }
    return rows.sort((a, b) => b.sortKey - a.sortKey);
  }, [filteredIncome, filteredExpenses]);

  const createMutation = trpc.expenses.create.useMutation({
    onSuccess: () => {
      utils.expenses.list.invalidate();
      utils.expenses.monthlySummary.invalidate();
      setDialogOpen(false);
      setForm(emptyFormForMonth());
      toast.success("支出已記錄");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.expenses.update.useMutation({
    onSuccess: () => {
      utils.expenses.list.invalidate();
      utils.expenses.monthlySummary.invalidate();
      setDialogOpen(false);
      setEditingId(null);
      setForm(emptyFormForMonth());
      toast.success("支出已更新");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.expenses.delete.useMutation({
    onSuccess: () => {
      utils.expenses.list.invalidate();
      utils.expenses.monthlySummary.invalidate();
      setDeleteConfirmId(null);
      toast.success("支出已刪除");
    },
    onError: (e) => toast.error(e.message),
  });

  const handleOpenCreate = () => {
    setEditingId(null);
    setForm(emptyFormForMonth());
    setDialogOpen(true);
  };

  const handleOpenEdit = (expense: (typeof expenses)[number]) => {
    setEditingId(expense.id);
    setForm({
      date: new Date(expense.date).toISOString().split("T")[0]!,
      category: expense.category,
      description: expense.description,
      amount: String(expense.amount),
      payee: expense.payee ?? "",
      notes: expense.notes ?? "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!form.category || !form.description || !form.amount || !form.date) {
      toast.error("請填寫所有必填欄位");
      return;
    }
    const amount = parseFloat(form.amount);
    if (isNaN(amount) || amount <= 0) {
      toast.error("請輸入有效金額");
      return;
    }
    const payload = {
      date: form.date,
      category: form.category as
        | "transport"
        | "equipment_rent"
        | "equipment_buy"
        | "staff"
        | "post_production"
        | "software"
        | "marketing"
        | "office"
        | "other",
      description: form.description,
      amount,
      payee: form.payee || undefined,
      notes: form.notes || undefined,
    };
    if (editingId !== null) {
      updateMutation.mutate({ id: editingId, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const monthNames = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
  const yearOptions = Array.from({ length: 6 }, (_, i) => now.getFullYear() - i);

  const prevMonth = () => {
    if (month === 1) {
      setMonth(12);
      setYear((y) => y - 1);
    } else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) {
      setMonth(1);
      setYear((y) => y + 1);
    } else setMonth((m) => m + 1);
  };
  const goThisMonth = () => {
    setYear(now.getFullYear());
    setMonth(now.getMonth() + 1);
  };

  const panelStyle: CSSProperties = {
    background: C.panel,
    border: `1px solid ${C.line}`,
  };
  const softPanelStyle: CSSProperties = {
    background: C.panelSoft,
    border: `1px solid ${C.line}`,
  };
  const controlStyle: CSSProperties = {
    background: C.panelSoft,
    border: `1px solid ${C.line}`,
    color: C.ink,
  };
  const rowDivider = { borderColor: C.lineSoft } as const;

  return (
    <DashboardLayout>
      <div className="space-y-5" style={{ color: C.ink }}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: C.ink }}>
              <BarChart3 className="w-6 h-6" style={{ color: C.gold }} />
              收入及支出
            </h1>
            <p className="text-sm mt-1" style={{ color: C.muted }}>
              收入按已接受報價（拍攝月／無拍攝日則開單月）；支出手動記錄
            </p>
          </div>
          <Button
            onClick={handleOpenCreate}
            className="gap-2"
            style={{ background: C.gold, color: "#111", border: "none" }}
          >
            <Plus className="w-4 h-4" />
            新增支出
          </Button>
        </div>

        {/* Month + search toolbar */}
        <div
          className="rounded-lg px-3 py-2.5 flex flex-wrap items-center gap-2"
          style={softPanelStyle}
        >
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 hover:bg-white/5"
              style={{ color: C.ink }}
              onClick={prevMonth}
              aria-label="上月"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Select
              value={String(year)}
              onValueChange={(v) => setYear(Number(v))}
            >
              <SelectTrigger className="h-8 w-[88px]" style={controlStyle}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}年
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
              <SelectTrigger className="h-8 w-[72px]" style={controlStyle}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthNames.map((label, i) => (
                  <SelectItem key={label} value={String(i + 1)}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 hover:bg-white/5"
              style={{ color: C.ink }}
              onClick={nextMonth}
              aria-label="下月"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
            {!isCurrentMonth && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs hover:bg-white/5"
                style={{ ...controlStyle, borderColor: C.goldLine, color: C.gold }}
                onClick={goThisMonth}
              >
                本月
              </Button>
            )}
          </div>

          <div className="relative flex-1 min-w-[180px] max-w-sm ml-auto">
            <Search
              className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2"
              style={{ color: C.muted }}
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜尋客戶、單號、描述、收款方…"
              className="h-8 pl-8"
              style={controlStyle}
            />
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg p-4" style={softPanelStyle}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs" style={{ color: C.muted }}>本月收入</span>
              <TrendingUp className="w-4 h-4" style={{ color: C.income }} />
            </div>
            <p className="text-2xl font-bold" style={{ color: C.income }}>{fmtHkd(totalIncome)}</p>
            <p className="text-xs mt-1" style={{ color: C.muted }}>
              {incomeTotalCount} 張已接受
              {incomeTotalCount > incomeRecords.length ? `（顯示 ${incomeRecords.length}）` : ""}
            </p>
          </div>
          <div className="rounded-lg p-4" style={softPanelStyle}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs" style={{ color: C.muted }}>本月支出</span>
              <TrendingDown className="w-4 h-4" style={{ color: C.expense }} />
            </div>
            <p className="text-2xl font-bold" style={{ color: C.expense }}>{fmtHkd(totalExpenses)}</p>
            <p className="text-xs mt-1" style={{ color: C.muted }}>
              {summary?.summary.reduce((n, s) => n + s.count, 0) ?? expenses.length} 筆支出
            </p>
          </div>
          <div className="rounded-lg p-4" style={softPanelStyle}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs" style={{ color: C.muted }}>本月淨額</span>
              <Wallet className="w-4 h-4" style={{ color: C.gold }} />
            </div>
            <p
              className="text-2xl font-bold"
              style={{ color: net >= 0 ? C.income : C.expense }}
            >
              {fmtHkd(net, { signed: true })}
            </p>
            <p className="text-xs mt-1" style={{ color: C.muted }}>收入 − 支出（未扣廣告）</p>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList
            className="h-auto p-1"
            style={{ background: C.panelSoft, border: `1px solid ${C.line}` }}
          >
            <TabsTrigger
              value="overview"
              className="gap-1.5 data-[state=active]:shadow-none"
              style={{ color: tab === "overview" ? C.ink : C.muted, ...(tab === "overview" ? { background: C.goldSoft, color: C.gold } : {}) }}
            >
              <Wallet className="w-3.5 h-3.5" />
              總覽 ({cashflowRows.length})
            </TabsTrigger>
            <TabsTrigger
              value="income"
              className="gap-1.5 data-[state=active]:shadow-none"
              style={{ color: tab === "income" ? C.ink : C.muted, ...(tab === "income" ? { background: C.goldSoft, color: C.gold } : {}) }}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              收入 ({filteredIncome.length})
            </TabsTrigger>
            <TabsTrigger
              value="expenses"
              className="gap-1.5 data-[state=active]:shadow-none"
              style={{ color: tab === "expenses" ? C.ink : C.muted, ...(tab === "expenses" ? { background: C.goldSoft, color: C.gold } : {}) }}
            >
              <TrendingDown className="w-3.5 h-3.5" />
              支出 ({filteredExpenses.length})
            </TabsTrigger>
          </TabsList>

          {/* Overview — combined cashflow */}
          <TabsContent value="overview" className="mt-4 space-y-4">
            {summary && summary.summary.length > 0 && (
              <Card style={panelStyle} className="border-0 shadow-none bg-transparent">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium" style={{ color: C.muted }}>
                    支出分類佔比
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {[...summary.summary]
                      .sort((a, b) => b.total - a.total)
                      .map((s) => {
                        const pct = totalExpenses > 0 ? (s.total / totalExpenses) * 100 : 0;
                        return (
                          <div key={s.category} className="flex items-center gap-3">
                            <span className="text-sm w-24 shrink-0" style={{ color: C.muted }}>
                              {s.categoryLabel}
                            </span>
                            <div className="flex-1 rounded-full h-2 overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                              <div
                                className="h-full rounded-full"
                                style={{ background: C.gold, width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-sm font-medium w-28 text-right shrink-0" style={{ color: C.ink }}>
                              {fmtHkd(s.total)}
                            </span>
                            <span className="text-xs w-10 text-right shrink-0" style={{ color: C.muted }}>
                              {pct.toFixed(0)}%
                            </span>
                          </div>
                        );
                      })}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card style={panelStyle} className="border-0 shadow-none bg-transparent">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2" style={{ color: C.muted }}>
                  <BarChart3 className="w-4 h-4" />
                  本月收支流水
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {incomeLoading || expensesLoading ? (
                  <div className="p-8 text-center" style={{ color: C.muted }}>載入中...</div>
                ) : cashflowRows.length === 0 ? (
                  <div className="p-12 text-center">
                    <Wallet className="w-12 h-12 mx-auto mb-3" style={{ color: "rgba(232,224,208,0.25)" }} />
                    <p style={{ color: C.muted }}>本月暫無收支記錄</p>
                    <Button onClick={handleOpenCreate} variant="outline" size="sm" className="mt-3">
                      新增支出
                    </Button>
                  </div>
                ) : (
                  <div className="divide-y" style={rowDivider}>
                    {cashflowRows.map((row) =>
                      row.kind === "income" ? (
                        <div
                          key={row.id}
                          className="flex items-center gap-3 px-4 py-3 transition-colors" style={{ color: C.ink }} onMouseEnter={(e) => { e.currentTarget.style.background = C.hover; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                        >
                          <div className="w-14 shrink-0 text-xs" style={{ color: C.muted }}>{row.dateLabel}</div>
                          <Badge
                            variant="outline"
                            className="text-[10px] shrink-0" style={{ background: C.incomeSoft, color: C.income, borderColor: "rgba(76,175,80,0.35)" }}
                          >
                            收入
                          </Badge>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate" style={{ color: C.ink }}>{row.title}</p>
                            <p className="text-xs truncate" style={{ color: C.muted }}>
                              {row.meta}
                              {row.subtitle ? ` · ${row.subtitle}` : ""}
                            </p>
                          </div>
                          <p className="text-sm font-semibold shrink-0" style={{ color: C.income }}>
                            {fmtHkd(row.amount, { signed: true })}
                          </p>
                          <Link href={row.href}>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 hover:bg-white/5 shrink-0" style={{ color: C.muted }}
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </Button>
                          </Link>
                        </div>
                      ) : (
                        <div
                          key={row.id}
                          className="flex items-center gap-3 px-4 py-3 transition-colors" style={{ color: C.ink }} onMouseEnter={(e) => { e.currentTarget.style.background = C.hover; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                        >
                          <div className="w-14 shrink-0 text-xs" style={{ color: C.muted }}>{row.dateLabel}</div>
                          <Badge
                            variant="outline"
                            className="text-[10px] shrink-0" style={categoryBadgeStyle(row.category)}
                          >
                            {row.categoryLabel}
                          </Badge>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate" style={{ color: C.ink }}>{row.title}</p>
                            {row.subtitle && (
                              <p className="text-xs truncate" style={{ color: C.muted }}>{row.subtitle}</p>
                            )}
                          </div>
                          <p className="text-sm font-semibold shrink-0" style={{ color: C.expense }}>
                            -{fmtHkd(row.amount)}
                          </p>
                          <div className="flex gap-0.5 shrink-0">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 hover:bg-white/5" style={{ color: C.muted }}
                              onClick={() => {
                                const ex = expenses.find((e) => e.id === row.expenseId);
                                if (ex) handleOpenEdit(ex);
                              }}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 hover:bg-white/5" style={{ color: C.muted }}
                              onClick={() => setDeleteConfirmId(row.expenseId)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Income Tab */}
          <TabsContent value="income" className="mt-4 space-y-4">
            <Card style={panelStyle} className="border-0 shadow-none bg-transparent">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2" style={{ color: C.muted }}>
                  <FileText className="w-4 h-4" />
                  已接受報價單（自動匯入）
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {incomeLoading ? (
                  <div className="p-8 text-center" style={{ color: C.muted }}>載入中...</div>
                ) : filteredIncome.length === 0 ? (
                  <div className="p-12 text-center">
                    <TrendingUp className="w-12 h-12 mx-auto mb-3" style={{ color: "rgba(232,224,208,0.25)" }} />
                    <p style={{ color: C.muted }}>
                      {q ? "沒有符合搜尋的收入記錄" : "本月暫無已接受報價單"}
                    </p>
                    {!q && (
                      <p className="text-xs mt-1" style={{ color: C.muted }}>
                        在報價單頁面將狀態改為「已接受」即可自動顯示於此
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="divide-y" style={rowDivider}>
                    {filteredIncome.map((quote) => {
                      const shootDate = quote.shootingDate ? new Date(quote.shootingDate) : null;
                      const displayDate = shootDate ?? new Date(quote.createdAt);
                      const displayLabel = shootDate ? "拍攝" : "建立";
                      return (
                        <div
                          key={quote.id}
                          className="flex items-center gap-4 px-4 py-3 transition-colors" style={{ color: C.ink }} onMouseEnter={(e) => { e.currentTarget.style.background = C.hover; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                              <Badge
                                variant="outline"
                                className="text-xs" style={{ background: C.incomeSoft, color: C.income, borderColor: "rgba(76,175,80,0.35)" }}
                              >
                                已接受
                              </Badge>
                              <span className="text-xs font-mono" style={{ color: C.muted }}>
                                {quote.quoteNumber}
                              </span>
                              <span className="text-xs" style={{ color: C.muted }}>
                                {displayLabel}{" "}
                                {displayDate.toLocaleDateString("zh-HK", {
                                  month: "short",
                                  day: "numeric",
                                })}
                              </span>
                            </div>
                            <p className="text-sm font-medium truncate" style={{ color: C.ink }}>
                              {quote.clientName}
                            </p>
                            {quote.serviceType && (
                              <p className="text-xs mt-0.5" style={{ color: C.muted }}>
                                {serviceLabel(quote.serviceType)}
                              </p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-base font-semibold" style={{ color: C.income }}>
                              {fmtHkd(Number(quote.total ?? 0), { signed: true })}
                            </p>
                          </div>
                          <Link href={`/quotes/${quote.id}`}>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 hover:bg-white/5 shrink-0" style={{ color: C.muted }}
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </Button>
                          </Link>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Expenses Tab */}
          <TabsContent value="expenses" className="mt-4 space-y-4">
            {summary && summary.summary.length > 0 && (
              <Card style={panelStyle} className="border-0 shadow-none bg-transparent">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium" style={{ color: C.muted }}>
                    支出分類明細
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {[...summary.summary]
                      .sort((a, b) => b.total - a.total)
                      .map((s) => {
                        const pct = totalExpenses > 0 ? (s.total / totalExpenses) * 100 : 0;
                        return (
                          <button
                            key={s.category}
                            type="button"
                            onClick={() =>
                              setFilterCategory((prev) =>
                                prev === s.category ? "all" : s.category
                              )
                            }
                            className="w-full flex items-center gap-3 rounded-md px-1 py-0.5 transition-colors text-left" onMouseEnter={(e) => { e.currentTarget.style.background = C.hover; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                          >
                            <span className="text-sm w-24 shrink-0" style={{ color: C.muted }}>
                              {s.categoryLabel}
                            </span>
                            <div className="flex-1 rounded-full h-2 overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                              <div
                                className="h-full rounded-full"
                                style={{ background: C.gold, width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-sm font-medium w-28 text-right shrink-0" style={{ color: C.ink }}>
                              {fmtHkd(s.total)}
                            </span>
                            <span className="text-xs w-10 text-right shrink-0" style={{ color: C.muted }}>
                              {pct.toFixed(0)}%
                            </span>
                          </button>
                        );
                      })}
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger className="h-8 w-[160px]" style={controlStyle}>
                  <SelectValue placeholder="全部分類" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部分類</SelectItem>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {filterCategory !== "all" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs hover:bg-white/5" style={{ color: C.muted }}
                  onClick={() => setFilterCategory("all")}
                >
                  清除篩選
                </Button>
              )}
            </div>

            <Card style={panelStyle} className="border-0 shadow-none bg-transparent">
              <CardContent className="p-0">
                {expensesLoading ? (
                  <div className="p-8 text-center" style={{ color: C.muted }}>載入中...</div>
                ) : filteredExpenses.length === 0 ? (
                  <div className="p-12 text-center">
                    <Receipt className="w-12 h-12 mx-auto mb-3" style={{ color: "rgba(232,224,208,0.25)" }} />
                    <p style={{ color: C.muted }}>
                      {q || filterCategory !== "all"
                        ? "沒有符合條件的支出記錄"
                        : "本月暫無支出記錄"}
                    </p>
                    {!q && filterCategory === "all" && (
                      <Button onClick={handleOpenCreate} variant="outline" size="sm" className="mt-3">
                        新增第一筆支出
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="divide-y" style={rowDivider}>
                    {filteredExpenses.map((expense) => {
                      return (
                        <div
                          key={expense.id}
                          className="flex items-center gap-4 px-4 py-3 transition-colors" style={{ color: C.ink }} onMouseEnter={(e) => { e.currentTarget.style.background = C.hover; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                              <Badge variant="outline" className="text-xs" style={categoryBadgeStyle(expense.category)}>
                                {expense.categoryLabel}
                              </Badge>
                              {expense.isFromQuoteCost && (
                                <Badge
                                  variant="outline"
                                  className="text-xs" style={{ color: C.income, borderColor: "rgba(76,175,80,0.4)", background: C.incomeSoft }}
                                >
                                  報價成本
                                </Badge>
                              )}
                              <span className="text-xs" style={{ color: C.muted }}>
                                {new Date(expense.date).toLocaleDateString("zh-HK", {
                                  month: "short",
                                  day: "numeric",
                                })}
                              </span>
                              {expense.payee && (
                                <span className="text-xs" style={{ color: C.muted }}>
                                  · {expense.payee}
                                </span>
                              )}
                            </div>
                            <p className="text-sm truncate" style={{ color: C.ink }}>{expense.description}</p>
                            {expense.notes && (
                              <p className="text-xs mt-0.5 truncate" style={{ color: C.muted }}>
                                {expense.notes}
                              </p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-base font-semibold" style={{ color: C.expense }}>
                              -{fmtHkd(expense.amount)}
                            </p>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 hover:bg-white/5" style={{ color: C.muted }}
                              onClick={() => handleOpenEdit(expense)}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 hover:bg-white/5" style={{ color: C.muted }}
                              onClick={() => setDeleteConfirmId(expense.id)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? "編輯支出" : "新增支出"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>日期 *</Label>
                <Input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>類別 *</Label>
                <Select
                  value={form.category}
                  onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="選擇類別" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>描述 *</Label>
              <Input
                placeholder="例：的士去九龍城拍攝"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>金額 (HKD) *</Label>
                <Input
                  type="number"
                  placeholder="0"
                  min="0"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>收款方</Label>
                <Input
                  placeholder="例：陳大文 / 租借器材公司"
                  value={form.payee}
                  onChange={(e) => setForm((f) => ({ ...f, payee: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>備註</Label>
              <Textarea
                placeholder="額外說明（可選）"
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
              style={{ background: C.gold, color: "#111" }}
            >
              {editingId ? "儲存更改" : "新增支出"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={deleteConfirmId !== null} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>確認刪除</DialogTitle>
          </DialogHeader>
          <p className="text-sm" style={{ color: C.muted }}>此操作無法復原，確定要刪除這筆支出記錄嗎？</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                deleteConfirmId !== null && deleteMutation.mutate({ id: deleteConfirmId })
              }
              disabled={deleteMutation.isPending}
            >
              確認刪除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
