import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Streamdown } from "streamdown";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend,
  BarChart, Bar, Cell
} from "recharts";
import DashboardLayout from "@/components/DashboardLayout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SERVICE_LABELS } from "@/lib/serviceLabels";
import { TrendingUp, TrendingDown, Minus, Award, AlertTriangle, Info, Sparkles, RefreshCw } from "lucide-react";
import { ALL_PLATFORMS as PLATFORMS } from "@/lib/platformConstants";



const GRADE_COLORS: Record<string, string> = {
  S: "#d4a843",
  A: "#4ade80",
  B: "#60a5fa",
  C: "#f59e0b",
  D: "#f87171",
};

const GRADE_LABELS: Record<string, string> = {
  S: "卓越",
  A: "優秀",
  B: "良好",
  C: "一般",
  D: "待改善",
};

function MetricCard({
  label,
  value,
  sub,
  color,
  tooltip,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  tooltip?: string;
}) {
  return (
    <div
      className="p-4 rounded"
      style={{ background: "#0f0f0f", border: "1px solid rgba(212,168,67,0.12)" }}
      title={tooltip}
    >
      <div style={{ fontSize: "0.58rem", letterSpacing: "0.15em", color: "#888", textTransform: "uppercase", marginBottom: "6px" }}>
        {label}
      </div>
      <div className="text-xl font-light" style={{ color: color ?? "#e8e0d0" }}>
        {value}
      </div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function GradeBadge({ grade }: { grade: string }) {
  return (
    <span
      className="inline-flex items-center justify-center w-8 h-8 rounded text-sm font-bold"
      style={{ background: `${GRADE_COLORS[grade]}20`, color: GRADE_COLORS[grade], border: `1px solid ${GRADE_COLORS[grade]}40` }}
    >
      {grade}
    </span>
  );
}

function ScoreBar({ score, color }: { score: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
        <div
          className="h-1.5 rounded-full transition-all"
          style={{ width: `${score}%`, background: color }}
        />
      </div>
      <span className="text-xs tabular-nums" style={{ color, minWidth: "28px" }}>{score}</span>
    </div>
  );
}

export default function PlatformEfficiency() {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);

  const currentMonth = new Date().getMonth() + 1;
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [aiResult, setAiResult] = useState<{ analysis: string; generatedAt: string; id?: number } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedHistoryId, setSelectedHistoryId] = useState<number | null>(null);

  const { data, isLoading } = trpc.adExpenses.platformEfficiency.useQuery({ year: selectedYear });
  const { data: profitData } = trpc.adExpenses.serviceTypeProfitability.useQuery({ year: selectedYear });
  const { data: latestAnalysis } = trpc.adExpenses.getLatestAiAnalysis.useQuery(
    { year: selectedYear, month: selectedMonth },
    { refetchOnWindowFocus: false }
  );
  const { data: historyList, refetch: refetchHistory } = trpc.adExpenses.getAiAnalysisHistory.useQuery(
    { year: selectedYear, month: selectedMonth, limit: 10 },
    { enabled: showHistory, refetchOnWindowFocus: false }
  );
  const aiMutation = trpc.adExpenses.aiAnalysis.useMutation({
    onSuccess: (res) => {
      setAiResult({ analysis: String(res.analysis ?? ""), generatedAt: res.generatedAt });
      refetchHistory();
    },
  });

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
          分析中...
        </div>
      </DashboardLayout>
    );
  }

  if (!data) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
          無法載入數據
        </div>
      </DashboardLayout>
    );
  }

  const activeStats = data.platformStats.filter(p => p.spend > 0 || p.totalLeads > 0);
  const unclassifiedLeads: number = (data as any).unclassifiedLeads ?? 0;
  const bestP = data.platformStats.find(p => p.platform === data.bestPlatform);
  const worstP = data.platformStats.find(p => p.platform === data.worstPlatform);

  // Radar chart data (normalize to 0-100)
  const radarData = [
    { metric: "ROAS", fullMark: 100 },
    { metric: "成交率", fullMark: 100 },
    { metric: "CPL效率", fullMark: 100 },
    { metric: "詢價量", fullMark: 100 },
    { metric: "退款率", fullMark: 100 },
  ].map(({ metric, fullMark }) => {
    const entry: Record<string, number | string> = { metric, fullMark };
    for (const p of activeStats) {
      const maxROAS = Math.max(...activeStats.map(x => x.roas ?? 0), 5);
      const maxLeads = Math.max(...activeStats.map(x => x.totalLeads), 1);
      const maxCPL = Math.max(...activeStats.filter(x => x.cpl !== null).map(x => x.cpl!), 200);
      if (metric === "ROAS") entry[p.platform] = p.roas !== null ? Math.min((p.roas / maxROAS) * 100, 100) : 0;
      else if (metric === "成交率") entry[p.platform] = Math.min(p.conversionRate * 3.33, 100);
      else if (metric === "CPL效率") entry[p.platform] = p.cpl !== null ? Math.max(0, 100 - (p.cpl / maxCPL) * 100) : 50;
      else if (metric === "詢價量") entry[p.platform] = Math.min((p.totalLeads / maxLeads) * 100, 100);
      else if (metric === "退款率") entry[p.platform] = Math.max(0, 100 - p.refundRate * 2);
    }
    return entry;
  });

  const tooltipStyle = {
    contentStyle: { background: "#111", border: "1px solid rgba(212,168,67,0.3)", borderRadius: "4px", fontSize: "12px" },
    labelStyle: { color: "#d4a843" },
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div style={{ fontSize: "0.6rem", letterSpacing: "0.2em", color: "#d4a843", textTransform: "uppercase", marginBottom: "6px" }}>
              Platform Efficiency Analysis
            </div>
            <h1 className="text-2xl font-light">平台效益分析</h1>
            <p className="text-xs text-muted-foreground mt-1">綜合評估各廣告平台的投資回報、詢價質量與成本效益</p>
          </div>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(parseInt(e.target.value))}
            className="text-sm px-3 py-1.5 rounded"
            style={{ background: "#111", border: "1px solid rgba(212,168,67,0.2)", color: "#e8e0d0" }}
          >
            {years.map(y => <option key={y} value={y}>{y} 年</option>)}
          </select>
        </div>

        <div style={{ height: "1px", background: "linear-gradient(to right, #d4a843, rgba(212,168,67,0.1), transparent)" }} />

        {/* Overview KPI */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <MetricCard
            label="總廣告開支"
            value={`HK$${data.totalSpend.toLocaleString()}`}
            sub={`淨開支 HK$${data.totalNetSpend.toLocaleString()}`}
            color="#d4a843"
            tooltip="全年所有平台廣告開支總和"
          />
          <MetricCard
            label="總詢價數"
            value={`${data.totalLeads} 份`}
            sub="來自所有平台"
            color="#60a5fa"
            tooltip="全年所有平台帶來的詢價總數"
          />
          <MetricCard
            label="總成交數"
            value={`${data.totalConversions} 份`}
            sub={`成交率 ${data.totalLeads > 0 ? ((data.totalConversions / data.totalLeads) * 100).toFixed(1) : 0}%`}
            color="#4ade80"
            tooltip="全年已接受報價數量"
          />
          <MetricCard
            label="總成交收入"
            value={`HK$${data.totalRevenue.toLocaleString()}`}
            sub="已接受報價金額"
            color="#a78bfa"
            tooltip="全年所有平台帶來的成交收入"
          />
          <MetricCard
            label="整體 ROAS"
            value={data.totalNetSpend > 0 ? `${(data.totalRevenue / data.totalNetSpend).toFixed(2)}x` : "—"}
            sub="收入 ÷ 淨廣告開支（業界良好 ≥5x）"
            color={data.totalNetSpend > 0 && data.totalRevenue / data.totalNetSpend >= 5 ? "#4ade80" : data.totalNetSpend > 0 && data.totalRevenue / data.totalNetSpend >= 3 ? "#f59e0b" : "#f87171"}
            tooltip="廣告回報率：衡量廣告效率。服務業 ROAS ≥5 為優秀，≥3 為良好"
          />
        </div>

        {/* Best / Worst Platform Banner */}
        {(bestP || worstP) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {bestP && (
              <div className="flex items-center gap-4 p-4 rounded" style={{ background: "rgba(74,222,128,0.06)", border: "1px solid rgba(74,222,128,0.2)" }}>
                <Award className="h-8 w-8 flex-shrink-0" style={{ color: "#4ade80" }} />
                <div>
                  <div style={{ fontSize: "0.6rem", letterSpacing: "0.15em", color: "#4ade80", textTransform: "uppercase" }}>最佳平台</div>
                  <div className="text-lg font-light mt-0.5">{bestP.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    綜合評分 {bestP.overallScore}/100 · 評級 {GRADE_LABELS[bestP.grade]} ({bestP.grade})
                    {bestP.roas !== null && ` · ROAS ${bestP.roas}x`}
                    {bestP.trueRoi !== null && ` · 真實ROI ${bestP.trueRoi}%`}
                  </div>
                </div>
              </div>
            )}
            {worstP && worstP.platform !== bestP?.platform && (
              <div className="flex items-center gap-4 p-4 rounded" style={{ background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.2)" }}>
                <AlertTriangle className="h-8 w-8 flex-shrink-0" style={{ color: "#f87171" }} />
                <div>
                  <div style={{ fontSize: "0.6rem", letterSpacing: "0.15em", color: "#f87171", textTransform: "uppercase" }}>需要關注</div>
                  <div className="text-lg font-light mt-0.5">{worstP.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    綜合評分 {worstP.overallScore}/100 · 評級 {GRADE_LABELS[worstP.grade]} ({worstP.grade})
                    {worstP.roas !== null && ` · ROAS ${worstP.roas}x`}
                    {worstP.trueRoi !== null && ` · 真實ROI ${worstP.trueRoi}%`}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Main Tabs */}
        <Tabs defaultValue="scorecard">
          <TabsList className="mb-4" style={{ background: "#0f0f0f", border: "1px solid rgba(212,168,67,0.15)" }}>
            <TabsTrigger value="scorecard">評分卡</TabsTrigger>
            <TabsTrigger value="comparison">指標對比</TabsTrigger>
            <TabsTrigger value="trend">月度趨勢</TabsTrigger>
            <TabsTrigger value="radar">雷達圖</TabsTrigger>
            <TabsTrigger value="service">服務盈利</TabsTrigger>
          </TabsList>

          {/* ── Tab 1: 評分卡 ── */}
          <TabsContent value="scorecard">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {data.platformStats.map(p => {
                const platformMeta = PLATFORMS.find(x => x.value === p.platform) ?? { value: p.platform, label: p.label, color: "#9ca3af" };
                return (
                  <div
                    key={p.platform}
                    className="p-5 rounded"
                    style={{ background: "#0f0f0f", border: `1px solid ${platformMeta.color}25` }}
                  >
                    {/* Card Header */}
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <div style={{ fontSize: "0.6rem", letterSpacing: "0.15em", color: platformMeta.color, textTransform: "uppercase" }}>
                          {p.label}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {p.spend > 0 ? `開支 HK$${p.spend.toLocaleString()} · 淨 HK$${p.netSpend.toLocaleString()}` : "尚無開支記錄"}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <GradeBadge grade={p.grade} />
                        <div className="text-right">
                          <div className="text-lg font-light" style={{ color: GRADE_COLORS[p.grade] }}>{p.overallScore}</div>
                          <div style={{ fontSize: "0.55rem", color: "#666", letterSpacing: "0.1em" }}>/ 100</div>
                        </div>
                      </div>
                    </div>

                    {/* Score Bar */}
                    <div className="mb-4">
                      <ScoreBar score={p.overallScore} color={platformMeta.color} />
                    </div>

                    {/* Metrics Grid */}
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <div style={{ fontSize: "0.55rem", color: "#666", letterSpacing: "0.1em", textTransform: "uppercase" }}>ROAS</div>
                        <div className="text-sm font-light mt-0.5" style={{ color: p.roas !== null ? (p.roas >= 5 ? "#4ade80" : p.roas >= 3 ? "#f59e0b" : "#f87171") : "#555" }}>
                          {p.roas !== null ? `${p.roas}x` : "—"}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: "0.55rem", color: "#666", letterSpacing: "0.1em", textTransform: "uppercase" }}>成交率</div>
                        <div className="text-sm font-light mt-0.5" style={{ color: p.conversionRate > 0 ? "#60a5fa" : "#555" }}>
                          {p.conversionRate > 0 ? `${p.conversionRate}%` : "—"}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: "0.55rem", color: "#666", letterSpacing: "0.1em", textTransform: "uppercase" }}>CPL</div>
                        <div className="text-sm font-light mt-0.5" style={{ color: p.cpl !== null ? "#a78bfa" : "#555" }}>
                          {p.cpl !== null ? `HK$${p.cpl}` : "—"}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: "0.55rem", color: "#666", letterSpacing: "0.1em", textTransform: "uppercase" }}>詢價數</div>
                        <div className="text-sm font-light mt-0.5">{p.totalLeads > 0 ? `${p.totalLeads} 份` : "—"}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: "0.55rem", color: "#666", letterSpacing: "0.1em", textTransform: "uppercase" }}>成交數</div>
                        <div className="text-sm font-light mt-0.5" style={{ color: p.conversions > 0 ? "#4ade80" : "#555" }}>
                          {p.conversions > 0 ? `${p.conversions} 份` : "—"}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: "0.55rem", color: "#666", letterSpacing: "0.1em", textTransform: "uppercase" }}>退款率</div>
                        <div className="text-sm font-light mt-0.5" style={{ color: p.refundRate > 10 ? "#f59e0b" : "#555" }}>
                          {p.spend > 0 ? `${p.refundRate}%` : "—"}
                        </div>
                      </div>
                    </div>

                    {/* CPA + 真實ROI + LTV/CAC */}
                    <div className="mt-3 pt-3 space-y-1.5" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                      {p.cpa !== null && (
                        <div className="flex items-center justify-between">
                          <span style={{ fontSize: "0.55rem", color: "#666", letterSpacing: "0.1em", textTransform: "uppercase" }}>每成交廣告成本 (CPA)</span>
                          <span className="text-xs" style={{ color: "#f59e0b" }}>HK${p.cpa}</span>
                        </div>
                      )}
                      {p.trueRoi !== null && (
                        <div className="flex items-center justify-between">
                          <span style={{ fontSize: "0.55rem", color: "#666", letterSpacing: "0.1em", textTransform: "uppercase" }}>真實 ROI（扣除服務成本）</span>
                          <span className="text-xs" style={{ color: p.trueRoi >= 0 ? "#4ade80" : "#f87171" }}>{p.trueRoi}%</span>
                        </div>
                      )}
                      {p.ltvCacRatio !== null && (
                        <div className="flex items-center justify-between">
                          <span style={{ fontSize: "0.55rem", color: "#666", letterSpacing: "0.1em", textTransform: "uppercase" }}>LTV/CAC 比率</span>
                          <span className="text-xs" style={{ color: p.ltvCacRatio >= 3 ? "#4ade80" : p.ltvCacRatio >= 1.5 ? "#f59e0b" : "#f87171" }}>{p.ltvCacRatio}:1</span>
                        </div>
                      )}
                    </div>

                    {/* 數據完整度警告 */}
                    {(p as any).hasAd && p.spend === 0 && p.totalLeads > 0 && (
                      <div className="mt-3 pt-3 flex items-start gap-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                        <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" style={{ color: "#f59e0b" }} />
                        <span style={{ fontSize: "0.65rem", color: "#f59e0b", lineHeight: "1.4" }}>
                          {(p as any).adType === "subscription"
                            ? "尚未輸入訂閱月費，ROI / CPL 無法計算。請在廣告開支頁面輸入 FH 月費。"
                            : "尚未輸入廣告開支，ROI / CPL 無法計算。請在廣告開支頁面輸入數據。"}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Scoring Methodology Note */}
            <div className="mt-4 p-4 rounded flex gap-3" style={{ background: "rgba(212,168,67,0.04)", border: "1px solid rgba(212,168,67,0.1)" }}>
              <Info className="h-4 w-4 flex-shrink-0 mt-0.5" style={{ color: "#d4a843" }} />
              <div className="text-xs text-muted-foreground leading-relaxed">
                <span style={{ color: "#d4a843" }}>評分方法：</span>
                綜合評分由四個維度組成：ROAS（佔 40%，以 ROAS=5 為滿分基準）、成交率（佔 30%，以 30% 為滿分）、CPL 效率（佔 20%，成本越低分越高）、開支趨勢（佔 10%，開支下降代表效率提升）。
                詢價來源以報價單的「詢價來源」欄位精確匹配（HelloToby / PRO360 / FreelanceHunter / Google / Repeat）。回頭客無廣告開支，CPL 效率自動得滿分。
                <span style={{ color: "#888" }}> FreeHunter 為訂閱制月費（非 CPC），請在廣告開支頁面將每月訂閱費輸入為「開支」以計算 ROAS 和 CPL。</span>
                <span style={{ color: "#888" }}> 「ROAS」（廣告回報率）= 成交收入 ÷ 淨廣告開支，衡量廣告效率，服務業基準 ≥5x 優秀。「真實 ROI」= 扣除廣告開支及按收入比例分攤的直接服務成本（車費+器材+人工）後的實際利潤率。「LTV/CAC」= 客戶終身價值 ÷ 獲客成本，業界黃金比率 ≥3:1。</span>
                {unclassifiedLeads > 0 && (
                  <span style={{ color: "#f59e0b" }}>
                    {` 另有 ${unclassifiedLeads} 份報價單尚未設定詢價來源，建議在報價單詳情頁設定「詢價來源」欄位。`}
                  </span>
                )}
              </div>
            </div>
          </TabsContent>

          {/* ── Tab 2: 指標對比 ── */}
          <TabsContent value="comparison">
            <div className="space-y-6">
              {/* Bar Chart: Net Spend vs Revenue */}
              <div className="rounded p-6" style={{ background: "#0f0f0f", border: "1px solid rgba(212,168,67,0.15)" }}>
                <div style={{ fontSize: "0.6rem", letterSpacing: "0.2em", color: "#d4a843", textTransform: "uppercase", marginBottom: "4px" }}>
                  Spend vs Revenue
                </div>
                <h3 className="text-sm font-light mb-4">各平台淨開支 vs 成交收入</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.platformStats} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
                    <XAxis dataKey="label" tick={{ fill: "#666", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "#666", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip {...tooltipStyle} formatter={(v: number) => [`HK$${v.toLocaleString()}`, ""]} />
                    <Legend wrapperStyle={{ fontSize: "11px" }} />
                    <Bar dataKey="netSpend" name="淨開支" fill="#d4a843" radius={[2, 2, 0, 0]} maxBarSize={32} />
                    <Bar dataKey="revenue" name="成交收入" fill="#4ade80" radius={[2, 2, 0, 0]} maxBarSize={32} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Comparison Table */}
              <div className="rounded overflow-hidden" style={{ border: "1px solid rgba(212,168,67,0.15)" }}>
                <table className="w-full">
                  <thead>
                    <tr style={{ background: "#0f0f0f", borderBottom: "1px solid rgba(212,168,67,0.2)" }}>
                      {["平台", "評級", "廣告開支", "退款", "淨開支", "詢價數", "成交數", "成交率", "CPL", "CPA", "ROAS", "真實ROI", "LTV/CAC"].map(h => (
                        <th key={h} className="text-left px-4 py-3" style={{ fontSize: "0.58rem", letterSpacing: "0.1em", color: "#d4a843", textTransform: "uppercase", fontWeight: 500 }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.platformStats.map((p, idx) => {
                      const meta = PLATFORMS.find(x => x.value === p.platform) ?? { value: p.platform, label: p.label, color: "#9ca3af" };
                      return (
                        <tr key={p.platform} style={{ background: idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                          <td className="px-4 py-3">
                            <span className="text-xs font-medium" style={{ color: meta.color }}>{p.label}</span>
                          </td>
                          <td className="px-4 py-3"><GradeBadge grade={p.grade} /></td>
                          <td className="px-4 py-3 text-sm" style={{ color: "#d4a843" }}>{p.spend > 0 ? `HK$${p.spend.toLocaleString()}` : "—"}</td>
                          <td className="px-4 py-3 text-sm" style={{ color: "#4ade80" }}>{p.refund > 0 ? `HK$${p.refund.toLocaleString()}` : "—"}</td>
                          <td className="px-4 py-3 text-sm">{p.netSpend > 0 ? `HK$${p.netSpend.toLocaleString()}` : "—"}</td>
                          <td className="px-4 py-3 text-sm">{p.totalLeads > 0 ? p.totalLeads : "—"}</td>
                          <td className="px-4 py-3 text-sm" style={{ color: p.conversions > 0 ? "#4ade80" : undefined }}>{p.conversions > 0 ? p.conversions : "—"}</td>
                          <td className="px-4 py-3 text-sm" style={{ color: p.conversionRate > 0 ? "#60a5fa" : undefined }}>{p.conversionRate > 0 ? `${p.conversionRate}%` : "—"}</td>
                          <td className="px-4 py-3 text-sm" style={{ color: p.cpl !== null ? "#a78bfa" : undefined }}>{p.cpl !== null ? `HK$${p.cpl}` : "—"}</td>
                          <td className="px-4 py-3 text-sm" style={{ color: p.cpa !== null ? "#f59e0b" : undefined }}>{p.cpa !== null ? `HK$${p.cpa}` : "—"}</td>
                          <td className="px-4 py-3 text-sm" style={{ color: p.roas !== null ? (p.roas >= 5 ? "#4ade80" : p.roas >= 3 ? "#f59e0b" : "#f87171") : undefined }}>
                            {p.roas !== null ? `${p.roas}x` : "—"}
                          </td>
                          <td className="px-4 py-3 text-sm" style={{ color: p.trueRoi !== null ? (p.trueRoi >= 0 ? "#4ade80" : "#f87171") : undefined }}>
                            {p.trueRoi !== null ? `${p.trueRoi}%` : "—"}
                          </td>
                          <td className="px-4 py-3 text-sm" style={{ color: p.ltvCacRatio !== null ? (p.ltvCacRatio >= 3 ? "#4ade80" : p.ltvCacRatio >= 1.5 ? "#f59e0b" : "#f87171") : undefined }}>
                            {p.ltvCacRatio !== null ? `${p.ltvCacRatio}:1` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          {/* ── Tab 3: 月度趨勢 ── */}
          <TabsContent value="trend">
            <div className="rounded p-6" style={{ background: "#0f0f0f", border: "1px solid rgba(212,168,67,0.15)" }}>
              <div style={{ fontSize: "0.6rem", letterSpacing: "0.2em", color: "#d4a843", textTransform: "uppercase", marginBottom: "4px" }}>
                Monthly Net Spend Trend
              </div>
              <h3 className="text-sm font-light mb-4">{selectedYear} 年各平台月度淨開支趨勢</h3>
              {data.trendByMonth.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={data.trendByMonth} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
                    <XAxis dataKey="label" tick={{ fill: "#666", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "#666", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip {...tooltipStyle} formatter={(v: number) => [`HK$${v.toLocaleString()}`, ""]} />
                    <Legend wrapperStyle={{ fontSize: "11px" }} />
                    {PLATFORMS.filter(p => ["hellotoby","360pro","freehunter","google_ads"].includes(p.value)).map(p => (
                      <Line
                        key={p.value}
                        type="monotone"
                        dataKey={p.value}
                        name={p.label}
                        stroke={p.color}
                        strokeWidth={1.5}
                        dot={{ r: 3, fill: p.color }}
                        connectNulls={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">
                  尚無月度數據
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── Tab 4: 雷達圖 ── */}
          <TabsContent value="radar">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded p-6" style={{ background: "#0f0f0f", border: "1px solid rgba(212,168,67,0.15)" }}>
                <div style={{ fontSize: "0.6rem", letterSpacing: "0.2em", color: "#d4a843", textTransform: "uppercase", marginBottom: "4px" }}>
                  Multi-Dimension Radar
                </div>
                <h3 className="text-sm font-light mb-4">各平台多維度對比</h3>
                {activeStats.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <RadarChart data={radarData}>
                      <PolarGrid stroke="rgba(255,255,255,0.08)" />
                      <PolarAngleAxis dataKey="metric" tick={{ fill: "#888", fontSize: 11 }} />
                      <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: "#555", fontSize: 9 }} />
                      {activeStats.map(p => {
                        const meta = PLATFORMS.find(x => x.value === p.platform) ?? { value: p.platform, label: p.label, color: "#9ca3af" };
                        return (
                          <Radar
                            key={p.platform}
                            name={p.label}
                            dataKey={p.platform}
                            stroke={meta.color}
                            fill={meta.color}
                            fillOpacity={0.1}
                            strokeWidth={1.5}
                          />
                        );
                      })}
                      <Legend wrapperStyle={{ fontSize: "11px" }} />
                      <Tooltip {...tooltipStyle} formatter={(v: number) => [v.toFixed(1), ""]} />
                    </RadarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">
                    需要至少一個平台有數據才能顯示雷達圖
                  </div>
                )}
              </div>

              {/* Dimension Explanation */}
              <div className="space-y-3">
                <div style={{ fontSize: "0.6rem", letterSpacing: "0.2em", color: "#d4a843", textTransform: "uppercase", marginBottom: "12px" }}>
                  維度說明
                </div>
                {[
                  { name: "ROI", desc: "投資回報率。(成交收入 - 淨開支) / 淨開支 × 100%。越高代表廣告效益越好。", color: "#d4a843" },
                  { name: "成交率", desc: "詢價轉化成交的比率。成交數 / 詢價數 × 100%。反映詢價質量。", color: "#4ade80" },
                  { name: "CPL 效率", desc: "每次詢價成本（越低越好）。淨開支 / 詢價數。分數越高代表 CPL 越低。", color: "#a78bfa" },
                  { name: "詢價量", desc: "相對詢價數量。與其他平台比較，反映平台帶來的流量規模。", color: "#60a5fa" },
                  { name: "退款率", desc: "平台退款佔廣告開支的比率（越低越好）。退款率高可能代表廣告質量問題。", color: "#f59e0b" },
                ].map(d => (
                  <div key={d.name} className="flex gap-3 p-3 rounded" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <div className="w-1 rounded-full flex-shrink-0" style={{ background: d.color }} />
                    <div>
                      <div className="text-xs font-medium" style={{ color: d.color }}>{d.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{d.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>
          {/* ── Tab 5: 服務類型盈利分析 ── */}
          <TabsContent value="service">
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">按服務類型統計詢價數、成交率與平均成交金額，找出最有利可圖的服務。</p>
              {!profitData || profitData.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground text-sm">暫無數據</div>
              ) : (
                <div className="space-y-3">
                  {profitData.map((row, idx) => {
                    const maxRevenue = Math.max(...profitData.map(r => r.totalRevenue), 1);
                    const barWidth = Math.max(4, Math.round((row.totalRevenue / maxRevenue) * 100));
                    const label = SERVICE_LABELS[row.serviceType] ?? row.serviceType;
                    const rankColors = ["#d4a843", "#9ca3af", "#b45309"];
                    const rankColor = rankColors[idx] ?? "#555";
                    return (
                      <div key={row.serviceType} className="p-4 rounded" style={{ background: "#0f0f0f", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-mono" style={{ color: rankColor, minWidth: "20px" }}>#{idx + 1}</span>
                            <div>
                              <div className="text-sm font-medium">{label}</div>
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {row.totalQuotes} 個詢價 · {row.acceptedQuotes} 個成交 · 成交率 {row.conversionRate}%
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-base font-light" style={{ color: "#4ade80" }}>HK${row.totalRevenue.toLocaleString()}</div>
                            <div className="text-xs text-muted-foreground">均 HK${Math.round(row.avgDeal).toLocaleString()}</div>
                          </div>
                        </div>
                        {/* Revenue bar */}
                        <div className="h-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
                          <div className="h-1.5 rounded-full transition-all" style={{ width: `${barWidth}%`, background: rankColor }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {/* AI 月度分析卡片 */}
        <div className="rounded-lg p-6" style={{ background: "#0a0a0a", border: "1px solid rgba(212,168,67,0.2)" }}>
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <Sparkles className="h-5 w-5" style={{ color: "#d4a843" }} />
              <div>
                <div className="text-sm font-medium" style={{ color: "#d4a843" }}>AI 月度廣告效益分析（8 個核心指標）</div>
                <div className="text-xs text-muted-foreground mt-0.5">按廣告漏斗分層：投放力度 → 曝光 → 點擊 → 詢價 → 成交 → 回報</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="text-sm rounded px-2 py-1"
                style={{ background: "#111", border: "1px solid rgba(212,168,67,0.3)", color: "#e8e0d0" }}
              >
                {["一月","二月","三月","四月","五月","六月","七月","八月","九月","十月","十一月","十二月"].map((m, i) => (
                  <option key={i+1} value={i+1}>{m}</option>
                ))}
              </select>
              <button
                onClick={() => aiMutation.mutate({ year: selectedYear, month: selectedMonth })}
                disabled={aiMutation.isPending}
                className="flex items-center gap-2 px-4 py-1.5 rounded text-sm font-medium transition-all"
                style={{
                  background: aiMutation.isPending ? "rgba(212,168,67,0.1)" : "rgba(212,168,67,0.15)",
                  border: "1px solid rgba(212,168,67,0.4)",
                  color: "#d4a843",
                  cursor: aiMutation.isPending ? "not-allowed" : "pointer",
                }}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${aiMutation.isPending ? "animate-spin" : ""}`} />
                {aiMutation.isPending ? "分析中..." : aiResult ? "重新生成" : "生成分析"}
              </button>
            </div>
          </div>

          {/* 8 個核心指標數據摘要 */}
          {(() => {
            const snap = aiResult ? null : null; // 使用 platformStats 數據
            const ps = data.platformStats;
            const curM = selectedMonth;
            const curY = selectedYear;
            // 從 trendByMonth 取得當月各平台開支
            const curTrend = data.trendByMonth?.find((r: { month: number }) => r.month === curM);
            const curSpendTotal = ps.reduce((s: number, p: { spend?: number }) => s + (p.spend ?? 0), 0);
            // 計算各平台 CPL
            const cplItems = ps.filter((p: { cpl: number | null; label: string }) => p.cpl !== null).map((p: { label: string; cpl: number | null }) => ({ label: p.label, cpl: p.cpl! }));
            const bestCpl = cplItems.length > 0 ? cplItems.reduce((a: { label: string; cpl: number }, b: { label: string; cpl: number }) => a.cpl < b.cpl ? a : b) : null;
            const totalLeadsAll = ps.reduce((s: number, p: { totalLeads: number }) => s + p.totalLeads, 0);
            const totalConvAll = ps.reduce((s: number, p: { conversions: number }) => s + p.conversions, 0);
            const overallConvPct = totalLeadsAll > 0 ? ((totalConvAll / totalLeadsAll) * 100).toFixed(1) : "0";
            const overallRoasVal = data.totalNetSpend > 0 ? (data.totalRevenue / data.totalNetSpend).toFixed(2) : null;
            // Google Ads 曝光/點擊/CPC 真實數據
            const gaStats = ps.find((p: { platform: string }) => p.platform === "google_ads");
            const gaImpressions = gaStats?.impressions ?? null;
            const gaClicks = gaStats?.clicks ?? null;
            const gaCpc = gaStats?.cpc ?? null;
            const gaCtr = gaStats?.ctr ?? null;
            const metrics = [
              { label: "① 總廣告支出", sub: `${curY}年${["一","二","三","四","五","六","七","八","九","十","十一","十二"][curM-1]}月`, value: `HK$${data.totalNetSpend.toLocaleString()}`, note: "全年淨開支", color: "#d4a843" },
              { label: "② 曝光次數", sub: "Google Ads", value: gaImpressions !== null ? gaImpressions.toLocaleString() : "未有數據", note: gaImpressions !== null ? "來自廣告開支記錄" : "請在廣告開支填入曝光次數", color: "#60a5fa" },
              { label: "③ CTR 點擊率", sub: "Google Ads", value: gaCtr !== null ? `${gaCtr.toFixed(2)}%` : (gaImpressions !== null && gaClicks !== null ? `${((gaClicks/gaImpressions)*100).toFixed(2)}%` : "未有數據"), note: "業界標準 1-3%", color: "#34d399" },
              { label: "④ CPC 點擊成本", sub: "Google Ads", value: gaCpc !== null ? `HK$${gaCpc.toFixed(2)}` : "未有數據", note: gaCpc !== null ? `點擊數：${gaClicks?.toLocaleString() ?? "—"}` : "請在廣告開支填入點擊次數", color: "#a78bfa" },
              { label: "⑤ CPL 詢價成本", sub: bestCpl ? `最優：${bestCpl.label}` : "各平台", value: bestCpl ? `HK$${Math.round(bestCpl.cpl)}` : "無數據", note: "越低越好", color: "#f59e0b" },
              { label: "⑥ 詢價數量", sub: "全年", value: `${totalLeadsAll} 個`, note: `${ps.filter((p: { totalLeads: number }) => p.totalLeads > 0).length} 個平台`, color: "#fb923c" },
              { label: "⑦ 成交率", sub: "全年整體", value: `${overallConvPct}%`, note: `${totalConvAll}/${totalLeadsAll}`, color: "#4ade80" },
              { label: "⑧ ROAS 回報率", sub: "全年整體", value: overallRoasVal ? `${overallRoasVal}x` : "N/A", note: "≥3x 為良好", color: "#f43f5e" },
            ];
            return (
              <div className="grid grid-cols-4 gap-3 mb-5">
                {metrics.map((m) => (
                  <div key={m.label} className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${m.color}22` }}>
                    <div className="text-xs font-medium mb-1" style={{ color: m.color }}>{m.label}</div>
                    <div className="text-sm font-bold" style={{ color: "#e8e0d0" }}>{m.value}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{m.sub}</div>
                    <div className="text-xs mt-1" style={{ color: `${m.color}99` }}>{m.note}</div>
                  </div>
                ))}
              </div>
            );
          })()}

          {aiMutation.isError && (
            <div className="text-sm text-red-400 mb-4 p-3 rounded" style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)" }}>
              生成失敗：{aiMutation.error?.message}
            </div>
          )}

          {!aiResult && !aiMutation.isPending && (
            <div className="text-center py-10 text-muted-foreground">
              <Sparkles className="h-8 w-8 mx-auto mb-3 opacity-30" />
              {latestAnalysis ? (
                <div>
                  <div className="text-sm mb-3">上次分析：{new Date(latestAnalysis.generatedAt).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" })}</div>
                  <button
                    onClick={() => setAiResult({ analysis: latestAnalysis.analysis as string, generatedAt: latestAnalysis.generatedAt, id: latestAnalysis.id })}
                    className="text-sm px-3 py-1.5 rounded transition-all mr-2"
                    style={{ background: "rgba(212,168,67,0.1)", border: "1px solid rgba(212,168,67,0.3)", color: "#d4a843" }}
                  >
                    載入上次分析
                  </button>
                  <span className="text-xs">或點擊「生成分析」重新生成</span>
                </div>
              ) : (
                <div className="text-sm">點擊「生成分析」，AI 將根據當前數據提供整體評估及改善建議</div>
              )}
            </div>
          )}

          {aiMutation.isPending && (
            <div className="text-center py-10 text-muted-foreground">
              <div className="flex items-center justify-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin" style={{ color: "#d4a843" }} />
                <span className="text-sm">AI 正在分析數據，請稍候...</span>
              </div>
            </div>
          )}

          {aiResult && !aiMutation.isPending && (
            <div>
              <div
                className="prose prose-sm max-w-none"
                style={{ color: "#e8e0d0", lineHeight: "1.8" }}
              >
                <Streamdown>{aiResult.analysis}</Streamdown>
              </div>
              <div className="mt-4 pt-4 flex items-center justify-between" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="text-xs text-muted-foreground">
                  分析時間：{new Date(aiResult.generatedAt).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" })}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => { setShowHistory(!showHistory); if (!showHistory) refetchHistory(); }}
                    className="text-xs transition-opacity hover:opacity-70"
                    style={{ color: "#d4a843" }}
                  >
                    {showHistory ? "收起歷史" : "查看歷史記錄"}
                  </button>
                  <div className="text-xs text-muted-foreground">由 AI 生成，僅供參考</div>
                </div>
              </div>
              {showHistory && historyList && historyList.length > 0 && (
                <div className="mt-4 space-y-2">
                  <div className="text-xs font-medium mb-2" style={{ color: "#d4a843" }}>歷史分析記錄</div>
                  {historyList.map((h) => (
                    <button
                      key={h.id}
                      onClick={() => setAiResult({ analysis: h.analysis as string, generatedAt: h.generatedAt, id: h.id })}
                      className="w-full text-left px-3 py-2 rounded text-xs transition-all"
                      style={{
                        background: selectedHistoryId === h.id || aiResult?.id === h.id ? "rgba(212,168,67,0.12)" : "rgba(255,255,255,0.03)",
                        border: selectedHistoryId === h.id || aiResult?.id === h.id ? "1px solid rgba(212,168,67,0.3)" : "1px solid rgba(255,255,255,0.06)",
                        color: "#e8e0d0",
                      }}
                      onMouseEnter={() => setSelectedHistoryId(h.id)}
                      onMouseLeave={() => setSelectedHistoryId(null)}
                    >
                      <span style={{ color: "#d4a843" }}>{h.year}年{h.month}月</span>
                      <span className="mx-2 text-muted-foreground">•</span>
                      <span className="text-muted-foreground">{new Date(h.generatedAt).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" })}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
