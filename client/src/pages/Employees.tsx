import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Shield, UserCheck, UserX } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import type { PageId } from "@shared/pagePermissions";

type EmployeeRow = {
  id: number;
  name: string | null;
  email: string | null;
  role: "user" | "admin";
  isActive: boolean;
  allowedPages: PageId[];
  lastSignedIn: Date | string | null;
  isOwner: boolean;
};

export default function Employees() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const { data: catalog = [], isLoading: catalogLoading } =
    trpc.employees.pageCatalog.useQuery();
  const { data: employees = [], isLoading } = trpc.employees.list.useQuery();
  const [editingId, setEditingId] = useState<number | null>(null);

  const [keepOpenId, setKeepOpenId] = useState<string>("");

  useEffect(() => {
    if (!user) return;
    setKeepOpenId(user.openId || "");
  }, [user]);

  const updateMutation = trpc.employees.updateAccess.useMutation({
    onSuccess: () => {
      toast.success("員工權限已儲存");
      utils.employees.list.invalidate();
      utils.auth.me.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const purgeMutation = trpc.employees.purgeExcept.useMutation({
    onSuccess: (res) => {
      toast.success("已清除其他帳號，並保留你指定的 openId");
      utils.employees.list.invalidate();
      utils.auth.me.invalidate();
      // Keep current draft openId
      setKeepOpenId(res.kept?.[0] ?? keepOpenId);
    },
    onError: (e) => toast.error(e.message),
  });

  if (user?.role !== "admin") {
    return (
      <DashboardLayout>
        <div className="p-8 text-center text-muted-foreground">只有管理員可管理員工權限</div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <div
            style={{
              fontSize: "0.6rem",
              letterSpacing: "0.2em",
              color: "#d4a843",
              textTransform: "uppercase",
              marginBottom: "4px",
            }}
          >
            Team Access
          </div>
          <h1 className="text-2xl font-light">員工管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            開啟員工使用權，並勾選該員工可看見的頁面。員工需先用 Manus 登入一次才會出現喺列表。
          </p>
        </div>

        <div
          className="rounded border p-4"
          style={{
            borderColor: "rgba(255,255,255,0.08)",
            background: "#0f0f0f",
          }}
        >
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-[240px]">
              <div className="text-sm font-medium">清除其他帳號（保留你）</div>
              <div className="text-xs text-muted-foreground mt-1 leading-relaxed">
                會刪走除 keepOpenId 以外的所有 users 記錄，並把 keepOpenId 設為管理員。
                <br />
                <span className="text-amber-400">
                  ⚠️ 這只影響本系統的帳號記錄，不會刪除 Manus 原本帳戶。
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                你目前的 openId：
                <span className="ml-2 font-mono text-emerald-300">
                  {user?.openId || "—"}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2 w-full sm:w-[360px]">
              <label className="text-xs text-muted-foreground">保留的 openId</label>
              <input
                value={keepOpenId}
                onChange={(e) => setKeepOpenId(e.target.value)}
                className="px-3 py-2 rounded text-xs"
                style={{
                  background: "#111",
                  border: "1px solid rgba(255,255,255,0.12)",
                  color: "#fff",
                }}
                placeholder="例如：xxxxxx"
              />
              <button
                onClick={() =>
                  purgeMutation.mutate({
                    keepOpenId: keepOpenId.trim(),
                  })
                }
                disabled={purgeMutation.isPending || !keepOpenId.trim()}
                className="px-4 py-2 text-xs font-semibold rounded disabled:opacity-50"
                style={{ background: "#d4a843", color: "#0a0a0a" }}
              >
                {purgeMutation.isPending ? "清除中…" : "全部刪走，保留我"}
              </button>
            </div>
          </div>
        </div>

        {isLoading || catalogLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
            載入中…
          </div>
        ) : employees.length === 0 ? (
          <div className="text-sm text-muted-foreground py-12 text-center">
            尚無用戶。請先請同事用同一個系統連結登入。
          </div>
        ) : (
          <div className="space-y-3">
            {employees.map((emp) => {
              const row = emp as EmployeeRow;
              const isEditing = editingId === row.id;
              return (
                <EmployeeCard
                  key={row.id}
                  employee={row}
                  catalog={catalog}
                  isEditing={isEditing}
                  saving={updateMutation.isPending && editingId === row.id}
                  onToggleEdit={() =>
                    setEditingId(isEditing ? null : row.id)
                  }
                  onSave={(patch) => {
                    setEditingId(row.id);
                    updateMutation.mutate({ userId: row.id, ...patch });
                  }}
                />
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function EmployeeCard({
  employee,
  catalog,
  isEditing,
  saving,
  onToggleEdit,
  onSave,
}: {
  employee: EmployeeRow;
  catalog: Array<{ id: PageId; label: string }>;
  isEditing: boolean;
  saving: boolean;
  onToggleEdit: () => void;
  onSave: (patch: {
    isActive?: boolean;
    allowedPages?: PageId[];
    role?: "user" | "admin";
  }) => void;
}) {
  const [draftPages, setDraftPages] = useState<PageId[]>(employee.allowedPages);
  const [draftActive, setDraftActive] = useState(employee.isActive);

  const openEdit = () => {
    setDraftPages(employee.allowedPages);
    setDraftActive(employee.isActive);
    onToggleEdit();
  };

  const lastSeen = employee.lastSignedIn
    ? new Date(employee.lastSignedIn).toLocaleString("zh-HK")
    : "—";

  return (
    <div
      className="rounded border p-4 space-y-3"
      style={{ borderColor: "rgba(255,255,255,0.08)", background: "#111" }}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-foreground font-medium">
              {employee.name || "未命名用戶"}
            </span>
            {employee.role === "admin" && (
              <span
                className="text-xs px-2 py-0.5 rounded-sm flex items-center gap-1"
                style={{
                  background: "rgba(212,168,67,0.15)",
                  color: "#d4a843",
                  border: "1px solid rgba(212,168,67,0.35)",
                }}
              >
                <Shield className="h-3 w-3" />
                管理員
              </span>
            )}
            {employee.isOwner && (
              <span className="text-xs text-muted-foreground">擁有者</span>
            )}
            {employee.isActive ? (
              <span className="text-xs flex items-center gap-1 text-emerald-500">
                <UserCheck className="h-3 w-3" /> 已開啟
              </span>
            ) : (
              <span className="text-xs flex items-center gap-1 text-red-400">
                <UserX className="h-3 w-3" /> 已停用
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {employee.email || "無電郵"} · 上次登入 {lastSeen}
          </div>
          {employee.role !== "admin" && !isEditing && (
            <div className="text-xs text-muted-foreground mt-2">
              可見頁面：
              {employee.allowedPages.length === 0
                ? "（無）"
                : employee.allowedPages
                    .map(
                      (id) => catalog.find((c) => c.id === id)?.label ?? id
                    )
                    .join("、")}
            </div>
          )}
          {employee.role === "admin" && (
            <div className="text-xs text-muted-foreground mt-2">
              管理員可存取全部頁面
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!employee.isOwner && employee.role !== "admin" && (
            <button
              onClick={isEditing ? onToggleEdit : openEdit}
              className="px-3 py-1.5 text-xs rounded transition-opacity hover:opacity-80"
              style={{
                border: "1px solid rgba(212,168,67,0.4)",
                color: "#d4a843",
              }}
            >
              {isEditing ? "取消" : "設定權限"}
            </button>
          )}
          {!employee.isOwner && employee.role === "admin" && (
            <button
              onClick={() => onSave({ role: "user", allowedPages: [] })}
              className="px-3 py-1.5 text-xs rounded text-muted-foreground hover:opacity-80"
              style={{ border: "1px solid rgba(255,255,255,0.12)" }}
              disabled={saving}
            >
              改為一般員工
            </button>
          )}
          {!employee.isOwner && employee.role !== "admin" && (
            <button
              onClick={() => onSave({ role: "admin" })}
              className="px-3 py-1.5 text-xs rounded text-muted-foreground hover:opacity-80"
              style={{ border: "1px solid rgba(255,255,255,0.12)" }}
              disabled={saving}
            >
              設為管理員
            </button>
          )}
        </div>
      </div>

      {isEditing && employee.role !== "admin" && (
        <div className="space-y-4 pt-2 border-t border-white/5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm text-foreground">開啟員工使用</div>
              <div className="text-xs text-muted-foreground">
                關閉後無法登入使用系統
              </div>
            </div>
            <Switch checked={draftActive} onCheckedChange={setDraftActive} />
          </div>

          <div>
            <div className="text-sm text-foreground mb-2">可看見的頁面</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {catalog.map((page) => {
                const checked = draftPages.includes(page.id);
                return (
                  <label
                    key={page.id}
                    className="flex items-center gap-2 text-sm cursor-pointer rounded px-2 py-1.5 hover:bg-white/5"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => {
                        setDraftPages((prev) =>
                          v
                            ? Array.from(new Set([...prev, page.id]))
                            : prev.filter((p) => p !== page.id)
                        );
                      }}
                    />
                    <span>{page.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <button
            onClick={() =>
              onSave({ isActive: draftActive, allowedPages: draftPages })
            }
            disabled={saving}
            className="px-4 py-2 text-xs font-semibold rounded disabled:opacity-50"
            style={{ background: "#d4a843", color: "#0a0a0a" }}
          >
            {saving ? "儲存中…" : "儲存權限"}
          </button>
        </div>
      )}
    </div>
  );
}
