import DashboardLayout from "@/components/DashboardLayout";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from "recharts";
import { SERVICE_LABELS } from "@/lib/serviceLabels";

const PIE_COLORS = ["#FFB800", "#00D4AA", "#FF6B6B", "#7B8CFF", "#FF9F43", "#EE5A24", "#0652DD", "#A3CB38"];

const MONTHS = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
const YEARS = [2026, 2025, 2024, 2023];

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { user, loading: authLoading } = useAuth();
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);

  // Fast initial load: fetch KPI cards first (only when authenticated)
  const { data: quickData, isLoading: quickLoading } = trpc.dashboard.quick.useQuery(
    { year: selectedYear, month: selectedMonth },
    { refetchOnWindowFocus: false, enabled: !authLoading && !!user }
  );
  
  // Detailed stats load in background
  const { data: dashData } = trpc.dashboard.all.useQuery(
    { year: selectedYear, month: selectedMonth },
    { refetchOnWindowFocus: false, enabled: !authLoading && !!user && !quickLoading }
  );
  
  const isLoading = quickLoading;

  const stats = dashData?.stats;
  const fhStats = dashData?.fhStats;
  const waStats = dashData?.waStats;
  const pendingInquiries = dashData?.pendingCount ?? 0;

  const trendData = stats?.trendData ?? [];
  const sourceData = useMemo(() => {
    if (!stats?.sourceDistribution?.length) return [];
    return stats.sourceDistribution.map((d) => ({
      name: SERVICE_LABELS[d.name] ?? d.name,
      value: d.value,
    }));
  }, [stats]);

  const fmt = (n: number) => `HK$${n.toLocaleString()}`;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">業務儀表板</h1>
            <p className="text-sm text-muted-foreground mt-1">JD Studio 業務數據總覽</p>
          </div>
          {/* Year / Month selectors */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="appearance-none text-sm px-4 py-2 pr-8 rounded-md cursor-pointer"
                style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.12)", color: "#e8e0d0" }}
              >
                {YEARS.map((y) => (
                  <option key={y} value={y}>{y}年</option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">▾</span>
            </div>
            <div className="relative">
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="appearance-none text-sm px-4 py-2 pr-8 rounded-md cursor-pointer"
                style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.12)", color: "#e8e0d0" }}
              >
                {MONTHS.map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">▾</span>
            </div>
          </div>
        </div>

        {/* Pending alerts */}
        {pendingInquiries > 0 && (
          <button
            onClick={() => setLocation("/email-inquiries")}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-opacity hover:opacity-80"
            style={{ background: "rgba(212,168,67,0.08)", border: "1px solid rgba(212,168,67,0.25)" }}
          >
            <span className="flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold" style={{ background: "#d4a843", color: "#000" }}>
              {pendingInquiries}
            </span>
            <span className="text-sm" style={{ color: "#d4a843" }}>
              有 {pendingInquiries} 封詢價郵件待處理 — 點擊前往查看
            </span>
            <span className="ml-auto text-xs text-muted-foreground">→</span>
          </button>
        )}

        {/* Top KPI Cards — 5 columns */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <KpiCard
            label="本月收入"
            value={isLoading ? "—" : fmt(quickData?.monthlyRevenue ?? stats?.monthlyRevenue ?? 0)}
            sub={`${stats?.acceptedQuotes ?? 0} 張成交`}
            valueColor="#4caf50"
            icon="$"
          />
          <KpiCard
            label="毛利"
            value={isLoading ? "—" : fmt((stats?.monthlyRevenue ?? 0) - (stats?.adSpend ?? 0))}
            sub={stats?.monthlyRevenue ? `廣告後毛利` : "—"}
            valueColor={((stats?.monthlyRevenue ?? 0) - (stats?.adSpend ?? 0)) >= 0 ? "#6fcf6f" : "#e57373"}
            icon="▲"
          />
          <KpiCard
            label="廣告開支"
            value={isLoading ? "—" : fmt(quickData?.adSpend ?? stats?.adSpend ?? 0)}
            sub={stats?.adSpendPlatforms?.length ? stats.adSpendPlatforms.join(" + ") : "本月未有廣告開支"}
            valueColor="#ff9800"
            icon="↗"
          />
          <KpiCard
            label="營運支出"
            value={isLoading ? "—" : fmt(quickData?.businessExpenses ?? stats?.businessExpenses ?? 0)}
            sub="車費 + 器材 + 員工"
            valueColor="#e57373"
            icon="≡"
          />
          <KpiCard
            label="淨利潤"
            value={isLoading ? "—" : fmt(quickData?.netProfit ?? stats?.netProfit ?? 0)}
            sub="收入 - 廣告 - 支出"
            valueColor={(stats?.netProfit ?? 0) >= 0 ? "#4caf50" : "#e57373"}
            icon="▦"
          />
        </div>

        {/* Middle Stats Cards — 6 columns */}
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          <StatCard
            label="總詢價數"
            value={isLoading ? "—" : `${stats?.totalQuotes ?? 0}份`}
            sub="本月開單"
            valueColor="#00D4AA"
          />
          <StatCard
            label="已成交"
            value={isLoading ? "—" : `${stats?.acceptedQuotes ?? 0}份`}
            sub="本月拍攝／成交歸屬"
            valueColor="#4caf50"
          />
          <StatCard
            label="成交率"
            value={isLoading ? "—" : `${stats?.conversionRate ?? 0}%`}
            sub="本月開單中已接受"
            valueColor="#ba68c8"
          />
          <StatCard
            label="廣告 ROAS"
            value={isLoading ? "—" : (stats?.roas != null ? `${stats.roas}x` : "—")}
            valueColor="#d4a843"
          />
          <StatCard
            label="已拒絕"
            value={isLoading ? "—" : `${stats?.rejectedQuotes ?? 0}份`}
            sub={stats?.rejectedQuotes ? `佔總報價 ${(stats?.totalQuotes ?? 0) > 0 ? Math.round(((stats?.rejectedQuotes ?? 0) / (stats?.totalQuotes ?? 1)) * 100) : 0}%` : "本月未有拒絕"}
            valueColor="#e57373"
          />
          <StatCard
            label="WhatsApp 轉化率"
            value={waStats != null ? `${waStats.conversionRate}%` : "—"}
            sub={
              waStats
                ? `${selectedMonth}月：${waStats.fhClicks ?? waStats.totalClicks} 次 FH 點擊 / ${waStats.emailsSent} 封第一封`
                : `${selectedMonth}月`
            }
            valueColor="#25D366"
          />
        </div>

        {/* FH Work Board Stats */}
        {fhStats && (
          <div
            className="rounded-lg p-4"
            style={{ background: "#111", border: "1px solid rgba(255,107,107,0.2)" }}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium" style={{ color: "#e8e0d0" }}>
                FreelanceHunter 工作板
              </h3>
              <button
                onClick={() => setLocation("/freehunter-board")}
                className="text-xs hover:opacity-70 transition-opacity"
                style={{ color: "#FF6B6B" }}
              >
                查看全部 →
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "已取得電郵", value: fhStats.emailFetched, color: "#00D4AA" },
                { label: "已發第一封郵件", value: fhStats.firstEmailSent ?? 0, color: "#FFB800" },
                { label: "已發第二封郵件", value: fhStats.followUpSent ?? 0, color: "#7B8CFF" },
                { label: "已匯入詢價", value: fhStats.imported, color: "#FF6B6B" },
              ].map((s) => (
                <div key={s.label} className="text-center">
                  <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Bottom Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Revenue + Ad Spend Dual-Line Trend Chart */}
          <div
            className="rounded-lg p-5"
            style={{ background: "#111", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <h3 className="text-sm font-medium mb-4" style={{ color: "#e8e0d0" }}>
              收入 vs 廣告開支（近 6 個月）
            </h3>
            {trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={trendData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "#666", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "#666", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    contentStyle={{ background: "#1a1a1a", border: "1px solid rgba(212,168,67,0.3)", borderRadius: "6px", fontSize: "12px" }}
                    labelStyle={{ color: "#d4a843" }}
                    formatter={(value: number, name: string) => [
                      `HK$${value.toLocaleString()}`,
                      name === "revenue" ? "收入" : "廣告開支",
                    ]}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: "11px" }}
                    formatter={(value) => value === "revenue" ? "收入" : "廣告開支"}
                  />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="#d4a843"
                    strokeWidth={2}
                    dot={{ fill: "#d4a843", r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="adSpend"
                    stroke="#FF6B6B"
                    strokeWidth={2}
                    strokeDasharray="4 2"
                    dot={{ fill: "#FF6B6B", r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="尚無收入數據" />
            )}
          </div>

          {/* Source Distribution Pie Chart */}
          <div
            className="rounded-lg p-5"
            style={{ background: "#111", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <h3 className="text-sm font-medium mb-4" style={{ color: "#e8e0d0" }}>
              詢價來源分佈
            </h3>
            {sourceData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={sourceData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${Math.round(percent * 100)}%`}
                    labelLine={false}
                  >
                    {sourceData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "#1a1a1a", border: "1px solid rgba(212,168,67,0.3)", borderRadius: "6px", fontSize: "12px" }}
                    formatter={(value: number, name: string) => [`${value} 份`, name]}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyPie />
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

function KpiCard({
  label,
  value,
  sub,
  valueColor,
  icon,
}: {
  label: string;
  value: string;
  sub: string;
  valueColor: string;
  icon: string;
}) {
  return (
    <div
      className="rounded-lg p-4"
      style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span
          className="flex items-center justify-center text-xs w-7 h-7 rounded-full"
          style={{ background: "rgba(255,255,255,0.06)", color: "#888" }}
        >
          {icon}
        </span>
      </div>
      <div className="text-xl font-bold mb-1" style={{ color: valueColor }}>{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function StatCard({
  label,
  value,
  valueColor,
  sub,
}: {
  label: string;
  value: string;
  valueColor: string;
  sub?: string;
}) {
  return (
    <div
      className="rounded-lg p-5 flex flex-col items-center justify-center text-center"
      style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.08)", minHeight: "100px" }}
    >
      <div className="text-xs text-muted-foreground mb-2">{label}</div>
      <div className="text-3xl font-bold" style={{ color: valueColor }}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1.5" style={{ fontSize: "0.65rem" }}>{sub}</div>}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">
      {message}
    </div>
  );
}

function EmptyPie() {
  return (
    <div className="h-[220px] flex flex-col items-center justify-center">
      <div
        className="rounded-full flex items-center justify-center"
        style={{ width: 120, height: 120, border: "8px solid rgba(212,168,67,0.3)" }}
      >
        <span className="text-xs text-muted-foreground">暫無數據</span>
      </div>
    </div>
  );
}
