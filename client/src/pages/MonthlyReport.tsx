import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useState, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { Download, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ALL_PLATFORMS as PLATFORMS } from "@/lib/platformConstants";



const MONTHS = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `${i + 1}月` }));

export default function MonthlyReport() {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);

  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);

  const { data: summary } = trpc.adExpenses.summary.useQuery({ year: selectedYear });
  const { data: quoteStats } = trpc.dashboard.stats.useQuery();

  // Current month data
  const monthData = useMemo(() => {
    if (!summary) return [];
    return summary.filter((r) => r.month === selectedMonth);
  }, [summary, selectedMonth]);

  // Previous month data for comparison
  const prevMonth = selectedMonth === 1 ? 12 : selectedMonth - 1;
  const prevYear = selectedMonth === 1 ? selectedYear - 1 : selectedYear;
  const { data: prevSummary } = trpc.adExpenses.summary.useQuery({ year: prevYear });

  // Monthly platform quote stats (leads + accepted per platform)
  const { data: platformQuotes } = trpc.adExpenses.monthlyPlatformQuotes.useQuery(
    { year: selectedYear, month: selectedMonth }
  );

  const prevMonthData = useMemo(() => {
    if (!prevSummary) return [];
    return prevSummary.filter((r) => r.month === prevMonth);
  }, [prevSummary, prevMonth]);

  const currentTotal = monthData.reduce((s, r) => s + Number(r.amount), 0);
  const prevTotal = prevMonthData.reduce((s, r) => s + Number(r.amount), 0);
  const changePercent = prevTotal > 0 ? ((currentTotal - prevTotal) / prevTotal) * 100 : 0;

  // Pie chart data
  const pieData = PLATFORMS.map((p) => {
    const amount = monthData.find((r) => r.platform === p.value);
    return { name: p.label, value: Number(amount?.amount ?? 0), color: p.color };
  }).filter((d) => d.value > 0);

  // Year trend
  const yearTrend = useMemo(() => {
    if (!summary) return [];
    const monthMap: Record<number, { monthLabel: string; total: number }> = {};
    for (const row of summary) {
      const m = row.month;
      if (!monthMap[m]) monthMap[m] = { monthLabel: `${m}月`, total: 0 };
      monthMap[m].total += Number(row.amount);
    }
    return Object.values(monthMap).sort((a, b) => {
      const ma = parseInt(a.monthLabel);
      const mb = parseInt(b.monthLabel);
      return ma - mb;
    });
  }, [summary]);

  const TrendIcon = changePercent > 5 ? TrendingUp : changePercent < -5 ? TrendingDown : Minus;
  const trendColor = changePercent > 5 ? "#e53935" : changePercent < -5 ? "#4caf50" : "#888";

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <div style={{ fontSize: "0.6rem", letterSpacing: "0.2em", color: "#d4a843", textTransform: "uppercase", marginBottom: "6px" }}>
              Monthly Report
            </div>
            <h1 className="text-2xl font-light">月度廣告報表</h1>
          </div>
          <button
            className="flex items-center gap-2 px-4 py-2 text-xs rounded transition-all hover:opacity-70"
            style={{ border: "1px solid rgba(212,168,67,0.3)", color: "#d4a843", letterSpacing: "0.1em" }}
            onClick={() => window.print()}
          >
            <Download className="h-3.5 w-3.5" />
            匯出報表
          </button>
        </div>

        <div style={{ height: "1px", background: "linear-gradient(to right, #d4a843, rgba(212,168,67,0.1), transparent)" }} />

        {/* Month Selector */}
        <div className="flex gap-3">
          <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(parseInt(v))}>
            <SelectTrigger className="w-[120px]" style={{ background: "#111", border: "1px solid rgba(212,168,67,0.2)" }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => <SelectItem key={y} value={String(y)}>{y} 年</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(parseInt(v))}>
            <SelectTrigger className="w-[110px]" style={{ background: "#111", border: "1px solid rgba(212,168,67,0.2)" }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m) => <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-5 rounded" style={{ background: "linear-gradient(135deg, rgba(212,168,67,0.08) 0%, rgba(0,0,0,0) 60%)", border: "1px solid rgba(212,168,67,0.2)" }}>
            <div style={{ fontSize: "0.6rem", letterSpacing: "0.15em", color: "#888", textTransform: "uppercase", marginBottom: "8px" }}>
              本月廣告總支出
            </div>
            <div className="text-2xl font-light" style={{ color: "#d4a843" }}>
              HKD {currentTotal.toLocaleString()}
            </div>
            <div className="flex items-center gap-1 mt-2">
              <TrendIcon className="h-3.5 w-3.5" style={{ color: trendColor }} />
              <span className="text-xs" style={{ color: trendColor }}>
                {Math.abs(changePercent).toFixed(1)}% 較上月{changePercent >= 0 ? "增加" : "減少"}
              </span>
            </div>
          </div>

          <div className="p-5 rounded" style={{ background: "#0f0f0f", border: "1px solid rgba(212,168,67,0.12)" }}>
            <div style={{ fontSize: "0.6rem", letterSpacing: "0.15em", color: "#888", textTransform: "uppercase", marginBottom: "8px" }}>
              上月廣告支出
            </div>
            <div className="text-2xl font-light">HKD {prevTotal.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground mt-2">{prevYear} 年 {prevMonth} 月</div>
          </div>

          <div className="p-5 rounded" style={{ background: "#0f0f0f", border: "1px solid rgba(212,168,67,0.12)" }}>
            <div style={{ fontSize: "0.6rem", letterSpacing: "0.15em", color: "#888", textTransform: "uppercase", marginBottom: "8px" }}>
              {selectedYear} 年廣告總支出
            </div>
            <div className="text-2xl font-light">
              HKD {(summary?.reduce((s, r) => s + Number(r.amount), 0) ?? 0).toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground mt-2">全年累計</div>
          </div>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Platform Breakdown */}
          <div className="rounded p-6" style={{ background: "#0f0f0f", border: "1px solid rgba(212,168,67,0.15)" }}>
            <div style={{ fontSize: "0.6rem", letterSpacing: "0.2em", color: "#d4a843", textTransform: "uppercase", marginBottom: "4px" }}>
              Platform Breakdown
            </div>
            <h3 className="text-sm font-light mb-4">{selectedMonth}月 各平台開支佔比</h3>
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                    {pieData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "#111", border: "1px solid rgba(212,168,67,0.3)", borderRadius: "4px", fontSize: "12px" }}
                    formatter={(value: number) => [`HKD ${value.toLocaleString()}`, ""]}
                  />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">本月尚無廣告開支資料</div>
            )}
          </div>

          {/* Year Trend */}
          <div className="rounded p-6" style={{ background: "#0f0f0f", border: "1px solid rgba(212,168,67,0.15)" }}>
            <div style={{ fontSize: "0.6rem", letterSpacing: "0.2em", color: "#d4a843", textTransform: "uppercase", marginBottom: "4px" }}>
              Annual Trend
            </div>
            <h3 className="text-sm font-light mb-4">{selectedYear} 年月度廣告支出趨勢</h3>
            {yearTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={yearTrend} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <XAxis dataKey="monthLabel" tick={{ fill: "#666", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#666", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: "#111", border: "1px solid rgba(212,168,67,0.3)", borderRadius: "4px", fontSize: "12px" }}
                    labelStyle={{ color: "#d4a843" }}
                    formatter={(value: number) => [`HKD ${value.toLocaleString()}`, "總支出"]}
                  />
                  <Bar dataKey="total" fill="#d4a843" radius={[2, 2, 0, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">尚無資料</div>
            )}
          </div>
        </div>

        {/* Platform Detail Table */}
        <div className="rounded overflow-hidden overflow-x-auto" style={{ border: "1px solid rgba(212,168,67,0.15)" }}>
          <div className="px-6 py-4" style={{ background: "#0f0f0f", borderBottom: "1px solid rgba(212,168,67,0.15)" }}>
            <div style={{ fontSize: "0.6rem", letterSpacing: "0.2em", color: "#d4a843", textTransform: "uppercase" }}>
              Platform Detail — {selectedYear} 年 {selectedMonth} 月
            </div>
          </div>
          <table className="w-full">
            <thead>
              <tr style={{ background: "#0a0a0a", borderBottom: "1px solid rgba(212,168,67,0.1)" }}>
                {["平台", "廣告支出", "佔比", "較上月", "詢價數", "已接受", "成交率", "曝光次數", "CPC"].map((h) => (
                  <th key={h} className="text-left px-4 py-3" style={{ fontSize: "0.6rem", letterSpacing: "0.12em", color: "#d4a843", textTransform: "uppercase", fontWeight: 500 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PLATFORMS.map((platform) => {
                const curr = monthData.find((r) => r.platform === platform.value);
                const prev = prevMonthData.find((r) => r.platform === platform.value);
                const currAmt = Number(curr?.amount ?? 0);
                const prevAmt = Number(prev?.amount ?? 0);
                const pct = currentTotal > 0 ? ((currAmt / currentTotal) * 100).toFixed(1) : "0";
                const change = prevAmt > 0 ? ((currAmt - prevAmt) / prevAmt) * 100 : null;
                const clicks = curr?.clicks ?? 0;
                const cpc = clicks > 0 ? (currAmt / Number(clicks)).toFixed(1) : "—";
                const pq = platformQuotes?.find((q) => q.platform === platform.value);
                const leads = pq?.leads ?? 0;
                const accepted = pq?.accepted ?? 0;
                // 廣告平台始終顯示；非廣告平台只在有詢價或成交記錄時顯示
                if (!platform.hasAd && leads === 0 && accepted === 0) return null;

                return (
                  <tr
                    key={platform.value}
                    style={{ background: "transparent", borderBottom: "1px solid rgba(255,255,255,0.04)" }}
                  >
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium" style={{ color: platform.color }}>{platform.label}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium" style={{ color: currAmt > 0 ? "#d4a843" : "#555" }}>
                        HKD {currAmt.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.1)" }}>
                          <div className="h-1 rounded-full" style={{ width: `${pct}%`, background: platform.color }} />
                        </div>
                        <span className="text-xs text-muted-foreground">{pct}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {change !== null ? (
                        <span className="text-xs" style={{ color: change >= 0 ? "#e57373" : "#81c784" }}>
                          {change >= 0 ? "+" : ""}{change.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    {(() => {
                      const convRate = leads > 0 ? ((accepted / leads) * 100).toFixed(0) + "%" : "—";
                      return (
                        <>
                          <td className="px-4 py-3 text-xs" style={{ color: leads > 0 ? "#aaa" : "#555" }}>{leads > 0 ? leads : "—"}</td>
                          <td className="px-4 py-3 text-xs font-medium" style={{ color: accepted > 0 ? "#81c784" : "#555" }}>{accepted > 0 ? accepted : "—"}</td>
                          <td className="px-4 py-3 text-xs" style={{ color: leads > 0 ? "#aaa" : "#555" }}>{convRate}</td>
                        </>
                      );
                    })()}
                    <td className="px-4 py-3 text-xs text-muted-foreground">{curr?.impressions ? Number(curr.impressions).toLocaleString() : "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{cpc !== "—" ? `HKD ${cpc}` : "—"}</td>
                  </tr>
                );
              })}
              {/* Total Row */}
              <tr style={{ borderTop: "1px solid rgba(212,168,67,0.2)", background: "rgba(212,168,67,0.05)" }}>
                <td className="px-4 py-3 text-sm font-medium" style={{ color: "#d4a843" }}>合計</td>
                <td className="px-4 py-3 text-sm font-medium" style={{ color: "#d4a843" }}>HKD {currentTotal.toLocaleString()}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">100%</td>
                <td className="px-4 py-3">
                  <span className="text-xs" style={{ color: trendColor }}>
                    {changePercent >= 0 ? "+" : ""}{changePercent.toFixed(1)}%
                  </span>
                </td>
                <td colSpan={5} />
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  );
}
