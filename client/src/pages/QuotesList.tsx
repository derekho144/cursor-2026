import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { FileText, Plus, Search, Trash2, Edit, Download, ImageIcon, Eye, Building2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SERVICE_LABELS } from "@/lib/serviceLabels";

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft: { label: "草稿", color: "#666" },
  sent: { label: "已發送", color: "#d4a843" },
  accepted: { label: "已接受", color: "#4caf50" },
  rejected: { label: "已拒絕", color: "#e53935" },
  expired: { label: "已過期", color: "#888" },
};

export default function QuotesList() {
  const [, setLocation] = useLocation();

  function handleDeliverPhotos(quote: { id: number; clientName: string; clientCompany?: string | null; title?: string | null; quoteNumber: string; shootingDate?: string | null }) {
    // Build a prefilled delivery title from quote info
    const titleParts = [quote.clientName];
    if (quote.shootingDate) titleParts.push(quote.shootingDate);
    const deliveryTitle = titleParts.join(" - ");
    // Navigate to delivery list with prefill params including quoteId
    const params = new URLSearchParams({
      clientName: quote.clientName,
      title: deliveryTitle,
      quoteId: String(quote.id),
      quoteNumber: quote.quoteNumber,
    });
    setLocation(`/deliveries?new=1&${params.toString()}`);
  }
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [serviceType, setServiceType] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [leadSource, setLeadSource] = useState<string>("all");
  const [selectedYear, setSelectedYear] = useState<string>("all");
  const [selectedMonth, setSelectedMonth] = useState<string>("all");
  const [page, setPage] = useState(0);
  const limit = 15;

  // Generate year options: current year and 3 years back
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 4 }, (_, i) => currentYear - i);
  const monthOptions = [
    { value: "1", label: "1月" }, { value: "2", label: "2月" }, { value: "3", label: "3月" },
    { value: "4", label: "4月" }, { value: "5", label: "5月" }, { value: "6", label: "6月" },
    { value: "7", label: "7月" }, { value: "8", label: "8月" }, { value: "9", label: "9月" },
    { value: "10", label: "10月" }, { value: "11", label: "11月" }, { value: "12", label: "12月" },
  ];

  // Debounce search input: wait 400ms after user stops typing before querying
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.quotes.list.useQuery({
    search: debouncedSearch || undefined,
    serviceType: serviceType === "all" ? undefined : serviceType,
    status: status === "all" ? undefined : status,
    leadSource: leadSource === "all" ? undefined : leadSource,
    year: selectedYear === "all" ? undefined : parseInt(selectedYear),
    month: selectedMonth === "all" ? undefined : parseInt(selectedMonth),
    limit,
    offset: page * limit,
  });

  const deleteMutation = trpc.quotes.delete.useMutation({
    onSuccess: () => {
      toast.success("報價單已刪除");
      utils.quotes.list.invalidate();
    },
    onError: () => toast.error("刪除失敗"),
  });

  const totalPages = Math.ceil((data?.total ?? 0) / limit);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <div style={{ fontSize: "0.6rem", letterSpacing: "0.2em", color: "#d4a843", textTransform: "uppercase", marginBottom: "6px" }}>
              Quote Management
            </div>
            <h1 className="text-2xl font-light">報價單管理</h1>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setLocation("/quotes/accepted-merchants")}
              className="flex items-center gap-2 px-4 py-2.5 transition-all hover:opacity-80"
              style={{
                border: "1px solid rgba(212,168,67,0.45)",
                color: "#d4a843",
                fontSize: "0.7rem",
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                borderRadius: "2px",
              }}
            >
              <Building2 className="h-4 w-4" />
              已接受商家名單（銀行）
            </button>
            <button
              onClick={() => setLocation("/quotes/new")}
              className="flex items-center gap-2 px-5 py-2.5 transition-all hover:opacity-80"
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
              <Plus className="h-4 w-4" />
              新增報價單
            </button>
          </div>
        </div>

        <div style={{ height: "1px", background: "linear-gradient(to right, #d4a843, rgba(212,168,67,0.1), transparent)" }} />

        {/* Filters */}
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜尋客戶名稱、報價單號、電話號碼..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              style={{ background: "#111", border: "1px solid rgba(212,168,67,0.2)", color: "#e8e0d0" }}
            />
          </div>
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
            <Select value={selectedYear} onValueChange={(v) => { setSelectedYear(v); setSelectedMonth("all"); setPage(0); }}>
              <SelectTrigger className="sm:w-[100px]" style={{ background: "#111", border: "1px solid rgba(212,168,67,0.2)" }}>
                <SelectValue placeholder="年份" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部年份</SelectItem>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}年</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedYear !== "all" && (
              <Select value={selectedMonth} onValueChange={(v) => { setSelectedMonth(v); setPage(0); }}>
                <SelectTrigger className="sm:w-[90px]" style={{ background: "#111", border: "1px solid rgba(212,168,67,0.2)" }}>
                  <SelectValue placeholder="月份" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部月份</SelectItem>
                  {monthOptions.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={serviceType} onValueChange={(v) => { setServiceType(v); setPage(0); }}>
              <SelectTrigger className="sm:w-[160px]" style={{ background: "#111", border: "1px solid rgba(212,168,67,0.2)" }}>
                <SelectValue placeholder="服務類型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部類型</SelectItem>
                {Object.entries(SERVICE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0); }}>
              <SelectTrigger className="sm:w-[130px]" style={{ background: "#111", border: "1px solid rgba(212,168,67,0.2)" }}>
                <SelectValue placeholder="狀態" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部狀態</SelectItem>
                {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={leadSource} onValueChange={(v) => { setLeadSource(v); setPage(0); }}>
              <SelectTrigger className="sm:w-[160px]" style={{ background: "#111", border: "1px solid rgba(212,168,67,0.2)" }}>
                <SelectValue placeholder="詢價來源" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部來源</SelectItem>
                <SelectItem value="Google">Google</SelectItem>
                <SelectItem value="HelloToby">HelloToby</SelectItem>
                <SelectItem value="PRO360">PRO360</SelectItem>
                <SelectItem value="FreelanceHunter">Freelance Hunter</SelectItem>
                <SelectItem value="Repeat">回頭客</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Table - Desktop */}
        <div className="hidden sm:block rounded overflow-hidden overflow-x-auto" style={{ border: "1px solid rgba(212,168,67,0.15)" }}>
          <table className="w-full">
            <thead>
              <tr style={{ background: "#0f0f0f", borderBottom: "1px solid rgba(212,168,67,0.2)" }}>
                {["報價單號", "客戶名稱", "服務類型", "拍攝日期", "金額", "狀態", "建立日期", "操作"].map((h) => (
                  <th
                    key={h}
                    className="text-left px-4 py-3"
                    style={{ fontSize: "0.6rem", letterSpacing: "0.15em", color: "#d4a843", textTransform: "uppercase", fontWeight: 500 }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-28" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-16" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-5 w-14 rounded-sm" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-16" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
                  </tr>
                ))
              )}
              {!isLoading && data?.data.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-16">
                    <FileText className="h-8 w-8 mx-auto mb-3 opacity-20" />
                    <div className="text-sm text-muted-foreground">尚無報價單記錄</div>
                    <button
                      onClick={() => setLocation("/quotes/new")}
                      className="mt-4 text-xs hover:opacity-70 transition-opacity"
                      style={{ color: "#d4a843", letterSpacing: "0.1em", textTransform: "uppercase" }}
                    >
                      + 建立第一份報價單
                    </button>
                  </td>
                </tr>
              )}
              {data?.data.map((quote, idx) => {
                const statusInfo = STATUS_CONFIG[quote.status] ?? { label: quote.status, color: "#888" };
                return (
                  <tr
                    key={quote.id}
                    onClick={() => setLocation(`/quotes/${quote.id}`)}
                    style={{
                      background: idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                      cursor: "pointer",
                    }}
                    className="hover:bg-white/[0.04] transition-colors"
                  >
                    <td className="px-4 py-3">
                      <span className="text-xs font-mono" style={{ color: "#d4a843" }}>{quote.quoteNumber}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium">{quote.clientName}</div>
                      {quote.clientCompany && <div className="text-xs text-muted-foreground">{quote.clientCompany}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-muted-foreground">{SERVICE_LABELS[quote.serviceType] ?? quote.serviceType}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-muted-foreground">{quote.shootingDate || "—"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium">HKD {Number(quote.total).toLocaleString()}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className="text-xs px-2 py-1 rounded-sm"
                          style={{ background: `${statusInfo.color}20`, color: statusInfo.color, fontSize: "0.6rem", letterSpacing: "0.1em" }}
                        >
                          {statusInfo.label}
                        </span>
                        {(quote as any).signedAt && (
                          <span
                            className="text-xs px-2 py-1 rounded-sm"
                            style={{ background: "rgba(111,207,111,0.12)", color: "#6fcf6f", fontSize: "0.6rem", letterSpacing: "0.1em", border: "1px solid rgba(111,207,111,0.25)" }}
                            title={`已簽署：${(quote as any).signedByName} 於 ${new Date((quote as any).signedAt).toLocaleString("zh-HK")}`}
                          >
                            ✓ 已簽署
                          </span>
                        )}
                        {(quote as any).paymentStatus === "deposit_paid" && (
                          <span
                            className="text-xs px-2 py-1 rounded-sm"
                            style={{ background: "rgba(126,184,247,0.12)", color: "#7eb8f7", fontSize: "0.6rem", letterSpacing: "0.1em", border: "1px solid rgba(126,184,247,0.25)" }}
                            title={`已付訂金${(quote as any).depositPaidAmount ? `: HKD ${Number((quote as any).depositPaidAmount).toLocaleString()}` : ""}`}
                          >
                            已付訂金
                          </span>
                        )}
                        {(quote as any).paymentStatus === "fully_paid" && (
                          <span
                            className="text-xs px-2 py-1 rounded-sm"
                            style={{ background: "rgba(111,207,111,0.12)", color: "#6fcf6f", fontSize: "0.6rem", letterSpacing: "0.1em", border: "1px solid rgba(111,207,111,0.25)" }}
                            title="已完成付款"
                          >
                            ✓ 已完成付款
                          </span>
                        )}
                        {(quote as any).emailOpened && (
                          <span
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-sm"
                            style={{ background: "rgba(201,169,110,0.12)", color: "#c9a96e", fontSize: "0.6rem", letterSpacing: "0.1em", border: "1px solid rgba(201,169,110,0.3)" }}
                            title="客戶已開啟郵件"
                          >
                            <Eye style={{ width: "9px", height: "9px" }} />
                            已讀
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-muted-foreground">
                        {new Date(quote.createdAt).toLocaleDateString("zh-HK")}
                      </span>
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); setLocation(`/quotes/${quote.id}/edit`); }}
                          className="p-1.5 rounded hover:bg-white/10 transition-colors"
                          title="編輯"
                        >
                          <Edit className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(`/print/quote/${quote.id}`, "_blank");
                          }}
                          className="p-1.5 rounded hover:bg-white/10 transition-colors"
                          title="下載PDF"
                        >
                          <Download className="h-3.5 w-3.5" style={{ color: "#d4a843" }} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeliverPhotos(quote); }}
                          className="p-1.5 rounded hover:bg-amber-500/10 transition-colors"
                          title="交付相片"
                        >
                          <ImageIcon className="h-3.5 w-3.5" style={{ color: "#d4a843" }} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`確定刪除報價單 ${quote.quoteNumber}？`)) {
                              deleteMutation.mutate({ id: quote.id });
                            }
                          }}
                          className="p-1.5 rounded hover:bg-red-500/10 transition-colors"
                          title="刪除"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile Card List */}
        <div className="sm:hidden space-y-2">
          {isLoading && (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-lg p-3 space-y-2" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(212,168,67,0.12)" }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-5 w-14 rounded-sm" />
                </div>
                <div className="flex items-center justify-between">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-16" />
                </div>
              </div>
            ))
          )}
          {!isLoading && data?.data.length === 0 && (
            <div className="text-center py-16">
              <FileText className="h-8 w-8 mx-auto mb-3 opacity-20" />
              <div className="text-sm text-muted-foreground">尚無報價單記錄</div>
              <button
                onClick={() => setLocation("/quotes/new")}
                className="mt-4 text-xs hover:opacity-70 transition-opacity"
                style={{ color: "#d4a843", letterSpacing: "0.1em", textTransform: "uppercase" }}
              >
                + 建立第一份報價單
              </button>
            </div>
          )}
          {data?.data.map((quote) => {
            const statusInfo = STATUS_CONFIG[quote.status] ?? { label: quote.status, color: "#888" };
            return (
              <div
                key={quote.id}
                onClick={() => setLocation(`/quotes/${quote.id}`)}
                className="rounded-lg p-3 space-y-2 cursor-pointer hover:bg-white/[0.04] transition-colors"
                style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(212,168,67,0.12)" }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{quote.clientName}</div>
                    {quote.clientCompany && <div className="text-xs text-muted-foreground truncate">{quote.clientCompany}</div>}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-xs px-2 py-0.5 rounded-sm" style={{ background: `${statusInfo.color}20`, color: statusInfo.color, border: `1px solid ${statusInfo.color}40`, fontSize: "0.6rem", letterSpacing: "0.08em" }}>
                      {statusInfo.label}
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="text-xs font-mono" style={{ color: "#d4a843" }}>{quote.quoteNumber}</div>
                    <div className="text-xs text-muted-foreground">{SERVICE_LABELS[quote.serviceType] ?? quote.serviceType}</div>
                    {quote.shootingDate && <div className="text-xs text-muted-foreground">{quote.shootingDate}</div>}
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium" style={{ color: "#d4a843" }}>HKD {Number(quote.total).toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground">{new Date(quote.createdAt).toLocaleDateString("zh-HK")}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setLocation(`/quotes/${quote.id}/edit`); }}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-white/10 transition-colors"
                    style={{ border: "1px solid rgba(255,255,255,0.1)", color: "#888" }}
                  >
                    <Edit className="h-3 w-3" />編輯
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeliverPhotos(quote); }}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-amber-500/10 transition-colors"
                    style={{ border: "1px solid rgba(212,168,67,0.2)", color: "#d4a843" }}
                  >
                    <ImageIcon className="h-3 w-3" />交付
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      window.open(`/print/quote/${quote.id}`, "_blank");
                    }}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-white/10 transition-colors"
                    style={{ border: "1px solid rgba(212,168,67,0.2)", color: "#d4a843" }}
                  >
                    <Download className="h-3 w-3" />PDF
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`確定刪除報價單 ${quote.quoteNumber}？`)) {
                        deleteMutation.mutate({ id: quote.id });
                      }
                    }}
                    className="ml-auto p-1.5 rounded hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-xs" style={{ color: "#666" }}>
            共 {data?.total ?? 0} 份報價單，第 {page + 1} / {Math.max(1, totalPages)} 頁
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              {/* Prev */}
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="px-3 py-1.5 text-xs rounded transition-all disabled:opacity-25 hover:opacity-70"
                style={{ border: "1px solid rgba(212,168,67,0.3)", color: "#d4a843" }}
              >
                ‹
              </button>

              {/* Page numbers */}
              {(() => {
                const pages: (number | "...")[] = [];
                if (totalPages <= 7) {
                  for (let i = 0; i < totalPages; i++) pages.push(i);
                } else {
                  pages.push(0);
                  if (page > 2) pages.push("...");
                  for (let i = Math.max(1, page - 1); i <= Math.min(totalPages - 2, page + 1); i++) pages.push(i);
                  if (page < totalPages - 3) pages.push("...");
                  pages.push(totalPages - 1);
                }
                return pages.map((p, i) =>
                  p === "..." ? (
                    <span key={`ellipsis-${i}`} className="px-2 py-1.5 text-xs" style={{ color: "#555" }}>…</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setPage(p as number)}
                      className="min-w-[32px] py-1.5 text-xs rounded transition-all"
                      style={{
                        border: `1px solid ${p === page ? "#d4a843" : "rgba(212,168,67,0.2)"}`,
                        background: p === page ? "rgba(212,168,67,0.15)" : "transparent",
                        color: p === page ? "#d4a843" : "#888",
                        fontWeight: p === page ? 600 : 400,
                      }}
                    >
                      {(p as number) + 1}
                    </button>
                  )
                );
              })()}

              {/* Next */}
              <button
                onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                disabled={page >= totalPages - 1}
                className="px-3 py-1.5 text-xs rounded transition-all disabled:opacity-25 hover:opacity-70"
                style={{ border: "1px solid rgba(212,168,67,0.3)", color: "#d4a843" }}
              >
                ›
              </button>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
