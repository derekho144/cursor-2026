/**
 * Pricing Learning — learn bid ranges from accepted quotes
 * Foundations: shoot type · hours · crew arrangement
 */
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { SERVICE_LABELS } from "@/lib/serviceLabels";
import { useState } from "react";
import { useLocation } from "wouter";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  GraduationCap,
  Clock,
  Users,
  Camera,
  Target,
  Loader2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { quotePricingMode } from "@shared/quotePricingMode";

function money(n: number) {
  return `HK$ ${n.toLocaleString("en-HK")}`;
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
}) {
  return (
    <div
      className="p-4 rounded"
      style={{ background: "#0f0f0f", border: "1px solid rgba(212,168,67,0.12)" }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-3.5 w-3.5" style={{ color: "#d4a843" }} />
        <div
          style={{
            fontSize: "0.58rem",
            letterSpacing: "0.15em",
            color: "#888",
            textTransform: "uppercase",
          }}
        >
          {label}
        </div>
      </div>
      <div className="text-xl font-light" style={{ color: "#e8e0d0" }}>
        {value}
      </div>
      {sub && (
        <div className="text-xs text-muted-foreground mt-1">{sub}</div>
      )}
    </div>
  );
}

function BucketTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{
    label: string;
    count: number;
    avg: number;
    p50: number;
    p25: number;
    p75: number;
  }>;
}) {
  const visible = rows.filter((r) => r.count > 0);
  return (
    <div
      className="rounded overflow-hidden"
      style={{ border: "1px solid rgba(212,168,67,0.12)" }}
    >
      <div
        className="px-4 py-3 text-xs"
        style={{
          background: "#111",
          color: "#d4a843",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        {title}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ color: "#777", fontSize: "0.7rem" }}>
              <th className="text-left px-4 py-2 font-normal">分段</th>
              <th className="text-right px-4 py-2 font-normal">筆數</th>
              <th className="text-right px-4 py-2 font-normal">中位</th>
              <th className="text-right px-4 py-2 font-normal">平均</th>
              <th className="text-right px-4 py-2 font-normal">P25–P75</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground text-xs">
                  暫無足夠已標明資料（請在報價單填寫時數／人手）
                </td>
              </tr>
            ) : (
              visible.map((r) => (
                <tr
                  key={r.label}
                  style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
                >
                  <td className="px-4 py-2.5" style={{ color: "#e8e0d0" }}>
                    {r.label}
                  </td>
                  <td className="px-4 py-2.5 text-right text-muted-foreground">
                    {r.count}
                  </td>
                  <td className="px-4 py-2.5 text-right" style={{ color: "#d4a843" }}>
                    {money(r.p50)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-muted-foreground">
                    {money(r.avg)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-muted-foreground text-xs">
                    {money(r.p25)} – {money(r.p75)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function PricingLearning() {
  const [, setLocation] = useLocation();
  const [serviceType, setServiceType] = useState<string>("product");
  const [hours, setHours] = useState<string>("");
  const [crewSize, setCrewSize] = useState<string>("");
  const [shotCount, setShotCount] = useState<string>("");

  const pricingMode = quotePricingMode(serviceType);

  const { data: overview, isLoading } = trpc.pricingLearning.overview.useQuery(
    undefined,
    { refetchOnWindowFocus: false }
  );
  const utils = trpc.useUtils();
  const backfillMutation = trpc.pricingLearning.backfillStructured.useMutation({
    onSuccess: (r) => {
      toast.success(
        r.dryRun
          ? `預覽：可回填 ${r.updated} / ${r.scanned} 筆`
          : `已回填 ${r.updated} / ${r.scanned} 筆結構化基礎資料`
      );
      utils.pricingLearning.overview.invalidate();
      utils.pricingLearning.byServiceType.invalidate();
    },
    onError: (e) => toast.error(`回填失敗：${e.message}`),
  });
  const { data: detail, isLoading: detailLoading } =
    trpc.pricingLearning.byServiceType.useQuery(
      { serviceType: serviceType as any },
      { enabled: !!serviceType, refetchOnWindowFocus: false }
    );

  const hoursNum = hours.trim() ? Number(hours) : null;
  const crewNum = crewSize.trim() ? Number(crewSize) : null;
  const shotNum = shotCount.trim() ? Number(shotCount) : null;
  const { data: suggestion } = trpc.pricingLearning.suggest.useQuery(
    {
      serviceType: serviceType as any,
      hours: hoursNum && Number.isFinite(hoursNum) ? hoursNum : null,
      crewSize: crewNum && Number.isFinite(crewNum) ? crewNum : null,
      shotCount: shotNum && Number.isFinite(shotNum) ? shotNum : null,
    },
    { enabled: !!serviceType, refetchOnWindowFocus: false }
  );

  const typeOptions =
    overview?.byServiceType?.map((t) => t.serviceType) ??
    Object.keys(SERVICE_LABELS);

  const hoursChart =
    detail?.hoursBuckets
      ?.filter((b) => b.key !== "unknown" && b.count > 0)
      .map((b) => ({ name: b.label, 中位: b.p50, 平均: b.avg, 筆數: b.count })) ??
    [];

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64 text-muted-foreground text-sm gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          分析已接受報價中…
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <GraduationCap className="h-5 w-5" style={{ color: "#d4a843" }} />
            <h1
              className="text-xl font-light"
              style={{ color: "#e8e0d0", letterSpacing: "0.08em" }}
            >
              定價學習
            </h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">
            從已接受報價學習出價區間。優先用報價單嘅結構化「拍攝時數／人手」欄位；
            未填寫時先後備從項目文字抽取。先提升資料準確率，之後先做報價單建議價。
          </p>
        </div>

        {/* Overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            icon={Camera}
            label="已接受報價"
            value={String(overview?.acceptedCount ?? 0)}
            sub={`整體中位 ${money(overview?.overall.p50 ?? 0)}${
              overview?.overallRecentMid
                ? ` · 近況加權 ${money(overview.overallRecentMid)}`
                : ""
            }`}
          />
          <StatCard
            icon={Clock}
            label="有時數資料"
            value={`${overview?.coverage.withHours ?? 0}`}
            sub={`覆蓋 ${
              overview?.acceptedCount
                ? Math.round(
                    ((overview.coverage.withHours ?? 0) /
                      overview.acceptedCount) *
                      100
                  )
                : 0
            }% · 結構化 ${overview?.coverage.withStructuredHours ?? 0}`}
          />
          <StatCard
            icon={Users}
            label="有人手資料"
            value={`${overview?.coverage.withCrew ?? 0}`}
            sub={`覆蓋 ${
              overview?.acceptedCount
                ? Math.round(
                    ((overview.coverage.withCrew ?? 0) /
                      overview.acceptedCount) *
                      100
                  )
                : 0
            }% · 結構化 ${overview?.coverage.withStructuredCrew ?? 0}`}
          />
          <StatCard
            icon={Target}
            label="資料質素分"
            value={`${overview?.dataQuality?.score ?? 0}`}
            sub={
              overview?.aiAccuracy
                ? `AI 對照 ±${overview.aiAccuracy.avgAbsErrorPct}% · ${overview.aiAccuracy.pairedCount} 筆`
                : "結構化時數+人手愈高愈準"
            }
          />
        </div>

        {/* Data quality */}
        <div
          className="p-4 rounded space-y-3"
          style={{ background: "#0f0f0f", border: "1px solid rgba(212,168,67,0.18)" }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              className="text-xs"
              style={{ color: "#d4a843", letterSpacing: "0.12em", textTransform: "uppercase" }}
            >
              準確率 · 資料質素
            </div>
            <button
              type="button"
              disabled={backfillMutation.isPending}
              onClick={() => backfillMutation.mutate({ limit: 800, dryRun: false })}
              className="text-xs px-3 py-1.5 rounded transition-opacity disabled:opacity-40"
              style={{
                border: "1px solid rgba(212,168,67,0.35)",
                color: "#d4a843",
                background: "rgba(212,168,67,0.08)",
              }}
            >
              {backfillMutation.isPending ? "回填中…" : "從舊報價文字回填時數／人手"}
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-muted-foreground">
            <div>
              雙基礎齊全{" "}
              <span style={{ color: "#e8e0d0" }}>
                {overview?.coverage.withBothFundamentals ?? 0}
              </span>
            </div>
            <div>
              結構化雙齊{" "}
              <span style={{ color: "#e8e0d0" }}>
                {overview?.coverage.withStructuredBoth ?? 0}
              </span>
            </div>
            <div>
              缺資料{" "}
              <span style={{ color: "#e8e0d0" }}>
                {overview?.coverage.incompleteCount ?? 0}
              </span>
            </div>
            <div>
              時薪中位{" "}
              <span style={{ color: "#e8e0d0" }}>
                {overview?.pricePerHour
                  ? money(overview.pricePerHour.p50)
                  : "—"}
              </span>
              {overview?.pricePerHour ? "/h" : ""}
            </div>
          </div>
          <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
            {(overview?.dataQuality?.tips ?? []).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          {(overview?.dataQuality?.incomplete?.length ?? 0) > 0 && (
            <div className="overflow-x-auto pt-1">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ color: "#777" }}>
                    <th className="text-left py-1 font-normal">缺資料報價</th>
                    <th className="text-left py-1 font-normal">客戶</th>
                    <th className="text-right py-1 font-normal">成交</th>
                    <th className="text-left py-1 font-normal">缺</th>
                  </tr>
                </thead>
                <tbody>
                  {overview!.dataQuality.incomplete.slice(0, 12).map((r) => (
                    <tr
                      key={r.id}
                      className="cursor-pointer hover:bg-white/[0.03]"
                      onClick={() => setLocation(`/quotes/${r.id}`)}
                    >
                      <td className="py-1.5" style={{ color: "#d4a843" }}>
                        {r.quoteNumber}
                      </td>
                      <td className="py-1.5" style={{ color: "#e8e0d0" }}>
                        {r.clientName}
                      </td>
                      <td className="py-1.5 text-right text-muted-foreground">
                        {money(r.total)}
                      </td>
                      <td className="py-1.5 text-muted-foreground">
                        {[
                          r.missingHours ? "時數" : null,
                          r.missingCrew ? "人手" : null,
                          (r as any).missingShots ? "張數" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Service type ranking */}
        <div
          className="rounded overflow-hidden"
          style={{ border: "1px solid rgba(212,168,67,0.12)" }}
        >
          <div
            className="px-4 py-3 text-xs"
            style={{
              background: "#111",
              color: "#d4a843",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            按拍攝類型 · 已接受成交
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: "#777", fontSize: "0.7rem" }}>
                  <th className="text-left px-4 py-2 font-normal">拍攝類型</th>
                  <th className="text-right px-4 py-2 font-normal">筆數</th>
                  <th className="text-right px-4 py-2 font-normal">中位價</th>
                  <th className="text-right px-4 py-2 font-normal">P25–P75</th>
                  <th className="text-right px-4 py-2 font-normal">時數標明</th>
                  <th className="text-right px-4 py-2 font-normal">人手標明</th>
                </tr>
              </thead>
              <tbody>
                {(overview?.byServiceType ?? []).map((row) => (
                  <tr
                    key={row.serviceType}
                    className="cursor-pointer hover:bg-white/[0.03]"
                    style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
                    onClick={() => setServiceType(row.serviceType)}
                  >
                    <td className="px-4 py-2.5" style={{ color: "#e8e0d0" }}>
                      {SERVICE_LABELS[row.serviceType] ?? row.serviceType}
                      {serviceType === row.serviceType && (
                        <span
                          className="ml-2 text-[10px]"
                          style={{ color: "#d4a843" }}
                        >
                          ● 已選
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">
                      {row.count}
                    </td>
                    <td
                      className="px-4 py-2.5 text-right"
                      style={{ color: "#d4a843" }}
                    >
                      {money(row.p50)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground text-xs">
                      {money(row.p25)} – {money(row.p75)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">
                      {row.withHours}
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">
                      {row.withCrew}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Suggestor */}
        <div
          className="p-4 md:p-5 rounded space-y-4"
          style={{ background: "#0f0f0f", border: "1px solid rgba(212,168,67,0.18)" }}
        >
          <div
            className="text-xs"
            style={{ color: "#d4a843", letterSpacing: "0.12em", textTransform: "uppercase" }}
          >
            出價建議（依歷史成交）
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <div className="text-xs text-muted-foreground mb-1.5">拍攝類型</div>
              <Select value={serviceType} onValueChange={setServiceType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {typeOptions.map((t) => (
                    <SelectItem key={t} value={t}>
                      {SERVICE_LABELS[t] ?? t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              {pricingMode === "shot_count" ? (
                <>
                  <div className="text-xs text-muted-foreground mb-1.5">張數（可選）</div>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    placeholder="例如 20"
                    value={shotCount}
                    onChange={(e) => setShotCount(e.target.value)}
                  />
                </>
              ) : (
                <>
                  <div className="text-xs text-muted-foreground mb-1.5">時數（可選）</div>
                  <Input
                    type="number"
                    min={0.5}
                    step={0.5}
                    placeholder="例如 4"
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                  />
                </>
              )}
            </div>
            <div>
              {pricingMode === "shot_count" ? (
                <div className="text-xs text-muted-foreground pt-6">
                  產品類以張數計價
                  {overview?.pricePerShot
                    ? ` · 歷史每張中位 ${money(overview.pricePerShot.p50)}`
                    : ""}
                </div>
              ) : (
                <>
                  <div className="text-xs text-muted-foreground mb-1.5">人手人數（可選）</div>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    placeholder="例如 2"
                    value={crewSize}
                    onChange={(e) => setCrewSize(e.target.value)}
                  />
                </>
              )}
            </div>
            <div className="flex flex-col justify-end">
              {suggestion?.suggestion ? (
                <div>
                  <div className="text-xs text-muted-foreground">建議中位</div>
                  <div className="text-2xl font-light" style={{ color: "#d4a843" }}>
                    {money(suggestion.suggestion.mid)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    低 {money(suggestion.suggestion.low)} · 高{" "}
                    {money(suggestion.suggestion.high)}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  {suggestion?.note ?? "載入中…"}
                </div>
              )}
            </div>
          </div>
          {suggestion?.note && suggestion.suggestion && (
            <div className="text-xs text-muted-foreground">{suggestion.note}</div>
          )}
        </div>

        {/* Detail for selected type */}
        <div className="space-y-4">
          <h2 className="text-sm" style={{ color: "#e8e0d0" }}>
            {SERVICE_LABELS[serviceType] ?? serviceType} ·{" "}
            {pricingMode === "shot_count" ? "張數分析" : "時數 × 人手分析"}
            {detailLoading && (
              <Loader2 className="inline h-3.5 w-3.5 ml-2 animate-spin text-muted-foreground" />
            )}
          </h2>

          {hoursChart.length > 0 && (
            <div
              className="p-4 rounded h-64"
              style={{ background: "#0f0f0f", border: "1px solid rgba(212,168,67,0.12)" }}
            >
              <div className="text-xs text-muted-foreground mb-3">按時數分段 · 成交價</div>
              <ResponsiveContainer width="100%" height="85%">
                <BarChart data={hoursChart}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: "#888", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#888", fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      background: "#111",
                      border: "1px solid rgba(212,168,67,0.3)",
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="中位" fill="#d4a843" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="平均" fill="#555" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            {pricingMode === "shot_count" ? (
              <BucketTable
                title="按張數"
                rows={(detail as any)?.shotBuckets ?? []}
              />
            ) : (
              <>
                <BucketTable
                  title="按時數"
                  rows={detail?.hoursBuckets ?? []}
                />
                <BucketTable
                  title="按人手安排"
                  rows={detail?.crewBuckets ?? []}
                />
              </>
            )}
          </div>

          {(detail?.cross?.length ?? 0) > 0 && (
            <div
              className="rounded overflow-hidden"
              style={{ border: "1px solid rgba(212,168,67,0.12)" }}
            >
              <div
                className="px-4 py-3 text-xs"
                style={{
                  background: "#111",
                  color: "#d4a843",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                }}
              >
                時數 × 人手交叉（有資料嘅組合）
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: "#777", fontSize: "0.7rem" }}>
                      <th className="text-left px-4 py-2 font-normal">時數</th>
                      <th className="text-left px-4 py-2 font-normal">人手</th>
                      <th className="text-right px-4 py-2 font-normal">筆數</th>
                      <th className="text-right px-4 py-2 font-normal">中位</th>
                      <th className="text-right px-4 py-2 font-normal">平均</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail!.cross.slice(0, 12).map((c) => (
                      <tr
                        key={`${c.hoursBucket}-${c.crewBucket}`}
                        style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
                      >
                        <td className="px-4 py-2" style={{ color: "#e8e0d0" }}>
                          {c.hoursLabel}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {c.crewLabel}
                        </td>
                        <td className="px-4 py-2 text-right text-muted-foreground">
                          {c.count}
                        </td>
                        <td
                          className="px-4 py-2 text-right"
                          style={{ color: "#d4a843" }}
                        >
                          {money(c.p50)}
                        </td>
                        <td className="px-4 py-2 text-right text-muted-foreground">
                          {money(c.avg)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div
            className="rounded overflow-hidden"
            style={{ border: "1px solid rgba(212,168,67,0.12)" }}
          >
            <div
              className="px-4 py-3 text-xs"
              style={{
                background: "#111",
                color: "#d4a843",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              近期同類成交（最多 30 筆）
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: "#777", fontSize: "0.7rem" }}>
                    <th className="text-left px-4 py-2 font-normal">報價</th>
                    <th className="text-left px-4 py-2 font-normal">客戶</th>
                    <th className="text-right px-4 py-2 font-normal">成交價</th>
                    <th className="text-left px-4 py-2 font-normal">時數</th>
                    <th className="text-left px-4 py-2 font-normal">人手</th>
                    <th className="text-right px-4 py-2 font-normal">AI 偏差</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail?.recent ?? []).length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-6 text-center text-muted-foreground text-xs"
                      >
                        此類型暫無已接受報價
                      </td>
                    </tr>
                  ) : (
                    detail!.recent.map((r) => (
                      <tr
                        key={r.id}
                        className="cursor-pointer hover:bg-white/[0.03]"
                        style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
                        onClick={() => setLocation(`/quotes/${r.id}`)}
                      >
                        <td className="px-4 py-2.5" style={{ color: "#d4a843" }}>
                          {r.quoteNumber}
                        </td>
                        <td className="px-4 py-2.5" style={{ color: "#e8e0d0" }}>
                          {r.clientName}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {money(r.total)}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground text-xs">
                          {r.hours != null ? `${r.hours}h` : r.hoursLabel}
                          {r.hoursSource === "structured" ? " ★" : ""}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground text-xs">
                          {r.crewLabel}
                          {r.crewSource === "structured" ? " ★" : ""}
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                          {r.accuracyPct == null
                            ? "—"
                            : `${r.accuracyPct > 0 ? "+" : ""}${r.accuracyPct}%`}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div
          className="text-xs text-muted-foreground p-3 rounded"
          style={{ background: "rgba(212,168,67,0.06)", border: "1px solid rgba(212,168,67,0.12)" }}
        >
          提升準確率：開／改報價時請填「拍攝時數」同人手人數。可用上方「回填」把舊報價文字轉成結構化欄位。
          報價單內建「建議價」會等學習質素夠高先加。
        </div>
      </div>
    </DashboardLayout>
  );
}
