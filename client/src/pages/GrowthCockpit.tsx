import DashboardLayout from "@/components/DashboardLayout";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import type { CockpitLight, MetricDelta } from "@shared/growthCockpit";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Gauge,
  Mail,
  Minus,
  RefreshCw,
  Sparkles,
  Target,
} from "lucide-react";
import { useLocation } from "wouter";
import type { ReactNode } from "react";

const gold = "#d4a843";
const panel = "#0f0f0f";

function currency(value: number) {
  return `HK$${Math.round(value).toLocaleString("en-HK")}`;
}

function pctLabel(pct: number | null) {
  if (pct == null) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct}%`;
}

function DeltaChip({ delta, invertGood }: { delta: MetricDelta; invertGood?: boolean }) {
  const good =
    delta.direction === "flat"
      ? null
      : invertGood
        ? delta.direction === "down"
        : delta.direction === "up";
  const color =
    good == null ? "#a3a3a3" : good ? "#4ade80" : "#f87171";
  const Icon =
    delta.direction === "up" ? ArrowUpRight : delta.direction === "down" ? ArrowDownRight : Minus;
  return (
    <span className="inline-flex items-center gap-0.5 text-xs tabular-nums" style={{ color }}>
      <Icon className="h-3.5 w-3.5" />
      {pctLabel(delta.pct)}
    </span>
  );
}

function LightDot({ tone }: { tone: CockpitLight["tone"] }) {
  const color =
    tone === "green" ? "#4ade80" : tone === "amber" ? "#fbbf24" : tone === "red" ? "#f87171" : "#737373";
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-full"
      style={{ background: color, boxShadow: `0 0 10px ${color}66` }}
      aria-hidden
    />
  );
}

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section
      className="rounded-lg p-4"
      style={{ background: panel, border: "1px solid rgba(212,168,67,0.18)" }}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium tracking-wide" style={{ color: gold }}>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function MetricCell({
  label,
  value,
  delta,
  invertGood,
}: {
  label: string;
  value: ReactNode;
  delta?: MetricDelta;
  invertGood?: boolean;
}) {
  return (
    <div className="rounded bg-white/[0.03] px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <div className="text-lg font-semibold tabular-nums" style={{ color: "#e8e0d0" }}>
          {value}
        </div>
        {delta && <DeltaChip delta={delta} invertGood={invertGood} />}
      </div>
    </div>
  );
}

export default function GrowthCockpit() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { data, error, isLoading, isFetching, refetch } = trpc.growthCockpit.overview.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: true,
    staleTime: 60_000,
    enabled: !!user,
  });

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              <Target className="h-3.5 w-3.5" style={{ color: gold }} />
              神經系統 · 運維 × Ads × SEO／GEO
            </div>
            <h1 className="mt-1 text-2xl font-semibold" style={{ color: "#e8e0d0" }}>
              監控台
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              一眼睇晒同步健康、報價漏斗、Google Ads 觸達／效益、GSC 自然搜尋；今日唯一行動優先修斷點，再優化增長。
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="border-[rgba(212,168,67,0.35)] bg-transparent text-[#e8e0d0] hover:bg-white/[0.04]"
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            重新整理
          </Button>
        </header>

        {isLoading && (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">載入中…</div>
        )}

        {error && (
          <div
            className="rounded-lg px-4 py-3 text-sm"
            style={{ border: "1px solid rgba(248,113,113,0.35)", background: "rgba(248,113,113,0.08)", color: "#f87171" }}
          >
            無法載入監控台：{error.message}
          </div>
        )}

        {data && (
          <>
            <div className="text-[11px] text-muted-foreground">
              {data.windows.thisWeek.label} {data.windows.thisWeek.startDate} → {data.windows.thisWeek.endDate}
              <span className="mx-2 opacity-40">|</span>
              對比 {data.windows.lastWeek.startDate} → {data.windows.lastWeek.endDate}
              <span className="mx-2 opacity-40">|</span>
              產生於 {new Date(data.generatedAt).toLocaleString("zh-HK")}
            </div>

            <button
              type="button"
              onClick={() => setLocation(data.primaryAction.href)}
              className="flex w-full items-center justify-between gap-3 rounded-lg px-4 py-3.5 text-left transition hover:bg-white/[0.04]"
              style={{
                background: panel,
                border: `1px solid ${
                  data.primaryAction.tone === "red"
                    ? "rgba(248,113,113,0.45)"
                    : data.primaryAction.tone === "amber"
                      ? "rgba(251,191,36,0.45)"
                      : "rgba(212,168,67,0.35)"
                }`,
              }}
            >
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">今日唯一行動</div>
                <div className="mt-1 flex items-center gap-2 text-base font-medium" style={{ color: "#e8e0d0" }}>
                  <LightDot tone={data.primaryAction.tone} />
                  {data.primaryAction.title}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">{data.primaryAction.reason}</div>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0" style={{ color: gold }} />
            </button>

            <Panel title="本週閉環">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="text-sm" style={{ color: "#e8e0d0" }}>
                    {data.weeklyLoop.label}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{data.weeklyLoop.detail}</div>
                </div>
                <div className="text-2xl font-semibold tabular-nums" style={{ color: gold }}>
                  {data.weeklyLoop.score != null ? `${data.weeklyLoop.score}%` : "—"}
                </div>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, Math.max(0, data.weeklyLoop.score ?? 0))}%`,
                    background: gold,
                  }}
                />
              </div>
            </Panel>

            <Panel
              title="神經系統"
              action={
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[11px]"
                  style={{ color: gold }}
                  onClick={() => setLocation("/growth-priorities")}
                >
                  SEO／GEO 詳情 <ArrowRight className="h-3 w-3" />
                </button>
              }
            >
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded bg-white/[0.03] px-3 py-2.5">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">運維同步</div>
                  <div className="mt-1 text-sm" style={{ color: "#e8e0d0" }}>
                    HT{" "}
                    {data.nervousSystem.sync.hellotobyConfigured
                      ? data.nervousSystem.sync.hellotobyLastStatus === "error"
                        ? "同步失敗"
                        : data.nervousSystem.sync.hellotobyCookieAgeDays != null &&
                            data.nervousSystem.sync.hellotobyCookieAgeDays >= 14
                          ? `Cookies ${data.nervousSystem.sync.hellotobyCookieAgeDays} 日`
                          : "正常"
                      : "未設定"}
                    {" · "}
                    360{" "}
                    {data.nervousSystem.sync.pro360Configured
                      ? data.nervousSystem.sync.pro360LastStatus === "error"
                        ? "失敗"
                        : "正常"
                      : "未設定"}
                  </div>
                  <button
                    type="button"
                    className="mt-1 text-[11px]"
                    style={{ color: gold }}
                    onClick={() => setLocation("/ad-sync")}
                  >
                    平台同步 →
                  </button>
                </div>
                <div className="rounded bg-white/[0.03] px-3 py-2.5">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">SEO · GEO · GSC</div>
                  {!data.nervousSystem.seoGeo.gscAvailable ? (
                    <div className="mt-1 text-sm" style={{ color: "#f87171" }}>
                      GSC 未連線
                      {data.nervousSystem.seoGeo.gscError
                        ? `：${data.nervousSystem.seoGeo.gscError.slice(0, 48)}`
                        : ""}
                    </div>
                  ) : (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <MetricCell
                        label="自然點擊"
                        value={data.nervousSystem.seoGeo.clicks.current.toLocaleString("en-HK")}
                        delta={data.nervousSystem.seoGeo.clicks}
                      />
                      <MetricCell
                        label="自然曝光"
                        value={data.nervousSystem.seoGeo.impressions.current.toLocaleString("en-HK")}
                        delta={data.nervousSystem.seoGeo.impressions}
                      />
                    </div>
                  )}
                </div>
                <div className="rounded bg-white/[0.03] px-3 py-2.5">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">FH 工作板</div>
                  <div
                    className="mt-1 text-sm"
                    style={{ color: data.nervousSystem.fh.scrapeStale ? "#fbbf24" : "#e8e0d0" }}
                  >
                    {data.nervousSystem.fh.ageHours == null
                      ? "尚無 scrape"
                      : data.nervousSystem.fh.scrapeStale
                        ? `過舊 · ${data.nervousSystem.fh.ageHours}h`
                        : `${data.nervousSystem.fh.ageHours}h 前`}
                  </div>
                  <button
                    type="button"
                    className="mt-1 text-[11px]"
                    style={{ color: gold }}
                    onClick={() => setLocation("/freehunter-board")}
                  >
                    FH 工作板 →
                  </button>
                </div>
              </div>
            </Panel>

            <Panel title="系統燈號">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data.lights.map((light) => (
                  <button
                    key={light.id}
                    type="button"
                    onClick={() => setLocation(light.href)}
                    className="flex items-start gap-3 rounded-md px-3 py-3 text-left transition hover:bg-white/[0.04]"
                    style={{ border: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    <LightDot tone={light.tone} />
                    <div className="min-w-0">
                      <div className="text-sm" style={{ color: "#e8e0d0" }}>
                        {light.label}
                      </div>
                      <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{light.detail}</div>
                    </div>
                  </button>
                ))}
              </div>
            </Panel>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel
                title="報價 WoW"
                action={
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-[11px]"
                    style={{ color: gold }}
                    onClick={() => setLocation("/quotes")}
                  >
                    報價單 <ArrowRight className="h-3 w-3" />
                  </button>
                }
              >
                <div className="grid grid-cols-3 gap-2">
                  <MetricCell label="開單" value={data.quotesWow.created.current} delta={data.quotesWow.created} />
                  <MetricCell label="成交" value={data.quotesWow.accepted.current} delta={data.quotesWow.accepted} />
                  <MetricCell
                    label="成交額"
                    value={currency(data.quotesWow.revenueHKD.current)}
                    delta={data.quotesWow.revenueHKD}
                  />
                </div>
              </Panel>

              <Panel
                title="Google Ads WoW"
                action={
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-[11px]"
                    style={{ color: gold }}
                    onClick={() => setLocation("/google-ads-quality")}
                  >
                    QS 詳情 <ArrowRight className="h-3 w-3" />
                  </button>
                }
              >
                {!data.adsWow.available ? (
                  <div className="text-sm text-muted-foreground">
                    Ads 指標暫不可用{data.adsWow.error ? `：${data.adsWow.error}` : ""}
                  </div>
                ) : (
                  <>
                    {data.adsWow.stale && (
                      <div className="mb-2 text-xs" style={{ color: "#fbbf24" }}>
                        顯示上次成功快取（即時連線失敗）
                        {data.adsWow.error ? `：${data.adsWow.error.slice(0, 100)}` : ""}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <MetricCell label="花費" value={currency(data.adsWow.spendHKD.current)} delta={data.adsWow.spendHKD} invertGood />
                      <MetricCell label="點擊" value={data.adsWow.clicks.current.toLocaleString("en-HK")} delta={data.adsWow.clicks} />
                      <MetricCell label="轉換" value={data.adsWow.conversions.current} delta={data.adsWow.conversions} />
                      <MetricCell
                        label="CTR"
                        value={data.adsWow.thisWeek.ctr != null ? `${data.adsWow.thisWeek.ctr}%` : "—"}
                        delta={data.adsWow.ctr}
                      />
                      <MetricCell
                        label="CPC"
                        value={data.adsWow.thisWeek.cpc != null ? currency(data.adsWow.thisWeek.cpc) : "—"}
                        delta={data.adsWow.cpc}
                        invertGood
                      />
                      <MetricCell
                        label="CPA"
                        value={data.adsWow.thisWeek.cpa != null ? currency(data.adsWow.thisWeek.cpa) : "—"}
                        delta={data.adsWow.cpa}
                        invertGood
                      />
                      <MetricCell
                        label="Search IS"
                        value={
                          data.adsWow.thisWeek.searchImpressionShare != null
                            ? `${data.adsWow.thisWeek.searchImpressionShare}%`
                            : "—"
                        }
                        delta={data.adsWow.searchImpressionShare}
                      />
                    </div>
                  </>
                )}
              </Panel>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel
                title="待辦 · Ads Action Queue"
                action={
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-[11px]"
                    style={{ color: gold }}
                    onClick={() => setLocation("/growth-priorities")}
                  >
                    <Sparkles className="h-3 w-3" /> 增長優先模型 <ArrowRight className="h-3 w-3" />
                  </button>
                }
              >
                <div className="mb-3 grid grid-cols-3 gap-2">
                  <MetricCell label="待執行可信 Action" value={data.adsActions.pendingTrusted} />
                  <MetricCell label="近 7 日已執行" value={data.adsActions.executed7d} />
                  <MetricCell
                    label="可信完成率"
                    value={data.adsActions.completionPct != null ? `${data.adsActions.completionPct}%` : "—"}
                  />
                </div>
                {data.adsActions.recentLogs.length === 0 ? (
                  <p className="text-xs text-muted-foreground">暫無執行紀錄 — 到增長優先模型審批／執行。</p>
                ) : (
                  <ul className="space-y-1.5">
                    {data.adsActions.recentLogs.map((log, idx) => (
                      <li
                        key={`${log.actionId}-${idx}`}
                        className="flex items-start justify-between gap-2 rounded bg-white/[0.03] px-2.5 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="truncate" style={{ color: "#e8e0d0" }}>
                            {log.actionId}
                          </div>
                          <div className="mt-0.5 truncate text-muted-foreground">{log.message || log.state}</div>
                        </div>
                        <span
                          className="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
                          style={{
                            color:
                              log.state === "executed"
                                ? "#4ade80"
                                : log.state === "failed"
                                  ? "#f87171"
                                  : "#fbbf24",
                            border: "1px solid currentColor",
                          }}
                        >
                          {log.state}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel
                title="待辦 · 報價跟進"
                action={
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-[11px]"
                    style={{ color: gold }}
                    onClick={() => setLocation("/follow-up")}
                  >
                    <Mail className="h-3 w-3" /> 報價跟進 <ArrowRight className="h-3 w-3" />
                  </button>
                }
              >
                <div className="mb-3 grid grid-cols-3 gap-2">
                  <MetricCell label="等待跟進" value={data.followUp.pending} />
                  <MetricCell label="近 7 日已發" value={data.followUp.sent7d} />
                  <MetricCell
                    label="跟進完成率"
                    value={data.followUp.completionPct != null ? `${data.followUp.completionPct}%` : "—"}
                  />
                </div>
                {!data.followUp.enabled && (
                  <p className="mb-2 text-xs" style={{ color: "#f87171" }}>
                    自動跟進已關閉 — 請到報價跟進頁重新啟用。
                  </p>
                )}
                {data.followUp.recentPending.length === 0 ? (
                  <p className="text-xs text-muted-foreground">沒有 pending 跟進。</p>
                ) : (
                  <ul className="space-y-1.5">
                    {data.followUp.recentPending.map((row) => (
                      <li key={row.id} className="rounded bg-white/[0.03] px-2.5 py-2 text-xs">
                        <div className="truncate" style={{ color: "#e8e0d0" }}>
                          {row.toName || row.toEmail}
                        </div>
                        <div className="mt-0.5 truncate text-muted-foreground">{row.subject}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>

            <Panel title="模組捷徑">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data.modules.map((mod) => (
                  <button
                    key={mod.id}
                    type="button"
                    onClick={() => setLocation(mod.href)}
                    className="flex items-start gap-3 rounded-md px-3 py-3 text-left transition hover:bg-white/[0.04]"
                    style={{ border: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    <Gauge className="mt-0.5 h-4 w-4 shrink-0" style={{ color: gold }} />
                    <div>
                      <div className="text-sm" style={{ color: "#e8e0d0" }}>
                        {mod.label}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{mod.blurb}</div>
                    </div>
                  </button>
                ))}
              </div>
            </Panel>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
