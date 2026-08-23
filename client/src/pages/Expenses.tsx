import { useState } from "react";
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
import { Plus, Pencil, Trash2, Receipt, TrendingDown, TrendingUp, BarChart3, FileText, ExternalLink } from "lucide-react";
import { Link } from "wouter";

const CATEGORIES = [
  { value: "transport", label: "車費", color: "bg-blue-500/20 text-blue-300 border-blue-500/30" },
  { value: "equipment_rent", label: "租用器材", color: "bg-purple-500/20 text-purple-300 border-purple-500/30" },
  { value: "equipment_buy", label: "購買器材", color: "bg-orange-500/20 text-orange-300 border-orange-500/30" },
  { value: "staff", label: "員工薪酬", color: "bg-green-500/20 text-green-300 border-green-500/30" },
  { value: "software", label: "軟件/訂閱", color: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30" },
  { value: "marketing", label: "市場推廣", color: "bg-pink-500/20 text-pink-300 border-pink-500/30" },
  { value: "office", label: "辦公室/場地", color: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30" },
  { value: "other", label: "其他", color: "bg-gray-500/20 text-gray-300 border-gray-500/30" },
];

const getCategoryStyle = (cat: string) => CATEGORIES.find(c => c.value === cat) ?? CATEGORIES[7];

const SERVICE_TYPE_LABELS: Record<string, string> = {
  wedding: "婚禮攝影",
  portrait: "人像攝影",
  commercial: "商業攝影",
  event: "活動攝影",
  video: "影片製作",
  product: "產品攝影",
  other: "其他",
  kol_mi: "KOL/MI 推廣",
  graphic_design: "平面設計",
  menu_design: "餐牌設計",
  corporate_event: "公司活動",
  interior: "內容攝影",
  photo_video: "攝影加錄影",
};

type ExpenseForm = {
  date: string;
  category: string;
  description: string;
  amount: string;
  payee: string;
  notes: string;
};

const emptyForm: ExpenseForm = {
  date: new Date().toISOString().split("T")[0],
  category: "",
  description: "",
  amount: "",
  payee: "",
  notes: "",
};

export default function Expenses() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [filterCategory, setFilterCategory] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ExpenseForm>(emptyForm);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const utils = trpc.useUtils();

  // Expenses queries
  const { data: expenses = [], isLoading: expensesLoading } = trpc.expenses.list.useQuery({
    year,
    month,
    category: filterCategory === "all" ? undefined : filterCategory,
  });

  const { data: summary } = trpc.expenses.monthlySummary.useQuery({ year, month });

  // Income: accepted quotes for the selected month
  const { data: acceptedQuotesData, isLoading: incomeLoading } = trpc.quotes.list.useQuery({
    status: "accepted",
    limit: 100,
  });

  // Filter accepted quotes by selected year/month:
  // - If shootingDate exists: use shootingDate (拍攝日期)
  // - If no shootingDate (e.g. graphic_design, menu_design, other): fall back to createdAt (建立日期)
  const DESIGN_TYPES = ["graphic_design", "menu_design"];
  const incomeRecords = (acceptedQuotesData?.data ?? []).filter(q => {
    if (q.shootingDate) {
      // Has shooting date: filter by shootingDate
      const d = new Date(q.shootingDate);
      return d.getFullYear() === year && d.getMonth() + 1 === month;
    } else {
      // No shooting date: fall back to createdAt
      const d = new Date(q.createdAt);
      return d.getFullYear() === year && d.getMonth() + 1 === month;
    }
  });

  const totalIncome = incomeRecords.reduce((sum, q) => sum + Number(q.total ?? 0), 0);
  const totalExpenses = summary?.grandTotal ?? 0;

  // Mutations
  const createMutation = trpc.expenses.create.useMutation({
    onSuccess: () => {
      utils.expenses.list.invalidate();
      utils.expenses.monthlySummary.invalidate();
      setDialogOpen(false);
      setForm(emptyForm);
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
      setForm(emptyForm);
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
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const handleOpenEdit = (expense: typeof expenses[number]) => {
    setEditingId(expense.id);
    setForm({
      date: new Date(expense.date).toISOString().split("T")[0],
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
      category: form.category as any,
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

  const monthNames = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-amber-400" />
              收入及支出記錄
            </h1>
            <p className="text-muted-foreground text-sm mt-1">收入來自已接受報價單，支出手動記錄</p>
          </div>
          <Button onClick={handleOpenCreate} className="bg-amber-600 hover:bg-amber-700 text-white gap-2">
            <Plus className="w-4 h-4" />
            新增支出
          </Button>
        </div>

        {/* Month navigation */}
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={prevMonth}>‹</Button>
          <span className="text-lg font-semibold text-foreground min-w-[100px] text-center">
            {year}年 {monthNames[month - 1]}
          </span>
          <Button variant="outline" size="sm" onClick={nextMonth}>›</Button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="border-green-500/20 bg-green-500/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="w-4 h-4 text-green-400" />
                <p className="text-xs text-muted-foreground">本月收入</p>
              </div>
              <p className="text-2xl font-bold text-green-400">
                HK${totalIncome.toLocaleString("en-HK", { minimumFractionDigits: 0 })}
              </p>
              <p className="text-xs text-muted-foreground mt-1">{incomeRecords.length} 張已接受報價單</p>
            </CardContent>
          </Card>
          <Card className="border-red-500/20 bg-red-500/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingDown className="w-4 h-4 text-red-400" />
                <p className="text-xs text-muted-foreground">本月支出</p>
              </div>
              <p className="text-2xl font-bold text-red-400">
                HK${totalExpenses.toLocaleString("en-HK", { minimumFractionDigits: 0 })}
              </p>
              <p className="text-xs text-muted-foreground mt-1">{expenses.length} 筆支出記錄</p>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="income">
          <TabsList className="bg-muted/30">
            <TabsTrigger value="income" className="gap-1.5">
              <TrendingUp className="w-3.5 h-3.5" />
              收入 ({incomeRecords.length})
            </TabsTrigger>
            <TabsTrigger value="expenses" className="gap-1.5">
              <TrendingDown className="w-3.5 h-3.5" />
              支出 ({expenses.length})
            </TabsTrigger>
          </TabsList>

          {/* Income Tab */}
          <TabsContent value="income" className="mt-4 space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  已接受報價單（自動匯入）
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {incomeLoading ? (
                  <div className="p-8 text-center text-muted-foreground">載入中...</div>
                ) : incomeRecords.length === 0 ? (
                  <div className="p-12 text-center">
                    <TrendingUp className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-muted-foreground">本月暫無已接受報價單</p>
                    <p className="text-xs text-muted-foreground mt-1">在報價單頁面將狀態改為「已接受」即可自動顯示於此</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border/50">
                    {incomeRecords.map(q => {
                      const shootDate = q.shootingDate ? new Date(q.shootingDate) : null;
                      const displayDate = shootDate ?? new Date(q.createdAt);
                      const displayLabel = shootDate ? "拍攝" : "建立";
                      return (
                        <div key={q.id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/20 transition-colors">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <Badge variant="outline" className="text-xs bg-green-500/10 text-green-300 border-green-500/30">
                                已接受
                              </Badge>
                              <span className="text-xs text-muted-foreground font-mono">{q.quoteNumber}</span>
                              {displayDate && (
                                <span className="text-xs text-muted-foreground">
                                  {displayLabel} {displayDate.toLocaleDateString("zh-HK", { month: "short", day: "numeric" })}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-foreground font-medium truncate">{q.clientName}</p>
                            {q.serviceType && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {SERVICE_TYPE_LABELS[q.serviceType] ?? q.serviceType}
                              </p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-base font-semibold text-green-400">
                              +HK${Number(q.total ?? 0).toLocaleString("en-HK", { minimumFractionDigits: 0 })}
                            </p>
                          </div>
                          <Link href={`/quotes/${q.id}`}>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0">
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
            {/* Category breakdown */}
            {summary && summary.summary.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">支出分類明細</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {summary.summary.sort((a, b) => b.total - a.total).map(s => {
                      const pct = totalExpenses > 0 ? (s.total / totalExpenses) * 100 : 0;
                      return (
                        <div key={s.category} className="flex items-center gap-3">
                          <span className="text-sm text-muted-foreground w-24 shrink-0">{s.categoryLabel}</span>
                          <div className="flex-1 bg-muted/30 rounded-full h-2 overflow-hidden">
                            <div className="h-full rounded-full bg-amber-500/70" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-sm font-medium text-foreground w-28 text-right shrink-0">
                            HK${s.total.toLocaleString("en-HK", { minimumFractionDigits: 0 })}
                          </span>
                          <span className="text-xs text-muted-foreground w-10 text-right shrink-0">
                            {pct.toFixed(0)}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Category filter */}
            <div className="flex gap-2 flex-wrap">
              <Button
                variant={filterCategory === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterCategory("all")}
                className={filterCategory === "all" ? "bg-amber-600 hover:bg-amber-700" : ""}
              >
                全部
              </Button>
              {CATEGORIES.map(c => (
                <Button
                  key={c.value}
                  variant={filterCategory === c.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilterCategory(c.value)}
                  className={filterCategory === c.value ? "bg-amber-600 hover:bg-amber-700" : ""}
                >
                  {c.label}
                </Button>
              ))}
            </div>

            {/* Expense list */}
            <Card>
              <CardContent className="p-0">
                {expensesLoading ? (
                  <div className="p-8 text-center text-muted-foreground">載入中...</div>
                ) : expenses.length === 0 ? (
                  <div className="p-12 text-center">
                    <Receipt className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-muted-foreground">本月暫無支出記錄</p>
                    <Button onClick={handleOpenCreate} variant="outline" size="sm" className="mt-3">
                      新增第一筆支出
                    </Button>
                  </div>
                ) : (
                  <div className="divide-y divide-border/50">
                    {expenses.map(expense => {
                      const catStyle = getCategoryStyle(expense.category);
                      return (
                        <div key={expense.id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/20 transition-colors">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <Badge variant="outline" className={`text-xs ${catStyle.color}`}>
                                {expense.categoryLabel}
                              </Badge>
                              {expense.isFromQuoteCost && (
                                <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-600/40">
                                  報價成本
                                </Badge>
                              )}
                              <span className="text-xs text-muted-foreground">
                                {new Date(expense.date).toLocaleDateString("zh-HK", { month: "short", day: "numeric" })}
                              </span>
                              {expense.payee && (
                                <span className="text-xs text-muted-foreground">· {expense.payee}</span>
                              )}
                            </div>
                            <p className="text-sm text-foreground truncate">{expense.description}</p>
                            {expense.notes && (
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">{expense.notes}</p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-base font-semibold text-red-400">
                              -HK${expense.amount.toLocaleString("en-HK", { minimumFractionDigits: 0 })}
                            </p>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              onClick={() => handleOpenEdit(expense)}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-red-400"
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
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>類別 *</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="選擇類別" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
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
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
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
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>收款方</Label>
                <Input
                  placeholder="例：陳大文 / 租借器材公司"
                  value={form.payee}
                  onChange={e => setForm(f => ({ ...f, payee: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>備註</Label>
              <Textarea
                placeholder="額外說明（可選）"
                rows={2}
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
              className="bg-amber-600 hover:bg-amber-700"
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
          <p className="text-sm text-muted-foreground">此操作無法復原，確定要刪除這筆支出記錄嗎？</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>取消</Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmId !== null && deleteMutation.mutate({ id: deleteConfirmId })}
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
