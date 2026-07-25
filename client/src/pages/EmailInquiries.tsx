import { trpc } from "@/lib/trpc";
import { useState, useMemo, memo } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Mail, RefreshCw, CheckCircle, XCircle, EyeOff, ChevronDown, ChevronUp, FileText, Loader2, ExternalLink, Phone, User, AlertCircle, Video, Calendar, MessageSquare, Sparkles } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import DashboardLayout from "@/components/DashboardLayout";
import { keepPreviousData } from "@tanstack/react-query";
import { SERVICE_LABELS } from "@/lib/serviceLabels";

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending: { label: "待處理", color: "#d4a843" },
  pending_send: { label: "待發送", color: "#ff7043" },
  approved: { label: "已批核", color: "#4caf50" },
  rejected: { label: "已拒絕", color: "#e53935" },
  ignored: { label: "已忽略", color: "#666" },
};

const CONFIDENCE_CONFIG: Record<string, { label: string; color: string }> = {
  high: { label: "高", color: "#4caf50" },
  medium: { label: "中", color: "#d4a843" },
  low: { label: "低", color: "#e53935" },
};


// 預設拒絕原因選項
const REJECTION_REASONS = [
  { value: "budget_mismatch", label: "預算不符" },
  { value: "date_conflict", label: "日期衝突" },
  { value: "location_out_of_range", label: "地區不符" },
  { value: "already_has_photographer", label: "客人已有攝影師" },
  { value: "no_response", label: "客人無回應" },
  { value: "service_not_offered", label: "服務類型不提供" },
  { value: "other", label: "其他原因" },
];

const InquiryCard = memo(function InquiryCard({ inquiry, onRefresh }: { inquiry: any; onRefresh: () => void }) {
  const [, setLocation] = useLocation();
  const [expanded, setExpanded] = useState(false);

  // Approve dialog state
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [approveClientName, setApproveClientName] = useState("");
  const [approveClientEmail, setApproveClientEmail] = useState("");
  const [approveClientPhone, setApproveClientPhone] = useState("");

  // Reject dialog state
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [selectedReason, setSelectedReason] = useState("");
  const [customReason, setCustomReason] = useState("");

  const aiParsed = useMemo(() => {
    try { return inquiry.aiParsed ? JSON.parse(inquiry.aiParsed) : null; } catch { return null; }
  }, [inquiry.aiParsed]);

  const approveMutation = trpc.emailInquiries.approve.useMutation({
    onSuccess: (data) => {
      setShowApproveDialog(false);
      if (data?.quoteId) {
        toast.success("已批核！正在跳轉到報價單...");
        setTimeout(() => setLocation(`/quotes/${data.quoteId}`), 600);
      } else {
        toast.success("已批核，但報價單建立失敗，請手動建立");
        onRefresh();
      }
    },
    onError: (err) => toast.error(`操作失敗: ${err.message}`),
  });

  const rejectMutation = trpc.emailInquiries.reject.useMutation({
    onSuccess: () => {
      setShowRejectDialog(false);
      setSelectedReason("");
      setCustomReason("");
      toast.success("已拒絕此詢價");
      onRefresh();
    },
    onError: () => toast.error("操作失敗"),
  });

  const ignoreMutation = trpc.emailInquiries.ignore.useMutation({
    onSuccess: () => { toast.success("已忽略"); onRefresh(); },
    onError: () => toast.error("操作失敗"),
  });
  // High-value meeting flow state
  const [showMeetingEmailDialog, setShowMeetingEmailDialog] = useState(false);
  const [meetingEmailBody, setMeetingEmailBody] = useState("");
  const [showMeetingNotesDialog, setShowMeetingNotesDialog] = useState(false);
  const [meetingNotes, setMeetingNotes] = useState("");
  const isHighValue = !!(inquiry.meetingStatus && inquiry.meetingStatus !== "none");
  const meetingStatusLabel: Record<string, { label: string; color: string }> = {
    pending_meeting: { label: "待預約會議", color: "#9c27b0" },
    meeting_scheduled: { label: "已發送預約電郵", color: "#2196f3" },
    meeting_done: { label: "會議完成", color: "#4caf50" },
  };
  const sendMeetingEmailMutation = trpc.emailInquiries.sendMeetingEmail.useMutation({
    onSuccess: () => {
      setShowMeetingEmailDialog(false);
      toast.success("預約會議電郵已發送！");
      onRefresh();
    },
    onError: (err) => toast.error(`發送失敗: ${err.message}`),
  });
  const updateMeetingStatusMutation = trpc.emailInquiries.updateMeetingStatus.useMutation({
    onSuccess: () => { toast.success("會議狀態已更新"); onRefresh(); },
    onError: () => toast.error("更新失敗"),
  });
  const generateMeetingDraftMutation = trpc.emailInquiries.generateMeetingEmailDraft.useMutation({
    onSuccess: (data) => {
      setMeetingEmailBody(data.draft);
      toast.success("AI 已重新生成個性化草稿！");
    },
    onError: (err) => toast.error(`AI 生成失敗: ${err.message}`),
  });
  const openMeetingEmailDialog = () => {
    setMeetingEmailBody(inquiry.meetingEmailDraft || "");
    setShowMeetingEmailDialog(true);
  };

  // Confirm send quote mutation (for pending_send status)
  const [showConfirmSendDialog, setShowConfirmSendDialog] = useState(false);
  const [confirmEmailSubject, setConfirmEmailSubject] = useState("");
  const [confirmEmailBody, setConfirmEmailBody] = useState("");
  const confirmSendMutation = trpc.emailInquiries.confirmSendQuote.useMutation({
    onSuccess: (data) => {
      setShowConfirmSendDialog(false);
      toast.success(`報價郵件已發送至 ${data.sentTo}`);
      onRefresh();
    },
    onError: (err) => toast.error(`發送失敗: ${err.message}`),
  });
  const openConfirmSendDialog = () => {
    const aiP = aiParsed;
    const clientName = aiP?.clientName || inquiry.fromName || "Sir/Madam";
    setConfirmEmailSubject("");
    setConfirmEmailBody(`Dear ${clientName},

Thank you for your inquiry. Please find attached our quotation for your reference.

Should you have any questions, please feel free to contact us.

Best regards,
Derek
JD STUDIO HK
Tel No: (852) 9153 1976
Web: https://jdstudiohk.com/`);
    setShowConfirmSendDialog(true);
  };

  const statusInfo = STATUS_CONFIG[inquiry.status] ?? { label: inquiry.status, color: "#888" };
  const confidenceInfo = CONFIDENCE_CONFIG[inquiry.aiConfidence ?? "low"] ?? { label: "—", color: "#888" };
  const isPending = inquiry.status === "pending";
  const isPendingSend = inquiry.status === "pending_send";
  const isFreehunter = !!(inquiry.externalLink && (
    inquiry.externalLink.toLowerCase().includes("freehunter.com.hk") ||
    inquiry.externalLink.toLowerCase().includes("freehunter.hk")
  ));
  // 是否關聯到 FH 工作板記錄
  const hasFHJobLink = !!(inquiry.fhJobId);

  const openApproveDialog = () => {
    setApproveClientName(aiParsed?.clientName || inquiry.fromName || "");
    setApproveClientEmail(aiParsed?.clientEmail || inquiry.fromEmail || "");
    setApproveClientPhone(aiParsed?.clientPhone || "");
    setShowApproveDialog(true);
  };

  const openRejectDialog = () => {
    setSelectedReason("");
    setCustomReason("");
    setShowRejectDialog(true);
  };

  const handleApprove = () => {
    approveMutation.mutate({
      id: inquiry.id,
      clientName: approveClientName || undefined,
      clientEmail: approveClientEmail || undefined,
      clientPhone: approveClientPhone || undefined,
    });
  };

  const handleReject = () => {
    if (!selectedReason) {
      toast.error("請選擇拒絕原因");
      return;
    }
    const reasonLabel = selectedReason === "other"
      ? (customReason.trim() || "其他原因")
      : REJECTION_REASONS.find(r => r.value === selectedReason)?.label ?? selectedReason;
    rejectMutation.mutate({ id: inquiry.id, reason: reasonLabel });
  };

  return (
    <>
      <div
        style={{
          border: "1px solid rgba(212,168,67,0.15)",
          borderRadius: "4px",
          background: "#0d0d0d",
          overflow: "hidden",
        }}
      >
        {/* Header row */}
        <div
          className="flex items-start gap-3 px-5 py-4 cursor-pointer hover:bg-white/[0.02] transition-colors"
          onClick={() => setExpanded((v) => !v)}
        >
          <Mail className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "#d4a843" }} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-sm font-medium truncate">{inquiry.subject || "(無主題)"}</span>
              <span
                className="text-xs px-2 py-0.5 rounded-sm shrink-0"
                style={{ background: `${statusInfo.color}20`, color: statusInfo.color, fontSize: "0.6rem", letterSpacing: "0.1em" }}
              >
                {statusInfo.label}
              </span>
              {inquiry.aiConfidence && (
                <span
                  className="text-xs px-2 py-0.5 rounded-sm shrink-0"
                  style={{ background: `${confidenceInfo.color}15`, color: confidenceInfo.color, fontSize: "0.6rem", letterSpacing: "0.08em", border: `1px solid ${confidenceInfo.color}30` }}
                >
                  AI 信心: {confidenceInfo.label}
                </span>
              )}
              {inquiry.status === "approved" && inquiry.aiConfidence === "high" && inquiry.quoteId && (
                <span
                  className="text-xs px-2 py-0.5 rounded-sm shrink-0"
                  style={{ background: "rgba(156,39,176,0.15)", color: "#ce93d8", fontSize: "0.6rem", letterSpacing: "0.08em", border: "1px solid rgba(156,39,176,0.3)" }}
                >
                  ✨ AI 自動批核
                </span>
              )}
              {inquiry.status === "pending_send" && (
                <span
                  className="text-xs px-2 py-0.5 rounded-sm shrink-0"
                  style={{ background: "rgba(255,112,67,0.15)", color: "#ff7043", fontSize: "0.6rem", letterSpacing: "0.08em", border: "1px solid rgba(255,112,67,0.3)" }}
                >
                  🤖 AI 批核 · 待確認發送
                </span>
              )}
              {isHighValue && inquiry.meetingStatus && meetingStatusLabel[inquiry.meetingStatus] && (
                <span
                  className="text-xs px-2 py-0.5 rounded-sm shrink-0"
                  style={{ background: `${meetingStatusLabel[inquiry.meetingStatus].color}18`, color: meetingStatusLabel[inquiry.meetingStatus].color, fontSize: "0.6rem", letterSpacing: "0.08em", border: `1px solid ${meetingStatusLabel[inquiry.meetingStatus].color}35` }}
                >
                  💎 HK$5,000+ · {meetingStatusLabel[inquiry.meetingStatus].label}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              <span>{inquiry.fromName ? `${inquiry.fromName} <${inquiry.fromEmail}>` : inquiry.fromEmail}</span>
              <span>{new Date(inquiry.receivedAt).toLocaleString("zh-HK")}</span>
              {isFreehunter && (
                <span
                  className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-sm shrink-0"
                  style={{ background: "rgba(245,166,35,0.15)", color: "#f5a623", fontSize: "0.6rem", letterSpacing: "0.08em", border: "1px solid rgba(245,166,35,0.3)" }}
                >
                  Freehunter
                </span>
              )}
              {/* FH 工作板關聯標籤 */}
              {hasFHJobLink && (
                <button
                  onClick={(e) => { e.stopPropagation(); setLocation("/freehunter-board"); }}
                  className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-sm shrink-0 hover:opacity-80 transition-opacity"
                  style={{ background: "rgba(76,175,80,0.15)", color: "#4caf50", fontSize: "0.6rem", letterSpacing: "0.08em", border: "1px solid rgba(76,175,80,0.3)" }}
                  title="此詢價已在 FH 工作板處理，點擊前往查看"
                >
                  ✓ FH 工作板已處理
                </button>
              )}
              {/* 顯示拒絕原因 */}
              {inquiry.status === "rejected" && inquiry.rejectedReason && (
                <span
                  className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-sm shrink-0"
                  style={{ background: "rgba(229,57,53,0.1)", color: "#e57373", fontSize: "0.6rem", letterSpacing: "0.06em", border: "1px solid rgba(229,57,53,0.2)" }}
                >
                  <AlertCircle className="h-2.5 w-2.5" />
                  {inquiry.rejectedReason}
                </span>
              )}
              {inquiry.quoteId && (
                <button
                  onClick={(e) => { e.stopPropagation(); setLocation(`/quotes/${inquiry.quoteId}`); }}
                  className="flex items-center gap-1 hover:opacity-70 transition-opacity"
                  style={{ color: "#d4a843" }}
                >
                  <FileText className="h-3 w-3" />
                  查看草稿報價單
                </button>
              )}
            </div>
          </div>
          <div className="shrink-0 text-muted-foreground">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </div>

        {/* Expanded content */}
        {expanded && (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              {/* Original email */}
              <div className="px-5 py-4" style={{ borderRight: "1px solid rgba(255,255,255,0.05)" }}>
                <div className="text-xs mb-2" style={{ color: "#d4a843", letterSpacing: "0.15em", textTransform: "uppercase" }}>
                  原始郵件內容
                </div>
                <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-sans leading-relaxed max-h-48 overflow-y-auto">
                  {inquiry.bodyText || "(無內容)"}
                </pre>
              </div>

              {/* AI parsed result */}
              <div className="px-5 py-4">
                <div className="text-xs mb-3" style={{ color: "#d4a843", letterSpacing: "0.15em", textTransform: "uppercase" }}>
                  AI 解析結果
                </div>
                {aiParsed ? (
                  <div className="space-y-2 text-xs">
                    {[
                      ["客戶姓名", aiParsed.clientName],
                      ["電郵", aiParsed.clientEmail],
                      ["電話", aiParsed.clientPhone],
                      ["公司", aiParsed.clientCompany],
                      ["服務類型", SERVICE_LABELS[aiParsed.serviceType] ?? aiParsed.serviceType],
                      ["拍攝日期", aiParsed.shootingDate],
                      ["拍攝地點", aiParsed.shootingLocation],
                    ].filter(([, v]) => v).map(([label, value]) => (
                      <div key={label} className="flex gap-2">
                        <span className="text-muted-foreground shrink-0 w-16">{label}</span>
                        <span>{value}</span>
                      </div>
                    ))}
                    {aiParsed.notes && (
                      <div className="mt-2 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                        <div className="text-muted-foreground mb-1">需求摘要</div>
                        <div className="text-xs leading-relaxed">{aiParsed.notes}</div>
                      </div>
                    )}
                    {aiParsed.suggestedItems?.length > 0 && (
                      <div className="mt-2 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                        <div className="text-muted-foreground mb-2">建議報價項目</div>
                        {aiParsed.suggestedItems.map((item: any, i: number) => (
                          <div key={i} className="flex justify-between py-1" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                            <span>{item.description}</span>
                            <span className="text-muted-foreground">x{item.quantity} @ HKD {item.unitPrice?.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {(aiParsed.pricingLow || aiParsed.pricingMid || aiParsed.pricingHigh) && (
                      <div className="mt-3 pt-2 rounded-lg p-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(212,168,67,0.06)", border: "1px solid rgba(212,168,67,0.15)" }}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs" style={{ color: "#d4a843" }}>📊 定價信心區間</span>
                          <span className="text-xs text-muted-foreground">
                            {aiParsed.pricingSource === "historical" ? `（基於 JD Studio 歷史成交數據）` : `（基於香港市場參考價）`}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div className="rounded p-2" style={{ background: "rgba(255,255,255,0.04)" }}>
                            <div className="text-xs text-muted-foreground mb-1">保守報價</div>
                            <div className="text-sm font-medium">HKD {aiParsed.pricingLow?.toLocaleString()}</div>
                          </div>
                          <div className="rounded p-2" style={{ background: "rgba(212,168,67,0.12)", border: "1px solid rgba(212,168,67,0.3)" }}>
                            <div className="text-xs mb-1" style={{ color: "#d4a843" }}>建議報價 ★</div>
                            <div className="text-sm font-semibold" style={{ color: "#d4a843" }}>HKD {aiParsed.pricingMid?.toLocaleString()}</div>
                          </div>
                          <div className="rounded p-2" style={{ background: "rgba(255,255,255,0.04)" }}>
                            <div className="text-xs text-muted-foreground mb-1">高端報價</div>
                            <div className="text-sm font-medium">HKD {aiParsed.pricingHigh?.toLocaleString()}</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">AI 解析無結果</div>
                )}
              </div>
            </div>

            {/* Action buttons */}
            {isPending && (
              <div className="px-5 py-3 flex items-center gap-3 flex-wrap" style={{ background: "rgba(0,0,0,0.2)" }}>
                {isFreehunter && inquiry.externalLink && (
                  <a
                    href={inquiry.externalLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded transition-all hover:opacity-80"
                    style={{ background: "rgba(245,166,35,0.12)", color: "#f5a623", border: "1px solid rgba(245,166,35,0.3)" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    前往 Freehunter 查看工作
                  </a>
                )}
                <button
                  onClick={openApproveDialog}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded transition-all hover:opacity-80"
                  style={{ background: "rgba(76,175,80,0.15)", color: "#4caf50", border: "1px solid rgba(76,175,80,0.3)" }}
                >
                  <CheckCircle className="h-3.5 w-3.5" />
                  {isFreehunter ? "批核並製作報價單" : "批核（建立草稿報價單）"}
                </button>
                <button
                  onClick={openRejectDialog}
                  disabled={rejectMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded transition-all hover:opacity-80 disabled:opacity-40"
                  style={{ background: "rgba(229,57,53,0.1)", color: "#e53935", border: "1px solid rgba(229,57,53,0.25)" }}
                >
                  <XCircle className="h-3.5 w-3.5" />
                  拒絕
                </button>
                <button
                  onClick={() => ignoreMutation.mutate({ id: inquiry.id })}
                  disabled={ignoreMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded transition-all hover:opacity-80 disabled:opacity-40"
                  style={{ color: "#666", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  <EyeOff className="h-3.5 w-3.5" />
                  忽略
                </button>
                {inquiry.quoteId && (
                  <button
                    onClick={() => setLocation(`/quotes/${inquiry.quoteId}/edit`)}
                    className="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded transition-all hover:opacity-80"
                    style={{ color: "#d4a843", border: "1px solid rgba(212,168,67,0.25)" }}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    編輯草稿報價單
                  </button>
                )}
              </div>
            )}
            {/* High-value inquiry: meeting flow action bar */}
            {isHighValue && inquiry.meetingStatus !== "meeting_done" && (
              <div className="px-5 py-3 flex items-center gap-3 flex-wrap" style={{ background: "rgba(156,39,176,0.06)", borderTop: "1px solid rgba(156,39,176,0.15)" }}>
                <div className="flex items-center gap-2 text-xs mr-2" style={{ color: "#ce93d8" }}>
                  <Video className="h-3.5 w-3.5" />
                  <span>
                    💎 HK$5,000+ 高價值詢盤{inquiry.estimatedTotal ? ` — AI 估算 HK$${inquiry.estimatedTotal.toLocaleString()}` : ""}
                    {inquiry.meetingStatus === "pending_meeting"
                      ? " — 正在發送預約會議電郵..."
                      : inquiry.meetingStatus === "meeting_scheduled"
                      ? " — ✅ 已自動發送預約會議電郵"
                      : ""}
                  </span>
                </div>
                {inquiry.meetingStatus === "pending_meeting" && (
                  <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded" style={{ background: "rgba(156,39,176,0.12)", color: "#ce93d8", border: "1px solid rgba(156,39,176,0.3)" }}>
                    <Mail className="h-3.5 w-3.5 animate-pulse" />
                    正在發送預約會議電郵...
                  </span>
                )}
                {inquiry.meetingStatus === "meeting_scheduled" && (
                  <button
                    onClick={() => {
                      setMeetingNotes(inquiry.meetingNotes || "");
                      setShowMeetingNotesDialog(true);
                    }}
                    className="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded transition-all hover:opacity-80"
                    style={{ background: "rgba(33,150,243,0.18)", color: "#90caf9", border: "1px solid rgba(33,150,243,0.4)" }}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    記錄會議備忘
                  </button>
                )}
                {inquiry.meetingStatus === "meeting_scheduled" && (
                  <button
                    onClick={() => updateMeetingStatusMutation.mutate({ id: inquiry.id, meetingStatus: "meeting_done" })}
                    disabled={updateMeetingStatusMutation.isPending}
                    className="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded transition-all hover:opacity-80 disabled:opacity-40"
                    style={{ background: "rgba(76,175,80,0.18)", color: "#a5d6a7", border: "1px solid rgba(76,175,80,0.4)" }}
                  >
                    <CheckCircle className="h-3.5 w-3.5" />
                    會議完成 → 建立報價單
                  </button>
                )}
              </div>
            )}
            {/* pending_send: AI auto-approved, awaiting admin confirmation to send */}
            {isPendingSend && (
              <div className="px-5 py-3 flex items-center gap-3 flex-wrap" style={{ background: "rgba(255,112,67,0.06)", borderTop: "1px solid rgba(255,112,67,0.15)" }}>
                <div className="flex items-center gap-2 text-xs mr-2" style={{ color: "#ff7043" }}>
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span>AI 已自動批核並建立草稿報價單，請確認後發送</span>
                </div>
                {inquiry.quoteId && (
                  <button
                    onClick={() => setLocation(`/quotes/${inquiry.quoteId}/edit`)}
                    className="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded transition-all hover:opacity-80"
                    style={{ color: "#d4a843", border: "1px solid rgba(212,168,67,0.25)" }}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    查看/編輯報價單
                  </button>
                )}
                <button
                  onClick={openConfirmSendDialog}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded transition-all hover:opacity-80"
                  style={{ background: "rgba(255,112,67,0.18)", color: "#ff7043", border: "1px solid rgba(255,112,67,0.4)" }}
                >
                  <CheckCircle className="h-3.5 w-3.5" />
                  確認並發送報價郵件
                </button>
                <button
                  onClick={openRejectDialog}
                  disabled={rejectMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded transition-all hover:opacity-80 disabled:opacity-40"
                  style={{ background: "rgba(229,57,53,0.1)", color: "#e53935", border: "1px solid rgba(229,57,53,0.25)" }}
                >
                  <XCircle className="h-3.5 w-3.5" />
                  拒絕
                </button>
              </div>
            )}
            {!isPending && !isPendingSend && (inquiry.quoteId || hasFHJobLink) && (
              <div className="px-5 py-3 flex items-center gap-3" style={{ background: "rgba(0,0,0,0.2)" }}>
                {inquiry.quoteId && (
                  <button
                    onClick={() => setLocation(`/quotes/${inquiry.quoteId}`)}
                    className="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded transition-all hover:opacity-80"
                    style={{ color: "#d4a843", border: "1px solid rgba(212,168,67,0.25)" }}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    查看報價單
                  </button>
                )}
                {/* FH 工作板關聯按鈕 */}
                {hasFHJobLink && (
                  <button
                    onClick={() => setLocation("/freehunter-board")}
                    className="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded transition-all hover:opacity-80"
                    style={{ background: "rgba(76,175,80,0.12)", color: "#4caf50", border: "1px solid rgba(76,175,80,0.3)" }}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    前往 FH 工作板查看
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Approve Dialog */}
      <Dialog open={showApproveDialog} onOpenChange={setShowApproveDialog}>
        <DialogContent className="max-w-md" style={{ background: "#111", border: "1px solid rgba(212,168,67,0.2)" }}>
          <DialogHeader>
            <DialogTitle className="text-base font-medium">
              {isFreehunter ? "批核 Freehunter 工作並製作報價單" : "批核詢價並建立報價單"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {isFreehunter && inquiry.externalLink && (
              <div
                className="rounded p-3 text-xs space-y-1.5"
                style={{ background: "rgba(245,166,35,0.06)", border: "1px solid rgba(245,166,35,0.15)" }}
              >
                <p style={{ color: "#f5a623", fontWeight: 600 }}>Freehunter 工作</p>
                <p className="text-muted-foreground">請前往 Freehunter 查看工作詳情，複製客人電郵後填入下方欄位。</p>
                <a
                  href={inquiry.externalLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all hover:opacity-80"
                  style={{ background: "rgba(245,166,35,0.15)", color: "#f5a623", border: "1px solid rgba(245,166,35,0.3)" }}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  前往 Freehunter 查看工作
                </a>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="approve-name" className="text-xs text-muted-foreground">客戶姓名</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  id="approve-name"
                  value={approveClientName}
                  onChange={(e) => setApproveClientName(e.target.value)}
                  placeholder="客戶姓名"
                  className="pl-8 h-8 text-sm"
                  style={{ background: "#0d0d0d", border: "1px solid rgba(255,255,255,0.1)" }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="approve-email" className="text-xs text-muted-foreground">客戶電郵</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  id="approve-email"
                  type="email"
                  value={approveClientEmail}
                  onChange={(e) => setApproveClientEmail(e.target.value)}
                  placeholder="client@example.com"
                  className="pl-8 h-8 text-sm"
                  style={{ background: "#0d0d0d", border: "1px solid rgba(255,255,255,0.1)" }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="approve-phone" className="text-xs text-muted-foreground">客戶電話</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  id="approve-phone"
                  value={approveClientPhone}
                  onChange={(e) => setApproveClientPhone(e.target.value)}
                  placeholder="例：9123 4567"
                  className="pl-8 h-8 text-sm"
                  style={{ background: "#0d0d0d", border: "1px solid rgba(255,255,255,0.1)" }}
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              以上資料將自動填入草稿報價單。如暫時未有客人資料，可留空後在報價單中補充。
            </p>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowApproveDialog(false)}
              style={{ border: "1px solid rgba(255,255,255,0.1)" }}
            >
              取消
            </Button>
            <Button
              size="sm"
              onClick={handleApprove}
              disabled={approveMutation.isPending}
              className="gap-2"
              style={{ background: "#4caf50", color: "#fff" }}
            >
              {approveMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle className="h-3.5 w-3.5" />
              )}
              確認批核並建立報價單
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Send Quote Dialog */}
      <Dialog open={showConfirmSendDialog} onOpenChange={setShowConfirmSendDialog}>
        <DialogContent className="max-w-lg" style={{ background: "#111", border: "1px solid rgba(255,112,67,0.25)" }}>
          <DialogHeader>
            <DialogTitle className="text-base font-medium flex items-center gap-2">
              <CheckCircle className="h-4 w-4" style={{ color: "#ff7043" }} />
              確認並發送報價郵件
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded px-3 py-2 text-xs" style={{ background: "rgba(255,112,67,0.08)", border: "1px solid rgba(255,112,67,0.2)", color: "#ff7043" }}>
              AI 已自動批核此詢價並建立草稿報價單。請確認郵件內容後發送。
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">郵件主旨（留空使用預設）</Label>
              <Input
                value={confirmEmailSubject}
                onChange={(e) => setConfirmEmailSubject(e.target.value)}
                placeholder={`JD Studio HK Quotation - (報價單號)`}
                className="h-8 text-xs"
                style={{ background: "#0d0d0d", border: "1px solid rgba(255,255,255,0.1)" }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">郵件內容</Label>
              <textarea
                value={confirmEmailBody}
                onChange={(e) => setConfirmEmailBody(e.target.value)}
                rows={8}
                className="w-full text-xs rounded px-3 py-2 resize-y"
                style={{ background: "#0d0d0d", border: "1px solid rgba(255,255,255,0.1)", color: "inherit", fontFamily: "inherit" }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              發送後，此詢價狀態將更新為「已批核」，報價單狀態將更新為「已發送」。
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowConfirmSendDialog(false)}
              style={{ border: "1px solid rgba(255,255,255,0.1)" }}
            >
              取消
            </Button>
            <Button
              size="sm"
              onClick={() => confirmSendMutation.mutate({
                id: inquiry.id,
                emailSubject: confirmEmailSubject || undefined,
                emailBody: confirmEmailBody || undefined,
              })}
              disabled={confirmSendMutation.isPending}
              className="gap-2"
              style={{ background: "#ff7043", color: "#fff" }}
            >
              {confirmSendMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle className="h-3.5 w-3.5" />
              )}
              確認發送
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Meeting Email Dialog */}
      <Dialog open={showMeetingEmailDialog} onOpenChange={setShowMeetingEmailDialog}>
        <DialogContent className="max-w-lg" style={{ background: "#111", border: "1px solid rgba(156,39,176,0.25)" }}>
          <DialogHeader>
            <DialogTitle className="text-base font-medium flex items-center gap-2">
              <Calendar className="h-4 w-4" style={{ color: "#ce93d8" }} />
              發送預約會議電郵
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded px-3 py-2 text-xs" style={{ background: "rgba(156,39,176,0.08)", border: "1px solid rgba(156,39,176,0.2)", color: "#ce93d8" }}>
              此詢盤 AI 估算金額達 HK$5,000 以上，建議先預約會議了解需求再制作報價單。
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">電郵內容（可直接修改）</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs gap-1.5"
                  style={{ color: "#ce93d8", border: "1px solid rgba(156,39,176,0.3)" }}
                  onClick={() => generateMeetingDraftMutation.mutate({ id: inquiry.id })}
                  disabled={generateMeetingDraftMutation.isPending}
                >
                  {generateMeetingDraftMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                  {generateMeetingDraftMutation.isPending ? "AI 生成中..." : "AI 重新生成"}
                </Button>
              </div>
              {!inquiry.meetingEmailDraft && !meetingEmailBody && (
                <div className="text-xs px-3 py-2 rounded" style={{ background: "rgba(156,39,176,0.06)", border: "1px solid rgba(156,39,176,0.15)", color: "#ce93d8" }}>
                  尚未生成草稿，點擊「AI 重新生成」讓 AI 根據詢盤資料（服務類型、日期、地點等）生成個性化電郵。
                </div>
              )}
              <textarea
                value={meetingEmailBody}
                onChange={(e) => setMeetingEmailBody(e.target.value)}
                rows={10}
                className="w-full text-xs rounded px-3 py-2 resize-y"
                style={{ background: "#0d0d0d", border: "1px solid rgba(255,255,255,0.1)", color: "inherit", fontFamily: "inherit" }}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowMeetingEmailDialog(false)}
              style={{ border: "1px solid rgba(255,255,255,0.1)" }}
            >
              取消
            </Button>
            <Button
              size="sm"
              onClick={() => sendMeetingEmailMutation.mutate({ id: inquiry.id, emailBody: meetingEmailBody || "" })}
              disabled={sendMeetingEmailMutation.isPending}
              className="gap-2"
              style={{ background: "#9c27b0", color: "#fff" }}
            >
              {sendMeetingEmailMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Mail className="h-3.5 w-3.5" />
              )}
              發送預約會議電郵
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Meeting Notes Dialog */}
      <Dialog open={showMeetingNotesDialog} onOpenChange={setShowMeetingNotesDialog}>
        <DialogContent className="max-w-md" style={{ background: "#111", border: "1px solid rgba(33,150,243,0.25)" }}>
          <DialogHeader>
            <DialogTitle className="text-base font-medium flex items-center gap-2">
              <MessageSquare className="h-4 w-4" style={{ color: "#90caf9" }} />
              記錄會議備忘
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">會議備忘記錄</Label>
              <textarea
                value={meetingNotes}
                onChange={(e) => setMeetingNotes(e.target.value)}
                rows={6}
                placeholder="記錄會議要點、客戶需求、預算等..."
                className="w-full text-xs rounded px-3 py-2 resize-y"
                style={{ background: "#0d0d0d", border: "1px solid rgba(255,255,255,0.1)", color: "inherit", fontFamily: "inherit" }}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowMeetingNotesDialog(false)}
              style={{ border: "1px solid rgba(255,255,255,0.1)" }}
            >
              取消
            </Button>
            <Button
              size="sm"
              onClick={() => updateMeetingStatusMutation.mutate({ id: inquiry.id, meetingNotes, meetingStatus: "meeting_scheduled" }, {
                onSuccess: () => setShowMeetingNotesDialog(false),
              })}
              disabled={updateMeetingStatusMutation.isPending}
              className="gap-2"
              style={{ background: "#2196f3", color: "#fff" }}
            >
              {updateMeetingStatusMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle className="h-3.5 w-3.5" />
              )}
              儲存備忘
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent className="max-w-sm" style={{ background: "#111", border: "1px solid rgba(229,57,53,0.2)" }}>
          <DialogHeader>
            <DialogTitle className="text-base font-medium flex items-center gap-2">
              <XCircle className="h-4 w-4" style={{ color: "#e53935" }} />
              拒絕此詢價
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">
              請選擇拒絕原因，以便日後統計分析。
            </p>

            {/* Reason buttons */}
            <div className="grid grid-cols-2 gap-2">
              {REJECTION_REASONS.filter(r => r.value !== "other").map((reason) => (
                <button
                  key={reason.value}
                  onClick={() => setSelectedReason(reason.value)}
                  className="px-3 py-2 text-xs rounded text-left transition-all"
                  style={{
                    background: selectedReason === reason.value
                      ? "rgba(229,57,53,0.2)"
                      : "rgba(255,255,255,0.03)",
                    border: selectedReason === reason.value
                      ? "1px solid rgba(229,57,53,0.5)"
                      : "1px solid rgba(255,255,255,0.08)",
                    color: selectedReason === reason.value ? "#ef5350" : "#aaa",
                  }}
                >
                  {reason.label}
                </button>
              ))}
              {/* Other reason button */}
              <button
                onClick={() => setSelectedReason("other")}
                className="px-3 py-2 text-xs rounded text-left transition-all col-span-2"
                style={{
                  background: selectedReason === "other"
                    ? "rgba(229,57,53,0.2)"
                    : "rgba(255,255,255,0.03)",
                  border: selectedReason === "other"
                    ? "1px solid rgba(229,57,53,0.5)"
                    : "1px solid rgba(255,255,255,0.08)",
                  color: selectedReason === "other" ? "#ef5350" : "#aaa",
                }}
              >
                其他原因
              </button>
            </div>

            {/* Custom reason input (only shown when "other" is selected) */}
            {selectedReason === "other" && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">請說明原因（可選）</Label>
                <Input
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  placeholder="輸入自定義拒絕原因..."
                  className="h-8 text-xs"
                  style={{ background: "#0d0d0d", border: "1px solid rgba(255,255,255,0.1)" }}
                />
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowRejectDialog(false)}
              style={{ border: "1px solid rgba(255,255,255,0.1)" }}
            >
              取消
            </Button>
            <Button
              size="sm"
              onClick={handleReject}
              disabled={rejectMutation.isPending || !selectedReason}
              className="gap-2"
              style={{
                background: selectedReason ? "#e53935" : "rgba(229,57,53,0.3)",
                color: "#fff",
                opacity: selectedReason ? 1 : 0.6,
              }}
            >
              {rejectMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <XCircle className="h-3.5 w-3.5" />
              )}
              確認拒絕
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});

export default function EmailInquiries() {
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(0);
  const limit = 15;

  const { data, isLoading, isFetching, refetch } = trpc.emailInquiries.list.useQuery({
    status: status === "all" ? undefined : status,
    limit,
    offset: page * limit,
  }, {
    placeholderData: keepPreviousData,
  });

  const { data: scanStatus } = trpc.emailInquiries.scanStatus.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const scanMutation = trpc.emailInquiries.scanGmail.useMutation({
    onSuccess: (result) => {
      toast.success(`掃描完成：發現 ${result.newInquiries} 封新詢價郵件（共掃描 ${result.scanned} 封）`);
      refetch();
    },
    onError: (e) => toast.error(`掃描失敗：${e.message}`),
  });

  const totalPages = Math.ceil((data?.total ?? 0) / limit);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <div style={{ fontSize: "0.6rem", letterSpacing: "0.2em", color: "#d4a843", textTransform: "uppercase", marginBottom: "6px" }}>
              Email Inquiries
            </div>
            <h1 className="text-2xl font-light">詢價郵件管理</h1>
            <p className="text-xs text-muted-foreground mt-1">
              系統自動掃描 Gmail，識別攝影詢價郵件並用 AI 生成報價單草稿
            </p>
          </div>
          <button
            onClick={() => scanMutation.mutate({ maxResults: 20 })}
            disabled={scanMutation.isPending}
            className="flex items-center gap-2 px-5 py-2.5 transition-all hover:opacity-80 disabled:opacity-50"
            style={{
              background: "#d4a843",
              color: "#0a0a0a",
              fontSize: "0.75rem",
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              borderRadius: "2px",
            }}
          >
            {scanMutation.isPending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <RefreshCw className="h-4 w-4" />
            }
            {scanMutation.isPending ? "掃描中..." : "掃描 Gmail"}
          </button>
        </div>

        <div style={{ height: "1px", background: "linear-gradient(to right, #d4a843, rgba(212,168,67,0.1), transparent)" }} />

        {/* Auto-scan status bar */}
        <div className="rounded px-4 py-3 text-xs flex flex-wrap items-center gap-x-4 gap-y-1" style={{ background: "rgba(212,168,67,0.05)", border: "1px solid rgba(212,168,67,0.12)" }}>
          <span style={{ color: "#d4a843", fontWeight: 600 }}>自動掃描：</span>
          {scanStatus?.withinActiveHours === false ? (
            <span className="text-muted-foreground">🌙 夜間暫停（21:00 – 09:00 HKT），明早 09:00 自動恢復</span>
          ) : (
            <span className="text-muted-foreground">每 30 分鐘自動掃描一次（09:00 – 21:00 HKT）</span>
          )}
          {scanStatus?.lastScanAt && (
            <span className="text-muted-foreground">
              上次掃描：{new Date(scanStatus.lastScanAt).toLocaleString("zh-HK")}
              {scanStatus.lastResult && ` · 發現 ${scanStatus.lastResult.newInquiries} 封新詢價`}
            </span>
          )}
          {scanStatus?.nextScanAt && (
            <span className="text-muted-foreground">
              下次掃描：{new Date(scanStatus.nextScanAt).toLocaleTimeString("zh-HK", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          {!scanStatus?.lastScanAt && (
            <span className="text-muted-foreground">伺服器啟動後 30 秒進行首次掃描</span>
          )}
        </div>

        {/* Filter */}
        <div className="flex items-center gap-3">
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0); }}>
            <SelectTrigger className="w-[140px]" style={{ background: "#111", border: "1px solid rgba(212,168,67,0.2)" }}>
              <SelectValue placeholder="狀態篩選" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部狀態</SelectItem>
              {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            共 {data?.total ?? 0} 封詢價郵件
          </span>
        </div>

        {/* List */}
        <div className="space-y-3">
          {isLoading && (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="rounded" style={{ border: "1px solid rgba(212,168,67,0.08)", background: "#0d0d0d", overflow: "hidden" }}>
                  <div className="flex items-start gap-3 px-5 py-4">
                    <div className="h-4 w-4 mt-0.5 rounded shrink-0 animate-pulse" style={{ background: "rgba(212,168,67,0.15)" }} />
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="h-4 rounded animate-pulse" style={{ background: "rgba(255,255,255,0.06)", width: `${180 + i * 30}px` }} />
                        <div className="h-4 w-14 rounded animate-pulse" style={{ background: "rgba(212,168,67,0.1)" }} />
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="h-3 w-40 rounded animate-pulse" style={{ background: "rgba(255,255,255,0.04)" }} />
                        <div className="h-3 w-28 rounded animate-pulse" style={{ background: "rgba(255,255,255,0.04)" }} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!isLoading && isFetching && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
              <div className="h-3 w-3 rounded-full border border-current border-t-transparent animate-spin" />
              更新中...
            </div>
          )}
          {!isLoading && (!data?.data || data.data.length === 0) && (
            <div className="text-center py-16" style={{ border: "1px solid rgba(255,255,255,0.05)", borderRadius: "4px" }}>
              <Mail className="h-8 w-8 mx-auto mb-3 text-muted-foreground opacity-30" />
              <p className="text-sm text-muted-foreground">尚無詢價郵件</p>
              <p className="text-xs text-muted-foreground mt-1 opacity-60">點擊「掃描 Gmail」開始掃描收件箱</p>
            </div>
          )}
          {data?.data?.map((inquiry: any) => (
            <InquiryCard key={inquiry.id} inquiry={inquiry} onRefresh={refetch} />
          ))}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 text-xs rounded disabled:opacity-30 hover:opacity-70 transition-opacity"
              style={{ border: "1px solid rgba(255,255,255,0.1)" }}
            >
              上一頁
            </button>
            <span className="text-xs text-muted-foreground">
              第 {page + 1} / {totalPages} 頁
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 text-xs rounded disabled:opacity-30 hover:opacity-70 transition-opacity"
              style={{ border: "1px solid rgba(255,255,255,0.1)" }}
            >
              下一頁
            </button>
          </div>
        )}
      </div>

    </DashboardLayout>
  );
}
