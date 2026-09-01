import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { AlertTriangle, ExternalLink, RefreshCw, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";

const QS_COLORS: Record<number, string> = {
  1: "#ef4444",
  2: "#f87171",
  3: "#fb923c",
  4: "#fbbf24",
  5: "#facc15",
  6: "#a3e635",
  7: "#4ade80",
  8: "#22c55e",
  9: "#10b981",
  10: "#059669",
};

function bucketBadge(value: string | null) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const color =
    value === "BELOW_AVERAGE"
      ? "#f87171"
      : value === "AVERAGE"
        ? "#fbbf24"
        : value === "ABOVE_AVERAGE"
          ? "#4ade80"
          : "#888";
  const label =
    value === "BELOW_AVERAGE"
      ? "低"
      : value === "AVERAGE"
        ? "中"
        : value === "ABOVE_AVERAGE"
          ? "高"
          : value;
  return (
    <span
      className="text-xs px-1.5 py-0.5 rounded"
      style={{ background: `${color}22`, color, border: `1px solid ${color}44` }}
    >
      {label}
    </span>
  );
}

function MetricCard({
  label,
  value,
  sub,
  warn,
}: {
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
}) {
  return (
    <div
      className="p-4 rounded"
      style={{
        background: "#0f0f0f",
        border: warn
          ? "1px solid rgba(248,113,113,0.35)"
          : "1px solid rgba(212,168,67,0.12)",
      }}
    >
      <div
        style={{
          fontSize: "0.58rem",
          letterSpacing: "0.15em",
          color: "#888",
          textTransform: "uppercase",
          marginBottom: "6px",
        }}
      >
        {label}
      </div>
      <div className="text-xl font-light" style={{ color: warn ? "#f87171" : "#e8e0d0" }}>
        {value}
      </div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

export default function GoogleAdsQuality() {
  const [days, setDays] = useState(30);

  const {
    data,
    isLoading,
    error,
    refetch,
    isFetching,
  } = trpc.googleAds.qualityDashboard.useQuery({ days });

  const { data: connection } = trpc.googleAds.testConnection.useQuery();

  const chartData =
    data?.distribution.map((d) => ({
      ...d,
      label: d.qualityScore === 0 ? "N/A" : String(d.qualityScore),
      fill: QS_COLORS[d.qualityScore] ?? "#888",
    })) ?? [];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-light" style={{ color: "#e8e0d0" }}>
              Google Ads 品質分數
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Search keywords · 過去 {days} 日 · 帳戶 483-935-2747
            </p>
          </div>
          <div className="flex items-center gap-2">
            {[14, 30, 60].map((d) => (
              <Button
                key={d}
                variant={days === d ? "default" : "outline"}
                size="sm"
                onClick={() => setDays(d)}
              >
                {d} 日
              </Button>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`w-4 h-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
              重新整理
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href="/ad-sync">
                <ExternalLink className="w-4 h-4 mr-1" />
                授權設定
              </a>
            </Button>
          </div>
        </div>

        {connection && !connection.success && (
          <div
            className="p-4 rounded flex items-start gap-3"
            style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)" }}
          >
            <AlertTriangle className="w-5 h-5 shrink-0" style={{ color: "#f87171" }} />
            <div>
              <div className="text-sm font-medium" style={{ color: "#f87171" }}>
                Google Ads API 連線失敗
              </div>
              <div className="text-xs text-muted-foreground mt-1">{connection.error}</div>
              <a href="/ad-sync" className="text-xs underline mt-2 inline-block" style={{ color: "#d4a843" }}>
                前往平台同步重新授權 →
              </a>
            </div>
          </div>
        )}

        {isLoading && (
          <div className="text-sm text-muted-foreground py-12 text-center">載入品質分數數據…</div>
        )}

        {error && (
          <div className="text-sm py-8 text-center" style={{ color: "#f87171" }}>
            {error.message}
          </div>
        )}

        {data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricCard
                label="平均 QS"
                value={data.overview.avgQualityScore != null ? String(data.overview.avgQualityScore) : "—"}
                sub={`${data.overview.keywordCount} 個 keywords`}
              />
              <MetricCard
                label="低 QS (≤5) 關鍵字"
                value={String(data.overview.lowQsKeywordCount)}
                warn={data.overview.lowQsKeywordCount > 0}
              />
              <MetricCard
                label="低 QS 花費佔比"
                value={`${data.overview.lowQsSpendSharePct}%`}
                sub={`HK$${data.overview.lowQsSpendHKD.toLocaleString()}`}
                warn={data.overview.lowQsSpendSharePct > 20}
              />
              <MetricCard
                label="總花費"
                value={`HK$${data.overview.totalSpendHKD.toLocaleString()}`}
                sub={`過去 ${data.days} 日`}
              />
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div
                className="p-4 rounded"
                style={{ background: "#0f0f0f", border: "1px solid rgba(212,168,67,0.12)" }}
              >
                <h2 className="text-sm font-medium mb-4" style={{ color: "#d4a843" }}>
                  QS 分佈（按關鍵字數量）
                </h2>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData}>
                    <XAxis dataKey="label" tick={{ fill: "#888", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#888", fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ background: "#1a1a1a", border: "1px solid #333" }}
                      formatter={(v: number, name: string) => [
                        v,
                        name === "keywordCount" ? "Keywords" : name,
                      ]}
                    />
                    <Bar dataKey="keywordCount" radius={[4, 4, 0, 0]}>
                      {chartData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div
                className="p-4 rounded"
                style={{ background: "#0f0f0f", border: "1px solid rgba(212,168,67,0.12)" }}
              >
                <h2 className="text-sm font-medium mb-4" style={{ color: "#d4a843" }}>
                  Campaign 品質（按花費）
                </h2>
                <div className="space-y-2 max-h-[220px] overflow-y-auto">
                  {data.campaigns.slice(0, 8).map((c) => (
                    <div
                      key={c.campaignId}
                      className="flex items-center justify-between text-xs py-1.5 border-b border-white/5"
                    >
                      <span className="truncate flex-1 mr-2" style={{ color: "#ccc" }}>
                        {c.campaignName}
                      </span>
                      <span className="tabular-nums mr-3" style={{ color: "#d4a843" }}>
                        QS {c.avgQualityScore ?? "—"}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        HK${c.costHKD.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div
              className="rounded overflow-hidden"
              style={{ border: "1px solid rgba(212,168,67,0.12)" }}
            >
              <div
                className="px-4 py-3 flex items-center gap-2"
                style={{ background: "#0f0f0f" }}
              >
                <TrendingDown className="w-4 h-4" style={{ color: "#f87171" }} />
                <h2 className="text-sm font-medium" style={{ color: "#e8e0d0" }}>
                  優先改善（低 QS + 高花費）
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ background: "#111", color: "#888" }}>
                      <th className="text-left p-3 font-normal">關鍵字</th>
                      <th className="text-left p-3 font-normal">Campaign</th>
                      <th className="text-center p-3 font-normal">QS</th>
                      <th className="text-center p-3 font-normal">CTR</th>
                      <th className="text-center p-3 font-normal">相關性</th>
                      <th className="text-center p-3 font-normal">落地頁</th>
                      <th className="text-right p-3 font-normal">花費</th>
                      <th className="text-right p-3 font-normal">CTR%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topKeywords.slice(0, 30).map((kw, i) => (
                      <tr
                        key={`${kw.keyword}-${i}`}
                        style={{
                          borderTop: "1px solid rgba(255,255,255,0.04)",
                          background: (kw.qualityScore ?? 10) <= 5 ? "rgba(248,113,113,0.04)" : undefined,
                        }}
                      >
                        <td className="p-3" style={{ color: "#e8e0d0" }}>
                          {kw.keyword}
                          <span className="text-muted-foreground ml-1">[{kw.matchType}]</span>
                        </td>
                        <td className="p-3 text-muted-foreground max-w-[140px] truncate">
                          {kw.campaignName}
                        </td>
                        <td className="p-3 text-center tabular-nums">
                          <span
                            style={{
                              color:
                                (kw.qualityScore ?? 10) <= 5
                                  ? "#f87171"
                                  : (kw.qualityScore ?? 10) >= 7
                                    ? "#4ade80"
                                    : "#fbbf24",
                            }}
                          >
                            {kw.qualityScore ?? "—"}
                          </span>
                        </td>
                        <td className="p-3 text-center">{bucketBadge(kw.expectedCtr)}</td>
                        <td className="p-3 text-center">{bucketBadge(kw.adRelevance)}</td>
                        <td className="p-3 text-center">{bucketBadge(kw.landingPageExperience)}</td>
                        <td className="p-3 text-right tabular-nums" style={{ color: "#d4a843" }}>
                          HK${kw.costHKD.toLocaleString()}
                        </td>
                        <td className="p-3 text-right tabular-nums text-muted-foreground">
                          {kw.ctr}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {data.recommendations.length > 0 && (
              <div
                className="p-4 rounded"
                style={{ background: "#0f0f0f", border: "1px solid rgba(212,168,67,0.12)" }}
              >
                <h2 className="text-sm font-medium mb-3" style={{ color: "#d4a843" }}>
                  Google 官方建議
                </h2>
                <ul className="space-y-2 text-xs text-muted-foreground">
                  {data.recommendations.map((r, i) => (
                    <li key={i} className="flex gap-2">
                      <span
                        className="shrink-0 px-1.5 py-0.5 rounded text-[10px]"
                        style={{ background: "rgba(212,168,67,0.15)", color: "#d4a843" }}
                      >
                        {r.type}
                      </span>
                      <span>{r.description}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-[10px] text-muted-foreground">
              每週報告：在 server 執行{" "}
              <code className="bg-black/40 px-1 rounded">bash scripts/weekly-qs-review.sh</code>
              {" · "}
              更新於 {new Date(data.generatedAt).toLocaleString("zh-HK")}
            </p>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
