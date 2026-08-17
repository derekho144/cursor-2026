import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useParams, useLocation } from "wouter";
import { toast } from "sonner";
import { ArrowLeft, Download, Edit, FileText, Loader2, Sparkles, Mail, Clock, Link2, CheckCircle2, Paperclip, X, UploadCloud, Eye, ExternalLink, ImageIcon, DollarSign, Plus, Trash2, TrendingUp, CreditCard, Copy } from "lucide-react";
import { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { SERVICE_LABELS } from "@/lib/serviceLabels";

const DEFAULT_EMAIL_BODY = `Hello,

Nice talk to you just now. Please find the attached quotation for your review. All items and pricing details are included. Kindly take a moment to look through it, and feel free to contact me if you have any questions or need further clarification.

Cheers!

Derek
Tel: 9153 1976
www.jdstudiohk.com`;

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft: { label: "草稿", color: "#666" },
  sent: { label: "已發送", color: "#d4a843" },
  accepted: { label: "已接受", color: "#4caf50" },
  rejected: { label: "已拒絕", color: "#e53935" },
  expired: { label: "已過期", color: "#888" },
};

export default function QuoteDetail() {
  const params = useParams<{ id: string }>();
  const quoteId = parseInt(params.id);
  const [, setLocation] = useLocation();

  function handleDeliverPhotos() {
    if (!quote) return;
    const titleParts = [quote.clientName];
    if ((quote as any).shootingDate) titleParts.push((quote as any).shootingDate);
    const deliveryTitle = titleParts.join(" - ");
    const params = new URLSearchParams({
      clientName: quote.clientName,
      title: deliveryTitle,
      quoteId: String(quoteId),
      quoteNumber: quote.quoteNumber,
    });
    setLocation(`/deliveries?new=1&${params.toString()}`);
  }
  const utils = trpc.useUtils();

  const { data: quote, isLoading } = trpc.quotes.getById.useQuery(
    { id: quoteId },
    { refetchOnMount: "always" } // 每次進入頁面必定重新拉取，避免快取舊資料
  );

  const generateReceiptMutation = trpc.quotes.generateReceiptPdf.useMutation({
    onSuccess: async (data) => {
      if (data.receiptUrl) {
        try {
          const resp = await fetch(data.receiptUrl);
          const blob = await resp.blob();
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = blobUrl;
          a.download = `${quote?.quoteNumber || "receipt"}-RECEIPT.pdf`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(blobUrl);
          toast.success("Receipt PDF 已下載");
        } catch {
          window.open(data.receiptUrl, "_blank");
          toast.success("Receipt PDF 已生成，請在新分頁查看");
        }
      }
    },
    onError: (e) => toast.error(`Receipt PDF 生成失敗：${e.message}`),
  });

  const generatePdfMutation = trpc.quotes.generatePdf.useMutation({
    onSuccess: async (data) => {
      utils.quotes.getById.invalidate({ id: quoteId });
      if (data.pdfUrl) {
        try {
          // Force download via fetch + blob (avoids popup blocker)
          const resp = await fetch(data.pdfUrl);
          const blob = await resp.blob();
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = blobUrl;
          a.download = `${quote?.quoteNumber || "quotation"}.pdf`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(blobUrl);
          toast.success("PDF 已下載");
        } catch {
          // Fallback: open in new tab
          window.open(data.pdfUrl, "_blank");
          toast.success("PDF 已生成，請在新分頁查看");
        }
      }
    },
    onError: (e) => toast.error(`PDF 生成失敗：${e.message}`),
  });

  // Email dialog state
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("JD Studio Quotation");
  const [emailBody, setEmailBody] = useState(DEFAULT_EMAIL_BODY);

  const { data: emailLogs } = trpc.quotes.getEmailLogs.useQuery(
    { quoteId },
    { enabled: !!quoteId }
  );

  const sendEmailMutation = trpc.quotes.sendQuoteEmail.useMutation({
    onSuccess: (data) => {
      toast.success(`郵件已發送至 ${data.sentTo}`);
      setEmailDialogOpen(false);
      utils.quotes.getById.invalidate({ id: quoteId });
      utils.quotes.getEmailLogs.invalidate({ quoteId });
    },
    onError: (e) => toast.error(`郵件發送失敗：${e.message}`),
  });

  const toggleStopFollowUpMutation = trpc.quotes.toggleStopFollowUp.useMutation({
    onSuccess: () => {
      utils.quotes.getById.invalidate({ id: quoteId });
      toast.success((quote as any)?.stopFollowUp ? "已恢復自動跟進" : "已停止自動跟進");
    },
    onError: (e) => toast.error((e as any).message || "操作失敗"),
  });

  const openEmailDialog = () => {
    setEmailTo(quote?.clientEmail ?? "");
    setEmailSubject("JD Studio Quotation");
    setEmailBody(DEFAULT_EMAIL_BODY);
    setEmailDialogOpen(true);
  };

  // ─── Payment tracking state & mutations ─────────────────────────
  const [paymentEditing, setPaymentEditing] = useState(false);
  const [paymentForm, setPaymentForm] = useState<{
    paymentStatus: "unpaid" | "deposit_paid" | "fully_paid";
    depositPaidAmount: string;
    depositPaidAt: string;
    balancePaidAmount: string;
    balancePaidAt: string;
    paymentNotes: string;
  } | null>(null);
  const updatePaymentMutation = trpc.quotes.updatePayment.useMutation({
    onSuccess: () => {
      toast.success("付款記錄已更新");
      utils.quotes.getById.invalidate({ id: quoteId });
      setPaymentEditing(false);
    },
    onError: () => toast.error("更新失敗"),
  });

  const { data: airwallexStatus } = trpc.quotes.airwallexStatus.useQuery();
  const { data: paymentLinks, refetch: refetchPaymentLinks } = trpc.quotes.listPaymentLinks.useQuery(
    { id: quoteId },
    { enabled: !!quoteId && !!airwallexStatus?.configured }
  );
  const createPaymentLinkMutation = trpc.quotes.createPaymentLink.useMutation({
    onSuccess: async (link) => {
      toast.success("Airwallex 付款連結已建立");
      await refetchPaymentLinks();
      try {
        await navigator.clipboard.writeText(link.url);
        toast.success("連結已複製到剪貼簿");
      } catch {
        // clipboard may fail on HTTP / restricted contexts
      }
    },
    onError: (e) => toast.error(`建立付款連結失敗：${e.message}`),
  });

  async function copyPaymentLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("連結已複製");
    } catch {
      toast.error("無法複製，請手動選取連結");
    }
  }
  function startPaymentEdit() {
    setPaymentForm({
      paymentStatus: ((quote as any)?.paymentStatus ?? "unpaid") as "unpaid" | "deposit_paid" | "fully_paid",
      depositPaidAmount: (quote as any)?.depositPaidAmount ? String(Number((quote as any).depositPaidAmount)) : "",
      depositPaidAt: (quote as any)?.depositPaidAt ? new Date((quote as any).depositPaidAt).toISOString().split("T")[0] : "",
      balancePaidAmount: (quote as any)?.balancePaidAmount ? String(Number((quote as any).balancePaidAmount)) : "",
      balancePaidAt: (quote as any)?.balancePaidAt ? new Date((quote as any).balancePaidAt).toISOString().split("T")[0] : "",
      paymentNotes: (quote as any)?.paymentNotes ?? "",
    });
    setPaymentEditing(true);
  }

  // ─── Sign link state & mutations ─────────────────────────────────
  const [signDialogOpen, setSignDialogOpen] = useState(false);
  const [signAttachUploading, setSignAttachUploading] = useState(false);
  const signFileInputRef = useRef<HTMLInputElement>(null);

  const generateSignLinkMutation = trpc.quotes.generateSignLink.useMutation({
    onSuccess: () => {
      utils.quotes.getById.invalidate({ id: quoteId });
      toast.success("簽署連結已生成");
    },
    onError: (e) => toast.error(`生成失敗：${e.message}`),
  });

  const resetSignLinkMutation = trpc.quotes.resetSignLink.useMutation({
    onSuccess: () => {
      utils.quotes.getById.invalidate({ id: quoteId });
      toast.success("簽署連結已重置，旧連結已失效");
    },
    onError: (e) => toast.error(`重置失敗：${e.message}`),
  });

  const removeAttachmentMutation = trpc.quotes.removeSignAttachment.useMutation({
    onSuccess: () => utils.quotes.getById.invalidate({ id: quoteId }),
    onError: (e) => toast.error(`移除失敗：${e.message}`),
  });

  const uploadAttachmentMutation = trpc.quotes.uploadSignAttachment.useMutation({
    onSuccess: () => {
      utils.quotes.getById.invalidate({ id: quoteId });
      toast.success("附件已上載");
    },
    onError: (e) => toast.error(`上載失敗：${e.message}`),
  });

  const handleUploadAttachment = async (file: File) => {
    setSignAttachUploading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      await uploadAttachmentMutation.mutateAsync({
        id: quoteId,
        fileName: file.name,
        fileBase64: base64,
        mimeType: file.type || "application/octet-stream",
      });
    } finally {
      setSignAttachUploading(false);
    }
  };

  const copySignLink = () => {
    if (!(quote as any)?.signToken) return;
    const url = `${window.location.origin}/sign/${(quote as any).signToken}`;
    navigator.clipboard.writeText(url);
    toast.success("簽署連結已複製到剪貼簿");
  };

  // ─── Quote Costs (Project Cost) state & mutations ─────────────────────────────
  const [costDialogOpen, setCostDialogOpen] = useState(false);
  const [costForm, setCostForm] = useState({
    category: "freelancer",
    description: "",
    amount: "",
    payee: "",
  });
  const COST_CATEGORIES = [
    { value: "freelancer", label: "外判人員" },
    { value: "venue", label: "拍攝場地" },
    { value: "post_production", label: "後期製作" },
    { value: "transport", label: "車費/交通" },
    { value: "equipment_rent", label: "租用器材" },
    { value: "equipment_buy", label: "購買器材" },
    { value: "staff", label: "員工薪酬" },
    { value: "other", label: "其他" },
  ];
  const { data: costsData } = trpc.quoteCosts.summary.useQuery(
    { quoteId },
    { enabled: !!quoteId }
  );
  const createCostMutation = trpc.quoteCosts.create.useMutation({
    onSuccess: () => {
      toast.success("成本已新增");
      utils.quoteCosts.summary.invalidate({ quoteId });
      setCostDialogOpen(false);
      setCostForm({ category: "freelancer", description: "", amount: "", payee: "" });
    },
    onError: (e) => toast.error(`新增失敗：${e.message}`),
  });
  const deleteCostMutation = trpc.quoteCosts.delete.useMutation({
    onSuccess: () => {
      toast.success("已刪除");
      utils.quoteCosts.summary.invalidate({ quoteId });
    },
    onError: (e) => toast.error(`刪除失敗：${e.message}`),
  });

  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [customRejectReason, setCustomRejectReason] = useState("");

  const REJECT_REASONS = [
    "價格太高",
    "時間不配合",
    "找到其他攝影師",
    "項目取消",
    "客戶無回覆",
    "其他原因",
  ];

  const updateStatusMutation = trpc.quotes.update.useMutation({
    onSuccess: () => {
      toast.success("狀態已更新");
      utils.quotes.getById.invalidate({ id: quoteId });
    },
    onError: () => toast.error("更新失敗"),
  });

  const handleStatusClick = (key: string) => {
    if (key === "rejected") {
      setRejectReason("");
      setCustomRejectReason("");
      setShowRejectDialog(true);
    } else {
      updateStatusMutation.mutate({ id: quoteId, status: key as any });
    }
  };

  const confirmReject = () => {
    const finalReason = rejectReason === "其他原因" ? customRejectReason : rejectReason;
    updateStatusMutation.mutate({ id: quoteId, status: "rejected", rejectedReason: finalReason || undefined });
    setShowRejectDialog(false);
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-6 w-6 animate-spin" style={{ color: "#d4a843" }} />
        </div>
      </DashboardLayout>
    );
  }

  if (!quote) {
    return (
      <DashboardLayout>
        <div className="text-center py-16 text-muted-foreground">報價單不存在</div>
      </DashboardLayout>
    );
  }

  const statusInfo = STATUS_CONFIG[quote.status] ?? { label: quote.status, color: "#888" };

  return (
    <DashboardLayout>
      <div className="max-w-4xl space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-4">
              <button onClick={() => setLocation("/quotes")} className="p-2 rounded hover:bg-white/5 transition-colors flex-shrink-0">
                <ArrowLeft className="h-4 w-4 text-muted-foreground" />
              </button>
              <div>
                <div style={{ fontSize: "0.6rem", letterSpacing: "0.2em", color: "#d4a843", textTransform: "uppercase", marginBottom: "4px" }}>
                  Quote Detail
                </div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-light">{quote.quoteNumber}</h1>
                  <span
                    className="text-xs px-2 py-1 rounded-sm"
                    style={{ background: `${statusInfo.color}20`, color: statusInfo.color, fontSize: "0.6rem", letterSpacing: "0.1em" }}
                  >
                    {statusInfo.label}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
            <button
              onClick={() => setLocation(`/quotes/${quoteId}/edit`)}
              className="flex items-center gap-2 px-4 py-2 text-xs rounded transition-all hover:opacity-70 flex-shrink-0"
              style={{ border: "1px solid rgba(212,168,67,0.3)", color: "#d4a843", letterSpacing: "0.1em" }}
            >
              <Edit className="h-3.5 w-3.5" />
              編輯
            </button>
            <button
              onClick={() => window.open(`/print/quote/${quoteId}`, "_blank")}
              className="flex items-center gap-2 px-4 py-2 text-xs rounded transition-all hover:opacity-80 flex-shrink-0"
              style={{ background: "#d4a843", color: "#0a0a0a", fontWeight: 600, letterSpacing: "0.1em" }}
            >
              <Download className="h-3.5 w-3.5" />
              下載 PDF
            </button>
            <button
              onClick={() => window.open(`/print/quote/${quoteId}?type=receipt`, "_blank")}
              className="flex items-center gap-2 px-4 py-2 text-xs rounded transition-all hover:opacity-80 flex-shrink-0"
              style={{ background: "#1a2e1a", color: "#6fcf6f", border: "1px solid rgba(111,207,111,0.3)", fontWeight: 600, letterSpacing: "0.1em" }}
            >
              <Download className="h-3.5 w-3.5" />
              下載 Receipt
            </button>
            <button
              onClick={openEmailDialog}
              className="flex items-center gap-2 px-4 py-2 text-xs rounded transition-all hover:opacity-80 flex-shrink-0"
              style={{ background: "#1a1a2e", color: "#7eb8f7", border: "1px solid rgba(126,184,247,0.3)", fontWeight: 600, letterSpacing: "0.1em" }}
            >
              <Mail className="h-3.5 w-3.5" />
              發送郵件
              {emailLogs && emailLogs.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px]" style={{ background: "rgba(126,184,247,0.2)", color: "#7eb8f7" }}>
                  {emailLogs.length}
                </span>
              )}
            </button>
            {/* Preview Button */}
            <button
              onClick={() => window.open(`/print/quote/${quoteId}`, "_blank")}
              className="flex items-center gap-2 px-4 py-2 text-xs rounded transition-all hover:opacity-80 flex-shrink-0"
              style={{ background: "#1a1a2e", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.3)", fontWeight: 600, letterSpacing: "0.1em" }}
            >
              <Eye className="h-3.5 w-3.5" />
              預覽
            </button>
            {/* HelloToby Refund Button */}
            <button
              onClick={() => window.open("https://docs.google.com/forms/d/16tvtqYkB2hWQd8A7DbUtNZ-gielzuLyyWWWqiCQVacs/viewform?ts=659f9d54&edit_requested=true", "_blank")}
              className="flex items-center gap-2 px-4 py-2 text-xs rounded transition-all hover:opacity-80 flex-shrink-0"
              style={{ background: "#1a1a1a", color: "#f87171", border: "1px solid rgba(248,113,113,0.3)", fontWeight: 600, letterSpacing: "0.1em" }}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              HT 退款申請
            </button>
            {/* Deliver Photos Button */}
            <button
              onClick={handleDeliverPhotos}
              className="flex items-center gap-2 px-4 py-2 text-xs rounded transition-all hover:opacity-80 flex-shrink-0"
              style={{ background: "#1a1a1a", color: "#d4a843", border: "1px solid rgba(212,168,67,0.3)", fontWeight: 600, letterSpacing: "0.1em" }}
            >
              <ImageIcon className="h-3.5 w-3.5" />
              建立交付連結
            </button>

            {/* Sign Link Button */}
            <button
              onClick={() => setSignDialogOpen(true)}
              className="flex items-center gap-2 px-4 py-2 text-xs rounded transition-all hover:opacity-80 flex-shrink-0"
              style={{
                background: (quote as any)?.signedAt ? "#1a2e1a" : "#1a1a1a",
                color: (quote as any)?.signedAt ? "#6fcf6f" : "#c9a96e",
                border: `1px solid ${(quote as any)?.signedAt ? "rgba(111,207,111,0.3)" : "rgba(201,169,110,0.3)"}`,
                fontWeight: 600,
                letterSpacing: "0.1em",
              }}
            >
              {(quote as any)?.signedAt ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <Link2 className="h-3.5 w-3.5" />
              )}
              {(quote as any)?.signedAt ? "已簽署" : "簽署連結"}
            </button>
          </div>
        </div>

        <div style={{ height: "1px", background: "linear-gradient(to right, #d4a843, rgba(212,168,67,0.1), transparent)" }} />

        {/* Quote Preview */}
        <div style={{ background: "#111111", border: "1px solid rgba(201,169,110,0.18)", borderRadius: "1px", overflow: "hidden" }}>
          {/* Quote Header */}
          <div
            className="flex justify-between items-start flex-wrap gap-4"
            style={{ background: "#111111", padding: "24px 24px 20px 24px" }}
          >
            <div>
              <img
                src="https://d2xsxph8kpxj0f.cloudfront.net/310519663457748523/VbnWSJV6UQ79sGuykqPPae/jd-studio-logo-original_0081e5b2.png"
                alt="JD STUDIO"
                style={{ width: "120px", height: "auto", display: "block", marginBottom: "14px" }}
              />
              <div style={{ fontSize: "11px", lineHeight: "2.0" }}>
                <div><span style={{ fontSize: "8px", letterSpacing: "0.2em", textTransform: "uppercase" as const, color: "#777", display: "inline-block", width: "42px" }}>TEL</span><span style={{ color: "#cccccc" }}>+852 9153 1976</span></div>
                <div><span style={{ fontSize: "8px", letterSpacing: "0.2em", textTransform: "uppercase" as const, color: "#777", display: "inline-block", width: "42px" }}>EMAIL</span><span style={{ color: "#cccccc" }}>info.exposurehk@gmail.com</span></div>
                <div><span style={{ fontSize: "8px", letterSpacing: "0.2em", textTransform: "uppercase" as const, color: "#777", display: "inline-block", width: "42px" }}>WEB</span><span style={{ color: "#cccccc" }}>www.jdstudiohk.com</span></div>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "8.5px", letterSpacing: "0.25em", textTransform: "uppercase" as const, color: "#888888", marginBottom: "8px" }}>QUOTATION</div>
              <div style={{ fontSize: "36px", fontWeight: 300, color: "#ffffff", lineHeight: 1 }}>{quote.quoteNumber}</div>
              <div style={{ width: "100%", height: "1px", background: "#444444", margin: "14px 0 10px" }}></div>
              <div style={{ fontSize: "10px", color: "#888888", letterSpacing: "0.12em", textTransform: "uppercase" as const }}>
                DATE &nbsp; {new Date(quote.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase()}
              </div>
            </div>
          </div>

          {/* Client Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2" style={{ padding: "24px", gap: "24px", background: "#111111", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <div>
              <div style={{ fontSize: "0.6rem", letterSpacing: "0.15em", color: "#d4a843", textTransform: "uppercase", marginBottom: "8px" }}>
                客戶資料
              </div>
              <div className="text-base font-medium">{quote.clientName}</div>
              {quote.clientCompany && <div className="text-sm text-muted-foreground mt-1">{quote.clientCompany}</div>}
              {quote.clientEmail && <div className="text-sm text-muted-foreground mt-1">{quote.clientEmail}</div>}
              {quote.clientPhone && <div className="text-sm text-muted-foreground mt-1">{quote.clientPhone}</div>}
            </div>
            <div>
              <div style={{ fontSize: "0.6rem", letterSpacing: "0.15em", color: "#d4a843", textTransform: "uppercase", marginBottom: "8px" }}>
                服務資料
              </div>
              <div className="text-sm">
                <span
                  className="inline-block px-2 py-0.5 text-xs mb-2"
                  style={{ background: "rgba(212,168,67,0.15)", color: "#d4a843", letterSpacing: "0.1em" }}
                >
                  {SERVICE_LABELS[quote.serviceType] ?? quote.serviceType}
                </span>
              </div>
              {quote.shootingDate && !(["graphic_design","web_development","menu_design"].includes(quote.serviceType)) && <div className="text-sm text-muted-foreground">拍攝日期：{quote.shootingDate}</div>}
              {quote.shootingLocation && <div className="text-sm text-muted-foreground mt-1">拍攝地點：{quote.shootingLocation}</div>}
              {quote.shootingDate && !(["graphic_design","web_development","menu_design"].includes(quote.serviceType)) && quote.status === "accepted" && (
                <div className="flex items-center gap-1.5 mt-2">
                  <span style={{ fontSize: "0.6rem", letterSpacing: "0.1em", color: "rgba(212,168,67,0.6)", textTransform: "uppercase" }}>評價邀請</span>
                  {(quote as any).reviewEmailSentAt ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs" style={{ background: "rgba(76,175,80,0.12)", color: "#4caf50", border: "1px solid rgba(76,175,80,0.25)", borderRadius: "2px" }}>
                      ✓ 已發送 · {new Date((quote as any).reviewEmailSentAt).toLocaleString("zh-HK", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs" style={{ background: "rgba(255,255,255,0.05)", color: "#666", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "2px" }}>
                      ⏳ 待發送（拍攝日當天自動發送）
                    </span>
                  )}
                </div>
              )}
              {(quote as any).leadSource && (
                <div className="flex items-center gap-2 mt-2">
                  <span style={{ fontSize: "0.6rem", letterSpacing: "0.1em", color: "rgba(212,168,67,0.6)", textTransform: "uppercase" }}>詢價來源</span>
                  <span className="inline-block px-2 py-0.5 text-xs" style={{ background: "rgba(212,168,67,0.1)", color: "#d4a843", border: "1px solid rgba(212,168,67,0.25)", borderRadius: "2px" }}>
                    {(quote as any).leadSource}
                  </span>
                </div>
              )}
              {quote.status === "rejected" && (quote as any).rejectedReason && (
                <div className="flex items-center gap-2 mt-2">
                  <span style={{ fontSize: "0.6rem", letterSpacing: "0.1em", color: "rgba(229,57,53,0.7)", textTransform: "uppercase" }}>拒絕原因</span>
                  <span className="inline-block px-2 py-0.5 text-xs" style={{ background: "rgba(229,57,53,0.1)", color: "#e53935", border: "1px solid rgba(229,57,53,0.25)", borderRadius: "2px" }}>
                    {(quote as any).rejectedReason}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Email Open Status Banner */}
          {emailLogs && emailLogs.length > 0 && (() => {
            const latestSent = emailLogs.find(l => l.status === "sent");
            if (!latestSent) return null;
            return (
              <div
                className="flex items-center gap-2 px-6 py-2.5"
                style={{
                  background: latestSent.openedAt ? "rgba(201,169,110,0.08)" : "rgba(255,255,255,0.03)",
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                }}
              >
                <Eye className="h-3 w-3 shrink-0" style={{ color: latestSent.openedAt ? "#c9a96e" : "#444" }} />
                {latestSent.openedAt ? (
                  <span style={{ fontSize: "0.7rem", color: "#c9a96e" }}>
                    客戶已於 {new Date(latestSent.openedAt).toLocaleString("zh-HK", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} 開啟郵件
                    {(latestSent.openCount ?? 0) > 1 && (
                      <span style={{ color: "rgba(201,169,110,0.6)", marginLeft: "6px" }}>（共 {latestSent.openCount} 次）</span>
                    )}
                  </span>
                ) : (
                  <span style={{ fontSize: "0.7rem", color: "#555" }}>
                    郵件已發送至 {latestSent.to}，尚未開啟
                  </span>
                )}
              </div>
            );
          })()}

          {/* LLM Description */}
          {quote.llmDescription && (
            <div style={{ padding: "16px 24px", background: "#111111", borderBottom: "1px solid rgba(255,255,255,0.05)", borderLeft: "3px solid #c9a96e" }}>
              <div style={{ fontSize: "0.6rem", letterSpacing: "0.15em", color: "#d4a843", textTransform: "uppercase", marginBottom: "8px" }}>
                AI 生成服務說明
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">{quote.llmDescription}</p>
            </div>
          )}

          {/* Items Table */}
          <div style={{ padding: "24px", background: "#111111", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <div style={{ fontSize: "0.6rem", letterSpacing: "0.15em", color: "#d4a843", textTransform: "uppercase", marginBottom: "16px" }}>
              報價明細
            </div>
            <div className="overflow-x-auto">
            <table className="w-full min-w-[400px]">
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(212,168,67,0.2)" }}>
                  {["服務項目", "數量", "單價", "金額"].map((h, i) => (
                    <th
                      key={h}
                      className={`pb-3 text-xs ${i > 0 ? "text-right" : "text-left"}`}
                      style={{ fontSize: "0.6rem", letterSpacing: "0.12em", color: "#888", textTransform: "uppercase", fontWeight: 400 }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {quote.items.map((item, idx) => (
                  <tr key={idx} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                    <td className="py-3 text-sm">{item.description}</td>
                    <td className="py-3 text-sm text-right text-muted-foreground">
                      {Number(item.quantity)} {item.unit}
                    </td>
                    <td className="py-3 text-sm text-right text-muted-foreground">
                      HKD {Number(item.unitPrice).toLocaleString()}
                    </td>
                    <td className="py-3 text-sm text-right font-medium">
                      HKD {Number(item.amount).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>

          {/* Totals */}
          <div style={{ padding: "24px", background: "#111111", display: "flex", justifyContent: "flex-end" }}>
            <div className="w-56 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">小計</span>
                <span>HKD {Number(quote.subtotal).toLocaleString()}</span>
              </div>
              {Number(quote.discountAmount) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    折扣{Number((quote as any).discountPercent) > 0 ? ` (${Number((quote as any).discountPercent)}%)` : ""}
                  </span>
                  <span>- HKD {Number(quote.discountAmount).toLocaleString()}</span>
                </div>
              )}
              <div
                className="flex justify-between text-base font-semibold pt-3"
                style={{ borderTop: "1px solid #d4a843", color: "#d4a843" }}
              >
                <span>總計 ({quote.currency})</span>
                <span>HKD {Number(quote.total).toLocaleString()}</span>
              </div>
              {/* Deposit — supports both percent and fixed amount modes */}
              {(() => {
                const depositMode = (quote as any).depositMode ?? "percent";
                const depositPct = Number((quote as any).depositPercent ?? 0);
                const depositFixedAmt = Number((quote as any).depositFixedAmount ?? 0);
                const hasDeposit = depositMode === "fixed" ? depositFixedAmt > 0 : depositPct > 0;
                if (!hasDeposit) return null;
                const depositAmt = depositMode === "fixed"
                  ? depositFixedAmt
                  : Number(quote.total) * depositPct / 100;
                const netAmt = Number(quote.total) - depositAmt;
                const isFullPayment = depositAmt >= Number(quote.total);
                const depositLabel = depositMode === "fixed"
                  ? `訂金 (HKD ${depositAmt.toLocaleString('en-HK')})`
                  : `訂金 (${depositPct}%)`;
                return (
                  <>
                    <div className="flex justify-between text-sm pt-1">
                      <span className="text-muted-foreground">{depositLabel}</span>
                      <span style={{ color: "#d4a843" }}>HKD {depositAmt.toLocaleString('en-HK', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
                    </div>
                    {!isFullPayment && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Net Payment</span>
                        <span className="text-muted-foreground">HKD {netAmt.toLocaleString('en-HK', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>

          {/* Notes */}
          {quote.notes && (
            <div style={{ padding: "0 24px 24px", background: "#111111" }}>
              <div style={{ fontSize: "0.6rem", letterSpacing: "0.15em", color: "#888", textTransform: "uppercase", marginBottom: "8px" }}>
                備註
              </div>
              <p className="text-sm text-muted-foreground">{quote.notes}</p>
            </div>
          )}
        </div>

        {/* Status Update */}
        <div className="flex items-center justify-between flex-wrap gap-3" style={{ background: "#111111", border: "1px solid rgba(255,255,255,0.05)", borderRadius: "1px", padding: "16px 20px" }}>
          <div>
            <div style={{ fontSize: "0.6rem", letterSpacing: "0.15em", color: "#888", textTransform: "uppercase", marginBottom: "4px" }}>
              更新狀態
            </div>
            <div className="text-sm text-muted-foreground">當前狀態：<span style={{ color: statusInfo.color }}>{statusInfo.label}</span></div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
              <button
                key={key}
                onClick={() => handleStatusClick(key)}
                disabled={quote.status === key || updateStatusMutation.isPending}
                className="px-3 py-1.5 text-xs rounded transition-all disabled:opacity-30 hover:opacity-80"
                style={{
                  border: `1px solid ${cfg.color}40`,
                  color: cfg.color,
                  background: quote.status === key ? `${cfg.color}20` : "transparent",
                }}
              >
                {cfg.label}
              </button>
            ))}

            {/* Stop/Resume Follow-up Button */}
            {quote.status === "sent" && (
              <button
                onClick={() => toggleStopFollowUpMutation.mutate({ id: quoteId, stopFollowUp: !(quote as any)?.stopFollowUp })}
                disabled={toggleStopFollowUpMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 text-xs rounded transition-all hover:opacity-80 flex-shrink-0 disabled:opacity-50"
                style={{
                  background: (quote as any)?.stopFollowUp ? "#2e1a1a" : "#1a2e1a",
                  color: (quote as any)?.stopFollowUp ? "#f87171" : "#6fcf6f",
                  border: `1px solid ${(quote as any)?.stopFollowUp ? "rgba(248,113,113,0.3)" : "rgba(111,207,111,0.3)"}`,
                  fontWeight: 600,
                  letterSpacing: "0.1em",
                }}
              >
                {toggleStopFollowUpMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (quote as any)?.stopFollowUp ? (
                  <>
                    <Clock className="h-3.5 w-3.5" />
                    恢復跟進
                  </>
                ) : (
                  <>
                    <X className="h-3.5 w-3.5" />
                    停止跟進
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* ─── Payment Record Panel (inline) ─── */}
        <div style={{ background: "#111111", border: "1px solid rgba(126,184,247,0.15)", borderRadius: "1px", padding: "16px 20px" }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <div style={{ fontSize: "0.6rem", letterSpacing: "0.15em", color: "#7eb8f7", textTransform: "uppercase", marginBottom: "4px" }}>付款記錄</div>
              {!paymentEditing && (
                <div className="flex items-center gap-2">
                  {(quote as any).paymentStatus === "fully_paid" ? (
                    <span className="text-xs" style={{ color: "#6fcf6f" }}>✓ 已完成付款</span>
                  ) : (quote as any).paymentStatus === "deposit_paid" ? (
                    <span className="text-xs" style={{ color: "#7eb8f7" }}>已付訂金</span>
                  ) : (
                    <span className="text-xs" style={{ color: "#666" }}>未付款</span>
                  )}
                </div>
              )}
            </div>
            {!paymentEditing && (
              <button
                onClick={startPaymentEdit}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-all hover:opacity-80"
                style={{ border: "1px solid rgba(126,184,247,0.3)", color: "#7eb8f7", letterSpacing: "0.08em" }}
              >
                <DollarSign className="h-3 w-3" />
                編輯
              </button>
            )}
          </div>

          {/* Read-only view */}
          {!paymentEditing && (
            <div className="grid grid-cols-2 gap-x-8 gap-y-2">
              <div className="flex justify-between text-xs">
                <span style={{ color: "#666" }}>報價總額</span>
                <span style={{ color: "#d4a843", fontWeight: 600 }}>HKD {Number(quote.total).toLocaleString()}</span>
              </div>
              {(() => {
                const depositMode = (quote as any).depositMode ?? "percent";
                const depositPct = Number((quote as any).depositPercent ?? 0);
                const depositFixedAmt = Number((quote as any).depositFixedAmount ?? 0);
                const hasDeposit = depositMode === "fixed" ? depositFixedAmt > 0 : depositPct > 0;
                if (!hasDeposit) return null;
                const depositAmt = depositMode === "fixed"
                  ? depositFixedAmt
                  : Number(quote.total) * depositPct / 100;
                const depositLabel = depositMode === "fixed"
                  ? `訂金應付 (HKD ${depositAmt.toLocaleString('en-HK')})`
                  : `訂金應付 (${depositPct}%)`;
                return (
                  <div className="flex justify-between text-xs">
                    <span style={{ color: "#666" }}>{depositLabel}</span>
                    <span style={{ color: "#aaa" }}>HKD {depositAmt.toLocaleString('en-HK', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
                  </div>
                );
              })()}
              <div className="flex justify-between text-xs">
                <span style={{ color: "#666" }}>已付訂金</span>
                <span style={{ color: (quote as any).depositPaidAmount ? "#7eb8f7" : "#444" }}>
                  {(quote as any).depositPaidAmount ? `HKD ${Number((quote as any).depositPaidAmount).toLocaleString()}` : "—"}
                  {(quote as any).depositPaidAt ? ` · ${new Date((quote as any).depositPaidAt).toLocaleDateString("zh-HK")}` : ""}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span style={{ color: "#666" }}>已付尾數</span>
                <span style={{ color: (quote as any).balancePaidAmount ? "#6fcf6f" : "#444" }}>
                  {(quote as any).balancePaidAmount ? `HKD ${Number((quote as any).balancePaidAmount).toLocaleString()}` : "—"}
                  {(quote as any).balancePaidAt ? ` · ${new Date((quote as any).balancePaidAt).toLocaleDateString("zh-HK")}` : ""}
                </span>
              </div>
              {(quote as any).paymentNotes && (
                <div className="col-span-2 flex justify-between text-xs">
                  <span style={{ color: "#666" }}>備註</span>
                  <span style={{ color: "#aaa" }}>{(quote as any).paymentNotes}</span>
                </div>
              )}
              {/* Airwallex online payment links */}
              {airwallexStatus?.configured && (quote as any).paymentStatus !== "fully_paid" && (
                <div className="col-span-2 pt-3 mt-2" style={{ borderTop: "1px solid rgba(126,184,247,0.15)" }}>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span style={{ fontSize: "0.6rem", letterSpacing: "0.12em", color: "#7eb8f7", textTransform: "uppercase" }}>
                      Airwallex 線上付款
                    </span>
                    <div className="flex flex-wrap gap-1.5 justify-end">
                      {((quote as any).paymentStatus === "unpaid"
                        ? (["deposit", "full"] as const)
                        : (["balance"] as const)
                      ).map((kind) => (
                        <button
                          key={kind}
                          onClick={() => createPaymentLinkMutation.mutate({ id: quoteId, kind })}
                          disabled={createPaymentLinkMutation.isPending}
                          className="flex items-center gap-1 px-2 py-1 text-[10px] rounded transition-all hover:opacity-80 disabled:opacity-50"
                          style={{
                            border: "1px solid rgba(126,184,247,0.35)",
                            color: "#7eb8f7",
                            letterSpacing: "0.06em",
                          }}
                        >
                          {createPaymentLinkMutation.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <CreditCard className="h-3 w-3" />
                          )}
                          {kind === "deposit" ? "訂金連結" : kind === "balance" ? "尾數連結" : "全數連結"}
                        </button>
                      ))}
                    </div>
                  </div>
                  {paymentLinks && paymentLinks.length > 0 ? (
                    <div className="space-y-2">
                      {paymentLinks.slice(0, 5).map((link) => (
                        <div
                          key={link.id}
                          className="flex items-center justify-between gap-2 text-xs py-1.5 px-2 rounded"
                          style={{ background: "rgba(126,184,247,0.06)", border: "1px solid rgba(126,184,247,0.12)" }}
                        >
                          <div className="min-w-0">
                            <span style={{ color: link.status === "PAID" ? "#6fcf6f" : "#aaa" }}>
                              {link.kind === "deposit" ? "訂金" : link.kind === "balance" ? "尾數" : "全數"}
                              {" · "}
                              {link.currency} {Number(link.amount).toLocaleString()}
                              {" · "}
                              {link.status === "PAID" ? "已付" : "待付"}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {link.status !== "PAID" && (
                              <>
                                <button
                                  onClick={() => copyPaymentLink(link.url)}
                                  className="p-1 rounded hover:opacity-80"
                                  title="複製連結"
                                  style={{ color: "#7eb8f7" }}
                                >
                                  <Copy className="h-3 w-3" />
                                </button>
                                <a
                                  href={link.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="p-1 rounded hover:opacity-80"
                                  title="開啟付款頁"
                                  style={{ color: "#7eb8f7" }}
                                >
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs" style={{ color: "#555" }}>
                      按上方按鈕建立付款連結，客人付清後 webhook 會自動更新付款狀態。
                    </p>
                  )}
                </div>
              )}
              {/* 尚欠總額：報價總額 - 已付訂金 */}
              {(quote as any).paymentStatus !== "fully_paid" && (() => {
                const total = Number(quote.total) || 0;
                const depositPaid = Number((quote as any).depositPaidAmount) || 0;
                const owed = total - depositPaid;
                if (owed <= 0) return null;
                return (
                  <div className="col-span-2 flex justify-between text-xs pt-2 mt-1" style={{ borderTop: "1px solid rgba(224,123,57,0.25)" }}>
                    <span style={{ color: "#e07b39", fontWeight: 600 }}>尚欠總額</span>
                    <span style={{ color: "#e07b39", fontWeight: 700 }}>HKD {owed.toLocaleString("en-HK", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Edit form */}
          {paymentEditing && paymentForm && (
            <div className="space-y-4">
              {/* Payment Status */}
              <div>
                <div style={{ fontSize: "0.6rem", letterSpacing: "0.12em", color: "#666", textTransform: "uppercase", marginBottom: "8px" }}>付款狀態</div>
                <div className="flex gap-2">
                  {([
                    { value: "unpaid", label: "未付款", color: "#888" },
                    { value: "deposit_paid", label: "已付訂金", color: "#7eb8f7" },
                    { value: "fully_paid", label: "已完成付款", color: "#6fcf6f" },
                  ] as const).map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setPaymentForm(f => f ? { ...f, paymentStatus: opt.value } : f)}
                      className="flex-1 py-2 text-xs rounded transition-all"
                      style={{
                        background: paymentForm.paymentStatus === opt.value ? `${opt.color}20` : "transparent",
                        border: `1px solid ${paymentForm.paymentStatus === opt.value ? opt.color : "rgba(255,255,255,0.1)"}`,
                        color: paymentForm.paymentStatus === opt.value ? opt.color : "#666",
                        fontWeight: paymentForm.paymentStatus === opt.value ? 700 : 400,
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              {/* Deposit + Balance */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label style={{ fontSize: "0.6rem", letterSpacing: "0.12em", color: "#666", textTransform: "uppercase" }}>已付訂金 (HKD)</Label>
                  <Input type="number" placeholder="0" value={paymentForm.depositPaidAmount}
                    onChange={e => setPaymentForm(f => f ? { ...f, depositPaidAmount: e.target.value } : f)}
                    className="mt-1 text-xs" style={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }} />
                </div>
                <div>
                  <Label style={{ fontSize: "0.6rem", letterSpacing: "0.12em", color: "#666", textTransform: "uppercase" }}>訂金日期</Label>
                  <Input type="date" value={paymentForm.depositPaidAt}
                    onChange={e => setPaymentForm(f => f ? { ...f, depositPaidAt: e.target.value } : f)}
                    className="mt-1 text-xs" style={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", colorScheme: "dark" }} />
                </div>
                <div>
                  <Label style={{ fontSize: "0.6rem", letterSpacing: "0.12em", color: "#666", textTransform: "uppercase" }}>已付尾數 (HKD)</Label>
                  <Input type="number" placeholder="0" value={paymentForm.balancePaidAmount}
                    onChange={e => setPaymentForm(f => f ? { ...f, balancePaidAmount: e.target.value } : f)}
                    className="mt-1 text-xs" style={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }} />
                </div>
                <div>
                  <Label style={{ fontSize: "0.6rem", letterSpacing: "0.12em", color: "#666", textTransform: "uppercase" }}>尾數日期</Label>
                  <Input type="date" value={paymentForm.balancePaidAt}
                    onChange={e => setPaymentForm(f => f ? { ...f, balancePaidAt: e.target.value } : f)}
                    className="mt-1 text-xs" style={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", colorScheme: "dark" }} />
                </div>
              </div>
              {/* Notes */}
              <div>
                <Label style={{ fontSize: "0.6rem", letterSpacing: "0.12em", color: "#666", textTransform: "uppercase" }}>付款備註</Label>
                <Textarea placeholder="例：用現金付款、轉帳參考號..." value={paymentForm.paymentNotes}
                  onChange={e => setPaymentForm(f => f ? { ...f, paymentNotes: e.target.value } : f)}
                  rows={2} className="mt-1 text-xs resize-none"
                  style={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }} />
              </div>
              {/* Actions */}
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setPaymentEditing(false)}
                  className="px-4 py-2 text-xs rounded transition-all hover:opacity-70"
                  style={{ border: "1px solid rgba(255,255,255,0.1)", color: "#888", letterSpacing: "0.1em" }}
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    if (!paymentForm) return;
                    updatePaymentMutation.mutate({
                      id: quoteId,
                      paymentStatus: paymentForm.paymentStatus,
                      depositPaidAmount: paymentForm.depositPaidAmount ? Number(paymentForm.depositPaidAmount) : null,
                      depositPaidAt: paymentForm.depositPaidAt || null,
                      balancePaidAmount: paymentForm.balancePaidAmount ? Number(paymentForm.balancePaidAmount) : null,
                      balancePaidAt: paymentForm.balancePaidAt || null,
                      paymentNotes: paymentForm.paymentNotes || null,
                    });
                  }}
                  disabled={updatePaymentMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 text-xs rounded transition-all hover:opacity-80 disabled:opacity-50"
                  style={{ background: "#7eb8f7", color: "#0a0a0a", fontWeight: 700, letterSpacing: "0.1em" }}
                >
                  {updatePaymentMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DollarSign className="h-3.5 w-3.5" />}
                  儲存
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ─── Project Cost Panel ─── */}
        <div style={{ background: "#111111", border: "1px solid rgba(111,207,111,0.15)", borderRadius: "1px", padding: "16px 20px" }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <div style={{ fontSize: "0.6rem", letterSpacing: "0.15em", color: "#6fcf6f", textTransform: "uppercase", marginBottom: "4px" }}>PROJECT COST 項目成本</div>
              <div className="text-xs" style={{ color: "#555" }}>Job 直接成本記錄</div>
            </div>
            <button
              onClick={() => setCostDialogOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-all hover:opacity-80"
              style={{ border: "1px solid rgba(111,207,111,0.3)", color: "#6fcf6f", letterSpacing: "0.08em" }}
            >
              <Plus className="h-3 w-3" />
              新增成本
            </button>
          </div>

          {/* Cost list */}
          {costsData && costsData.costs.length > 0 ? (
            <div className="space-y-2 mb-4">
              {costsData.costs.map((cost) => (
                <div key={cost.id} className="flex items-center justify-between px-3 py-2 rounded" style={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs px-1.5 py-0.5 rounded shrink-0" style={{ background: "rgba(111,207,111,0.1)", color: "#6fcf6f", fontSize: "0.6rem", letterSpacing: "0.08em" }}>
                      {cost.categoryLabel}
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs truncate" style={{ color: "#ccc" }}>{cost.description}</div>
                      {cost.payee && <div className="text-xs" style={{ color: "#555" }}>{cost.payee}</div>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-3">
                    <span className="text-sm font-medium" style={{ color: "#f87171" }}>- HKD {Number(cost.amount).toLocaleString()}</span>
                    <button
                      onClick={() => deleteCostMutation.mutate({ id: cost.id })}
                      disabled={deleteCostMutation.isPending}
                      className="p-1 rounded hover:bg-white/5 transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" style={{ color: "#555" }} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs mb-4" style={{ color: "#444" }}>尚未記錄任何成本</div>
          )}

          {/* Gross Profit Summary */}
          <div className="pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center p-2 rounded" style={{ background: "rgba(212,168,67,0.06)", border: "1px solid rgba(212,168,67,0.1)" }}>
                <div style={{ fontSize: "0.55rem", letterSpacing: "0.12em", color: "#888", textTransform: "uppercase", marginBottom: "4px" }}>收入</div>
                <div className="text-sm font-semibold" style={{ color: "#d4a843" }}>HKD {Number(quote.total).toLocaleString()}</div>
              </div>
              <div className="text-center p-2 rounded" style={{ background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.1)" }}>
                <div style={{ fontSize: "0.55rem", letterSpacing: "0.12em", color: "#888", textTransform: "uppercase", marginBottom: "4px" }}>直接成本</div>
                <div className="text-sm font-semibold" style={{ color: "#f87171" }}>HKD {(costsData?.totalCost ?? 0).toLocaleString()}</div>
              </div>
              <div className="text-center p-2 rounded" style={{
                background: ((Number(quote.total) - (costsData?.totalCost ?? 0)) >= 0) ? "rgba(111,207,111,0.06)" : "rgba(248,113,113,0.06)",
                border: `1px solid ${((Number(quote.total) - (costsData?.totalCost ?? 0)) >= 0) ? "rgba(111,207,111,0.1)" : "rgba(248,113,113,0.1)"}`
              }}>
                <div className="flex items-center justify-center gap-1 mb-1">
                  <TrendingUp className="h-2.5 w-2.5" style={{ color: "#888" }} />
                  <div style={{ fontSize: "0.55rem", letterSpacing: "0.12em", color: "#888", textTransform: "uppercase" }}>毛利</div>
                </div>
                <div className="text-sm font-semibold" style={{ color: (Number(quote.total) - (costsData?.totalCost ?? 0)) >= 0 ? "#6fcf6f" : "#f87171" }}>
                  HKD {(Number(quote.total) - (costsData?.totalCost ?? 0)).toLocaleString()}
                </div>
                {costsData && costsData.totalCost > 0 && (
                  <div style={{ fontSize: "0.6rem", color: "#555" }}>
                    {((Number(quote.total) - costsData.totalCost) / Number(quote.total) * 100).toFixed(1)}%
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Reject Reason Dialog */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent
          className="max-w-sm"
          style={{ background: "#111111", border: "1px solid rgba(229,57,53,0.3)", borderRadius: "4px" }}
        >
          <DialogHeader>
            <DialogTitle style={{ color: "#e53935", fontSize: "0.75rem", letterSpacing: "0.2em", textTransform: "uppercase", fontWeight: 400 }}>
              報價被拒絕原因
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p style={{ fontSize: "0.75rem", color: "#888" }}>請選擇拒絕原因（可不選）</p>
            <div className="grid grid-cols-2 gap-2">
              {REJECT_REASONS.map(reason => (
                <button
                  key={reason}
                  onClick={() => setRejectReason(reason)}
                  className="px-3 py-2 text-xs rounded text-left transition-all"
                  style={{
                    border: `1px solid ${rejectReason === reason ? "#e53935" : "rgba(255,255,255,0.1)"}`,
                    background: rejectReason === reason ? "rgba(229,57,53,0.15)" : "transparent",
                    color: rejectReason === reason ? "#e53935" : "#aaa",
                  }}
                >
                  {reason}
                </button>
              ))}
            </div>
            {rejectReason === "其他原因" && (
              <input
                type="text"
                placeholder="請輸入原因..."
                value={customRejectReason}
                onChange={e => setCustomRejectReason(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded"
                style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.15)", color: "#fff" }}
              />
            )}
          </div>
          <DialogFooter className="gap-2">
            <button
              onClick={() => setShowRejectDialog(false)}
              className="px-4 py-2 text-xs rounded"
              style={{ border: "1px solid rgba(255,255,255,0.15)", color: "#888" }}
            >
              取消
            </button>
            <button
              onClick={confirmReject}
              className="px-4 py-2 text-xs rounded"
              style={{ background: "rgba(229,57,53,0.2)", border: "1px solid rgba(229,57,53,0.4)", color: "#e53935" }}
            >
              確認已拒絕
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Email Compose Dialog */}
      <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
        <DialogContent
          className="max-w-lg"
          style={{ background: "#111111", border: "1px solid rgba(212,168,67,0.2)", borderRadius: "4px" }}
        >
          <DialogHeader>
            <DialogTitle style={{ color: "#d4a843", fontSize: "0.75rem", letterSpacing: "0.2em", textTransform: "uppercase", fontWeight: 400 }}>
              發送報價單郵件
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label style={{ fontSize: "0.65rem", letterSpacing: "0.15em", color: "#888", textTransform: "uppercase" }}>TO (收件人)</Label>
              <Input
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                placeholder="client@example.com"
                type="email"
                style={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", fontSize: "0.85rem" }}
              />
            </div>
            <div className="space-y-1.5">
              <Label style={{ fontSize: "0.65rem", letterSpacing: "0.15em", color: "#888", textTransform: "uppercase" }}>SUBJECT (標題)</Label>
              <Input
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                placeholder="JD Studio Quotation"
                style={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", fontSize: "0.85rem" }}
              />
            </div>
            <div className="space-y-1.5">
              <Label style={{ fontSize: "0.65rem", letterSpacing: "0.15em", color: "#888", textTransform: "uppercase" }}>BODY (正文)</Label>
              <Textarea
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                rows={10}
                style={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", fontSize: "0.8rem", lineHeight: 1.7, resize: "vertical" }}
              />
            </div>

            {/* Email history */}
            {emailLogs && emailLogs.length > 0 && (
              <div className="pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ fontSize: "0.6rem", letterSpacing: "0.15em", color: "#666", textTransform: "uppercase", marginBottom: "8px" }}>SEND HISTORY</div>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {emailLogs.map((log) => (
                    <div key={log.id} className="rounded p-2" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                      {/* Row 1: status + recipient + sent time */}
                      <div className="flex items-center justify-between" style={{ fontSize: "0.72rem" }}>
                        <div className="flex items-center gap-2">
                          <span style={{ color: log.status === "sent" ? "#4caf50" : "#e53935", fontSize: "0.6rem" }}>
                            {log.status === "sent" ? "✓" : "✕"}
                          </span>
                          <span style={{ color: "#aaa" }}>{log.to}</span>
                        </div>
                        <div className="flex items-center gap-1" style={{ color: "#555" }}>
                          <Clock className="h-2.5 w-2.5" />
                          <span>{new Date(log.sentAt).toLocaleString("zh-HK", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                      </div>
                      {/* Row 2: open tracking status */}
                      <div className="flex items-center gap-1.5 mt-1" style={{ fontSize: "0.65rem" }}>
                        {log.openedAt ? (
                          <>
                            <Eye className="h-2.5 w-2.5" style={{ color: "#c9a96e" }} />
                            <span style={{ color: "#c9a96e" }}>
                              已讀 · {new Date(log.openedAt).toLocaleString("zh-HK", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </span>
                            {(log.openCount ?? 0) > 1 && (
                              <span style={{ color: "#666" }}>（共開啟 {log.openCount} 次）</span>
                            )}
                          </>
                        ) : (
                          <>
                            <Eye className="h-2.5 w-2.5" style={{ color: "#444" }} />
                            <span style={{ color: "#444" }}>未讀</span>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <button
              onClick={() => setEmailDialogOpen(false)}
              className="px-4 py-2 text-xs rounded transition-all hover:opacity-70"
              style={{ border: "1px solid rgba(255,255,255,0.1)", color: "#888", letterSpacing: "0.1em" }}
            >
              取消
            </button>
            <button
              onClick={() => {
                if (!emailTo.trim()) { toast.error("請填寫收件人電郵地址"); return; }
                if (!emailSubject.trim()) { toast.error("請填寫標題"); return; }
                if (!emailBody.trim()) { toast.error("請填寫正文"); return; }
                sendEmailMutation.mutate({ id: quoteId, to: emailTo.trim(), subject: emailSubject.trim(), body: emailBody.trim() });
              }}
              disabled={sendEmailMutation.isPending}
              className="flex items-center gap-2 px-5 py-2 text-xs rounded transition-all hover:opacity-80 disabled:opacity-50"
              style={{ background: "#d4a843", color: "#0a0a0a", fontWeight: 700, letterSpacing: "0.1em" }}
            >
              {sendEmailMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
              {sendEmailMutation.isPending ? "發送中..." : "確認發送"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sign Link Dialog */}
      <Dialog open={signDialogOpen} onOpenChange={setSignDialogOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-lg" style={{ background: "#111", border: "1px solid rgba(201,169,110,0.2)", maxHeight: "90vh", overflowY: "auto", overflowX: "hidden" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "#c9a96e", fontSize: "0.85rem", letterSpacing: "0.15em", textTransform: "uppercase" }}>
              {(quote as any)?.signedAt ? "簽署狀態" : "簽署連結"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Signed status */}
            {(quote as any)?.signedAt && (
              <div className="flex items-center gap-3 p-3 rounded" style={{ background: "rgba(111,207,111,0.08)", border: "1px solid rgba(111,207,111,0.2)" }}>
                <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: "#6fcf6f" }} />
                <div>
                  <div style={{ color: "#6fcf6f", fontSize: "0.75rem", fontWeight: 600 }}>已簽署</div>
                  <div style={{ color: "#aaa", fontSize: "0.7rem" }}>
                    {(quote as any).signedByName} &middot; {new Date((quote as any).signedAt).toLocaleString("zh-HK")}
                  </div>
                </div>
              </div>
            )}

            {/* Sign link */}
            <div>
              <div style={{ fontSize: "0.6rem", letterSpacing: "0.15em", color: "#666", textTransform: "uppercase", marginBottom: "8px" }}>SIGN LINK</div>
              {(quote as any)?.signToken ? (
                <div className="space-y-2">
                  <div
                    className="w-full px-3 py-2 rounded text-xs"
                    style={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.08)", color: "#888", fontFamily: "monospace", wordBreak: "break-all", lineHeight: "1.5" }}
                  >
                    {window.location.origin}/sign/{(quote as any).signToken}
                  </div>
                  <button
                    onClick={copySignLink}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded text-xs transition-all hover:opacity-80"
                    style={{ background: "#d4a843", color: "#0a0a0a", fontWeight: 700, letterSpacing: "0.1em" }}
                  >
                    複製連結
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => generateSignLinkMutation.mutate({ id: quoteId })}
                  disabled={generateSignLinkMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 text-xs rounded transition-all hover:opacity-80 disabled:opacity-50"
                  style={{ background: "#d4a843", color: "#0a0a0a", fontWeight: 700, letterSpacing: "0.1em" }}
                >
                  {generateSignLinkMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                  生成簽署連結
                </button>
              )}
            </div>

            {/* Attachments */}
            <div>
              <div style={{ fontSize: "0.6rem", letterSpacing: "0.15em", color: "#666", textTransform: "uppercase", marginBottom: "8px" }}>ATTACHMENTS 附件</div>
              {/* Attachment list */}
              {(() => {
                const attachments: Array<{ name: string; url: string; key: string }> =
                  (quote as any)?.signAttachments
                    ? JSON.parse((quote as any).signAttachments)
                    : [];
                return attachments.length > 0 ? (
                  <div className="space-y-1.5 mb-3">
                    {attachments.map((att) => (
                      <div key={att.key} className="flex items-center justify-between px-3 py-2 rounded" style={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <div className="flex items-center gap-2 min-w-0">
                          <Paperclip className="h-3 w-3 shrink-0" style={{ color: "#c9a96e" }} />
                          <a href={att.url} target="_blank" rel="noopener noreferrer" className="text-xs truncate hover:underline" style={{ color: "#c9a96e" }}>{att.name}</a>
                        </div>
                        <button
                          onClick={() => removeAttachmentMutation.mutate({ id: quoteId, key: att.key })}
                          className="p-1 rounded hover:bg-white/5 transition-colors"
                          disabled={removeAttachmentMutation.isPending}
                        >
                          <X className="h-3 w-3" style={{ color: "#666" }} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: "#444", fontSize: "0.72rem", marginBottom: "8px" }}>尚未上載附件</div>
                );
              })()}
              {/* Upload button */}
              <input
                ref={signFileInputRef}
                type="file"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) await handleUploadAttachment(file);
                  e.target.value = "";
                }}
              />
              <button
                onClick={() => signFileInputRef.current?.click()}
                disabled={signAttachUploading || uploadAttachmentMutation.isPending}
                className="flex items-center gap-2 px-3 py-2 text-xs rounded transition-all hover:opacity-80 disabled:opacity-50"
                style={{ border: "1px solid rgba(201,169,110,0.3)", color: "#c9a96e", letterSpacing: "0.1em" }}
              >
                {signAttachUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
                {signAttachUploading ? "上載中...": "上載附件"}
              </button>
            </div>

            {/* Reset sign link */}
            {(quote as any)?.signToken && (
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "12px" }}>
                <div style={{ fontSize: "0.6rem", letterSpacing: "0.15em", color: "#444", textTransform: "uppercase", marginBottom: "8px" }}>DANGER ZONE</div>
                <button
                  onClick={() => {
                    if (confirm("重置後舊連結將失效，已簽署記錄將被清除。確定繼續？")) {
                      resetSignLinkMutation.mutate({ id: quoteId });
                    }
                  }}
                  disabled={resetSignLinkMutation.isPending}
                  className="flex items-center gap-2 px-3 py-2 text-xs rounded transition-all hover:opacity-80 disabled:opacity-50"
                  style={{ border: "1px solid rgba(229,57,53,0.3)", color: "#e57373", letterSpacing: "0.1em" }}
                >
                  {resetSignLinkMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  重置簽署連結
                </button>
              </div>
            )}
          </div>
          <DialogFooter>
            <button
              onClick={() => setSignDialogOpen(false)}
              className="px-4 py-2 text-xs rounded transition-all hover:opacity-70"
              style={{ border: "1px solid rgba(255,255,255,0.1)", color: "#888", letterSpacing: "0.1em" }}
            >
              關閉
            </button>
          </DialogFooter>
        </DialogContent>
            </Dialog>

      {/* Add Cost Dialog */}
      <Dialog open={costDialogOpen} onOpenChange={setCostDialogOpen}>
        <DialogContent
          className="max-w-sm"
          style={{ background: "#111111", border: "1px solid rgba(111,207,111,0.3)", borderRadius: "4px" }}
        >
          <DialogHeader>
            <DialogTitle style={{ color: "#6fcf6f", fontSize: "0.75rem", letterSpacing: "0.2em", textTransform: "uppercase", fontWeight: 400 }}>
              新增項目成本
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {/* Category */}
            <div>
              <Label style={{ fontSize: "0.6rem", letterSpacing: "0.12em", color: "#666", textTransform: "uppercase" }}>成本種類</Label>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {COST_CATEGORIES.map(cat => (
                  <button
                    key={cat.value}
                    onClick={() => setCostForm(f => ({ ...f, category: cat.value }))}
                    className="px-3 py-2 text-xs rounded text-left transition-all"
                    style={{
                      border: `1px solid ${costForm.category === cat.value ? "#6fcf6f" : "rgba(255,255,255,0.1)"}`,
                      background: costForm.category === cat.value ? "rgba(111,207,111,0.15)" : "transparent",
                      color: costForm.category === cat.value ? "#6fcf6f" : "#aaa",
                    }}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>
            {/* Description */}
            <div>
              <Label style={{ fontSize: "0.6rem", letterSpacing: "0.12em", color: "#666", textTransform: "uppercase" }}>描述 *</Label>
              <Input
                value={costForm.description}
                onChange={e => setCostForm(f => ({ ...f, description: e.target.value }))}
                placeholder="例：外判攝影師 陳大文"
                className="mt-1 text-xs"
                style={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }}
              />
            </div>
            {/* Amount */}
            <div>
              <Label style={{ fontSize: "0.6rem", letterSpacing: "0.12em", color: "#666", textTransform: "uppercase" }}>金額 (HKD) *</Label>
              <Input
                type="number"
                value={costForm.amount}
                onChange={e => setCostForm(f => ({ ...f, amount: e.target.value }))}
                placeholder="0"
                className="mt-1 text-xs"
                style={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }}
              />
            </div>
            {/* Payee */}
            <div>
              <Label style={{ fontSize: "0.6rem", letterSpacing: "0.12em", color: "#666", textTransform: "uppercase" }}>收款方（可不填）</Label>
              <Input
                value={costForm.payee}
                onChange={e => setCostForm(f => ({ ...f, payee: e.target.value }))}
                placeholder="例：陳大文 / ABC 公司"
                className="mt-1 text-xs"
                style={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <button
              onClick={() => { setCostDialogOpen(false); setCostForm({ category: "freelancer", description: "", amount: "", payee: "" }); }}
              className="px-4 py-2 text-xs rounded transition-all hover:opacity-70"
              style={{ border: "1px solid rgba(255,255,255,0.1)", color: "#888", letterSpacing: "0.1em" }}
            >
              取消
            </button>
            <button
              onClick={() => {
                if (!costForm.description.trim()) { toast.error("請填寫描述"); return; }
                const amt = Number(costForm.amount);
                if (!amt || amt <= 0) { toast.error("請填寫有效金額"); return; }
                createCostMutation.mutate({
                  quoteId,
                  category: costForm.category as any,
                  description: costForm.description.trim(),
                  amount: amt,
                  payee: costForm.payee.trim() || undefined,
                });
              }}
              disabled={createCostMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 text-xs rounded transition-all hover:opacity-80 disabled:opacity-50"
              style={{ background: "#6fcf6f", color: "#0a0a0a", fontWeight: 700, letterSpacing: "0.1em" }}
            >
              {createCostMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              新增
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
