import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, LineChart, Line } from "recharts";
import { Plus, Trash2, Edit2, Check, X, ChevronDown, ChevronUp, Receipt } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AD_PLATFORMS as PLATFORMS } from "@/lib/platformConstants";



const MONTHS = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `${i + 1}月` }));

type EditingRow = {
  id?: number;
  platform: string;
  year: number;
  month: number;
  amount: number;
  impressions: string;
  clicks: string;
  conversions: string;
  notes: string;
};

export default function AdExpenses() {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
   const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(currentMonth);
  const [editingRow, setEditingRow] = useState<EditingRow | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showTransactions, setShowTransactions] = useState(false);
  const [txPlatform, setTxPlatform] = useState<string>("hellotoby");
  const [txMonth, setTxMonth] = useState<number | null>(currentMonth);
  const [txType, setTxType] = useState<string>("all");
  const [txOffset, setTxOffset] = useState(0);
  const TX_LIMIT = 50;
  const utils = trpc.useUtils();
  const { data: expenses, isLoading } = trpc.adExpenses.list.useQuery({
    year: selectedYear,
    month: selectedMonth ?? undefined,
  });

  const { data: summary } = trpc.adExpenses.summary.useQuery({ year: selectedYear });
  const { data: txData, isLoading: txLoading } = trpc.adExpenses.getTransactions.useQuery(
    {
      platform: txPlatform,
      year: selectedYear,
      month: txMonth ?? undefined,
      type: txType === "all" ? undefined : (txType as "expense" | "refund" | "topup"),
      limit: TX_LIMIT,
      offset: txOffset,
    },
    { enabled: showTransactions }
  );

  // fix: ensure month is always a number
  const safeMonth = selectedMonth ?? undefined;

  const upsertMutation = trpc.adExpenses.upsert.useMutation({
    onSuccess: () => {
      toast.success("廣告開支已儲存");
      utils.adExpenses.list.invalidate();
      utils.adExpenses.summary.invalidate();
      setEditingRow(null);
      setShowAddForm(false);
    },
    onError: (e) => toast.error(`儲存失敗：${e.message}`),
  });

  const deleteMutation = trpc.adExpenses.delete.useMutation({
    onSuccess: () => {
      toast.success("記錄已刪除");
      utils.adExpenses.list.invalidate();
      utils.adExpenses.summary.invalidate();
    },
    onError: () => toast.error("刪除失敗"),
  });

  const chartData = useMemo(() => {
    if (!summary) return [];
    const monthMap: Record<number, Record<string, number | string>> = {};
    for (const row of summary) {
      const m = row.month;
      if (!monthMap[m]) monthMap[m] = { month: m, monthLabel: `${m}月` };
      monthMap[m][row.platform] = Number(row.amount);
    }
    return Object.values(monthMap).sort((a, b) => Number(a.month) - Number(b.month));
  }, [summary]);

  const platformTotals = useMemo(() => {
    if (!summary) return {} as Record<string, { expense: number; refund: number }>;
    const totals: Record<string, { expense: number; refund: number }> = {};
    // Filter by selectedMonth if set, otherwise use all months
    const filtered = selectedMonth ? summary.filter((row) => row.month === selectedMonth) : summary;
    for (const row of filtered) {
      if (!totals[row.platform]) totals[row.platform] = { expense: 0, refund: 0 };
      totals[row.platform].expense += Number(row.amount);
      totals[row.platform].refund += Number(row.refundAmount ?? 0);
    }
    return totals;
  }, [summary, selectedMonth]);

  const totalYearSpend = Object.values(platformTotals).reduce((s, v) => s + v.expense, 0);

  const handleSave = (row: EditingRow) => {
    upsertMutation.mutate({
      platform: row.platform as any,
      year: row.year,
      month: row.month,
      amount: row.amount,
      impressions: row.impressions ? parseInt(row.impressions) : undefined,
      clicks: row.clicks ? parseInt(row.clicks) : undefined,
      conversions: row.conversions ? parseInt(row.conversions) : undefined,
      notes: row.notes || undefined,
    });
  };

  const newRow = (): EditingRow => ({
    platform: "hellotoby",
    year: selectedYear,
    month: currentMonth,
    amount: 0,
    impressions: "",
    clicks: "",
    conversions: "",
    notes: "",
  });

  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <div style={{ fontSize: "0.6rem", letterSpacing: "0.2em", color: "#d4a843", textTransform: "uppercase", marginBottom: "6px" }}>
              Ad Expense Tracker
            </div>
            <h1 className="text-2xl font-light">廣告開支記錄</h1>
          </div>
          <button
            onClick={() => { setShowAddForm(true); setEditingRow(newRow()); }}
            className="flex items-center gap-2 px-5 py-2.5 transition-all hover:opacity-80"
            style={{ background: "#d4a843", color: "#0a0a0a", fontSize: "0.75rem", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", borderRadius: "2px" }}
          >
            <Plus className="h-4 w-4" />
            新增記錄
          </button>
        </div>

        <div style={{ height: "1px", background: "linear-gradient(to right, #d4a843, rgba(212,168,67,0.1), transparent)" }} />

        {/* Platform Summary Cards */}
        <div className="flex items-center justify-between mb-2">
          <div style={{ fontSize: "0.65rem", letterSpacing: "0.15em", color: "rgba(255,255,255,0.4)", textTransform: "uppercase" }}>
            {selectedMonth ? `${selectedYear} 年 ${selectedMonth} 月開支總覽` : `${selectedYear} 年全年開支總覽`}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {PLATFORMS.map((p) => {
            const total = platformTotals[p.value]?.expense ?? 0;
            const refund = platformTotals[p.value]?.refund ?? 0;
            // HelloToby: refund = coins returned to wallet, not a cash refund — don't deduct from net spend
            const net = p.value === "hellotoby" ? total : total - refund;
            const pct = totalYearSpend > 0 ? ((total / totalYearSpend) * 100).toFixed(1) : "0";
            return (
              <div
                key={p.value}
                className="p-4 rounded"
                style={{ background: `${p.color}0d`, border: `1px solid ${p.color}30` }}
              >
                <div style={{ fontSize: "0.6rem", letterSpacing: "0.15em", color: p.color, textTransform: "uppercase", marginBottom: "8px" }}>
                  {p.label}
                </div>
                <div className="text-lg font-light" style={{ color: p.color }}>
                  HKD {total.toLocaleString()}
                </div>
                {refund > 0 && (
                  <div className="text-xs mt-1" style={{ color: "#4ade80" }}>退款 HKD {refund.toLocaleString()}</div>
                )}
                {refund > 0 && (
                  <div className="text-xs mt-0.5 text-muted-foreground">淨開支 HKD {net.toLocaleString()}</div>
                )}
                {refund === 0 && (
                  <div className="text-xs text-muted-foreground mt-1">{pct}% 佔比</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded p-6" style={{ background: "#0f0f0f", border: "1px solid rgba(212,168,67,0.15)" }}>
            <div style={{ fontSize: "0.6rem", letterSpacing: "0.2em", color: "#d4a843", textTransform: "uppercase", marginBottom: "4px" }}>
              Monthly Breakdown
            </div>
            <h3 className="text-sm font-light mb-4">{selectedYear} 年月度開支分佈</h3>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <XAxis dataKey="monthLabel" tick={{ fill: "#666", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#666", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "#111", border: "1px solid rgba(212,168,67,0.3)", borderRadius: "4px", fontSize: "12px" }} labelStyle={{ color: "#d4a843" }} />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  {PLATFORMS.map((p) => (
                    <Bar key={p.value} dataKey={p.value} name={p.label} fill={p.color} radius={[2, 2, 0, 0]} maxBarSize={16} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">尚無資料</div>
            )}
          </div>

          <div className="rounded p-6" style={{ background: "#0f0f0f", border: "1px solid rgba(212,168,67,0.15)" }}>
            <div style={{ fontSize: "0.6rem", letterSpacing: "0.2em", color: "#d4a843", textTransform: "uppercase", marginBottom: "4px" }}>
              Trend Analysis
            </div>
            <h3 className="text-sm font-light mb-4">各平台月度趨勢</h3>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <XAxis dataKey="monthLabel" tick={{ fill: "#666", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#666", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "#111", border: "1px solid rgba(212,168,67,0.3)", borderRadius: "4px", fontSize: "12px" }} labelStyle={{ color: "#d4a843" }} />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  {PLATFORMS.map((p) => (
                    <Line key={p.value} type="monotone" dataKey={p.value} name={p.label} stroke={p.color} strokeWidth={1.5} dot={{ r: 3, fill: p.color }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">尚無資料</div>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3">
          <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(parseInt(v))}>
            <SelectTrigger className="w-[120px]" style={{ background: "#111", border: "1px solid rgba(212,168,67,0.2)" }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => <SelectItem key={y} value={String(y)}>{y} 年</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={selectedMonth ? String(selectedMonth) : "all"} onValueChange={(v) => setSelectedMonth(v === "all" ? null : parseInt(v))}>
            <SelectTrigger className="w-[110px]" style={{ background: "#111", border: "1px solid rgba(212,168,67,0.2)" }}>
              <SelectValue placeholder="全部月份" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部月份</SelectItem>
              {MONTHS.map((m) => <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="rounded overflow-hidden overflow-x-auto" style={{ border: "1px solid rgba(212,168,67,0.15)" }}>
          <table className="w-full">
            <thead>
              <tr style={{ background: "#0f0f0f", borderBottom: "1px solid rgba(212,168,67,0.2)" }}>
                {["平台", "年份", "月份", "廣告開支 (HKD)", "退款 (HKD)", "淨開支 (HKD)", "曝光次數", "點擊次數", "轉換數", "備註", "操作"].map((h) => (
                  <th key={h} className="text-left px-4 py-3" style={{ fontSize: "0.6rem", letterSpacing: "0.12em", color: "#d4a843", textTransform: "uppercase", fontWeight: 500 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Add Row */}
              {showAddForm && editingRow && !editingRow.id && (
                <EditRow
                  row={editingRow}
                  onChange={setEditingRow}
                  onSave={() => handleSave(editingRow)}
                  onCancel={() => { setShowAddForm(false); setEditingRow(null); }}
                  isSaving={upsertMutation.isPending}
                />
              )}

              {isLoading && (
                <tr><td colSpan={11} className="text-center py-8 text-muted-foreground text-sm">載入中...</td></tr>
              )}
              {!isLoading && expenses?.length === 0 && !showAddForm && (
                <tr>
                  <td colSpan={11} className="text-center py-12 text-muted-foreground text-sm">
                    尚無廣告開支記錄，點擊「新增記錄」開始追蹤
                  </td>
                </tr>
              )}

              {expenses?.map((exp, idx) => {
                const platform = PLATFORMS.find((p) => p.value === exp.platform);
                const isEditing = editingRow?.id === exp.id;
                if (isEditing && editingRow) {
                  return (
                    <EditRow
                      key={exp.id}
                      row={editingRow}
                      onChange={setEditingRow}
                      onSave={() => handleSave(editingRow)}
                      onCancel={() => setEditingRow(null)}
                      isSaving={upsertMutation.isPending}
                    />
                  );
                }
                return (
                  <tr
                    key={exp.id}
                    style={{ background: idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}
                    className="hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium" style={{ color: platform?.color ?? "#888" }}>
                        {platform?.label ?? exp.platform}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">{exp.year}</td>
                    <td className="px-4 py-3 text-sm">{exp.month}月</td>
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium" style={{ color: "#d4a843" }}>
                        {Number(exp.amount).toLocaleString()}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {Number(exp.refundAmount ?? 0) > 0 ? (
                        <span className="text-sm font-medium" style={{ color: "#4ade80" }}>
                          {Number(exp.refundAmount).toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium" style={{ color: Number(exp.refundAmount ?? 0) > 0 ? "#a3e635" : "#d4a843" }}>
                        {/* HelloToby: refund is coins returned to wallet, net spend = full purchase amount */}
                        {exp.platform === "hellotoby"
                          ? Number(exp.amount).toLocaleString()
                          : (Number(exp.amount) - Number(exp.refundAmount ?? 0)).toLocaleString()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{exp.impressions?.toLocaleString() ?? "—"}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{exp.clicks?.toLocaleString() ?? "—"}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{exp.conversions ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-[120px] truncate">{exp.notes ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => setEditingRow({
                            id: exp.id,
                            platform: exp.platform,
                            year: exp.year,
                            month: exp.month,
                            amount: Number(exp.amount),
                            impressions: exp.impressions ? String(exp.impressions) : "",
                            clicks: exp.clicks ? String(exp.clicks) : "",
                            conversions: exp.conversions ? String(exp.conversions) : "",
                            notes: exp.notes ?? "",
                          })}
                          className="p-1.5 rounded hover:bg-white/10 transition-colors"
                        >
                          <Edit2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                        <button
                          onClick={() => { if (confirm("確定刪除此記錄？")) deleteMutation.mutate({ id: exp.id }); }}
                          className="p-1.5 rounded hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
         {/* Transaction Detail Section */}
        <div className="rounded overflow-hidden" style={{ border: "1px solid rgba(212,168,67,0.15)" }}>
          {/* Header toggle */}
          <button
            className="w-full flex items-center justify-between px-6 py-4 hover:bg-white/[0.02] transition-colors"
            style={{ background: "#0f0f0f" }}
            onClick={() => { setShowTransactions(!showTransactions); setTxOffset(0); }}
          >
            <div className="flex items-center gap-3">
              <Receipt className="h-4 w-4" style={{ color: "#d4a843" }} />
              <div>
                <div style={{ fontSize: "0.6rem", letterSpacing: "0.2em", color: "#d4a843", textTransform: "uppercase", textAlign: "left" }}>Transaction Detail</div>
                <div className="text-sm font-light text-left">逐筆交易明細</div>
              </div>
            </div>
            {showTransactions ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </button>

          {showTransactions && (
            <div>
              {/* Filters */}
              <div className="flex flex-wrap gap-3 px-6 py-4" style={{ borderTop: "1px solid rgba(212,168,67,0.1)", background: "rgba(0,0,0,0.3)" }}>
                <Select value={txPlatform} onValueChange={(v) => { setTxPlatform(v); setTxOffset(0); }}>
                  <SelectTrigger className="w-[140px]" style={{ background: "#111", border: "1px solid rgba(212,168,67,0.2)", fontSize: "12px" }}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLATFORMS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={txMonth ? String(txMonth) : "all"} onValueChange={(v) => { setTxMonth(v === "all" ? null : parseInt(v)); setTxOffset(0); }}>
                  <SelectTrigger className="w-[110px]" style={{ background: "#111", border: "1px solid rgba(212,168,67,0.2)", fontSize: "12px" }}>
                    <SelectValue placeholder="全部月份" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部月份</SelectItem>
                    {MONTHS.map((m) => <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={txType} onValueChange={(v) => { setTxType(v); setTxOffset(0); }}>
                  <SelectTrigger className="w-[120px]" style={{ background: "#111", border: "1px solid rgba(212,168,67,0.2)", fontSize: "12px" }}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部類別</SelectItem>
                    <SelectItem value="expense">消費</SelectItem>
                    <SelectItem value="refund">退款</SelectItem>
                    <SelectItem value="topup">增值</SelectItem>
                  </SelectContent>
                </Select>
                {txData && (
                  <div className="ml-auto text-xs text-muted-foreground flex items-center">
                    共 {txData.total} 筆記錄
                  </div>
                )}
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr style={{ background: "#0a0a0a", borderBottom: "1px solid rgba(212,168,67,0.15)" }}>
                      {["日期", "描述", "金幣", "換算率", "港幣金額", "類別"].map((h) => (
                        <th key={h} className="text-left px-4 py-3" style={{ fontSize: "0.6rem", letterSpacing: "0.12em", color: "#d4a843", textTransform: "uppercase", fontWeight: 500 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {txLoading && (
                      <tr><td colSpan={6} className="text-center py-8 text-muted-foreground text-sm">載入中...</td></tr>
                    )}
                    {!txLoading && txData?.rows.length === 0 && (
                      <tr><td colSpan={6} className="text-center py-8 text-muted-foreground text-sm">此篩選條件下沒有交易記錄</td></tr>
                    )}
                    {txData?.rows.map((tx, idx) => {
                      const typeConfig = {
                        expense: { label: "消費", color: "#FFB800", bg: "rgba(255,184,0,0.1)" },
                        refund: { label: "退款", color: "#4ade80", bg: "rgba(74,222,128,0.1)" },
                        topup: { label: "增值", color: "#7B8CFF", bg: "rgba(123,140,255,0.1)" },
                      }[tx.type] ?? { label: tx.type, color: "#888", bg: "rgba(136,136,136,0.1)" };
                      const platform = PLATFORMS.find((p) => p.value === tx.platform);
                      return (
                        <tr
                          key={tx.id}
                          style={{ background: idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}
                          className="hover:bg-white/[0.02] transition-colors"
                        >
                          <td className="px-4 py-2.5 text-sm text-muted-foreground whitespace-nowrap">{tx.transDate}</td>
                          <td className="px-4 py-2.5 text-sm max-w-[280px]">
                            <div className="truncate" title={tx.description ?? ""}>{tx.description || "—"}</div>
                          </td>
                          <td className="px-4 py-2.5 text-sm">
                            {tx.coins != null ? (
                              <span style={{ color: tx.type === "topup" ? "#7B8CFF" : tx.type === "refund" ? "#4ade80" : "#FFB800" }}>
                                {tx.type === "expense" ? "-" : "+"}{Math.abs(Number(tx.coins))}
                              </span>
                            ) : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">
                            {tx.exchangeRate ? `${Number(tx.exchangeRate).toFixed(2)}/幣` : "—"}
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="text-sm font-medium" style={{ color: tx.type === "refund" ? "#4ade80" : tx.type === "topup" ? "#7B8CFF" : "#d4a843" }}>
                              {tx.type === "refund" ? "+" : tx.type === "topup" ? "+" : "-"}HKD {Math.abs(Number(tx.hkdAmount)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="text-xs px-2 py-0.5 rounded" style={{ color: typeConfig.color, background: typeConfig.bg }}>
                              {typeConfig.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {txData && txData.total > TX_LIMIT && (
                <div className="flex items-center justify-between px-6 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                  <button
                    disabled={txOffset === 0}
                    onClick={() => setTxOffset(Math.max(0, txOffset - TX_LIMIT))}
                    className="text-xs px-3 py-1.5 rounded disabled:opacity-30 hover:bg-white/10 transition-colors"
                    style={{ border: "1px solid rgba(212,168,67,0.2)" }}
                  >
                    上一頁
                  </button>
                  <span className="text-xs text-muted-foreground">
                    {txOffset + 1}–{Math.min(txOffset + TX_LIMIT, txData.total)} / {txData.total}
                  </span>
                  <button
                    disabled={txOffset + TX_LIMIT >= txData.total}
                    onClick={() => setTxOffset(txOffset + TX_LIMIT)}
                    className="text-xs px-3 py-1.5 rounded disabled:opacity-30 hover:bg-white/10 transition-colors"
                    style={{ border: "1px solid rgba(212,168,67,0.2)" }}
                  >
                    下一頁
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
function EditRow({
  row,
  onChange,
  onSave,
  onCancel,
  isSaving,
}: {
  row: EditingRow;
  onChange: (r: EditingRow) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const inputS: React.CSSProperties = { background: "#0a0a0a", border: "1px solid rgba(212,168,67,0.3)", color: "#e8e0d0", height: "32px", fontSize: "12px", padding: "0 8px" };
  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

  return (
    <tr style={{ background: "rgba(212,168,67,0.05)", borderBottom: "1px solid rgba(212,168,67,0.2)" }}>
      <td className="px-2 py-2">
        <Select value={row.platform} onValueChange={(v) => onChange({ ...row, platform: v })}>
          <SelectTrigger style={{ ...inputS, width: "110px" }}><SelectValue /></SelectTrigger>
          <SelectContent>
            {[{ value: "hellotoby", label: "HelloToby" }, { value: "360pro", label: "360Pro" }, { value: "freehunter", label: "FreeHunter" }, { value: "google_ads", label: "Google Ads" }].map((p) => (
              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="px-2 py-2">
        <Select value={String(row.year)} onValueChange={(v) => onChange({ ...row, year: parseInt(v) })}>
          <SelectTrigger style={{ ...inputS, width: "80px" }}><SelectValue /></SelectTrigger>
          <SelectContent>{years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
        </Select>
      </td>
      <td className="px-2 py-2">
        <Select value={String(row.month)} onValueChange={(v) => onChange({ ...row, month: parseInt(v) })}>
          <SelectTrigger style={{ ...inputS, width: "70px" }}><SelectValue /></SelectTrigger>
          <SelectContent>{Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <SelectItem key={m} value={String(m)}>{m}月</SelectItem>)}</SelectContent>
        </Select>
      </td>
      <td className="px-2 py-2"><Input type="number" value={row.amount} onChange={(e) => onChange({ ...row, amount: parseFloat(e.target.value) || 0 })} style={{ ...inputS, width: "100px" }} /></td>
      <td className="px-2 py-2"><Input value={row.impressions} onChange={(e) => onChange({ ...row, impressions: e.target.value })} placeholder="選填" style={{ ...inputS, width: "80px" }} /></td>
      <td className="px-2 py-2"><Input value={row.clicks} onChange={(e) => onChange({ ...row, clicks: e.target.value })} placeholder="選填" style={{ ...inputS, width: "80px" }} /></td>
      <td className="px-2 py-2"><Input value={row.conversions} onChange={(e) => onChange({ ...row, conversions: e.target.value })} placeholder="選填" style={{ ...inputS, width: "70px" }} /></td>
      <td className="px-2 py-2"><Input value={row.notes} onChange={(e) => onChange({ ...row, notes: e.target.value })} placeholder="備註" style={{ ...inputS, width: "100px" }} /></td>
      <td className="px-2 py-2">
        <div className="flex gap-1">
          <button onClick={onSave} disabled={isSaving} className="p-1.5 rounded hover:bg-green-500/20 transition-colors disabled:opacity-50">
            <Check className="h-3.5 w-3.5 text-green-400" />
          </button>
          <button onClick={onCancel} className="p-1.5 rounded hover:bg-white/10 transition-colors">
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      </td>
    </tr>
  );
}
