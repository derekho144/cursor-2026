import DashboardLayout from "@/components/DashboardLayout";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { buildAdsActionQueue, buildInteriorQualityReviewAction, buildTrustedServiceNegativeQueue, filterAdsActionHistory, getExecutableAdsActions, isRequeueableInteriorAction, toAdsActionHistoryRecord, type AdsActionHistoryFilter, type AdsActionHistoryRecord, type AdsActionItem, type AdsActionStatus } from "@shared/adsActionQueue";
import type { AdsExecutionResult } from "@shared/adsActionExecution";
import { contentChangeForAction, contentChangeInstructionForReason, type SeoToAdsPlan, type SeoToAdsVerification } from "@shared/seoToAdsAgent";
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Check,
  CircleAlert,
  Copy,
  Clock3,
  ExternalLink,
  Link2,
  ListChecks,
  MapPin,
  RefreshCw,
  Search,
  Sparkles,
  Target,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

const gold = "#d4a843";
const panel = "#0f0f0f";
type ExecutionState = "idle" | "running" | "dry_run_passed" | "executed" | "blocked" | "failed";
type PipelineProgressStage = "content_contract" | "landing_verification" | "dry_run" | "execute";
const PIPELINE_STAGES: Array<{ key: PipelineProgressStage; label: string }> = [
  { key: "content_contract", label: "Content Contract" },
  { key: "landing_verification", label: "Landing" },
  { key: "dry_run", label: "Dry-run" },
  { key: "execute", label: "Execute" },
];

function executionStateLabel(state: ExecutionState) {
  return ({ idle: "未執行", running: "執行中…", dry_run_passed: "Dry-run 通過", executed: "已執行並覆核", blocked: "已阻擋", failed: "執行失敗" } as const)[state];
}

function currency(value: number) {
  return `HK$${Math.round(value).toLocaleString("en-HK")}`;
}

function number(value: number | null) {
  return value == null ? "—" : value.toLocaleString("en-HK");
}

function gscPositionTrend(item: { position?: number | null; previousPosition?: number | null; positionChange?: number | null; positionTrend?: "up" | "down" | "flat" | "insufficient" }) {
  if (item.positionTrend === "up") return <span className="text-emerald-300" title="排名改善；位置數字下降">↑ {Math.abs(item.positionChange ?? 0).toFixed(1)} 位</span>;
  if (item.positionTrend === "down") return <span className="text-red-300" title="排名轉差；位置數字上升">↓ {Math.abs(item.positionChange ?? 0).toFixed(1)} 位</span>;
  if (item.positionTrend === "flat") return <span className="text-muted-foreground" title="前後期變化不足 0.5 位">→ 穩定</span>;
  return <span className="text-muted-foreground" title="需要前期 GSC baseline 才能判斷">→ 未足夠數據</span>;
}

function SourceBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px]"
      style={{
        border: `1px solid ${ok ? "rgba(74,222,128,0.35)" : "rgba(248,113,113,0.35)"}`,
        background: ok ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)",
        color: ok ? "#4ade80" : "#f87171",
      }}
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <CircleAlert className="h-3 w-3" />}
      {label}
    </span>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 65 ? "#f87171" : score >= 40 ? "#fbbf24" : "#4ade80";
  return (
    <div
      className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-full"
      style={{ border: `2px solid ${color}`, background: `${color}12`, color }}
      title="優先分數（滿分 100）"
    >
      <span className="text-base font-semibold leading-none">{score}</span>
      <span className="mt-0.5 text-[8px] tracking-wider">/100</span>
    </div>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: "ready" | "warning" | "muted" }) {
  const colors = {
    ready: "#4ade80",
    warning: "#fbbf24",
    muted: "#a3a3a3",
  } as const;
  const color = colors[tone];
  return (
    <span className="rounded px-2 py-1 text-[10px]" style={{ border: `1px solid ${color}55`, background: `${color}12`, color }}>
      {label}
    </span>
  );
}

function Metric({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm tabular-nums" style={{ color: "#e8e0d0" }}>{value}</div>
      {hint && <div className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{hint}</div>}
    </div>
  );
}

function FeatureChip({ children }: { children: string }) {
  return <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-muted-foreground">{children}</span>;
}

function PipelineProgress({ stage }: { stage?: PipelineProgressStage | "complete" }) {
  const activeIndex = stage === "complete" ? PIPELINE_STAGES.length : stage ? PIPELINE_STAGES.findIndex((item) => item.key === stage) : -1;
  return (
    <div className="mt-3 rounded bg-white/[0.03] px-3 py-2" aria-label="SEO-to-Ads pipeline progress">
      <div className="mb-2 flex items-center justify-between text-[10px] text-muted-foreground"><span>SEO-to-Ads 流程</span><span>{stage === "complete" ? "已完成；GAQL 已覆核" : stage ? `進行至 ${PIPELINE_STAGES[activeIndex]?.label}` : "尚未開始"}</span></div>
      <div className="grid grid-cols-4 gap-1.5">
        {PIPELINE_STAGES.map((item, index) => {
          const done = index < activeIndex || stage === "complete";
          const active = index === activeIndex && stage !== "complete";
          return <div key={item.key} className="rounded px-2 py-1 text-center text-[10px]" style={{ border: `1px solid ${done || active ? `${gold}88` : "rgba(255,255,255,0.12)"}`, background: done ? "rgba(74,222,128,0.10)" : active ? "rgba(212,168,67,0.14)" : "rgba(255,255,255,0.03)", color: done ? "#86efac" : active ? gold : "#737373" }}>{done ? "✓ " : active ? "• " : "○ "}{item.label}</div>;
        })}
      </div>
    </div>
  );
}

function ContentChangeChecklist({ item, verification }: { item: AdsActionItem; verification?: SeoToAdsVerification }) {
  const contract = contentChangeForAction(item);
  const signals = verification?.verification;
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const signalOk = (id: string) => !signals ? undefined : id === "hero" ? signals.contentChanged : id === "definition" ? signals.hasDefinition : id === "faq" ? signals.hasFaqPage : id === "schema" ? signals.hasService && signals.hasOffer : signals.hasContactCta;
  const copy = async (id: string, text: string) => { try { await navigator.clipboard.writeText(text); setCopiedId(id); window.setTimeout(() => setCopiedId(null), 1600); } catch { setCopiedId(null); } };
  const failed = signals?.reasons.map((reason) => ({ reason, instruction: contentChangeInstructionForReason(reason, contract.instructions) })).filter((entry) => entry.instruction);
  return (
    <div className="mt-3 rounded border border-amber-500/20 bg-amber-500/[0.06] px-3 py-3" data-testid="content-change-checklist">
      <div className="flex flex-wrap items-center justify-between gap-2"><div className="text-xs font-medium text-amber-100">要修改的內容（{contract.targetPath}）</div><div className="text-[10px] text-amber-200/70">完成後按「修正後自動重驗」</div></div>
      <div className="mt-2 space-y-1.5">
        {contract.instructions.map((instruction) => { const ok = signalOk(instruction.id); return <div key={instruction.id} className="rounded border border-white/[0.06] px-2 py-2 text-[11px]"><div className="flex items-start gap-2"><span className={ok === true ? "text-emerald-300" : ok === false ? "text-red-300" : "text-amber-300"}>{ok === true ? "✓" : ok === false ? "!" : "○"}</span><span className="min-w-[74px] font-medium text-amber-100">{instruction.label}</span><span className="text-muted-foreground">{instruction.location}</span></div><div className="ml-5 mt-1 text-muted-foreground">建議文案：{instruction.suggestedCopy}</div><button type="button" className="ml-5 mt-1 inline-flex items-center gap-1 text-[10px] text-amber-200 hover:text-amber-100" onClick={() => void copy(instruction.id, instruction.suggestedCopy)}>{copiedId === instruction.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{copiedId === instruction.id ? "已複製" : "複製文案"}</button></div>; })}
      </div>
      {failed && failed.length > 0 && <div className="mt-3 rounded border border-red-400/20 bg-red-400/[0.06] px-2 py-2 text-[11px]"><div className="font-medium text-red-200">未通過原因 → 對應修正位置</div>{failed.map(({ reason, instruction }) => <div key={reason} className="mt-1 text-muted-foreground">• {reason} → <span className="text-red-100">{instruction?.location}</span></div>)}</div>}
      {signals?.contentDiffSummary && <div className="mt-3 rounded border border-sky-400/20 bg-sky-400/[0.06] px-2 py-2 text-[11px] text-sky-100"><div className="font-medium">重驗內容差異摘要</div><div className="mt-1 text-sky-100/80">{signals.contentDiffSummary}</div><div className="mt-1 text-[10px] text-muted-foreground">以上為 live HTML fingerprint 變更摘要；系統不會顯示或儲存整頁內容。</div></div>}
      <div className="mt-2 text-[10px] text-muted-foreground">完成條件：live page HTTP 200、contentChanged=true、definition／FAQPage／Service／Offer／CTA 全部通過；系統不會自動 publish 網站。</div>
    </div>
  );
}

function riskLabel(risk: AdsActionItem["risk"]) {
  return risk === "high" ? "高風險：必須再確認" : risk === "medium" ? "中風險：先審核" : "低風險：只讀檢查";
}

function statusLabel(status: AdsActionStatus) {
  return status === "approved" ? "已批准下一步" : status === "rejected" ? "已拒絕" : status === "completed" ? "已完成" : "待審批";
}

export default function GrowthPriorities() {
  const { user } = useAuth();
  const [days, setDays] = useState(28);
  const [actionStatuses, setActionStatuses] = useState<Record<string, AdsActionStatus>>({});
  const [executionStates, setExecutionStates] = useState<Record<string, ExecutionState>>({});
  const [showResults, setShowResults] = useState<Record<string, boolean>>({});
  const [executionMessages, setExecutionMessages] = useState<Record<string, string>>({});
  const [executionDetails, setExecutionDetails] = useState<Record<string, string>>({});
  const [seoPlans, setSeoPlans] = useState<Record<string, { plan?: SeoToAdsPlan; verification?: SeoToAdsVerification }>>({});
  const [pipelineBaselines, setPipelineBaselines] = useState<Record<string, string>>({});
  const [batchRunning, setBatchRunning] = useState(false);
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [actionHistory, setActionHistory] = useState<AdsActionHistoryRecord[]>([]);
  const [historyFilter, setHistoryFilter] = useState<AdsActionHistoryFilter>("all");
  const [requeuedActionIds, setRequeuedActionIds] = useState<Set<string>>(new Set());
  const [pipelineProgress, setPipelineProgress] = useState<Record<string, PipelineProgressStage | "complete">>({});
  const executeApproved = trpc.growthPriorities.executeApproved.useMutation();
  const runSeoToAdsPipeline = trpc.growthPriorities.runSeoToAdsPipeline.useMutation();
  const runApprovedAdsBatch = trpc.growthPriorities.runApprovedAdsBatch.useMutation();
  const dryRunApproved = trpc.growthPriorities.dryRunApproved.useMutation();
  const seoToAdsPlan = trpc.growthPriorities.seoToAdsPlan.useMutation();
  const verifySeoToAdsPlan = trpc.growthPriorities.verifySeoToAdsPlan.useMutation();
  const { data: executionLogs, refetch: refetchExecutionLogs } = trpc.growthPriorities.executionLogs.useQuery(undefined, { retry: false });
  const { data: dailyReport } = trpc.growthPriorities.dailyExecutionReport.useQuery(undefined, { retry: false });
  const { data, error, isLoading, isFetching, refetch } = trpc.growthPriorities.overview.useQuery(
    { days },
    {
      retry: false,
      refetchOnWindowFocus: false,
      // The query re-checks unavailable sources while this page is open. Ahrefs
      // results are server-cached, so a healthy connection is not repeatedly charged.
      refetchInterval: 5 * 60 * 1_000,
    }
  );

  const summary = useMemo(() => {
    const rows = data?.backlog ?? [];
    return {
      quickWins: rows.filter((row) => row.organic.position != null && row.organic.position <= 20).length,
      currentPageOne: rows.filter((row) => row.organic.position != null && row.organic.position <= 10).length,
      paidValidated: rows.filter((row) => row.ads.commercialSignal === "available" && row.ads.keywordCount > 0).length,
      aeoGaps: rows.filter((row) => row.aeo.status === "partial" || row.aeo.status === "weak").length,
    };
  }, [data]);

  const generatedActions = useMemo(() => {
    if (!data?.backlog) return [];
    const generated = buildAdsActionQueue(data.backlog.map((item) => ({
      id: item.id,
      query: item.query,
      serviceLabel: item.serviceLabel,
      targetPath: item.targetPath,
      score: item.score,
      organicPosition: item.organic.position,
      ads: item.ads,
      revenue: item.revenue,
    })));
    const trusted = buildTrustedServiceNegativeQueue();
    const requeued = requeuedActionIds.has("interior-photography:quality-review") ? [buildInteriorQualityReviewAction()] : [];
    return [...trusted, ...requeued, ...generated.filter((item) => !trusted.some((candidate) => candidate.id === item.id) && !requeued.some((candidate) => candidate.id === item.id))];
  }, [data, requeuedActionIds]);

  const actionQueue = useMemo(() => getExecutableAdsActions(
    generatedActions.map((item) => ({ ...item, status: actionStatuses[item.id] ?? item.status })),
    completedIds,
  ), [generatedActions, actionStatuses, completedIds]);
  const filteredActionHistory = useMemo(() => filterAdsActionHistory(actionHistory, historyFilter), [actionHistory, historyFilter]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("jd-ads-action-queue-statuses");
      if (raw) {
        const statuses = JSON.parse(raw) as Record<string, AdsActionStatus>;
        setActionStatuses(statuses);
        setCompletedIds(new Set(Object.entries(statuses).filter(([, status]) => status === "completed").map(([id]) => id)));
      }
      const history = window.localStorage.getItem("jd-ads-action-history");
      if (history) setActionHistory(JSON.parse(history) as AdsActionHistoryRecord[]);
    } catch {
      // Ignore unavailable or malformed browser storage.
    }
  }, []);

  useEffect(() => {
    if (!executionLogs?.length) return;
    const serverRecords = executionLogs.flatMap((log) => {
      try {
        const payload = log.message ? JSON.parse(log.message) as { actionId?: string; state?: string; message?: string; mutationCount?: number; verification?: string; operations?: string[] } : null;
        if (!payload?.actionId || !payload.state || !["executed", "blocked", "failed"].includes(payload.state)) return [];
        const action = generatedActions.find((item) => item.id === payload.actionId);
        return [toAdsActionHistoryRecord({
          actionId: payload.actionId,
          title: action?.title ?? payload.actionId,
          state: payload.state as "executed" | "blocked" | "failed",
          message: payload.message ?? "server execution result",
          mutationCount: payload.mutationCount ?? 0,
          verification: payload.verification,
          operations: payload.operations,
          completedAt: new Date(log.syncedAt).toISOString(),
        })];
      } catch { return []; }
    });
    if (!serverRecords.length) return;
    setActionHistory((current) => {
      const merged = [...current, ...serverRecords].filter((record, index, all) => all.findIndex((candidate) => candidate.actionId === record.actionId) === index).slice(0, 100);
      try { window.localStorage.setItem("jd-ads-action-history", JSON.stringify(merged)); } catch { /* storage optional */ }
      return merged;
    });
    const serverCompleted = new Set(serverRecords.filter((record) => record.state === "executed").map((record) => record.actionId));
    if (serverCompleted.size) {
      setCompletedIds((current) => new Set(Array.from(current).concat(Array.from(serverCompleted))));
      setActionStatuses((current) => {
        const next = { ...current };
        serverCompleted.forEach((id) => { next[id] = "completed"; });
        try { window.localStorage.setItem("jd-ads-action-queue-statuses", JSON.stringify(next)); } catch { /* storage optional */ }
        return next;
      });
    }
  }, [executionLogs, generatedActions]);

  function setActionStatus(id: string, status: AdsActionStatus) {
    setActionStatuses((current) => {
      const next = { ...current, [id]: status };
      try { window.localStorage.setItem("jd-ads-action-queue-statuses", JSON.stringify(next)); } catch { /* storage optional */ }
      return next;
    });
  }

  function requeueHistoryRecord(record: AdsActionHistoryRecord) {
    if (!isRequeueableInteriorAction(record)) return;
    const id = "interior-photography:quality-review";
    const requeuedAt = new Date().toISOString();
    const requeueReason = "修正室內攝影 Landing／RSA／Phrase keyword 對口度後，要求重新驗證。";
    const requeuedBy = user?.email ?? user?.name ?? "authenticated-user";
    setRequeuedActionIds((current) => new Set(current).add(id));
    // The visible queue contains approved actions; this does not execute anything.
    // The user must still run Content Contract, Landing verification and Dry-run.
    setActionStatus(id, "approved");
    setExecutionStates((current) => ({ ...current, [id]: "idle" }));
    setExecutionMessages((current) => ({ ...current, [id]: `已重新加入待審批清單；原因：${requeueReason} 操作者：${requeuedBy}` }));
    setActionHistory((current) => {
      const next = current.map((entry) => entry.actionId === record.actionId ? { ...entry, requeueReason, requeuedBy, requeuedAt } : entry);
      try { window.localStorage.setItem("jd-ads-action-history", JSON.stringify(next)); } catch { /* storage optional */ }
      return next;
    });
  }

  async function reverifyAfterFix(item: AdsActionItem) {
    setPipelineProgress((current) => ({ ...current, [item.id]: "landing_verification" }));
    setExecutionMessages((current) => ({ ...current, [item.id]: "修正後自動重驗：正在檢查 HTTPS、live HTML、Schema、CTA 及 hosting；不會修改 Ads。" }));
    try {
      const baselineFingerprint = pipelineBaselines[item.id] ?? seoPlans[item.id]?.plan?.baseline.contentFingerprint;
      if (!baselineFingerprint) {
        await prepareSeoToAds(item);
        setExecutionMessages((current) => ({ ...current, [item.id]: "已建立新的 baseline；請完成頁面修正後再次按「修正後自動重驗」。" }));
        return;
      }
      const verification = await verifySeoToAdsPlan.mutateAsync({ ...item, baselineFingerprint });
      setSeoPlans((current) => ({ ...current, [item.id]: { ...current[item.id], verification } }));
      setExecutionMessages((current) => ({ ...current, [item.id]: verification.adsReady ? "修正後重驗通過；已停在 Dry-run 前，最後 live mutation 仍需批准。" : "修正後重驗未通過；Ads mutation 仍被安全阻擋。" }));
      setExecutionDetails((current) => ({ ...current, [item.id]: `contentChanged=${verification.verification.contentChanged} · readyForAds=${verification.adsReady} · ${verification.verification.reasons.slice(0, 3).join("；") || "所有必要訊號已通過"}` }));
      setPipelineProgress((current) => ({ ...current, [item.id]: verification.adsReady ? "dry_run" : "landing_verification" }));
    } catch (error) {
      setExecutionMessages((current) => ({ ...current, [item.id]: `修正後重驗失敗：${error instanceof Error ? error.message : "未知錯誤"}` }));
    }
  }

  function recordActionResult(item: AdsActionItem, result: AdsExecutionResult) {
    if (result.state !== "executed" && result.state !== "blocked" && result.state !== "failed") return;
    const record = toAdsActionHistoryRecord({ ...result, actionId: item.id, title: item.title, state: result.state });
    setActionHistory((current) => {
      const next = [record, ...current.filter((entry) => entry.actionId !== item.id)].slice(0, 100);
      try { window.localStorage.setItem("jd-ads-action-history", JSON.stringify(next)); } catch { /* storage optional */ }
      return next;
    });
    if (result.state === "executed") {
      setActionStatus(item.id, "completed");
      setCompletedIds((current) => new Set(current).add(item.id));
    }
  }

  async function approveAndExecute(item: AdsActionItem) {
    setActionStatus(item.id, "approved");
    setExecutionStates((current) => ({ ...current, [item.id]: "running" }));
    setExecutionMessages((current) => ({ ...current, [item.id]: "已批准，正在執行 server-side dry-run／護欄檢查…" }));
    try {
      const baselineFingerprint = seoPlans[item.id]?.plan?.baseline.contentFingerprint ?? undefined;
      const result = await executeApproved.mutateAsync({ ...item, baselineFingerprint });
      setExecutionStates((current) => ({ ...current, [item.id]: result.state === "executed" ? "executed" : result.state === "dry_run_passed" ? "dry_run_passed" : result.state === "blocked" ? "blocked" : "failed" }));
      setExecutionMessages((current) => ({
        ...current,
        [item.id]: `${result.message}（${result.state}，${result.mutationCount} 個 mutation）`,
      }));
      setExecutionDetails((current) => ({ ...current, [item.id]: [result.verification, result.operations?.length ? `operations: ${result.operations.join(", ")}` : "", result.resources?.length ? `resources: ${result.resources.length}` : "", result.dryRun ? `dry-run payload: ${result.dryRun.negativeTerms.join(", ")}` : ""].filter(Boolean).join(" · ") }));
      recordActionResult(item, result);
      await refetchExecutionLogs();
    } catch (error) {
      setExecutionStates((current) => ({ ...current, [item.id]: "failed" }));
      setExecutionMessages((current) => ({
        ...current,
        [item.id]: `自動執行失敗：${error instanceof Error ? error.message : "未知錯誤"}`,
      }));
    }
  }

  async function runSeoToAdsOneClick(item: AdsActionItem) {
    setActionStatus(item.id, "approved");
    setExecutionStates((current) => ({ ...current, [item.id]: "running" }));
    setPipelineProgress((current) => ({ ...current, [item.id]: "content_contract" }));
    setExecutionMessages((current) => ({ ...current, [item.id]: "一鍵流程：Content Contract → Landing verification → Dry-run → Live mutation → GAQL 覆核…" }));
    try {
      const result = await runSeoToAdsPipeline.mutateAsync({ ...item, baselineFingerprint: pipelineBaselines[item.id] });
      if (result.baselineFingerprint) setPipelineBaselines((current) => ({ ...current, [item.id]: result.baselineFingerprint! }));
      setPipelineProgress((current) => ({ ...current, [item.id]: result.state === "executed" ? "complete" : result.pipelineStage === "landing_verification" ? "landing_verification" : result.pipelineStage === "dry_run" ? "dry_run" : "content_contract" }));
      setExecutionStates((current) => ({ ...current, [item.id]: result.state === "executed" ? "executed" : result.state === "dry_run_passed" ? "dry_run_passed" : result.state === "blocked" ? "blocked" : "failed" }));
      setExecutionMessages((current) => ({ ...current, [item.id]: `${result.message}（${result.state}，${result.mutationCount} 個 mutation）` }));
      setExecutionDetails((current) => ({ ...current, [item.id]: [result.pipelineStage ? `stage=${result.pipelineStage}` : "", result.baselineFingerprint ? `baseline=${result.baselineFingerprint}` : "", result.verification ?? "", result.operations?.length ? `operations: ${result.operations.join(", ")}` : "", result.resources?.length ? `resources: ${result.resources.length}` : ""].filter(Boolean).join(" · ") }));
      recordActionResult(item, result);
      await refetchExecutionLogs();
    } catch (error) {
      setExecutionStates((current) => ({ ...current, [item.id]: "failed" }));
      setExecutionMessages((current) => ({ ...current, [item.id]: `一鍵流程失敗：${error instanceof Error ? error.message : "未知錯誤"}` }));
    }
  }

  function runPrimaryAction(item: AdsActionItem) {
    if (item.id.startsWith("trusted-negative:")) return void approveAndExecute(item);
    return void runSeoToAdsOneClick(item);
  }

  async function runAllApproved() {
    const approved = actionQueue.filter((item) => item.status === "approved");
    if (!approved.length) {
      setExecutionMessages((current) => ({ ...current, __batch__: "目前沒有已批准項目；請先在每個項目按一鍵檢查並執行，或先批准項目。" }));
      return;
    }
    setBatchRunning(true);
    setExecutionMessages((current) => ({ ...current, __batch__: `正在逐項執行 ${approved.length} 個已批准項目；每項會獨立通過 Landing、Dry-run、護欄及 GAQL 覆核。` }));
    setExecutionStates((current) => ({ ...current, ...Object.fromEntries(approved.map((item) => [item.id, "running" as ExecutionState])) }));
    try {
      const batch = await runApprovedAdsBatch.mutateAsync({
        items: approved.map((item) => ({ ...item, baselineFingerprint: pipelineBaselines[item.id] ?? seoPlans[item.id]?.plan?.baseline.contentFingerprint })),
      });
      for (const result of batch.results) {
        const item = approved.find((candidate) => candidate.id === result.actionId);
        const state = result.state === "executed" ? "executed" : result.state === "dry_run_passed" ? "dry_run_passed" : result.state === "blocked" ? "blocked" : "failed";
        setExecutionStates((current) => ({ ...current, [result.actionId]: state }));
        setExecutionMessages((current) => ({ ...current, [result.actionId]: `${result.message}（${result.state}，${result.mutationCount} 個 mutation）` }));
        setExecutionDetails((current) => ({ ...current, [result.actionId]: [result.pipelineStage ? `stage=${result.pipelineStage}` : "", result.baselineFingerprint ? `baseline=${result.baselineFingerprint}` : "", result.verification ?? "", result.operations?.length ? `operations: ${result.operations.join(", ")}` : "", result.resources?.length ? `resources: ${result.resources.length}` : ""].filter(Boolean).join(" · ") }));
        if (result.baselineFingerprint) setPipelineBaselines((current) => ({ ...current, [result.actionId]: result.baselineFingerprint! }));
        if (item) recordActionResult(item, result);
      }
      const executed = batch.results.filter((result) => result.state === "executed").length;
      const blocked = batch.results.filter((result) => result.state === "blocked").length;
      setExecutionMessages((current) => ({ ...current, __batch__: `批量完成：${executed} 項已執行並覆核、${blocked} 項被安全阻擋、${batch.results.length - executed - blocked} 項失敗。未批准項目已跳過。` }));
      await refetchExecutionLogs();
    } catch (error) {
      setExecutionMessages((current) => ({ ...current, __batch__: `批量執行失敗：${error instanceof Error ? error.message : "未知錯誤"}` }));
    } finally {
      setBatchRunning(false);
    }
  }

  async function previewDryRun(item: AdsActionItem) {
    setPipelineProgress((current) => ({ ...current, [item.id]: "dry_run" }));
    setExecutionMessages((current) => ({ ...current, [item.id]: "正在執行 validateOnly dry-run 及 GAQL before 覆核…" }));
    try {
      const baselineFingerprint = seoPlans[item.id]?.plan?.baseline.contentFingerprint ?? undefined;
      const result = await dryRunApproved.mutateAsync({ ...item, baselineFingerprint });
      setExecutionMessages((current) => ({ ...current, [item.id]: `${result.message}（${result.state}）` }));
      setExecutionDetails((current) => ({ ...current, [item.id]: [result.verification, result.dryRun ? `payload: campaign ${result.dryRun.campaignId} · ad group ${result.dryRun.adGroupId} · PHRASE · ${result.dryRun.negativeTerms.join(", ") || "無新增"}` : ""].filter(Boolean).join(" · ") }));
      await refetchExecutionLogs();
    } catch (error) {
      setExecutionMessages((current) => ({ ...current, [item.id]: `dry-run 失敗：${error instanceof Error ? error.message : "未知錯誤"}` }));
    }
  }

  async function prepareSeoToAds(item: AdsActionItem) {
    setPipelineProgress((current) => ({ ...current, [item.id]: "content_contract" }));
    setExecutionMessages((current) => ({ ...current, [item.id]: "正在建立 content change contract 並檢查 live landing baseline…" }));
    try {
      const plan = await seoToAdsPlan.mutateAsync(item);
      setSeoPlans((current) => ({ ...current, [item.id]: { plan } }));
      setExecutionMessages((current) => ({ ...current, [item.id]: `Content contract 已建立；baseline ${plan.baseline.contentFingerprint ?? "不可用"}。不會自動 publish。` }));
      setExecutionDetails((current) => ({ ...current, [item.id]: `${plan.contentChange.changes.length} 項內容提案 · Ads payload ${plan.adsPayload ? plan.adsPayload.payloads.map((payload) => payload.kind).join("、") : "只讀／未映射"} · 禁止：budget、tCPA、campaign status · 下一步：發布內容後重驗` }));
    } catch (error) {
      setExecutionMessages((current) => ({ ...current, [item.id]: `Content contract 失敗：${error instanceof Error ? error.message : "未知錯誤"}` }));
    }
  }

  async function verifySeoToAds(item: AdsActionItem) {
    setPipelineProgress((current) => ({ ...current, [item.id]: "landing_verification" }));
    const baselineFingerprint = seoPlans[item.id]?.plan?.baseline.contentFingerprint;
    if (!baselineFingerprint) return prepareSeoToAds(item);
    setExecutionMessages((current) => ({ ...current, [item.id]: "正在重新驗證 HTTPS、live HTML、Schema、CTA 及 hosting…" }));
    try {
      const verification = await verifySeoToAdsPlan.mutateAsync({ ...item, baselineFingerprint });
      setSeoPlans((current) => ({ ...current, [item.id]: { ...current[item.id], verification } }));
      setExecutionMessages((current) => ({ ...current, [item.id]: verification.adsReady ? "Landing verification 通過；可以進入 Ads validateOnly dry-run。" : "Landing verification 未通過；已封鎖 Ads execution。" }));
      setExecutionDetails((current) => ({ ...current, [item.id]: `contentChanged=${verification.verification.contentChanged} · readyForAds=${verification.adsReady} · payload=${verification.adsPayload?.payloads.map((payload) => payload.kind).join("、") || "無"} · ${verification.verification.reasons.slice(0, 3).join("；") || "所有必要訊號已通過"}` }));
    } catch (error) {
      setExecutionMessages((current) => ({ ...current, [item.id]: `Landing verification 失敗：${error instanceof Error ? error.message : "未知錯誤"}` }));
    }
  }

  const sourceError = error?.message ??
    data?.sources.googleAds.error ??
    data?.sources.ahrefs.error ??
    data?.sources.googleSearchConsole.error;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <section className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-[0.2em]" style={{ color: gold }}>
              <Sparkles className="h-3.5 w-3.5" /> Growth Intelligence
            </div>
            <h1 className="text-2xl font-light" style={{ color: "#e8e0d0" }}>Top 10 SEO + Ads + AEO Backlog</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              只保留 GSC 已有曝光、具香港商業服務意圖、但尚未進第一頁的 query；每項對應一個目標頁及可執行缺口。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[28, 60, 90].map((value) => (
              <Button key={value} size="sm" variant={days === value ? "default" : "outline"} onClick={() => setDays(value)}>
                {value} 日
              </Button>
            ))}
            <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`mr-1 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              重新計算
            </Button>
          </div>
        </section>

        <section className="grid gap-3 rounded p-4 md:grid-cols-4" style={{ background: panel, border: "1px solid rgba(212,168,67,0.15)" }}>
          <Metric label="Backlog 項目" value={`${data?.backlog.length ?? 0} / 10`} hint="符合篩選條件的 query" />
          <Metric label="接近第一頁" value={`${summary.quickWins}`} hint="平均排名第 11–20 位" />
          <Metric label="已驗證 Ads 意圖" value={`${summary.paidValidated}`} hint="有關鍵字、點擊與花費資料" />
          <Metric label="AEO 可補強項目" value={`${summary.aeoGaps}`} hint="FAQ／Schema／定義／CTA 尚有缺口" />
        </section>

        <section className="flex flex-wrap items-center gap-2 text-xs">
          <span className="mr-1 text-muted-foreground">資料來源：</span>
          <SourceBadge ok={Boolean(data?.sources.revenue.available)} label="報價 funnel" />
          <SourceBadge ok={Boolean(data?.sources.googleSearchConsole.available)} label="Search Console" />
          <SourceBadge ok={Boolean(data?.sources.googleAds.available)} label="Google Ads" />
          <SourceBadge ok={Boolean(data?.sources.googleAds.searchTerms)} label="Ads 搜尋字詞" />
          <SourceBadge ok={Boolean(data?.sources.ahrefs.available)} label="Ahrefs" />
          <SourceBadge ok={Boolean(data?.sources.livePageAudit.available)} label="Live AEO 檢查" />
          {data?.sources.ahrefs.cached && <span className="text-[10px] text-muted-foreground">Ahrefs 使用快取結果</span>}
        </section>

        <section className="rounded p-4" style={{ background: panel, border: "1px solid rgba(248,113,113,0.22)" }}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium" style={{ color: "#e8e0d0" }}>
                <Target className="h-4 w-4" style={{ color: gold }} /> Ads Action Queue
              </div>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
                C 模式：批准後自動送到 server-side Google Ads API 執行器；先過 landing verification、dry-run、預算／tCPA／月度上限護欄，再執行並用 GAQL 覆核。RSA、Final URL、Sitelink 及 campaign negatives 只會在所有閘門通過後修改；未有可信 payload 會 fail-closed。
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="text-[11px] text-muted-foreground">
                {actionQueue.filter((item) => item.status === "pending").length} 待審批 · {actionQueue.filter((item) => item.status === "approved").length} 已批准
              </div>
              <Button size="sm" variant="default" onClick={() => void runAllApproved()} disabled={batchRunning || runApprovedAdsBatch.isPending || executeApproved.isPending || runSeoToAdsPipeline.isPending || !actionQueue.some((item) => item.status === "approved")} aria-busy={batchRunning}>
                <CheckCircle2 className={`mr-1 h-3.5 w-3.5 ${batchRunning ? "animate-pulse" : ""}`} />{batchRunning ? "批量執行中…" : "批量執行全部已批准"}
              </Button>
            </div>
          </div>
          {executionMessages.__batch__ && <div className="mt-3 rounded bg-amber-500/[0.08] px-3 py-2 text-xs text-amber-200">{executionMessages.__batch__}</div>}
          <div className="mt-4 space-y-3">
            {!actionQueue.length && <div className="rounded bg-white/[0.03] p-3 text-xs text-muted-foreground">目前沒有足夠 Ads 證據生成動作，先重新計算或恢復 Ads 讀取權限。</div>}
            {actionQueue.map((item) => (
              <div key={item.id} className="rounded p-3" style={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-[240px] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-medium" style={{ color: "#e8e0d0" }}>{item.title}</h3>
                      <StatusBadge label={riskLabel(item.risk)} tone={item.risk === "low" ? "ready" : "warning"} />
                      <StatusBadge label={statusLabel(item.status)} tone={item.status === "approved" ? "ready" : item.status === "rejected" ? "muted" : "warning"} />
                      <StatusBadge label={executionStateLabel(executionStates[item.id] ?? "idle")} tone={executionStates[item.id] === "executed" ? "ready" : executionStates[item.id] === "failed" ? "muted" : "warning"} />
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{item.rationale}</p>
                    <p className="mt-1 text-xs leading-relaxed" style={{ color: "#d4a843" }}>預期：{item.expectedImpact}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">範圍：{item.proposedScope}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    <Button size="sm" variant={item.status === "approved" ? "default" : "outline"} onClick={() => runPrimaryAction(item)} disabled={executeApproved.isPending || runSeoToAdsPipeline.isPending}>
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" />{item.id.startsWith("trusted-negative:") ? "檢查並執行" : "一鍵檢查並執行"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setShowResults((current) => ({ ...current, [item.id]: !current[item.id] }))}>
                      <Search className="mr-1 h-3.5 w-3.5" />{showResults[item.id] ? "收起結果" : "查看結果"}
                    </Button>
                  </div>
                </div>
                {executionMessages[item.id] && (
                  <div className="mt-3 rounded bg-white/[0.04] px-3 py-2 text-xs text-muted-foreground">
                    {executionMessages[item.id]}
                  </div>
                )}
                {!item.id.startsWith("trusted-negative:") && <ContentChangeChecklist item={item} verification={seoPlans[item.id]?.verification} />}
                {!item.id.startsWith("trusted-negative:") && <PipelineProgress stage={pipelineProgress[item.id]} />}
                {showResults[item.id] && (
                  <div className="mt-2 rounded bg-emerald-500/[0.06] px-3 py-2 text-[11px] text-emerald-300">
                    <div className="font-medium">執行結果：{executionStateLabel(executionStates[item.id] ?? "idle")}</div>
                    {executionDetails[item.id] && <div className="mt-1">{executionDetails[item.id]}</div>}
                  </div>
                )}
                <details className="mt-2 text-[11px] text-muted-foreground">
                  <summary className="cursor-pointer select-none">進階檢查／拒絕</summary>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => void prepareSeoToAds(item)} disabled={seoToAdsPlan.isPending}><Link2 className="mr-1 h-3.5 w-3.5" />內容 Contract</Button>
                    <Button size="sm" variant="outline" onClick={() => void verifySeoToAds(item)} disabled={verifySeoToAdsPlan.isPending}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />重驗 Landing</Button>
                    <Button size="sm" variant="outline" onClick={() => void previewDryRun(item)} disabled={dryRunApproved.isPending}><Search className="mr-1 h-3.5 w-3.5" />只做 Dry-run</Button>
                    {item.id === "interior-photography:quality-review" && <Button size="sm" variant="outline" onClick={() => void reverifyAfterFix(item)} disabled={verifySeoToAdsPlan.isPending}><RefreshCw className="mr-1 h-3.5 w-3.5" />修正後自動重驗</Button>}
                    <Button size="sm" variant="outline" onClick={() => setActionStatus(item.id, "rejected")}><CircleAlert className="mr-1 h-3.5 w-3.5" />拒絕</Button>
                  </div>
                </details>
                {seoPlans[item.id]?.plan && (
                  <div className="mt-2 rounded bg-amber-500/[0.06] px-3 py-2 text-[11px] text-amber-200">
                    SEO-to-Ads contract：只產生提案，不自動改網站；{seoPlans[item.id]?.verification ? `Landing ${seoPlans[item.id]?.verification?.adsReady ? "READY" : "BLOCKED"}` : "等待內容發布後重驗"}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 rounded bg-white/[0.03] p-3">
            <div className="text-xs font-medium" style={{ color: "#e8e0d0" }}>最近 Ads 執行紀錄</div>
            <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
              {(executionLogs ?? []).slice(0, 8).map((log) => <div key={log.id} className="flex flex-wrap gap-2"><span className={log.status === "success" ? "text-emerald-300" : "text-red-300"}>{log.status}</span><span>{new Date(log.syncedAt).toLocaleString("zh-HK")}</span><span className="truncate">{log.message}</span></div>)}
              {!executionLogs?.length && <div>暫無執行紀錄。</div>}
            </div>
          </div>
          <div className="mt-4 rounded bg-emerald-500/[0.04] p-3" data-testid="ads-action-history">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-medium" style={{ color: "#e8e0d0" }}>Action Queue 歷史紀錄</div>
              <div className="text-[10px] text-muted-foreground">已完成項目不會再次進入待執行清單</div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="歷史紀錄篩選">
              {([
                ["all", "全部"],
                ["executed", "已完成"],
                ["blocked", "被阻擋"],
                ["failed", "失敗"],
              ] as const).map(([value, label]) => {
                const count = value === "all" ? actionHistory.length : actionHistory.filter((record) => record.state === value).length;
                return (
                  <Button
                    key={value}
                    size="sm"
                    variant={historyFilter === value ? "default" : "outline"}
                    onClick={() => setHistoryFilter(value)}
                    aria-pressed={historyFilter === value}
                    data-testid={`history-filter-${value}`}
                    className="h-7 px-2 text-[11px]"
                  >
                    {label} ({count})
                  </Button>
                );
              })}
            </div>
            <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
              {filteredActionHistory.slice(0, 10).map((record) => (
                <div key={`${record.actionId}-${record.completedAt}`} className="flex flex-wrap gap-2">
                  <span className={record.state === "executed" ? "text-emerald-300" : record.state === "blocked" ? "text-amber-300" : "text-red-300"}>{executionStateLabel(record.state)}</span>
                  <span>{new Date(record.completedAt).toLocaleString("zh-HK")}</span>
                  <span>{record.title}</span>
                  <span>{record.mutationCount} mutations</span>
                  <span className="truncate">{record.message}</span>
                  {record.requeuedBy && <span className="text-amber-200">重加入：{record.requeuedBy} · {record.requeueReason ?? "未提供原因"}</span>}
                  {isRequeueableInteriorAction(record) && <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => requeueHistoryRecord(record)}>重新加入待執行</Button>}
                </div>
              ))}
              {!!actionHistory.length && !filteredActionHistory.length && <div>此篩選條件暫無紀錄。</div>}
              {!actionHistory.length && <div>暫無本機 Action Queue 歷史紀錄。</div>}
            </div>
          </div>
          <div className="mt-4 rounded bg-white/[0.03] p-3">
            <div className="text-xs font-medium" style={{ color: "#e8e0d0" }}>每日 Negative Plan 報表</div>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-[11px] text-muted-foreground"><thead><tr><th className="pr-3">日期</th><th className="pr-3">runs</th><th className="pr-3">新增</th><th className="pr-3">已存在</th><th className="pr-3">跳過</th><th>GAQL verified</th></tr></thead><tbody>{(dailyReport ?? []).slice(0, 7).map((row) => <tr key={row.date}><td className="pr-3">{row.date}</td><td className="pr-3">{row.runs}</td><td className="pr-3 text-emerald-300">{row.added}</td><td className="pr-3">{row.alreadyExisted}</td><td className="pr-3">{row.skipped}</td><td>{row.verified}</td></tr>)}</tbody></table>
              {!dailyReport?.length && <div className="mt-2">暫無每日 negative plan 執行數據。</div>}
            </div>
          </div>
        </section>

        {(error || (!isLoading && data && (!data.sources.googleAds.available || !data.sources.ahrefs.available))) && (
          <section className="flex items-start gap-3 rounded p-4 text-sm" style={{ background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.3)" }}>
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" style={{ color: "#fbbf24" }} />
            <div>
              <div style={{ color: "#fbbf24" }}>部分外部來源暫不可用；GSC、收入與 AEO 資料仍可生成 backlog。</div>
              <div className="mt-1 text-xs text-muted-foreground">{sourceError}</div>
              <div className="mt-1 text-xs text-muted-foreground">來源恢復後，頁面每 5 分鐘會重試；成功的 Ahrefs 結果會快取 24 小時，避免重複 API 消耗。</div>
            </div>
          </section>
        )}

        {isLoading && <div className="py-16 text-center text-sm text-muted-foreground">正在組合 GSC query、收入、Ads、Ahrefs 與 live AEO 訊號…</div>}

        {data && (
          <>
            <section className="overflow-hidden rounded" style={{ border: "1px solid rgba(212,168,67,0.15)", background: panel }}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3" style={{ borderColor: "rgba(212,168,67,0.12)" }}>
                <div className="flex items-center gap-2">
                  <ListChecks className="h-4 w-4" style={{ color: gold }} />
                  <h2 className="text-sm font-medium" style={{ color: "#e8e0d0" }}>可執行 Backlog</h2>
                </div>
                <div className="text-[11px] text-muted-foreground">{data.backlogDefinition.selection}</div>
              </div>

              {!data.backlog.length ? (
                <div className="px-5 py-12 text-center text-sm text-muted-foreground">
                  這個資料窗暫未找到「已有香港商業曝光但未進第一頁」的可配對 query。可改看 60／90 日，或先確認 GSC property 是否涵蓋服務頁。
                </div>
              ) : (
                <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                  {data.backlog.map((item, index) => (
                    <article key={item.id} className="p-4 sm:p-5">
                      <div className="flex flex-wrap gap-4">
                        <div className="flex min-w-[250px] flex-1 items-start gap-3">
                          <ScoreBadge score={item.score} />
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[11px]" style={{ color: gold }}>#{index + 1}</span>
                              <h3 className="font-medium" style={{ color: "#e8e0d0" }}>{item.query}</h3>
                              <StatusBadge label={item.serviceLabel} tone="muted" />
                              <StatusBadge label={item.expectedTime.label} tone={item.expectedTime.label.startsWith("快") ? "ready" : "warning"} />
                            </div>
                            <a href={item.targetUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
                              目標頁：{item.targetPath}<ExternalLink className="h-3 w-3" />
                            </a>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {item.ahrefs.intents.map((intent) => <FeatureChip key={intent}>{intent}</FeatureChip>)}
                              {item.ahrefs.serpFeatures.map((feature) => <FeatureChip key={feature}>{feature.replaceAll("_", " ")}</FeatureChip>)}
                              {item.aeo.status === "ready" ? <FeatureChip>AEO 基礎已就緒</FeatureChip> : <FeatureChip>AEO 待補強</FeatureChip>}
                            </div>
                          </div>
                        </div>

                        <div className="grid min-w-full grid-cols-2 gap-x-5 gap-y-3 text-xs sm:min-w-[570px] sm:grid-cols-5">
                          <Metric label="GSC 位置" value={item.organic.position == null ? "—" : <span className="inline-flex items-center gap-1">第 {item.organic.position} {gscPositionTrend(item.organic)}</span>} hint={<span>{number(item.organic.impressions)} 曝光 · CTR {item.organic.ctr}%{item.organic.previousPosition != null ? ` · 前期第 ${item.organic.previousPosition}` : ""}</span>} />
                          <Metric label="Ads 商業意圖" value={item.ads.commercialSignal === "available" ? `${item.ads.keywordCount} 個關鍵字` : "待授權"} hint={item.ads.commercialSignal === "available" ? `${item.ads.clicks} clicks · ${currency(item.ads.spendHKD)}${item.ads.conversions ? ` · ${number(item.ads.conversions)} 轉換` : ""}` : "恢復後自動補齊"} />
                          <Metric label="Ads 搜尋字詞" value={item.searchTerms.termCount ? `${item.searchTerms.termCount} 個字詞` : "—"} hint={item.searchTerms.termCount ? `${number(item.searchTerms.conversions)} 轉換 · ${item.searchTerms.topTerms.slice(0, 2).join("、") || "相關字詞"}` : "無匹配字詞"} />
                          <Metric label="Ahrefs 難度" value={item.ahrefs.available ? `KD ${number(item.ahrefs.difficulty)}` : "待連線"} hint={item.ahrefs.available ? `Volume ${number(item.ahrefs.volume)}` : "恢復後自動補齊"} />
                          <Metric label="商業價值" value={currency(item.revenue.acceptedRevenueHKD)} hint={`${item.revenue.acceptedCount} 接受 · ${item.revenue.leadCount} 詢價${item.revenue.searchLeads ? ` · ${item.revenue.searchLeads} 搜尋來源` : ""}`} />
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 xl:grid-cols-[0.95fr_1.25fr_1fr]">
                        <div className="rounded p-3" style={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.06)" }}>
                          <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground"><BarChart3 className="h-3 w-3" /> 計分透明度</div>
                          <div className="grid grid-cols-5 gap-1 text-center text-[10px]">
                            {[
                              ["收入", item.breakdown.businessValue, 30],
                              ["Ads", item.breakdown.paidIntent, 20],
                              ["SEO", item.breakdown.organicOpportunity, 25],
                              ["AEO", item.breakdown.aeoGap, 12],
                              ["KD", item.breakdown.ahrefsFeasibility, 13],
                            ].map(([label, value, max]) => (
                              <div key={String(label)}><div className="text-sm tabular-nums" style={{ color: gold }}>{String(value)}</div><div className="text-muted-foreground">{String(label)} / {String(max)}</div></div>
                            ))}
                          </div>
                        </div>

                        <div className="rounded p-3" style={{ background: "rgba(212,168,67,0.04)", border: "1px solid rgba(212,168,67,0.13)" }}>
                          <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em]" style={{ color: gold }}><Search className="h-3 w-3" /> 內容與 AEO 缺口</div>
                          <ul className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                            {item.gaps.content.map((gap) => <li key={gap} className="flex gap-2"><ArrowUpRight className="mt-0.5 h-3 w-3 shrink-0" style={{ color: gold }} />{gap}</li>)}
                          </ul>
                        </div>

                        <div className="rounded p-3" style={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.06)" }}>
                          <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground"><Link2 className="h-3 w-3" /> 內鏈與權威</div>
                          <p className="text-xs leading-relaxed text-muted-foreground">{item.gaps.internalLinks}</p>
                          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{item.gaps.authority}</p>
                        </div>
                      </div>

                      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr]">
                        <div className="flex gap-2 rounded p-3 text-xs text-muted-foreground" style={{ background: "#0a0a0a" }}>
                          <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: gold }} />
                          <div><span style={{ color: "#e8e0d0" }}>{item.expectedTime.label}</span><span className="ml-1">— {item.expectedTime.basis}</span></div>
                        </div>
                        <div className="flex gap-2 rounded p-3 text-xs text-muted-foreground" style={{ background: "#0a0a0a" }}>
                          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: gold }} />
                          <div>{item.actions[1]}</div>
                        </div>
                      </div>

                      {item.ahrefs.competitors.length > 0 && (
                        <div className="mt-3 rounded p-3" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
                          <div className="mb-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Ahrefs SERP 首 3 個自然競爭頁</div>
                          <div className="grid gap-2 md:grid-cols-3">
                            {item.ahrefs.competitors.map((competitor) => (
                              <a key={`${competitor.position}-${competitor.url}`} href={competitor.url ?? undefined} target="_blank" rel="noreferrer" className="rounded bg-white/[0.04] p-2 text-xs hover:bg-white/[0.07]">
                                <div className="line-clamp-2" style={{ color: "#e8e0d0" }}>#{competitor.position} {competitor.title ?? competitor.url ?? "無標題"}</div>
                                <div className="mt-1 text-[10px] text-muted-foreground">DR {number(competitor.domainRating)} · RD {number(competitor.referringDomains)}</div>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded p-4" style={{ background: panel, border: "1px solid rgba(212,168,67,0.12)" }}>
              <h2 className="mb-2 text-sm font-medium" style={{ color: gold }}>自動補齊規則</h2>
              <p className="text-xs leading-relaxed text-muted-foreground">{data.backlogDefinition.automaticRefresh}</p>
              <p className="mt-2 text-[10px] text-muted-foreground">資料窗：{data.window.startDate} 至 {data.window.endDate}（香港時間，完整日）。更新於 {new Date(data.generatedAt).toLocaleString("zh-HK")}；此頁只讀取資料，不會修改 Ads、網站或資料庫。</p>
            </section>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
