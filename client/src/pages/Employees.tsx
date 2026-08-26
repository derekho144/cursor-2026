import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Shield, UserCheck, UserX, Plus, KeyRound, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import type { PageId } from "@shared/pagePermissions";

type EmployeeRow = {
  id: number;
  openId: string;
  username: string | null;
  name: string | null;
  email: string | null;
  role: "user" | "admin";
  isActive: boolean;
  allowedPages: PageId[];
  lastSignedIn: Date | string | null;
  isOwner: boolean;
  isLocal?: boolean;
  hasPassword?: boolean;
};

export default function Employees() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const { data: catalog = [], isLoading: catalogLoading } =
    trpc.employees.pageCatalog.useQuery();
  const { data: employees = [], isLoading } = trpc.employees.list.useQuery();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [keepOpenId, setKeepOpenId] = useState<string>("");

  const [createForm, setCreateForm] = useState({
    username: "",
    password: "",
    name: "",
    isActive: true,
    allowedPages: [] as PageId[],
  });
  const [showCreate, setShowCreate] = useState(false);

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

  const createMutation = trpc.employees.create.useMutation({
    onSuccess: () => {
      toast.success("已建立員工帳號");
      utils.employees.list.invalidate();
      setCreateForm({
        username: "",
        password: "",
        name: "",
        isActive: true,
        allowedPages: [],
      });
      setShowCreate(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const resetPasswordMutation = trpc.employees.resetPassword.useMutation({
    onSuccess: () => toast.success("密碼已重設"),
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.employees.delete.useMutation({
    onSuccess: () => {
      toast.success("已刪除員工帳號");
      utils.employees.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const purgeMutation = trpc.employees.purgeExcept.useMutation({
    onSuccess: (res) => {
      toast.success("已清除其他帳號，並保留你指定的 openId");
      utils.employees.list.invalidate();
      utils.auth.me.invalidate();
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
        <div className="flex items-start justify-between gap-3 flex-wrap">
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
              幫員工建立帳號密碼，並勾選可看見的頁面。員工用帳號密碼登入系統。
            </p>
          </div>
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded"
            style={{ background: "#d4a843", color: "#0a0a0a" }}
          >
            <Plus className="h-3.5 w-3.5" />
            {showCreate ? "取消" : "新增員工帳號"}
          </button>
        </div>

        {showCreate && (
          <div
            className="rounded border p-4 space-y-4"
            style={{ borderColor: "rgba(212,168,67,0.25)", background: "#111" }}
          >
            <div className="text-sm font-medium text-foreground">新增員工帳號</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">登入帳號 *</label>
                <input
                  value={createForm.username}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, username: e.target.value }))
                  }
                  className="mt-1 w-full px-3 py-2 rounded text-sm"
                  style={{
                    background: "#0a0a0a",
                    border: "1px solid rgba(255,255,255,0.12)",
                    color: "#fff",
                  }}
                  placeholder="例如：staff01"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">密碼 *（至少 8 位）</label>
                <input
                  type="password"
                  value={createForm.password}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, password: e.target.value }))
                  }
                  className="mt-1 w-full px-3 py-2 rounded text-sm"
                  style={{
                    background: "#0a0a0a",
                    border: "1px solid rgba(255,255,255,0.12)",
                    color: "#fff",
                  }}
                  placeholder="••••••••"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">顯示名稱</label>
                <input
                  value={createForm.name}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, name: e.target.value }))
                  }
                  className="mt-1 w-full px-3 py-2 rounded text-sm"
                  style={{
                    background: "#0a0a0a",
                    border: "1px solid rgba(255,255,255,0.12)",
                    color: "#fff",
                  }}
                  placeholder="例如：阿明"
                />
              </div>
              <div className="flex items-center justify-between gap-3 pt-5">
                <div>
                  <div className="text-sm">開啟使用</div>
                  <div className="text-xs text-muted-foreground">建立後可否登入</div>
                </div>
                <Switch
                  checked={createForm.isActive}
                  onCheckedChange={(v) =>
                    setCreateForm((f) => ({ ...f, isActive: v }))
                  }
                />
              </div>
            </div>

            <div>
              <div className="text-sm mb-2">可看見的頁面</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {catalog.map((page) => {
                  const checked = createForm.allowedPages.includes(page.id);
                  return (
                    <label
                      key={page.id}
                      className="flex items-center gap-2 text-sm cursor-pointer rounded px-2 py-1.5 hover:bg-white/5"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          setCreateForm((f) => ({
                            ...f,
                            allowedPages: v
                              ? Array.from(new Set([...f.allowedPages, page.id]))
                              : f.allowedPages.filter((p) => p !== page.id),
                          }));
                        }}
                      />
                      <span>{page.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <button
              onClick={() => {
                if (!createForm.username.trim() || createForm.password.length < 8) {
                  toast.error("請填寫帳號，密碼至少 8 位");
                  return;
                }
                createMutation.mutate({
                  username: createForm.username.trim(),
                  password: createForm.password,
                  name: createForm.name.trim() || undefined,
                  isActive: createForm.isActive,
                  allowedPages: createForm.allowedPages,
                });
              }}
              disabled={createMutation.isPending}
              className="px-4 py-2 text-xs font-semibold rounded disabled:opacity-50"
              style={{ background: "#d4a843", color: "#0a0a0a" }}
            >
              {createMutation.isPending ? "建立中…" : "建立帳號"}
            </button>
          </div>
        )}

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
              />
              <button
                onClick={() =>
                  purgeMutation.mutate({ keepOpenId: keepOpenId.trim() })
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
            尚無用戶。請先新增員工帳號。
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
                  onToggleEdit={() => setEditingId(isEditing ? null : row.id)}
                  onSave={(patch) => {
                    setEditingId(row.id);
                    updateMutation.mutate({ userId: row.id, ...patch });
                  }}
                  onResetPassword={() => {
                    const pwd = window.prompt(`為 ${row.username || row.name} 設定新密碼（至少 8 位）`);
                    if (!pwd) return;
                    if (pwd.length < 8) {
                      toast.error("密碼至少 8 位");
                      return;
                    }
                    resetPasswordMutation.mutate({ userId: row.id, password: pwd });
                  }}
                  onDelete={() => {
                    if (!window.confirm(`確定刪除 ${row.username || row.name}？`)) return;
                    deleteMutation.mutate({ userId: row.id });
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
  onResetPassword,
  onDelete,
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
  onResetPassword: () => void;
  onDelete: () => void;
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
              {employee.name || employee.username || "未命名用戶"}
            </span>
            {employee.username && (
              <span className="text-xs font-mono text-emerald-300">
                @{employee.username}
              </span>
            )}
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
            {employee.email || (employee.isLocal ? "本系統帳號" : "無電郵")} · 上次登入{" "}
            {lastSeen}
          </div>
          {employee.role !== "admin" && !isEditing && (
            <div className="text-xs text-muted-foreground mt-2">
              可見頁面：
              {employee.allowedPages.length === 0
                ? "（無）"
                : employee.allowedPages
                    .map((id) => catalog.find((c) => c.id === id)?.label ?? id)
                    .join("、")}
            </div>
          )}
          {employee.role === "admin" && (
            <div className="text-xs text-muted-foreground mt-2">
              管理員可存取全部頁面
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
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
          {employee.hasPassword && !employee.isOwner && (
            <button
              onClick={onResetPassword}
              className="px-3 py-1.5 text-xs rounded flex items-center gap-1 text-muted-foreground hover:opacity-80"
              style={{ border: "1px solid rgba(255,255,255,0.12)" }}
            >
              <KeyRound className="h-3 w-3" />
              重設密碼
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
          {!employee.isOwner && (
            <button
              onClick={onDelete}
              className="px-3 py-1.5 text-xs rounded flex items-center gap-1 text-red-400 hover:opacity-80"
              style={{ border: "1px solid rgba(248,113,113,0.35)" }}
            >
              <Trash2 className="h-3 w-3" />
              刪除
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
