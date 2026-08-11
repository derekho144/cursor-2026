import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  RefreshCw,
  Mail,
  ExternalLink,
  CheckCircle,
  XCircle,
  Clock,
  Briefcase,
  MapPin,
  DollarSign,
  User,
  AlertCircle,
  Loader2,
  SendHorizonal,
  CheckCheck,
  AlertTriangle,
  Pencil,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";

type JobStatus = "new" | "email_fetched" | "first_email_sent" | "imported" | "ignored";

interface FreehunterJob {
  id: number;
  jobId: string;
  title: string;
  clientName: string | null;
  clientEmail: string | null;
  budget: string | null;
  location: string | null;
  description: string | null;
  jobUrl: string;
  categories: string | null;
  status: JobStatus;
  scrapedAt: Date | string;
  postedAt: Date | string | null;
  aiScore: number | null;
  aiScoreReason: string | null;
  emailInquiryId: number | null;
  firstEmailSentAt: Date | string | null;
  // Reply tracking from linked email_inquiry
  replyTrackingId?: string | null;
  replyOpenedAt?: Date | string | null;
  replyOpenCount?: number | null;
  realOpenCount?: number | null;
  followUpSentAt?: Date | string | null;
  quoteId?: number | null;
}

interface BulkSendResult {
  jobId: string;
  title: string;
  clientEmail: string;
  status: "sent" | "failed" | "skipped";
  reason?: string;
}

const STATUS_LABELS: Record<JobStatus, { label: string; color: string }> = {
  new: { label: "新工作", color: "bg-blue-100 text-blue-700" },
  email_fetched: { label: "已取得電郵", color: "bg-green-100 text-green-700" },
  first_email_sent: { label: "已發第一封郵件", color: "bg-amber-100 text-amber-700" },
  imported: { label: "已匯入詢價", color: "bg-purple-100 text-purple-700" },
  ignored: { label: "已忽略", color: "bg-gray-100 text-gray-500" },
};

function JobCard({
  job,
  onFetchEmail,
  onImport,
  onIgnore,
  onCreateTracking,
  onAiCompose,
  isFetchingEmail,
  isImporting,
  isIgnoring,
  isCreatingTracking,
  isComposing,
}: {
  job: FreehunterJob;
  onFetchEmail: (jobId: string) => void;
  onImport: (jobId: string) => void;
  onIgnore: (jobId: string) => void;
  onCreateTracking: (jobId: string) => void;
  onAiCompose: (jobId: string) => void;
  isFetchingEmail: boolean;
  isImporting: boolean;
  isIgnoring: boolean;
  isCreatingTracking: boolean;
  isComposing: boolean;
}) {
  const statusInfo = STATUS_LABELS[job.status];
  const scrapedDate = new Date(job.scrapedAt).toLocaleString("zh-HK");

  return (
    <Card className="border border-border hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex flex-col gap-3">
          <div className="flex-1 min-w-0">
            {/* Title & Status */}
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusInfo.color}`}>
                {statusInfo.label}
              </span>
              {job.aiScore !== null && job.aiScore !== undefined && (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                    job.aiScore >= 80
                      ? "bg-emerald-100 text-emerald-700"
                      : job.aiScore >= 50
                      ? "bg-yellow-100 text-yellow-700"
                      : "bg-red-100 text-red-600"
                  }`}
                  title={job.aiScoreReason || ""}
                >
                  AI {job.aiScore}%
                </span>
              )}
              {job.categories && (
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  {job.categories.split(",").slice(0, 2).join(" · ")}
                </span>
              )}
            </div>

            <h3 className="font-semibold text-sm leading-snug mb-2 line-clamp-2">{job.title}</h3>

            {/* Meta info */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mb-2">
              {job.clientName && (
                <span className="flex items-center gap-1">
                  <User className="w-3 h-3" />
                  {job.clientName}
                </span>
              )}
              {job.budget && (
                <span className="flex items-center gap-1">
                  <DollarSign className="w-3 h-3" />
                  {job.budget}
                </span>
              )}
              {job.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {job.location}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {scrapedDate}
              </span>
            </div>

            {/* Client Email */}
            {job.clientEmail && (
              <div className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 px-2 py-1 rounded mb-2 w-fit">
                <Mail className="w-3 h-3" />
                <span className="font-medium">{job.clientEmail}</span>
              </div>
            )}

            {/* FH 工作板已發第一封郵件資訊 */}
            {job.firstEmailSentAt && (
              <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded mb-2 w-fit">
                <CheckCircle className="w-3 h-3" />
                <span>第一封郵件已發送 {new Date(job.firstEmailSentAt).toLocaleDateString("zh-HK")}</span>
              </div>
            )}

            {/* 已關聯詢價郵件記錄 */}
            {job.emailInquiryId && (
              <div className="flex items-center gap-1.5 text-xs text-purple-700 bg-purple-50 px-2 py-1 rounded mb-2 w-fit">
                <Mail className="w-3 h-3" />
                <span>已建立詢價記錄 #{job.emailInquiryId}</span>
              </div>
            )}

            {/* 跟進郵件狀態（已發跟進 / 等待 24 小時跟進 / 未發）*/}
            {job.followUpSentAt && new Date(job.followUpSentAt).getFullYear() > 1970 ? (
              <div
                className="flex items-center gap-1.5 text-xs px-2 py-1 rounded mb-2 w-fit"
                style={{ background: "rgba(33,150,243,0.10)", color: "#1565c0" }}
                title={`跟進郵件已於 ${new Date(job.followUpSentAt).toLocaleString("zh-HK")} 自動發送`}
              >
                <Mail className="w-3 h-3" />
                <span>跟進郵件已發 · {new Date(job.followUpSentAt).toLocaleDateString("zh-HK")}</span>
              </div>
            ) : job.firstEmailSentAt && job.status === "first_email_sent" && (() => {
              const sentAt = new Date(job.firstEmailSentAt);
              const followUpAt = new Date(sentAt.getTime() + 24 * 60 * 60 * 1000);
              const now = new Date();
              const isPending = followUpAt > now;
              const hoursLeft = Math.max(0, Math.ceil((followUpAt.getTime() - now.getTime()) / (60 * 60 * 1000)));
              return (
                <div
                  className="flex items-center gap-1.5 text-xs px-2 py-1 rounded mb-2 w-fit"
                  style={isPending
                    ? { background: "rgba(255,152,0,0.10)", color: "#e65100" }
                    : { background: "rgba(33,150,243,0.08)", color: "#1565c0" }
                  }
                  title={isPending
                    ? `預計於 ${followUpAt.toLocaleString("zh-HK")} 自動發送跟進郵件`
                    : `跟進郵件將於下次排程檢查時發送`
                  }
                >
                  <Clock className="w-3 h-3" />
                  <span>
                    {isPending ? `跟進郵件：${hoursLeft} 小時後發送` : "跟進郵件將即發送"}
                  </span>
                </div>
              );
            })()}

            {/* 外發郵件已讀狀態（只在已發第一封郵件且有追蹤 ID 時顯示）*/}
            {job.replyTrackingId && (
              job.replyOpenedAt
                ? <div
                    className="flex items-center gap-1.5 text-xs px-2 py-1 rounded mb-2 w-fit"
                    style={{ background: "rgba(76,175,80,0.12)", color: "#2e7d32" }}
                    title={`客戶於 ${new Date(job.replyOpenedAt).toLocaleString("zh-HK")} 開啟了外發郵件（原始次數: ${job.replyOpenCount ?? 0}，過濾機器人後: ${job.realOpenCount ?? 0}）`}
                  >
                    <CheckCircle className="w-3 h-3" />
                    <span>
                      客戶已讀
                      {(() => {
                        const real = job.realOpenCount ?? 0;
                        const raw = job.replyOpenCount ?? 0;
                        const count = real > 0 ? real : raw;
                        return count > 1 ? ` ×${count}` : "";
                      })()}
                      {(job.realOpenCount ?? 0) < (job.replyOpenCount ?? 0) && (job.replyOpenCount ?? 0) > 0 && (
                        <span className="ml-1 opacity-50" title={`原始 ${job.replyOpenCount} 次，${(job.replyOpenCount ?? 0) - (job.realOpenCount ?? 0)} 次已過濾（機器人/預覽）`}>*</span>
                      )}
                      {" · "}{new Date(job.replyOpenedAt).toLocaleDateString("zh-HK")}
                    </span>
                  </div>
                : <div
                    className="flex items-center gap-1.5 text-xs px-2 py-1 rounded mb-2 w-fit"
                    style={{ background: "rgba(0,0,0,0.04)", color: "#888" }}
                    title="客戶尚未開啟外發郵件"
                  >
                    <Mail className="w-3 h-3" />
                    <span>外發郵件未讀</span>
                  </div>
            )}

            {/* Description preview */}
            {job.description && (
              <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{job.description}</p>
            )}
          </div>

          {/* Actions — horizontal row, wraps on mobile */}
          <div className="flex flex-row flex-wrap items-center gap-2">
            <a
              href={job.jobUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline px-2 py-1 rounded border border-blue-200 bg-blue-50 hover:bg-blue-100 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              查看工作
            </a>

            {job.quoteId && (
              <a
                href={`/quotes/${job.quoteId}`}
                className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline px-2 py-1 rounded border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 transition-colors font-medium"
              >
                <CheckCircle className="w-3 h-3" />
                查看報價單
              </a>
            )}

            {job.status === "new" && (
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-8 px-3"
                onClick={() => onFetchEmail(job.jobId)}
                disabled={isFetchingEmail}
              >
                {isFetchingEmail ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Mail className="w-3 h-3" />
                )}
                取得電郵
              </Button>
            )}

            {job.status === "email_fetched" && (
              <Button
                size="sm"
                className="text-xs h-8 px-3 bg-emerald-600 hover:bg-emerald-700"
                onClick={() => onAiCompose(job.jobId)}
                disabled={isComposing}
                title="AI 根據工作內容自動撰寫郵件，發送前可預覽及編輯"
              >
                {isComposing ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Pencil className="w-3 h-3" />
                )}
                AI 撰寫郵件
              </Button>
            )}

            {(job.status === "new" || job.status === "email_fetched") && (
              <Button
                size="sm"
                className="text-xs h-8 px-3 bg-purple-600 hover:bg-purple-700"
                onClick={() => onImport(job.jobId)}
                disabled={isImporting}
              >
                {isImporting ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <CheckCircle className="w-3 h-3" />
                )}
                匯入詢價
              </Button>
            )}

            {job.status === "imported" && (
              <span className="text-xs text-purple-600 flex items-center gap-1 px-2 py-1">
                <CheckCircle className="w-3 h-3" />
                已匯入
              </span>
            )}

            {job.status === "first_email_sent" && !job.replyTrackingId && (
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-8 px-3 text-orange-600 border-orange-300 hover:bg-orange-50"
                onClick={() => onCreateTracking(job.jobId)}
                disabled={isCreatingTracking}
                title="為此工作建立已讀追蹤記錄"
              >
                {isCreatingTracking ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Mail className="w-3 h-3" />
                )}
                補建追蹤
              </Button>
            )}
            {job.status !== "ignored" && job.status !== "imported" && (
              <Button
                size="sm"
                variant="ghost"
                className="text-xs h-8 px-3 text-muted-foreground hover:text-red-600"
                onClick={() => onIgnore(job.jobId)}
                disabled={isIgnoring}
              >
                <XCircle className="w-3 h-3" />
                忽略
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Bulk Send Result Dialog ──────────────────────────────────────────────────
function BulkSendResultDialog({
  open,
  onClose,
  results,
  sent,
  failed,
  skipped,
}: {
  open: boolean;
  onClose: () => void;
  results: BulkSendResult[];
  sent: number;
  failed: number;
  skipped: number;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <CheckCheck className="w-5 h-5 text-green-600" />
            批量發送完成
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              {/* Summary */}
              <div className="flex gap-4 text-sm font-medium">
                <span className="text-green-700">✓ 成功 {sent} 封</span>
                {failed > 0 && <span className="text-red-600">✗ 失敗 {failed} 封</span>}
                {skipped > 0 && <span className="text-gray-500">⊘ 跳過 {skipped} 個</span>}
              </div>

              {/* Per-job results */}
              <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
                {results.map((r) => (
                  <div
                    key={r.jobId}
                    className={`flex items-start gap-2 text-xs px-2 py-1.5 rounded ${
                      r.status === "sent"
                        ? "bg-green-50 text-green-800"
                        : r.status === "failed"
                        ? "bg-red-50 text-red-800"
                        : "bg-gray-50 text-gray-600"
                    }`}
                  >
                    {r.status === "sent" ? (
                      <CheckCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    ) : r.status === "failed" ? (
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="font-medium truncate">{r.title}</p>
                      <p className="opacity-70">{r.clientEmail}{r.reason ? ` — ${r.reason}` : ""}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={onClose}>關閉</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function FreehunterBoard() {
  const [activeTab, setActiveTab] = useState<"active" | "all" | "ignored">("active");
  const [actionJobId, setActionJobId] = useState<string | null>(null);
  const [confirmImportJobId, setConfirmImportJobId] = useState<string | null>(null);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [composeJobId, setComposeJobId] = useState<string | null>(null);
  const [composePreview, setComposePreview] = useState<{
    subject: string;
    body: string;
    clientEmail: string;
    clientName: string;
  } | null>(null);

  const [bulkSendResult, setBulkSendResult] = useState<{
    sent: number;
    failed: number;
    skipped: number;
    results: BulkSendResult[];
  } | null>(null);

  const utils = trpc.useUtils();

  const { data, isLoading, refetch } = trpc.freehunterBoard.getStatus.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const backfill = trpc.freehunterBoard.backfillHighConfidenceEmails.useMutation({
    onSuccess: (result) => {
      utils.freehunterBoard.getStatus.invalidate();
      const hasErrors = result.errors && result.errors.length > 0;
      if (result.processed > 0) {
        if (hasErrors) {
          toast.warning(`補跑完成（有錯誤）：處理 ${result.processed} 個工作，取得 ${result.emailsFetched} 個電郵，發送 ${result.emailsSent} 封郵件。錯誤：${result.errors?.[0]}`);
        } else {
          toast.success(`補跑完成：處理 ${result.processed} 個工作，取得 ${result.emailsFetched} 個電郵，發送 ${result.emailsSent} 封郵件`);
        }
      } else if (hasErrors) {
        toast.error(`補跑失敗：${result.errors?.[0]}`);
      } else {
        toast.info(`補跑完成：沒有待處理的新工作`);
      }
    },
    onError: (e) => {
      toast.error(`補跑失敗：${e.message}`);
    },
  });

  const scrapeNow = trpc.freehunterBoard.scrapeNow.useMutation({
    onSuccess: (result) => {
      toast.success(`爬取完成：發現 ${result.newJobs} 個新工作，取得 ${result.emailsFetched} 個客戶電郵`);
      utils.freehunterBoard.getStatus.invalidate();
      // Auto-backfill: fetch emails for any remaining 'new' jobs
      backfill.mutate();
    },
    onError: (e) => {
      toast.error(`爬取失敗：${e.message}`);
    },
  });

  const fetchEmail = trpc.freehunterBoard.fetchEmail.useMutation({
    onSuccess: (result) => {
      toast.success(`成功取得電郵：${result.email}`);
      utils.freehunterBoard.getStatus.invalidate();
      setActionJobId(null);
    },
    onError: (e) => {
      toast.error(`無法取得電郵：${e.message}`);
      setActionJobId(null);
    },
  });

  const importAsInquiry = trpc.freehunterBoard.importAsInquiry.useMutation({
    onSuccess: () => {
      toast.success("已匯入詢價，請前往詢價郵件頁面處理");
      utils.freehunterBoard.getStatus.invalidate();
      setActionJobId(null);
      setConfirmImportJobId(null);
    },
    onError: (e) => {
      toast.error(`匯入失敗：${e.message}`);
      setActionJobId(null);
      setConfirmImportJobId(null);
    },
  });

  const ignoreJob = trpc.freehunterBoard.ignoreJob.useMutation({
    onSuccess: () => {
      utils.freehunterBoard.getStatus.invalidate();
      setActionJobId(null);
    },
    onError: (e) => {
      toast.error(`操作失敗：${e.message}`);
      setActionJobId(null);
    },
  });

  const createTrackingRecord = trpc.freehunterBoard.createTrackingRecord.useMutation({
    onSuccess: (result) => {
      if (result.alreadyExists) {
        toast.info("此工作已有追蹤記錄");
      } else {
        toast.success("追蹤記錄已建立，客戶開啟郵件後將顯示已讀狀態");
      }
      utils.freehunterBoard.getStatus.invalidate();
      setActionJobId(null);
    },
    onError: (e) => {
      toast.error(`建立追蹤記錄失敗：${e.message}`);
      setActionJobId(null);
    },
  });

  const bulkSendFirstEmail = trpc.freehunterBoard.bulkSendFirstEmail.useMutation({
    onSuccess: (result) => {
      utils.freehunterBoard.getStatus.invalidate();
      setBulkSendResult(result);
      if (result.sent > 0) {
        toast.success(`批量發送完成：成功 ${result.sent} 封${result.failed > 0 ? `，失敗 ${result.failed} 封` : ""}`);
      } else if (result.skipped > 0 && result.sent === 0) {
        toast.info("所有工作已有追蹤記錄，無需重複發送");
      } else {
        toast.error("批量發送失敗，請查看詳細結果");
      }
    },
    onError: (e) => {
      toast.error(`批量發送失敗：${e.message}`);
    },
  });

  const handleCreateTracking = (jobId: string) => {
    setActionJobId(jobId);
    createTrackingRecord.mutate({ jobId });
  };

  // Deduplicate by jobId as a safety net (backend already deduplicates,
  // but this prevents React key warnings if duplicates ever slip through)
  const rawJobList: FreehunterJob[] = (data?.jobs as FreehunterJob[]) || [];
  const jobs: FreehunterJob[] = Array.from(
    new Map(rawJobList.map((j) => [j.jobId, j])).values()
  );
  const stats = data?.stats;
  const session = data?.session;

  const activeJobs = jobs.filter((j) => j.status === "new" || j.status === "email_fetched" || j.status === "first_email_sent");
  const allJobs = jobs.filter((j) => j.status !== "ignored");
  const ignoredJobs = jobs.filter((j) => j.status === "ignored");

  const displayJobs =
    activeTab === "active" ? activeJobs : activeTab === "all" ? allJobs : ignoredJobs;

  // Count eligible jobs for bulk send (email_fetched with a client email)
  const eligibleForBulkSend = jobs.filter(
    (j) => j.status === "email_fetched" && j.clientEmail
  );

  const handleFetchEmail = (jobId: string) => {
    setActionJobId(jobId);
    fetchEmail.mutate({ jobId });
  };

  const handleImport = (jobId: string) => {
    setConfirmImportJobId(jobId);
  };

  const handleIgnore = (jobId: string) => {
    setActionJobId(jobId);
    ignoreJob.mutate({ jobId });
  };

  const aiComposeEmail = trpc.freehunterBoard.aiComposeEmail.useMutation({
    onSuccess: (result) => {
      setComposePreview({
        subject: result.subject,
        body: result.body,
        clientEmail: result.clientEmail,
        clientName: result.clientName,
      });
    },
    onError: (e) => {
      toast.error(`AI 撰寫失敗：${e.message}`);
      setComposeJobId(null);
    },
  });

  const manualSendEmail = trpc.freehunterBoard.manualSendEmail.useMutation({
    onSuccess: () => {
      toast.success("郵件已成功發送！");
      setComposePreview(null);
      setComposeJobId(null);
      utils.freehunterBoard.getStatus.invalidate();
    },
    onError: (e) => {
      toast.error(`發送失敗：${e.message}`);
    },
  });

  const handleAiCompose = (jobId: string) => {
    setComposeJobId(jobId);
    setComposePreview(null);
    aiComposeEmail.mutate({ jobId });
  };

  const handleBulkSendConfirm = () => {
    setShowBulkConfirm(false);
    bulkSendFirstEmail.mutate({});
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Briefcase className="w-6 h-6 text-orange-500" />
            FreelanceHunter 工作板
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            自動爬取攝影相關工作，每 15 分鐘更新（09:00–21:00 HKT）
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          {/* Bulk Send Button — only shown when there are eligible jobs */}
          {eligibleForBulkSend.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-emerald-500 text-emerald-700 hover:bg-emerald-50 flex-1 sm:flex-none"
              onClick={() => setShowBulkConfirm(true)}
              disabled={bulkSendFirstEmail.isPending}
            >
              {bulkSendFirstEmail.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <SendHorizonal className="w-4 h-4" />
              )}
              {bulkSendFirstEmail.isPending
                ? "發送中..."
                : `批量發送（${eligibleForBulkSend.length}）`}
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => scrapeNow.mutate({ fetchEmails: true, maxJobs: 20 })}
            disabled={scrapeNow.isPending}
            className="gap-2 flex-1 sm:flex-none"
          >
            {scrapeNow.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {scrapeNow.isPending ? "爬取中..." : "立即爬取"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => backfill.mutate()}
            disabled={backfill.isPending}
            className="gap-2 flex-1 sm:flex-none"
            title="對現有「新工作」狀態的工作補跑取電郵"
          >
            {backfill.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Mail className="w-4 h-4" />
            )}
            {backfill.isPending ? "補跑中..." : "補跑電郵"}
          </Button>
        </div>
      </div>

      {/* Bulk Send In-Progress Banner */}
      {bulkSendFirstEmail.isPending && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          <div className="flex-1">
            <p className="font-medium">正在批量發送第一封郵件…</p>
            <p className="text-xs text-emerald-600 mt-0.5">
              AI 正在為每位客戶生成個人化開場白，每封郵件約需 3–5 秒，請稍候
            </p>
          </div>
        </div>
      )}

      {/* Session Status */}
      {session && (
        <div
          className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${
            session.connected
              ? "bg-green-50 text-green-700"
              : "bg-yellow-50 text-yellow-700"
          }`}
        >
          {session.connected ? (
            <CheckCircle className="w-4 h-4" />
          ) : (
            <AlertCircle className="w-4 h-4" />
          )}
          {session.connected
            ? `已登入 FreelanceHunter（${session.email}）`
            : "尚未登入 FreelanceHunter，爬取時將自動登入"}
        </div>
      )}

      {/* Health alert */}
      {(data as any)?.health && (
        <div
          className={`flex items-start gap-2 text-sm px-3 py-2 rounded-lg ${
            (data as any).health.scrapeStale || !(data as any).health.sessionConnected
              ? "bg-red-50 text-red-700 border border-red-200"
              : "bg-slate-50 text-slate-600 border border-slate-200"
          }`}
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">
              {(data as any).health.scrapeStale
                ? "爬取可能已停滯 — 請檢查登入或按「立即爬取」"
                : "爬取狀態正常"}
            </p>
            <p className="text-xs mt-0.5 opacity-80">
              上次資料：
              {(data as any).health.lastScrapedAt
                ? new Date((data as any).health.lastScrapedAt).toLocaleString("zh-HK")
                : "尚無"}
              {(data as any).health.ageHours != null ? `（${(data as any).health.ageHours} 小時前）` : ""}
              {(data as any).health.lastScrapeResult
                ? ` · 最近一次 +${(data as any).health.lastScrapeResult.newJobs} 新工作 / ${(data as any).health.lastScrapeResult.emailsFetched} 電郵`
                : ""}
            </p>
          </div>
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "新工作", value: stats.new, color: "text-blue-600" },
            { label: "已取得電郵", value: stats.emailFetched, color: "text-green-600" },
            { label: "已匯入詢價", value: stats.imported, color: "text-purple-600" },
            { label: "已忽略", value: stats.ignored, color: "text-gray-400" },
          ].map((s) => (
            <Card key={s.label} className="border border-border">
              <CardContent className="p-3 text-center">
                <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Job List */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <TabsList>
          <TabsTrigger value="active">
            待處理
            {stats && stats.new + stats.emailFetched > 0 && (
              <span className="ml-1.5 bg-blue-500 text-white text-xs rounded-full px-1.5 py-0.5">
                {stats.new + stats.emailFetched}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="all">全部</TabsTrigger>
          <TabsTrigger value="ignored">已忽略</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-4">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="rounded-lg p-4 space-y-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-5 w-48" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                    <Skeleton className="h-6 w-16 rounded-full" />
                  </div>
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-3/4" />
                  <div className="flex gap-2 pt-1">
                    <Skeleton className="h-7 w-20 rounded-md" />
                    <Skeleton className="h-7 w-20 rounded-md" />
                    <Skeleton className="h-7 w-20 rounded-md" />
                  </div>
                </div>
              ))}
            </div>
          ) : displayJobs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Briefcase className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">暫無工作記錄</p>
              <p className="text-sm mt-1">點擊「立即爬取」抓取最新工作</p>
            </div>
          ) : (
            <div className="space-y-3">
              {displayJobs.map((job) => (
                <JobCard
                  key={job.jobId}
                  job={job}
                  onFetchEmail={handleFetchEmail}
                  onImport={handleImport}
                  onIgnore={handleIgnore}
                  onCreateTracking={handleCreateTracking}
                  onAiCompose={handleAiCompose}
                  isFetchingEmail={fetchEmail.isPending && actionJobId === job.jobId}
                  isImporting={importAsInquiry.isPending && actionJobId === job.jobId}
                  isIgnoring={ignoreJob.isPending && actionJobId === job.jobId}
                  isCreatingTracking={createTrackingRecord.isPending && actionJobId === job.jobId}
                  isComposing={aiComposeEmail.isPending && composeJobId === job.jobId}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Import Confirmation Dialog */}
      <AlertDialog
        open={!!confirmImportJobId}
        onOpenChange={(open) => !open && setConfirmImportJobId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確認匯入詢價？</AlertDialogTitle>
            <AlertDialogDescription>
              此工作將被匯入為詢價記錄，你可以在「詢價郵件」頁面進行批核或拒絕。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmImportJobId) {
                  setActionJobId(confirmImportJobId);
                  importAsInquiry.mutate({ jobId: confirmImportJobId });
                }
              }}
            >
              確認匯入
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Send Confirmation Dialog */}
      <AlertDialog open={showBulkConfirm} onOpenChange={(o) => !o && setShowBulkConfirm(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <SendHorizonal className="w-5 h-5 text-emerald-600" />
              確認批量發送？
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  將向 <span className="font-semibold text-foreground">{eligibleForBulkSend.length} 位</span> 已取得電郵的客戶發送第一封開發郵件。
                </p>
                <div className="bg-muted rounded-lg p-3 space-y-1.5 text-xs">
                  <p className="font-medium text-foreground">每封郵件將包含：</p>
                  <p>• AI 根據工作描述生成的個人化開場白</p>
                  <p>• JD Studio HK 公司介紹及聯絡資料</p>
                  <p>• 隱藏追蹤像素（偵測客戶開啟狀態）</p>
                </div>
                <p className="text-muted-foreground">
                  已有追蹤記錄的工作將自動跳過，不會重複發送。
                  預計需時 {Math.ceil(eligibleForBulkSend.length * 5 / 60)} 分鐘。
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={handleBulkSendConfirm}
            >
              <SendHorizonal className="w-4 h-4 mr-1.5" />
              確認發送 {eligibleForBulkSend.length} 封
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* AI Compose Email Preview Dialog */}
      <Dialog
        open={!!composeJobId}
        onOpenChange={(open) => {
          if (!open && !aiComposeEmail.isPending && !manualSendEmail.isPending) {
            setComposePreview(null);
            setComposeJobId(null);
          }
        }}
      >
        <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-5 h-5 text-emerald-600" />
              AI 撰寫郵件預覽
            </DialogTitle>
          </DialogHeader>

          {/* Loading state — shown while AI is generating */}
          {aiComposeEmail.isPending && !composePreview && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 py-12 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
              <div className="text-center">
                <p className="font-medium text-sm">AI 正在撰寫郵件…</p>
                <p className="text-xs mt-1">根據工作描述生成個人化內容，約需 5-10 秒</p>
              </div>
            </div>
          )}

          {composePreview && (
            <div className="flex-1 overflow-y-auto space-y-4 py-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">收件人</label>
                <p className="text-sm bg-muted px-3 py-2 rounded">{composePreview.clientEmail}</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">主旨</label>
                <input
                  className="w-full text-sm border border-border rounded px-3 py-2 bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  value={composePreview.subject}
                  onChange={(e) => setComposePreview({ ...composePreview, subject: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">郵件內容（可直接編輯）</label>
                <Textarea
                  className="text-sm min-h-[180px] sm:min-h-[280px] font-mono"
                  value={composePreview.body}
                  onChange={(e) => setComposePreview({ ...composePreview, body: e.target.value })}
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              disabled={aiComposeEmail.isPending || manualSendEmail.isPending}
              onClick={() => {
                setComposePreview(null);
                setComposeJobId(null);
              }}
            >
              取消
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={manualSendEmail.isPending || aiComposeEmail.isPending || !composePreview}
              onClick={() => {
                if (composePreview && composeJobId) {
                  manualSendEmail.mutate({
                    jobId: composeJobId,
                    subject: composePreview.subject,
                    body: composePreview.body,
                  });
                }
              }}
            >
              {manualSendEmail.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin mr-2" />發送中...</>
              ) : (
                <><SendHorizonal className="w-4 h-4 mr-2" />確認發送</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Send Result Dialog */}
      {bulkSendResult && (
        <BulkSendResultDialog
          open={!!bulkSendResult}
          onClose={() => setBulkSendResult(null)}
          results={bulkSendResult.results}
          sent={bulkSendResult.sent}
          failed={bulkSendResult.failed}
          skipped={bulkSendResult.skipped}
        />
      )}
    </div>
  );
}
