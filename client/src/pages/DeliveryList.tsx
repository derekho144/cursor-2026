import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Copy, ExternalLink, Trash2, Edit2, CheckCircle, Eye, EyeOff, Search, Camera, FileText, Loader2 } from "lucide-react";
import { useState as useStateLocal } from "react";

const BASE_URL = window.location.origin;

type DeliveryStatus = "active" | "expired" | "archived";

const STATUS_LABELS: Record<DeliveryStatus, { label: string; color: string; bg: string }> = {
  active:   { label: "啟用中", color: "#4ade80", bg: "rgba(74,222,128,0.1)" },
  expired:  { label: "已過期", color: "#f87171", bg: "rgba(248,113,113,0.1)" },
  archived: { label: "已封存", color: "#9ca3af", bg: "rgba(156,163,175,0.1)" },
};

function PasswordInput({ value, onChange, placeholder, inputStyle }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputStyle: React.CSSProperties;
}) {
  const [show, setShow] = useStateLocal(false);
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={inputStyle}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2"
        style={{ color: "rgba(255,255,255,0.4)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABELS[status as DeliveryStatus] ?? { label: status, color: "#9ca3af", bg: "rgba(156,163,175,0.1)" };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 text-xs font-semibold tracking-wide"
      style={{ color: s.color, background: s.bg, border: `1px solid ${s.color}40`, borderRadius: 3 }}
    >
      {s.label}
    </span>
  );
}

type FormState = {
  clientName: string;
  title: string;
  googleDriveUrl: string;
  message: string;
  password: string;
  expiresAt: string;
  quoteId: string; // selected quote id (string for Select)
  quoteNumber: string; // display only
  quoteLocked: boolean; // true when navigated from quote detail
};

const emptyForm: FormState = {
  clientName: "",
  title: "",
  googleDriveUrl: "",
  message: "",
  password: "",
  expiresAt: "",
  quoteId: "",
  quoteNumber: "",
  quoteLocked: false,
};

export default function DeliveryList() {
  const utils = trpc.useUtils();

  const { data: deliveries, isLoading } = trpc.deliveries.list.useQuery();
  const createMutation = trpc.deliveries.create.useMutation({
    onSuccess: (data) => {
      toast.success("交付連結已建立");
      utils.deliveries.list.invalidate();
      setShowCreate(false);
      setForm(emptyForm);
      const link = `${BASE_URL}/delivery/${data.token}`;
      setNewLink(link);
      setShowLinkDialog(true);
    },
    onError: (e) => toast.error(`建立失敗：${e.message}`),
  });
  const deleteMutation = trpc.deliveries.delete.useMutation({
    onSuccess: () => { toast.success("已刪除"); utils.deliveries.list.invalidate(); },
    onError: (e) => toast.error(`刪除失敗：${e.message}`),
  });
  const updateMutation = trpc.deliveries.update.useMutation({
    onSuccess: () => { toast.success("已更新"); utils.deliveries.list.invalidate(); setShowEdit(false); },
    onError: (e) => toast.error(`更新失敗：${e.message}`),
  });

  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [newLink, setNewLink] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editStatus, setEditStatus] = useState<DeliveryStatus>("active");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [isGeneratingReceipt, setIsGeneratingReceipt] = useState(false);

  // Fetch quotes for linking
  const { data: quotesListData } = trpc.quotes.list.useQuery({ limit: 100 });
  const generateReceiptMutation = trpc.quotes.generateReceiptPdf.useMutation();

  // Auto-open create dialog if navigated from quote with prefill params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1") {
      const clientName = params.get("clientName") ?? "";
      const title = params.get("title") ?? "";
      const quoteId = params.get("quoteId") ?? "";
      const quoteNumber = params.get("quoteNumber") ?? "";
      setForm({ ...emptyForm, clientName, title, quoteId, quoteNumber, quoteLocked: !!quoteId });
      setShowCreate(true);
      // Clean URL without reload
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const inputStyle = {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    color: "#e5e7eb",
    borderRadius: "4px",
  };

  async function handleCreate() {
    if (!form.clientName.trim() || !form.title.trim() || !form.googleDriveUrl.trim()) {
      toast.error("請填寫客戶名稱、標題及 Google Drive 連結");
      return;
    }
    const quoteId = form.quoteId ? parseInt(form.quoteId) : undefined;
    // Auto-generate Receipt PDF if quote selected
    if (quoteId) {
      setIsGeneratingReceipt(true);
      try {
        await generateReceiptMutation.mutateAsync({ id: quoteId });
      } catch (e) {
        toast.error("Receipt PDF 生成失敗，仍繼續建立交付連結");
      } finally {
        setIsGeneratingReceipt(false);
      }
    }
    createMutation.mutate({
      clientName: form.clientName,
      title: form.title,
      googleDriveUrl: form.googleDriveUrl,
      message: form.message || undefined,
      password: form.password.trim() || undefined,
      expiresAt: form.expiresAt || undefined,
      quoteId,
    });
  }

  function handleEditOpen(d: any) {
    setEditId(d.id);
    // Find the quote number for display
    const linkedQuote = d.quoteId ? (quotesListData?.data ?? []).find((q: any) => q.id === d.quoteId) : null;
    setForm({
      clientName: d.clientName,
      title: d.title,
      googleDriveUrl: d.googleDriveUrl,
      message: d.message ?? "",
      password: "",
      expiresAt: d.expiresAt ? new Date(d.expiresAt).toISOString().split("T")[0] : "",
      quoteId: d.quoteId ? String(d.quoteId) : "",
      quoteNumber: linkedQuote?.quoteNumber ?? (d.quoteId ? String(d.quoteId) : ""),
      quoteLocked: false, // editing always allows changing quote
    });
    setEditStatus(d.status);
    setShowEdit(true);
  }

  async function handleUpdate() {
    if (!editId) return;
    const quoteId = form.quoteId ? parseInt(form.quoteId) : undefined;
    // Auto-generate Receipt PDF if quote selected
    if (quoteId) {
      setIsGeneratingReceipt(true);
      try {
        await generateReceiptMutation.mutateAsync({ id: quoteId });
      } catch (e) {
        toast.error("Receipt PDF 生成失敗，仍繼續儲存");
      } finally {
        setIsGeneratingReceipt(false);
      }
    }
    updateMutation.mutate({
      id: editId,
      clientName: form.clientName,
      title: form.title,
      googleDriveUrl: form.googleDriveUrl,
      message: form.message || undefined,
      password: form.password !== undefined ? (form.password.trim() || null) : undefined,
      status: editStatus,
      expiresAt: form.expiresAt || undefined,
      quoteId: quoteId !== undefined ? (quoteId || null) : undefined,
    });
  }

  function copyLink(token: string) {
    const link = `${BASE_URL}/delivery/${token}`;
    navigator.clipboard.writeText(link);
    toast.success("連結已複製到剪貼板");
  }

  // Filter + search
  const filtered = (deliveries ?? []).filter((d) => {
    const matchStatus = filterStatus === "all" || d.status === filterStatus;
    const q = search.toLowerCase();
    const matchSearch = !q || d.clientName.toLowerCase().includes(q) || d.title.toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  return (
    <DashboardLayout>
      <div style={{ maxWidth: 1200 }}>

        {/* Header */}
        <div className="flex items-start justify-between mb-6 gap-2 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-white tracking-wide">相片交付</h1>
            <p className="text-sm text-muted-foreground mt-1">
              建立交付連結，讓客人下載相片及影片
              {deliveries?.length ? <span className="ml-2 text-xs" style={{ color: "rgba(212,168,67,0.7)" }}>共 {deliveries.length} 條記錄</span> : null}
            </p>
          </div>
          <Button
            onClick={() => { setForm(emptyForm); setShowCreate(true); }}
            style={{ background: "#d4a843", color: "#000", fontWeight: 700, letterSpacing: "0.04em" }}
          >
            <Plus className="h-4 w-4 mr-1" /> 新增交付
          </Button>
        </div>

        {/* Search + Filter bar */}
        {(deliveries?.length ?? 0) > 0 && (
          <div className="flex gap-3 mb-6">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: "rgba(255,255,255,0.3)" }} />
              <Input
                placeholder="搜尋客戶名稱或相簿標題..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ ...inputStyle, paddingLeft: "2.25rem" }}
              />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger style={{ ...inputStyle, width: 130 }}>
                <SelectValue placeholder="全部狀態" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部狀態</SelectItem>
                <SelectItem value="active">啟用中</SelectItem>
                <SelectItem value="expired">已過期</SelectItem>
                <SelectItem value="archived">已封存</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Content */}
        {isLoading ? (
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
            {[1,2,3,4].map((i) => (
              <div key={i} className="rounded-lg p-5 animate-pulse" style={{ background: "#111", border: "1px solid rgba(255,255,255,0.06)", height: 160 }} />
            ))}
          </div>
        ) : !deliveries?.length ? (
          <div className="text-center py-24">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-5" style={{ background: "rgba(212,168,67,0.08)", border: "1px solid rgba(212,168,67,0.15)" }}>
              <Camera className="h-7 w-7" style={{ color: "#d4a843", opacity: 0.7 }} />
            </div>
            <p className="text-white font-medium mb-1">尚未建立任何交付連結</p>
            <p className="text-sm text-muted-foreground">點擊「新增交付」開始建立</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Search className="h-8 w-8 mx-auto mb-3 opacity-20" />
            <p className="text-muted-foreground text-sm">找不到符合的記錄</p>
          </div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
            {filtered.map((d) => {
              const link = `${BASE_URL}/delivery/${d.token}`;
              const createdDate = new Date(d.createdAt).toLocaleDateString("zh-HK", { year: "numeric", month: "short", day: "numeric" });
              return (
                <div
                  key={d.id}
                  className="rounded-lg flex flex-col"
                  style={{
                    background: "#0f0f0f",
                    border: "1px solid rgba(255,255,255,0.08)",
                    transition: "border-color 0.2s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = "rgba(212,168,67,0.3)")}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)")}
                >
                  {/* Card top accent */}
                  <div style={{ height: 2, background: d.status === "active" ? "linear-gradient(90deg, #d4a843, transparent)" : "transparent", borderRadius: "8px 8px 0 0" }} />

                  <div className="p-5 flex flex-col flex-1">
                    {/* Title row */}
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-white text-sm leading-tight truncate">{d.title}</p>
                      </div>
                      <StatusBadge status={d.status} />
                    </div>

                    {/* Stats row */}
                    <div className="flex items-center gap-4 mb-4">
                      <div className="flex items-center gap-1.5">
                        <Eye className="h-3.5 w-3.5" style={{ color: "rgba(255,255,255,0.3)" }} />
                        <span className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>{d.downloadCount} 次瀏覽</span>
                      </div>

                    </div>

                    {/* Link preview */}
                    <div
                      className="text-xs mb-4 px-2.5 py-1.5 rounded truncate"
                      style={{ background: "rgba(212,168,67,0.06)", color: "rgba(212,168,67,0.55)", border: "1px solid rgba(212,168,67,0.12)", fontFamily: "monospace" }}
                    >
                      {link.replace(BASE_URL, "")}
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 mt-auto">
                      <Button
                        size="sm"
                        onClick={() => copyLink(d.token)}
                        className="flex-1 text-xs"
                        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#9ca3af", height: 32 }}
                      >
                        <Copy className="h-3 w-3 mr-1.5" /> 複製連結
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => window.open(link, "_blank")}
                        style={{ borderColor: "rgba(255,255,255,0.1)", color: "#9ca3af", height: 32, width: 32, padding: 0 }}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleEditOpen(d)}
                        style={{ borderColor: "rgba(255,255,255,0.1)", color: "#9ca3af", height: 32, width: 32, padding: 0 }}
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { if (confirm("確定刪除此交付連結？")) deleteMutation.mutate({ id: d.id }); }}
                        style={{ borderColor: "rgba(239,68,68,0.25)", color: "#f87171", height: 32, width: 32, padding: 0 }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent style={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.1)", maxWidth: 560 }}>
          <DialogHeader>
            <div className="text-xs tracking-widest mb-1" style={{ color: "#d4a843" }}>NEW DELIVERY</div>
            <DialogTitle className="text-white text-xl">新增交付連結</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Linked Quote (locked when from quote detail) */}
            {form.quoteLocked ? (
              <div>
                <label className="text-xs tracking-widest text-muted-foreground mb-1.5 block">連結報價單</label>
                <div
                  className="flex items-center gap-2 px-3 py-2 rounded"
                  style={{ background: "rgba(111,207,111,0.08)", border: "1px solid rgba(111,207,111,0.3)", color: "#6fcf6f" }}
                >
                  <FileText className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="text-sm font-medium">{form.quoteNumber}</span>
                  <span className="text-xs ml-auto" style={{ color: "rgba(111,207,111,0.6)" }}>已鎖定</span>
                </div>
              </div>
            ) : (
              <div>
                <label className="text-xs tracking-widest text-muted-foreground mb-1.5 block">連結報價單（選填）</label>
                <Select value={form.quoteId || "none"} onValueChange={(v) => {
                  const q = quotesListData?.data?.find((q: any) => String(q.id) === v);
                  setForm((p) => ({ ...p, quoteId: v === "none" ? "" : v, quoteNumber: q?.quoteNumber ?? "" }));
                }}>
                  <SelectTrigger style={inputStyle}>
                    <SelectValue placeholder="選擇報價單（可選）" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">不連結報價單</SelectItem>
                    {(quotesListData?.data ?? []).map((q: any) => (
                      <SelectItem key={q.id} value={String(q.id)}>
                        {q.quoteNumber} — {q.clientName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <label className="text-xs tracking-widest text-muted-foreground mb-1.5 block">客戶名稱 *</label>
              <Input value={form.clientName} onChange={(e) => setForm((p) => ({ ...p, clientName: e.target.value }))} placeholder="e.g. ABC Company" style={inputStyle} />
            </div>
            <div>
              <label className="text-xs tracking-widest text-muted-foreground mb-1.5 block">交付標題 *</label>
              <Input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder="e.g. ABC Company Event Photos - March 2026" style={inputStyle} />
            </div>
            <div>
              <label className="text-xs tracking-widest text-muted-foreground mb-1.5 block">Google Drive 連結 *</label>
              <Input value={form.googleDriveUrl} onChange={(e) => setForm((p) => ({ ...p, googleDriveUrl: e.target.value }))} placeholder="https://drive.google.com/drive/folders/..." style={inputStyle} />
            </div>
            <div>
              <label className="text-xs tracking-widest text-muted-foreground mb-1.5 block">密碼保護（選填）</label>
              <PasswordInput value={form.password} onChange={(v) => setForm((p) => ({ ...p, password: v }))} placeholder="設定後客人需輸入密碼才能查看" inputStyle={inputStyle} />
            </div>
            {form.quoteId && (
              <p className="text-xs" style={{ color: "rgba(111,207,111,0.8)" }}>
                <FileText className="inline h-3 w-3 mr-1" />Receipt PDF 將根據已連結的報價單 <strong>{form.quoteNumber}</strong> 自動生成
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} style={{ borderColor: "rgba(255,255,255,0.1)", color: "#9ca3af" }}>取消</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending || isGeneratingReceipt} style={{ background: "#d4a843", color: "#000", fontWeight: 600 }}>
              {isGeneratingReceipt ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />生成 Receipt...</> : createMutation.isPending ? "建立中..." : "建立連結"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent style={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.1)", maxWidth: 560 }}>
          <DialogHeader>
            <div className="text-xs tracking-widest mb-1" style={{ color: "#d4a843" }}>EDIT DELIVERY</div>
            <DialogTitle className="text-white text-xl">編輯交付連結</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs tracking-widest text-muted-foreground mb-1.5 block">連結報價單</label>
              <Select value={form.quoteId || "none"} onValueChange={(v) => {
                const q = quotesListData?.data?.find((q: any) => String(q.id) === v);
                setForm((p) => ({ ...p, quoteId: v === "none" ? "" : v, quoteNumber: q?.quoteNumber ?? "" }));
              }}>
                <SelectTrigger style={form.quoteId ? { ...inputStyle, borderColor: "rgba(111,207,111,0.4)", color: "#6fcf6f" } : inputStyle}>
                  <SelectValue placeholder="不連結報價單" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不連結報價單</SelectItem>
                  {(quotesListData?.data ?? []).map((q: any) => (
                    <SelectItem key={q.id} value={String(q.id)}>
                      {q.quoteNumber} — {q.clientName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.quoteId && (
                <p className="text-xs mt-1" style={{ color: "rgba(111,207,111,0.7)" }}>
                  <FileText className="inline h-3 w-3 mr-1" />Receipt 將根據 <strong>{form.quoteNumber}</strong> 生成
                </p>
              )}
            </div>
            <div>
              <label className="text-xs tracking-widest text-muted-foreground mb-1.5 block">客戶名稱</label>
              <Input value={form.clientName} onChange={(e) => setForm((p) => ({ ...p, clientName: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label className="text-xs tracking-widest text-muted-foreground mb-1.5 block">交付標題</label>
              <Input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label className="text-xs tracking-widest text-muted-foreground mb-1.5 block">Google Drive 連結</label>
              <Input value={form.googleDriveUrl} onChange={(e) => setForm((p) => ({ ...p, googleDriveUrl: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label className="text-xs tracking-widest text-muted-foreground mb-1.5 block">密碼保護（留空則清除密碼）</label>
              <PasswordInput value={form.password} onChange={(v) => setForm((p) => ({ ...p, password: v }))} placeholder="輸入新密碼，或留空清除現有密碼" inputStyle={inputStyle} />
            </div>
            <div>
              <label className="text-xs tracking-widest text-muted-foreground mb-1.5 block">狀態</label>
              <Select value={editStatus} onValueChange={(v) => setEditStatus(v as DeliveryStatus)}>
                <SelectTrigger style={inputStyle}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">啟用中</SelectItem>
                  <SelectItem value="expired">已過期</SelectItem>
                  <SelectItem value="archived">已封存</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)} style={{ borderColor: "rgba(255,255,255,0.1)", color: "#9ca3af" }}>取消</Button>
            <Button onClick={handleUpdate} disabled={updateMutation.isPending || isGeneratingReceipt} style={{ background: "#d4a843", color: "#000", fontWeight: 600 }}>
              {isGeneratingReceipt ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />生成 Receipt...</> : updateMutation.isPending ? "儲存中..." : "儲存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Link Dialog */}
      <Dialog open={showLinkDialog} onOpenChange={setShowLinkDialog}>
        <DialogContent style={{ background: "#0a0a0a", border: "1px solid rgba(212,168,67,0.3)", maxWidth: 520 }}>
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className="h-5 w-5" style={{ color: "#4ade80" }} />
              <div className="text-xs tracking-widest" style={{ color: "#4ade80" }}>DELIVERY CREATED</div>
            </div>
            <DialogTitle className="text-white text-xl">交付連結已建立</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-muted-foreground mb-3">請複製以下連結並發送給客人：</p>
            <div
              className="flex items-center gap-2 p-3 rounded"
              style={{ background: "rgba(212,168,67,0.08)", border: "1px solid rgba(212,168,67,0.2)" }}
            >
              <span className="flex-1 text-sm break-all" style={{ color: "#d4a843" }}>{newLink}</span>
              <Button
                size="sm"
                onClick={() => { navigator.clipboard.writeText(newLink); toast.success("已複製"); }}
                style={{ background: "#d4a843", color: "#000", flexShrink: 0 }}
              >
                <Copy className="h-3.5 w-3.5 mr-1" /> 複製
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setShowLinkDialog(false)} style={{ background: "#d4a843", color: "#000", fontWeight: 600 }}>完成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
