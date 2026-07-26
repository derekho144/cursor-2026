import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Plus, Search, Building2, Mail, Phone, ChevronRight, Trash2, Users, TrendingUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// 客戶來源選項
const CLIENT_SOURCES = [
  { value: "gmail", label: "Gmail 詢價" },
  { value: "freehunter", label: "FreelanceHunter" },
  { value: "hellotoby", label: "HelloToby" },
  { value: "pro360", label: "360Pro" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "referral", label: "朋友介紹" },
  { value: "website", label: "官方網站" },
  { value: "repeat", label: "回頭客" },
  { value: "other", label: "其他" },
];

// 來源標籤顏色
const SOURCE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  gmail:       { bg: "rgba(66,133,244,0.12)",  text: "#4285f4", border: "rgba(66,133,244,0.3)" },
  freehunter:  { bg: "rgba(245,166,35,0.12)",  text: "#f5a623", border: "rgba(245,166,35,0.3)" },
  hellotoby:   { bg: "rgba(76,175,80,0.12)",   text: "#4caf50", border: "rgba(76,175,80,0.3)" },
  pro360:      { bg: "rgba(156,39,176,0.12)",  text: "#ab47bc", border: "rgba(156,39,176,0.3)" },
  instagram:   { bg: "rgba(225,48,108,0.12)",  text: "#e1306c", border: "rgba(225,48,108,0.3)" },
  facebook:    { bg: "rgba(24,119,242,0.12)",  text: "#1877f2", border: "rgba(24,119,242,0.3)" },
  referral:    { bg: "rgba(212,168,67,0.12)",  text: "#d4a843", border: "rgba(212,168,67,0.3)" },
  website:     { bg: "rgba(0,188,212,0.12)",   text: "#00bcd4", border: "rgba(0,188,212,0.3)" },
  repeat:      { bg: "rgba(255,152,0,0.12)",   text: "#ff9800", border: "rgba(255,152,0,0.3)" },
  other:       { bg: "rgba(120,120,120,0.12)", text: "#888",    border: "rgba(120,120,120,0.3)" },
};

function SourceBadge({ source }: { source: string | null | undefined }) {
  if (!source) return null;
  const label = CLIENT_SOURCES.find(s => s.value === source)?.label ?? source;
  const color = SOURCE_COLORS[source] ?? SOURCE_COLORS.other;
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-sm shrink-0"
      style={{ background: color.bg, color: color.text, border: `1px solid ${color.border}`, fontSize: "0.6rem", letterSpacing: "0.06em" }}
    >
      {label}
    </span>
  );
}

export default function ClientsList() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [sortBy, setSortBy] = useState<'default' | 'ltv' | 'orderCount'>('ltv');
  const limit = 20;

  const { data, isLoading, refetch } = trpc.clients.listWithLTV.useQuery({
    search: search || undefined,
    limit,
    offset: page * limit,
    sortBy,
  });

  const utils = trpc.useUtils();
  const deleteMutation = trpc.clients.delete.useMutation({
    onSuccess: () => {
      toast.success("客戶已刪除");
      utils.clients.listWithLTV.invalidate();
    },
    onError: (e) => toast.error(`刪除失敗：${e.message}`),
  });

  const clients = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <div style={{ fontSize: "0.6rem", letterSpacing: "0.2em", color: "#d4a843", textTransform: "uppercase", marginBottom: "4px" }}>
              Client Database
            </div>
            <h1 className="text-2xl font-light">客戶管理</h1>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all hover:opacity-80"
            style={{ background: "#d4a843", color: "#0a0a0a", borderRadius: "2px" }}
          >
            <Plus className="h-4 w-4" />
            新增客戶
          </button>
        </div>

        <div style={{ height: "1px", background: "linear-gradient(to right, #d4a843, rgba(212,168,67,0.1), transparent)" }} />

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="搜尋客戶姓名、公司、電郵或電話..."
            className="pl-9"
            style={{ background: "#111", border: "1px solid rgba(212,168,67,0.2)", color: "#e8e0d0" }}
          />
        </div>

        {/* Stats + Sort */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="h-4 w-4" />
            <span>共 {total} 位客戶</span>
          </div>
          <Select value={sortBy} onValueChange={(v) => { setSortBy(v as any); setPage(0); }}>
            <SelectTrigger className="w-36 text-xs h-8" style={{ background: "#111", border: "1px solid rgba(212,168,67,0.2)", color: "#e8e0d0" }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent style={{ background: "#111", border: "1px solid rgba(212,168,67,0.2)" }}>
              <SelectItem value="ltv">總收入排序</SelectItem>
              <SelectItem value="orderCount">成交次數排序</SelectItem>
              <SelectItem value="default">預設排序</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Client List */}
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-20 rounded animate-pulse" style={{ background: "#111" }} />
            ))}
          </div>
        ) : clients.length === 0 ? (
          <div className="text-center py-20">
            <Users className="h-12 w-12 mx-auto mb-4 opacity-20" />
            <p className="text-muted-foreground">{search ? "找不到符合的客戶" : "尚未建立任何客戶"}</p>
            {!search && (
              <button
                onClick={() => setShowCreateModal(true)}
                className="mt-4 text-sm underline"
                style={{ color: "#d4a843" }}
              >
                新增第一位客戶
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {clients.map((client) => (
              <div
                key={client.id}
                className="group flex items-center justify-between p-4 rounded cursor-pointer transition-all hover:border-amber-500/30"
                style={{ background: "#111", border: "1px solid rgba(255,255,255,0.06)" }}
                onClick={() => setLocation(`/clients/${client.id}`)}
              >
                <div className="flex items-center gap-4 min-w-0">
                  {/* Avatar */}
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-medium"
                    style={{ background: "rgba(212,168,67,0.15)", color: "#d4a843" }}
                  >
                    {client.name.charAt(0).toUpperCase()}
                  </div>
                  {/* Info */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="font-medium text-sm truncate">{client.name}</span>
                      <SourceBadge source={(client as any).source} />
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {client.company && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Building2 className="h-3 w-3" />
                          {client.company}
                        </span>
                      )}
                      {client.email && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Mail className="h-3 w-3" />
                          {client.email}
                        </span>
                      )}
                      {client.phone && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Phone className="h-3 w-3" />
                          {client.phone}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {/* LTV Display */}
                  {(client as any).totalRevenue > 0 && (
                    <div className="text-right hidden sm:block">
                      <div className="text-sm font-light" style={{ color: "#4ade80" }}>
                        HK${((client as any).totalRevenue as number).toLocaleString()}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        LTV · {(client as any).orderCount} 次成交
                      </div>
                    </div>
                  )}
                  {(client as any).totalRevenue === 0 && (
                    <div className="text-right hidden sm:block">
                      <div className="text-xs text-muted-foreground">尚無成交</div>
                    </div>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`確定刪除客戶「${client.name}」？`)) {
                        deleteMutation.mutate({ id: client.id });
                      }
                    }}
                    className="p-1.5 rounded opacity-0 group-hover:opacity-100 transition-all hover:bg-red-500/10"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </button>
                  <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-4">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 text-xs rounded disabled:opacity-30 transition-colors hover:bg-white/5"
              style={{ border: "1px solid rgba(212,168,67,0.3)", color: "#d4a843" }}
            >
              上一頁
            </button>
            <span className="text-xs text-muted-foreground">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 text-xs rounded disabled:opacity-30 transition-colors hover:bg-white/5"
              style={{ border: "1px solid rgba(212,168,67,0.3)", color: "#d4a843" }}
            >
              下一頁
            </button>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <CreateClientModal
          onClose={() => setShowCreateModal(false)}
          onCreated={(id) => {
            setShowCreateModal(false);
            utils.clients.list.invalidate();
            setLocation(`/clients/${id}`);
          }}
        />
      )}
    </DashboardLayout>
  );
}

function CreateClientModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [form, setForm] = useState({ name: "", company: "", email: "", phone: "", address: "", notes: "", source: "" });
  const createMutation = trpc.clients.create.useMutation({
    onSuccess: (data) => {
      toast.success("客戶已建立");
      onCreated(data.id);
    },
    onError: (e) => toast.error(`建立失敗：${e.message}`),
  });

  const inputStyle = { background: "#111", border: "1px solid rgba(212,168,67,0.2)", color: "#e8e0d0" };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div className="w-full max-w-lg rounded-sm space-y-5 p-6" style={{ background: "#0f0f0f", border: "1px solid rgba(212,168,67,0.2)" }}>
        <div>
          <div style={{ fontSize: "0.6rem", letterSpacing: "0.2em", color: "#d4a843", textTransform: "uppercase", marginBottom: "4px" }}>
            New Client
          </div>
          <h2 className="text-lg font-light">新增客戶</h2>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-xs text-muted-foreground mb-1 block">客戶姓名 *</label>
            <Input value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} placeholder="輸入姓名" style={inputStyle} />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-muted-foreground mb-1 block">公司名稱</label>
            <Input value={form.company} onChange={(e) => setForm(p => ({ ...p, company: e.target.value }))} placeholder="選填" style={inputStyle} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">電郵地址（選填）</label>
            <Input type="text" value={form.email} onChange={(e) => setForm(p => ({ ...p, email: e.target.value }))} placeholder="email@example.com" style={inputStyle} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">聯絡電話</label>
            <Input value={form.phone} onChange={(e) => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="+852 xxxx xxxx" style={inputStyle} />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-muted-foreground mb-1 block">客戶來源</label>
            <Select value={form.source} onValueChange={(v) => setForm(p => ({ ...p, source: v }))}>
              <SelectTrigger style={{ ...inputStyle, height: "36px" }}>
                <SelectValue placeholder="選擇客戶來源（選填）" />
              </SelectTrigger>
              <SelectContent>
                {CLIENT_SOURCES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <label className="text-xs text-muted-foreground mb-1 block">地址</label>
            <Input value={form.address} onChange={(e) => setForm(p => ({ ...p, address: e.target.value }))} placeholder="選填" style={inputStyle} />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-muted-foreground mb-1 block">備註</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm(p => ({ ...p, notes: e.target.value }))}
              placeholder="客戶偏好、特別要求..."
              rows={3}
              className="w-full rounded px-3 py-2 text-sm resize-none focus:outline-none"
              style={{ ...inputStyle, borderRadius: "4px" }}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">取消</button>
          <button
            onClick={() => {
              if (!form.name.trim()) { toast.error("請填寫客戶姓名"); return; }
              createMutation.mutate({
                ...form,
                source: form.source || undefined,
              });
            }}
            disabled={createMutation.isPending}
            className="px-5 py-2 text-sm font-medium transition-all hover:opacity-80 disabled:opacity-50"
            style={{ background: "#d4a843", color: "#0a0a0a", borderRadius: "2px" }}
          >
            {createMutation.isPending ? "建立中..." : "建立客戶"}
          </button>
        </div>
      </div>
    </div>
  );
}
