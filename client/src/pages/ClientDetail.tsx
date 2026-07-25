import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { toast } from "sonner";
import { ArrowLeft, Edit2, Save, X, Building2, Mail, Phone, MapPin, FileText, Plus, Tag } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SERVICE_LABELS } from "@/lib/serviceLabels";

const CLIENT_SOURCES = [
  { value: "gmail",       label: "Gmail 詢價" },
  { value: "freehunter",  label: "FreelanceHunter" },
  { value: "hellotoby",   label: "HelloToby" },
  { value: "pro360",      label: "360Pro" },
  { value: "instagram",   label: "Instagram" },
  { value: "facebook",    label: "Facebook" },
  { value: "referral",    label: "朋友介紹" },
  { value: "website",     label: "官方網站" },
  { value: "repeat",      label: "回頭客" },
  { value: "other",       label: "其他" },
];

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

function SourceBadge({ source }: { source?: string | null }) {
  if (!source) return null;
  const label = CLIENT_SOURCES.find(s => s.value === source)?.label ?? source;
  const color = SOURCE_COLORS[source] ?? SOURCE_COLORS.other;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-sm"
      style={{ background: color.bg, color: color.text, border: `1px solid ${color.border}`, fontSize: "0.65rem", letterSpacing: "0.06em" }}
    >
      <Tag className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft: { label: "草稿", color: "#666" },
  sent: { label: "已發送", color: "#d4a843" },
  accepted: { label: "已接受", color: "#4caf50" },
  rejected: { label: "已拒絕", color: "#e53935" },
  expired: { label: "已過期", color: "#888" },
};

export default function ClientDetail() {
  const params = useParams<{ id: string }>();
  const clientId = parseInt(params.id);
  const [, setLocation] = useLocation();
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<{
    name: string; company: string; email: string; phone: string; address: string; notes: string; source: string;
  } | null>(null);

  const { data: client, isLoading, refetch } = trpc.clients.getById.useQuery({ id: clientId });
  const utils = trpc.useUtils();

  const updateMutation = trpc.clients.update.useMutation({
    onSuccess: () => {
      toast.success("客戶資料已更新");
      setIsEditing(false);
      utils.clients.getById.invalidate({ id: clientId });
    },
    onError: (e) => toast.error(`更新失敗：${e.message}`),
  });

  const startEdit = () => {
    if (!client) return;
    setEditForm({
      name: client.name,
      company: client.company ?? "",
      email: client.email ?? "",
      phone: client.phone ?? "",
      address: client.address ?? "",
      notes: client.notes ?? "",
      source: (client as any).source ?? "",
    });
    setIsEditing(true);
  };

  const saveEdit = () => {
    if (!editForm) return;
    if (!editForm.name.trim()) { toast.error("請填寫客戶姓名"); return; }
    updateMutation.mutate({
      id: clientId,
      ...editForm,
      source: editForm.source || undefined,
    });
  };

  const inputStyle = { background: "#111", border: "1px solid rgba(212,168,67,0.2)", color: "#e8e0d0" };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 rounded animate-pulse" style={{ background: "#111" }} />
          ))}
        </div>
      </DashboardLayout>
    );
  }

  if (!client) {
    return (
      <DashboardLayout>
        <div className="text-center py-20 text-muted-foreground">客戶不存在</div>
      </DashboardLayout>
    );
  }

  const quotes = (client as any).quotes ?? [];
  const totalRevenue = quotes
    .filter((q: any) => q.status === "accepted")
    .reduce((sum: number, q: any) => sum + Number(q.total), 0);

  return (
    <DashboardLayout>
      <div className="max-w-4xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-4">
            <button onClick={() => setLocation("/clients")} className="p-2 rounded hover:bg-white/5 transition-colors">
              <ArrowLeft className="h-4 w-4 text-muted-foreground" />
            </button>
            <div>
              <div style={{ fontSize: "0.6rem", letterSpacing: "0.2em", color: "#d4a843", textTransform: "uppercase", marginBottom: "4px" }}>
                Client Profile
              </div>
              <h1 className="text-2xl font-light">{client.name}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <button onClick={() => setIsEditing(false)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
                  <X className="h-3.5 w-3.5" /> 取消
                </button>
                <button
                  onClick={saveEdit}
                  disabled={updateMutation.isPending}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium transition-all hover:opacity-80 disabled:opacity-50"
                  style={{ background: "#d4a843", color: "#0a0a0a", borderRadius: "2px" }}
                >
                  <Save className="h-3.5 w-3.5" />
                  {updateMutation.isPending ? "儲存中..." : "儲存"}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={startEdit}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors hover:bg-white/5"
                  style={{ border: "1px solid rgba(212,168,67,0.3)", color: "#d4a843", borderRadius: "2px" }}
                >
                  <Edit2 className="h-3.5 w-3.5" /> 編輯
                </button>
                <button
                  onClick={() => setLocation(`/quotes/new?clientId=${clientId}`)}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium transition-all hover:opacity-80"
                  style={{ background: "#d4a843", color: "#0a0a0a", borderRadius: "2px" }}
                >
                  <Plus className="h-3.5 w-3.5" /> 新增報價單
                </button>
              </>
            )}
          </div>
        </div>

        <div style={{ height: "1px", background: "linear-gradient(to right, #d4a843, rgba(212,168,67,0.1), transparent)" }} />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Left: Client Info */}
          <div className="md:col-span-2 space-y-4">
            <div className="p-5 rounded-sm space-y-4" style={{ background: "#111", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontSize: "0.6rem", letterSpacing: "0.15em", color: "#d4a843", textTransform: "uppercase" }}>
                基本資料
              </div>

              {isEditing && editForm ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-xs text-muted-foreground mb-1 block">客戶姓名 *</label>
                    <Input value={editForm.name} onChange={(e) => setEditForm(p => p ? { ...p, name: e.target.value } : p)} style={inputStyle} />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-muted-foreground mb-1 block">公司名稱</label>
                    <Input value={editForm.company} onChange={(e) => setEditForm(p => p ? { ...p, company: e.target.value } : p)} placeholder="選填" style={inputStyle} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">電郵地址</label>
                    <Input type="email" value={editForm.email} onChange={(e) => setEditForm(p => p ? { ...p, email: e.target.value } : p)} style={inputStyle} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">聯絡電話</label>
                    <Input value={editForm.phone} onChange={(e) => setEditForm(p => p ? { ...p, phone: e.target.value } : p)} style={inputStyle} />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-muted-foreground mb-1 block">客戶來源</label>
                    <Select value={editForm.source} onValueChange={(v) => setEditForm(p => p ? { ...p, source: v } : p)}>
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
                    <Input value={editForm.address} onChange={(e) => setEditForm(p => p ? { ...p, address: e.target.value } : p)} style={inputStyle} />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-muted-foreground mb-1 block">備註</label>
                    <textarea
                      value={editForm.notes}
                      onChange={(e) => setEditForm(p => p ? { ...p, notes: e.target.value } : p)}
                      rows={3}
                      className="w-full rounded px-3 py-2 text-sm resize-none focus:outline-none"
                      style={{ ...inputStyle, borderRadius: "4px" }}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {(client as any).source && (
                    <div className="flex items-start gap-3">
                      <span className="text-muted-foreground mt-0.5"><Tag className="h-4 w-4" /></span>
                      <div>
                        <div className="text-xs text-muted-foreground">客戶來源</div>
                        <div className="mt-1"><SourceBadge source={(client as any).source} /></div>
                      </div>
                    </div>
                  )}
                  {client.company && (
                    <InfoRow icon={<Building2 className="h-4 w-4" />} label="公司" value={client.company} />
                  )}
                  {client.email && (
                    <InfoRow icon={<Mail className="h-4 w-4" />} label="電郵" value={client.email} />
                  )}
                  {client.phone && (
                    <InfoRow icon={<Phone className="h-4 w-4" />} label="電話" value={client.phone} />
                  )}
                  {client.address && (
                    <InfoRow icon={<MapPin className="h-4 w-4" />} label="地址" value={client.address} />
                  )}
                  {client.notes && (
                    <div className="pt-2 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                      <div className="text-xs text-muted-foreground mb-1">備註</div>
                      <p className="text-sm whitespace-pre-wrap">{client.notes}</p>
                    </div>
                  )}
                  {!(client as any).source && !client.company && !client.email && !client.phone && !client.address && !client.notes && (
                    <p className="text-sm text-muted-foreground">尚未填寫詳細資料</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right: Stats */}
          <div className="space-y-3">
            <StatCard label="歷史報價單" value={`${quotes.length} 份`} />
            <StatCard label="已成交金額" value={`HKD ${totalRevenue.toLocaleString()}`} highlight />
            <StatCard
              label="成交率"
              value={quotes.length > 0
                ? `${Math.round((quotes.filter((q: any) => q.status === "accepted").length / quotes.length) * 100)}%`
                : "—"}
            />
          </div>
        </div>

        {/* Quote History */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div style={{ fontSize: "0.6rem", letterSpacing: "0.15em", color: "#d4a843", textTransform: "uppercase" }}>
              歷史報價單
            </div>
            <button
              onClick={() => setLocation(`/quotes/new?clientId=${clientId}`)}
              className="flex items-center gap-1 text-xs transition-colors hover:opacity-80"
              style={{ color: "#d4a843" }}
            >
              <Plus className="h-3 w-3" /> 新增報價單
            </button>
          </div>

          {quotes.length === 0 ? (
            <div className="text-center py-10 rounded-sm" style={{ background: "#111", border: "1px solid rgba(255,255,255,0.06)" }}>
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-20" />
              <p className="text-sm text-muted-foreground">尚未有報價單記錄</p>
            </div>
          ) : (
            <div className="space-y-2">
              {quotes.map((quote: any) => {
                const status = STATUS_CONFIG[quote.status] ?? { label: quote.status, color: "#888" };
                return (
                  <div
                    key={quote.id}
                    className="flex items-center justify-between p-4 rounded-sm cursor-pointer transition-all hover:border-amber-500/20"
                    style={{ background: "#111", border: "1px solid rgba(255,255,255,0.06)" }}
                    onClick={() => setLocation(`/quotes/${quote.id}`)}
                  >
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="text-sm font-medium" style={{ color: "#d4a843" }}>{quote.quoteNumber}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {SERVICE_LABELS[quote.serviceType] ?? quote.serviceType}
                          {quote.shootingDate && ` · ${quote.shootingDate}`}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-right">
                      <div>
                        <div className="text-sm font-medium">HKD {Number(quote.total).toLocaleString()}</div>
                        <div className="text-xs mt-0.5" style={{ color: status.color }}>{status.label}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-muted-foreground mt-0.5">{icon}</span>
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-sm mt-0.5">{value}</div>
      </div>
    </div>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="p-4 rounded-sm" style={{ background: "#111", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="text-lg font-light" style={{ color: highlight ? "#d4a843" : undefined }}>{value}</div>
    </div>
  );
}
