import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Loader2,
  Linkedin,
  RefreshCw,
  Copy,
  Sparkles,
  ChevronRight,
  SkipForward,
  Plus,
  ExternalLink,
  Building2,
  ListTodo,
  BookOpen,
  Users,
  PenLine,
  Check,
  X,
  ImagePlus,
  Trash2,
} from "lucide-react";

const ASSET_CATEGORIES = [
  { value: "food", label: "食物" },
  { value: "jewellery", label: "珠寶" },
  { value: "product", label: "產品" },
  { value: "fashion", label: "時裝" },
  { value: "commercial", label: "商業／人像" },
  { value: "before_after", label: "前後對比" },
  { value: "event", label: "活動攝影" },
  { value: "other", label: "其他" },
] as const;

const ASSET_PREFERRED = [
  { value: "any", label: "全部主題" },
  { value: "project", label: "項目＋幕後" },
  { value: "education", label: "教育＋洞察" },
  { value: "data", label: "數據＋視覺" },
] as const;

const PLAYBOOK_LABELS: Record<string, string> = {
  hire_signal: "招聘訊號",
  winback: "舊客喚回",
  general: "一般開發",
};

function formatHkt(iso: string | Date | null | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** datetime-local value in Asia/Hong_Kong */
function toHktDatetimeLocal(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

/** Treat datetime-local as HKT → UTC ISO */
function fromHktDatetimeLocal(local: string): string | null {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const utcMs = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:00+08:00`);
  if (Number.isNaN(utcMs)) return null;
  return new Date(utcMs).toISOString();
}

export default function LinkedInOps() {
  const [tab, setTab] = useState("today");
  const [listStage, setListStage] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<any>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    companyName: "",
    personName: "",
    personTitle: "",
    linkedInProfileUrl: "",
    playbook: "general" as "hire_signal" | "winback" | "general",
  });

  const utils = trpc.useUtils();

  const { data: stats, isLoading: statsLoading } = trpc.linkedinOps.getStats.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const { data: dueData, isLoading: dueLoading } = trpc.linkedinOps.listDueToday.useQuery(
    { limit: 20 },
    { refetchInterval: 30000 }
  );

  const { data: listData, isLoading: listLoading } = trpc.linkedinOps.listContacts.useQuery(
    { stage: listStage as any, page, pageSize: 20 },
    { enabled: tab === "all" }
  );

  const { data: playbooks } = trpc.linkedinOps.playbooks.useQuery();

  const { data: contentStats } = trpc.linkedinContent.getStats.useQuery(undefined, {
    refetchInterval: 30000,
    enabled: tab === "content",
  });
  const { data: contentMeta } = trpc.linkedinContent.meta.useQuery(undefined, {
    enabled: tab === "content",
  });
  const [contentFilter, setContentFilter] = useState<"all" | "pending_review" | "scheduled" | "published">("pending_review");
  const { data: contentList, isLoading: contentLoading } = trpc.linkedinContent.listPosts.useQuery(
    {
      // 「已發佈」睇歷史；其餘鎖定本週
      weekKey: contentFilter === "published" ? undefined : contentStats?.weekKey,
      status: contentFilter === "all" ? "all" : contentFilter,
      limit: 20,
    },
    { enabled: tab === "content", refetchInterval: 30000 }
  );
  const { data: duePosts } = trpc.linkedinContent.dueToday.useQuery(undefined, {
    enabled: tab === "content",
    refetchInterval: 30000,
  });
  const [editingPost, setEditingPost] = useState<any>(null);
  const [uploadCategory, setUploadCategory] = useState<(typeof ASSET_CATEGORIES)[number]["value"]>("product");
  const [uploadPreferred, setUploadPreferred] = useState<(typeof ASSET_PREFERRED)[number]["value"]>("any");
  const [uploadCaption, setUploadCaption] = useState("");
  const [uploading, setUploading] = useState(false);

  const { data: assets, isLoading: assetsLoading } = trpc.linkedinContent.listAssets.useQuery(undefined, {
    enabled: tab === "content",
  });

  const uploadAsset = trpc.linkedinContent.uploadAsset.useMutation({
    onSuccess: () => {
      toast.success("已加入圖片庫");
      utils.linkedinContent.listAssets.invalidate();
      utils.linkedinContent.getStats.invalidate();
      setUploadCaption("");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateAsset = trpc.linkedinContent.updateAsset.useMutation({
    onSuccess: () => {
      utils.linkedinContent.listAssets.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const archiveAsset = trpc.linkedinContent.archiveAsset.useMutation({
    onSuccess: () => {
      toast.success("已移出圖片庫");
      utils.linkedinContent.listAssets.invalidate();
      utils.linkedinContent.getStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const harvestWebsite = trpc.linkedinContent.harvestFromWebsite.useMutation({
    onSuccess: (d) => {
      toast.success(
        d.imported > 0
          ? `已從 jdstudiohk.com 匯入 ${d.imported} 張`
          : "官網冇新相可匯入（可能已全部入庫）"
      );
      utils.linkedinContent.listAssets.invalidate();
      utils.linkedinContent.getStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const readFileAsBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("讀取檔案失敗"));
      reader.readAsDataURL(file);
    });

  const onUploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) {
          toast.error(`${file.name} 唔係圖片`);
          continue;
        }
        const dataUrl = await readFileAsBase64(file);
        await uploadAsset.mutateAsync({
          fileName: file.name,
          fileBase64: dataUrl,
          mimeType: file.type,
          category: uploadCategory,
          preferredFor: uploadPreferred,
          caption: uploadCaption || undefined,
        });
      }
    } catch (e: any) {
      toast.error(e?.message || "上傳失敗");
    } finally {
      setUploading(false);
    }
  };

  const genWeek = trpc.linkedinContent.generateThisWeek.useMutation({
    onSuccess: (d) => {
      const used = (d as any).assetsUsed ?? 0;
      if (d.created === 0 && d.existing > 0) {
        toast.success(
          `本週已有 ${d.existing} 篇（${d.weekKey}）— 已切去「全部」顯示。若要重寫待批核稿，用「清空本週草稿」後再生成。`
        );
        setContentFilter("all");
      } else {
        toast.success(
          `本週內容：新增 ${d.created}，已有 ${d.existing}${used ? `，抽相 ${used} 張` : ""}（${d.weekKey}）`
        );
        if (d.created > 0) setContentFilter("pending_review");
      }
      utils.linkedinContent.getStats.invalidate();
      utils.linkedinContent.listPosts.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const clearWeek = trpc.linkedinContent.clearWeekDrafts.useMutation({
    onSuccess: (d) => {
      toast.success(`已清空本週草稿 ${d.deleted} 篇（${d.weekKey}）`);
      utils.linkedinContent.getStats.invalidate();
      utils.linkedinContent.listPosts.invalidate();
      utils.linkedinContent.dueToday.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const deletePost = trpc.linkedinContent.deletePost.useMutation({
    onSuccess: () => {
      toast.success("已刪除");
      utils.linkedinContent.getStats.invalidate();
      utils.linkedinContent.listPosts.invalidate();
      setEditingPost(null);
    },
    onError: (e) => toast.error(e.message),
  });
  const approvePost = trpc.linkedinContent.approve.useMutation({
    onSuccess: (d) => {
      if (d.bufferPushed) {
        toast.success(
          d.scheduledBumpedTo
            ? `已批准 → Buffer（原排程已過，自動改到 ${formatHkt(d.scheduledBumpedTo)} HKT）`
            : "已批准 → Buffer 已排程，到點自動發 LinkedIn"
        );
      } else if (d.bufferError) {
        toast.warning(`已批准，但 Buffer 失敗：${d.bufferError}`);
      } else {
        toast.success("已批准並排程");
      }
      utils.linkedinContent.getStats.invalidate();
      utils.linkedinContent.listPosts.invalidate();
      utils.linkedinContent.dueToday.invalidate();
      setContentFilter("scheduled");
      setEditingPost(null);
    },
    onError: (e) => toast.error(e.message),
  });
  const pushBuffer = trpc.linkedinContent.pushToBuffer.useMutation({
    onSuccess: (d) => {
      if (d.alreadyQueued) {
        toast.success("已在 Buffer 排程");
      } else if (d.scheduledBumpedTo) {
        toast.success(`已推去 Buffer（原排程已過，自動改到 ${formatHkt(d.scheduledBumpedTo)} HKT）`);
      } else {
        toast.success("已推去 Buffer，到點自動發 LinkedIn");
      }
      utils.linkedinContent.listPosts.invalidate();
      utils.linkedinContent.dueToday.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const rejectPost = trpc.linkedinContent.reject.useMutation({
    onSuccess: () => {
      toast.success("已拒絕");
      utils.linkedinContent.getStats.invalidate();
      utils.linkedinContent.listPosts.invalidate();
      setEditingPost(null);
    },
  });
  const publishPost = trpc.linkedinContent.markPublished.useMutation({
    onSuccess: () => {
      toast.success("已標記為已發佈");
      utils.linkedinContent.getStats.invalidate();
      utils.linkedinContent.listPosts.invalidate();
      utils.linkedinContent.dueToday.invalidate();
      setEditingPost(null);
    },
  });
  const savePost = trpc.linkedinContent.updatePost.useMutation({
    onSuccess: () => {
      toast.success("草稿已儲存");
      utils.linkedinContent.listPosts.invalidate();
    },
  });

  const sync = trpc.linkedinOps.syncFromPitchLeads.useMutation({
    onSuccess: (d) => {
      toast.success(`已同步：新增 ${d.created}，略過 ${d.skipped}（掃描 ${d.scanned} 條招聘線索）`);
      utils.linkedinOps.getStats.invalidate();
      utils.linkedinOps.listDueToday.invalidate();
      utils.linkedinOps.listContacts.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const advance = trpc.linkedinOps.advanceStage.useMutation({
    onSuccess: (d) => {
      toast.success(`已推進 → ${d.stageLabel}`);
      utils.linkedinOps.getStats.invalidate();
      utils.linkedinOps.listDueToday.invalidate();
      utils.linkedinOps.listContacts.invalidate();
      setShowDetail(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const skip = trpc.linkedinOps.skipContact.useMutation({
    onSuccess: () => {
      toast.success("已跳過");
      utils.linkedinOps.getStats.invalidate();
      utils.linkedinOps.listDueToday.invalidate();
      utils.linkedinOps.listContacts.invalidate();
      setShowDetail(false);
    },
  });

  const genDm = trpc.linkedinOps.generateDm.useMutation({
    onSuccess: (d) => {
      toast.success("DM 草稿已生成");
      setSelected((prev: any) => (prev ? { ...prev, dmDraft: d.body } : prev));
      utils.linkedinOps.listDueToday.invalidate();
      utils.linkedinOps.listContacts.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const create = trpc.linkedinOps.createContact.useMutation({
    onSuccess: () => {
      toast.success("已新增聯絡");
      setShowCreate(false);
      setCreateForm({
        companyName: "",
        personName: "",
        personTitle: "",
        linkedInProfileUrl: "",
        playbook: "general",
      });
      utils.linkedinOps.getStats.invalidate();
      utils.linkedinOps.listDueToday.invalidate();
      utils.linkedinOps.listContacts.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const update = trpc.linkedinOps.updateContact.useMutation({
    onSuccess: () => {
      toast.success("已儲存");
      utils.linkedinOps.listDueToday.invalidate();
      utils.linkedinOps.listContacts.invalidate();
    },
  });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("已複製");
    } catch {
      toast.error("複製失敗");
    }
  };

  const openDetail = (c: any) => {
    setSelected(c);
    setShowDetail(true);
  };

  const renderContactRow = (c: any) => (
    <div
      key={c.id}
      className="border rounded-lg p-3 sm:p-4 bg-card flex flex-col gap-3"
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-foreground text-sm sm:text-base break-words">{c.companyName}</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 shrink-0">
            {c.stageLabel}
          </span>
          <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
            {PLAYBOOK_LABELS[c.playbook] ?? c.playbook}
          </span>
        </div>
        {c.jobTitle && <p className="text-sm text-muted-foreground break-words">訊號職位：{c.jobTitle}</p>}
        {(c.personName || c.personTitle) && (
          <p className="text-sm text-foreground break-words">
            {c.personName ?? "（未填姓名）"}
            {c.personTitle ? ` · ${c.personTitle}` : ""}
          </p>
        )}
        {c.nextStageLabel && (
          <p className="text-xs text-muted-foreground">下一步：{c.nextStageLabel}</p>
        )}
      </div>
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
        <Button variant="outline" size="sm" className="gap-1 min-h-10 sm:min-h-0 justify-center" asChild>
          <a href={c.searchUrl || c.linkedInProfileUrl} target="_blank" rel="noopener noreferrer">
            <Linkedin className="w-3.5 h-3.5" />
            {c.linkedInProfileUrl ? "開 Profile" : "搵人"}
          </a>
        </Button>
        {c.jobUrl && (
          <Button variant="ghost" size="sm" className="gap-1 min-h-10 sm:min-h-0 justify-center border sm:border-0" asChild>
            <a href={c.jobUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-3.5 h-3.5" />
              職位
            </a>
          </Button>
        )}
        <Button variant="ghost" size="sm" className="min-h-10 sm:min-h-0 justify-center border sm:border-0" onClick={() => openDetail(c)}>
          詳情
        </Button>
        {c.nextStage && (
          <Button
            size="sm"
            className="gap-1 min-h-10 sm:min-h-0 col-span-2 sm:col-span-1 justify-center"
            onClick={() => advance.mutate({ id: c.id })}
            disabled={advance.isPending}
          >
            {advance.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChevronRight className="w-3.5 h-3.5" />}
            完成這步
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-4 sm:space-y-6 max-w-full overflow-x-hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">LinkedIn 營運</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1 leading-relaxed">
            招聘訊號 → 暖場 → 連線 → DM。系統管進度同草稿；你喺 LinkedIn 執行。
          </p>
        </div>
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 w-full sm:w-auto">
          <Button variant="outline" className="gap-2 min-h-10" onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4 shrink-0" />
            <span className="truncate">手動新增</span>
          </Button>
          <Button
            className="gap-2 min-h-10"
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
          >
            {sync.isPending ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : <RefreshCw className="w-4 h-4 shrink-0" />}
            <span className="truncate sm:hidden">同步</span>
            <span className="hidden sm:inline">從開拓客戶同步</span>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 sm:gap-3">
        {[
          { label: "今日待辦", value: stats?.dueToday ?? 0, color: "text-amber-600" },
          { label: "總聯絡", value: stats?.total ?? 0, color: "text-foreground" },
          { label: "已發 DM", value: stats?.dmSent ?? 0, color: "text-blue-600" },
          { label: "有回覆", value: stats?.replied ?? 0, color: "text-purple-600" },
          { label: "成交", value: stats?.won ?? 0, color: "text-emerald-600" },
        ].map((s) => (
          <div key={s.label} className="bg-card border rounded-lg p-2.5 sm:p-3 text-center">
            <div className={`text-xl sm:text-2xl font-bold ${s.color}`}>{statsLoading ? "…" : s.value}</div>
            <div className="text-[11px] sm:text-xs text-muted-foreground mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab} className="gap-0">
        <div className="-mx-1 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsList className="inline-flex w-max min-w-full sm:min-w-0 h-auto p-1 gap-0.5">
            <TabsTrigger value="today" className="gap-1 px-2.5 py-2 text-xs sm:text-sm shrink-0">
              <ListTodo className="w-3.5 h-3.5" />
              今日
              <span className="hidden sm:inline">任務</span>
            </TabsTrigger>
            <TabsTrigger value="all" className="gap-1 px-2.5 py-2 text-xs sm:text-sm shrink-0">
              <Users className="w-3.5 h-3.5" />
              聯絡
            </TabsTrigger>
            <TabsTrigger value="playbooks" className="gap-1 px-2.5 py-2 text-xs sm:text-sm shrink-0">
              <BookOpen className="w-3.5 h-3.5" />
              劇本
            </TabsTrigger>
            <TabsTrigger value="content" className="gap-1 px-2.5 py-2 text-xs sm:text-sm shrink-0">
              <PenLine className="w-3.5 h-3.5" />
              內容工廠
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="today" className="space-y-3 mt-4">
          {dueLoading ? (
            <div className="py-16 text-center text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
              載入中…
            </div>
          ) : (dueData?.contacts.length ?? 0) === 0 ? (
            <div className="py-16 text-center text-muted-foreground border rounded-lg bg-card">
              <Building2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>今日無待辦</p>
              <p className="text-xs mt-1">撳「從開拓客戶同步」匯入招聘訊號，或手動新增</p>
            </div>
          ) : (
            dueData?.contacts.map(renderContactRow)
          )}
        </TabsContent>

        <TabsContent value="all" className="space-y-3 mt-4">
          <div className="flex gap-2">
            <Select
              value={listStage}
              onValueChange={(v) => {
                setListStage(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full sm:w-40 min-h-10 sm:min-h-9">
                <SelectValue placeholder="階段" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部階段</SelectItem>
                {Object.entries(stats?.stageLabels ?? {}).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {listLoading ? (
            <div className="py-12 text-center">
              <Loader2 className="w-6 h-6 animate-spin mx-auto" />
            </div>
          ) : (listData?.contacts.length ?? 0) === 0 ? (
            <div className="py-12 text-center text-muted-foreground">暫無記錄</div>
          ) : (
            listData?.contacts.map(renderContactRow)
          )}
        </TabsContent>

        <TabsContent value="playbooks" className="mt-4 space-y-3">
          {(playbooks ?? []).map((pb) => (
            <div key={pb.id} className="border rounded-lg p-4 bg-card space-y-2">
              <div className="font-medium" style={{ color: "#d4a843" }}>
                {pb.name}
              </div>
              <p className="text-sm text-muted-foreground">{pb.summary}</p>
              <ol className="text-sm list-decimal list-inside space-y-0.5 text-foreground">
                {pb.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="content" className="mt-4 space-y-4">
          <div className="rounded-lg border bg-muted/30 px-3 py-3 sm:px-4 text-xs sm:text-sm text-muted-foreground leading-relaxed break-words">
            每週 3 篇：項目＋幕後 · 教育＋洞察 · 數據＋視覺。批准後經 Buffer 自動發 LinkedIn。
            <div className="text-xs mt-1 break-words">{contentMeta?.scheduleNote}</div>
            {contentMeta?.typeBlurbs && (
              <ul className="text-xs mt-2 space-y-1.5 list-none">
                <li>🥇 項目案例 + 幕後故事 — {(contentMeta.typeBlurbs as any).project_bts}</li>
                <li>🥈 攝影教育 + 行業洞察 — {(contentMeta.typeBlurbs as any).photo_education}</li>
                <li>🥉 數據 + 視覺化 — {(contentMeta.typeBlurbs as any).data_viz}</li>
              </ul>
            )}
            {(contentMeta as any)?.buffer && (
              <div className="text-xs mt-2 pt-2 border-t border-border/60 break-words">
                Buffer → LinkedIn：{" "}
                {(contentMeta as any).buffer.configured ? (
                  (contentMeta as any).buffer.error ? (
                    <span className="text-destructive">{(contentMeta as any).buffer.error}</span>
                  ) : (
                    <span className="text-emerald-700 dark:text-emerald-400">
                      已連接 {(contentMeta as any).buffer.displayName}
                      {(contentMeta as any).buffer.type
                        ? `（${(contentMeta as any).buffer.type}）`
                        : ""}
                    </span>
                  )
                ) : (
                  <span className="text-amber-700">未設定 BUFFER_ACCESS_TOKEN</span>
                )}
              </div>
            )}
          </div>

          {/* Image library */}
          <div className="border rounded-lg p-3 sm:p-4 bg-card space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="font-medium text-sm flex flex-wrap items-center gap-2">
                  <ImagePlus className="w-4 h-4 shrink-0" style={{ color: "#d4a843" }} />
                  圖片庫
                  <span className="text-xs font-normal text-muted-foreground">
                    {contentStats?.libraryCount ?? assets?.length ?? 0} 張 · 生成時自動抽相
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  上傳後設「適用主題」。生成時若庫存冇相，會自動去 jdstudiohk.com 服務頁抽圖入庫。
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1 w-full sm:w-auto min-h-10"
                  disabled={harvestWebsite.isPending}
                  onClick={() =>
                    harvestWebsite.mutate({ maxNew: 8, preferredFor: uploadPreferred })
                  }
                >
                  {harvestWebsite.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <ExternalLink className="w-3 h-3" />
                  )}
                  從官網抽相
                </Button>
              <label className="inline-flex w-full sm:w-auto">
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  disabled={uploading || uploadAsset.isPending}
                  onChange={(e) => {
                    void onUploadFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  className="gap-1 w-full sm:w-auto min-h-10"
                  disabled={uploading || uploadAsset.isPending}
                  onClick={(e) => {
                    const input = (e.currentTarget.parentElement as HTMLLabelElement)?.querySelector(
                      'input[type="file"]'
                    ) as HTMLInputElement | null;
                    input?.click();
                  }}
                >
                  {uploading || uploadAsset.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <ImagePlus className="w-3 h-3" />
                  )}
                  上傳相片
                </Button>
              </label>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:flex sm:flex-wrap gap-2 sm:items-end">
              <div className="space-y-1 min-w-0">
                <Label className="text-xs">分類</Label>
                <Select value={uploadCategory} onValueChange={(v) => setUploadCategory(v as any)}>
                  <SelectTrigger className="w-full sm:w-36 h-10 sm:h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSET_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 min-w-0">
                <Label className="text-xs">適用主題</Label>
                <Select value={uploadPreferred} onValueChange={(v) => setUploadPreferred(v as any)}>
                  <SelectTrigger className="w-full sm:w-36 h-10 sm:h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSET_PREFERRED.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 min-w-0 sm:flex-1 sm:min-w-[160px]">
                <Label className="text-xs">說明（可選）</Label>
                <Input
                  className="h-10 sm:h-8 text-xs"
                  placeholder="例如：珠寶 before / 產品棚拍"
                  value={uploadCaption}
                  onChange={(e) => setUploadCaption(e.target.value)}
                />
              </div>
            </div>

            {assetsLoading ? (
              <div className="py-6 text-center">
                <Loader2 className="w-5 h-5 animate-spin mx-auto" />
              </div>
            ) : (assets?.length ?? 0) === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground border border-dashed rounded-md">
                未有相片 — 上傳後，「生成本週 3 篇」會自動抽相
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {assets?.map((a) => (
                  <div key={a.id} className="border rounded-md overflow-hidden bg-muted/20 space-y-1">
                    <a href={a.url} target="_blank" rel="noreferrer" className="block aspect-square bg-black/5">
                      <img src={a.url} alt={a.fileName} className="w-full h-full object-cover" />
                    </a>
                    <div className="px-2 pb-2 space-y-1">
                      <div className="text-[10px] text-muted-foreground truncate" title={a.fileName}>
                        #{a.id} · 用過 {a.timesUsed} 次
                      </div>
                      <Select
                        value={a.category}
                        onValueChange={(v) => updateAsset.mutate({ id: a.id, category: v as any })}
                      >
                        <SelectTrigger className="h-7 text-[10px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ASSET_CATEGORIES.map((c) => (
                            <SelectItem key={c.value} value={c.value}>
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={a.preferredFor}
                        onValueChange={(v) => updateAsset.mutate({ id: a.id, preferredFor: v as any })}
                      >
                        <SelectTrigger className="h-7 text-[10px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ASSET_PREFERRED.map((c) => (
                            <SelectItem key={c.value} value={c.value}>
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-full text-[10px] gap-1 text-muted-foreground"
                        onClick={() => archiveAsset.mutate({ id: a.id })}
                      >
                        <Trash2 className="w-3 h-3" />
                        移出
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-1.5 sm:gap-2 text-xs sm:text-sm">
              <span className="px-2 py-1 rounded bg-card border">週次 {contentStats?.weekKey ?? "…"}</span>
              <span className="px-2 py-1 rounded bg-amber-50 text-amber-800 border border-amber-200">
                待批核 {contentStats?.weekPending ?? 0}
              </span>
              <span className="px-2 py-1 rounded bg-blue-50 text-blue-800 border border-blue-200">
                今日要發 {contentStats?.dueToday ?? 0}
              </span>
              <span className="px-2 py-1 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                已發佈 {contentStats?.published ?? 0}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:flex gap-2 w-full sm:w-auto">
              <Button
                variant="outline"
                className="gap-2 w-full sm:w-auto min-h-10 text-muted-foreground"
                disabled={clearWeek.isPending || !(contentStats?.weekPending || contentList?.posts?.length)}
                onClick={() => {
                  if (confirm(`清空本週（${contentStats?.weekKey ?? ""}）待批核／草稿？之後可再生成。`)) {
                    clearWeek.mutate({});
                  }
                }}
              >
                {clearWeek.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                清空本週草稿
              </Button>
              <Button
                className="gap-2 w-full sm:w-auto min-h-10"
                onClick={() => genWeek.mutate({ force: (contentStats?.weekPending ?? 0) > 0 })}
                disabled={genWeek.isPending}
              >
                {genWeek.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {(contentStats?.weekPending ?? 0) > 0 ? "重新生成 3 篇" : "生成本週 3 篇"}
              </Button>
            </div>
          </div>

          {(duePosts?.length ?? 0) > 0 && (
            <div className="border rounded-lg p-3 space-y-2" style={{ borderColor: "#d4a843" }}>
              <div className="text-sm font-medium" style={{ color: "#d4a843" }}>
                今日要發佈
              </div>
              {duePosts?.map((p) => (
                <div key={p.id} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between text-sm bg-card rounded p-2 border">
                  <div className="min-w-0 break-words">
                    <span className="font-medium">{p.typeLabel}</span>
                    <span className="text-muted-foreground ml-2">{p.title}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:flex gap-2">
                    <Button size="sm" variant="outline" className="gap-1 min-h-10 sm:min-h-0" onClick={() => copy(p.body)}>
                      <Copy className="w-3 h-3" />
                      複製
                    </Button>
                    <Button size="sm" className="gap-1 min-h-10 sm:min-h-0" onClick={() => publishPost.mutate({ id: p.id })}>
                      <Check className="w-3 h-3" />
                      已發佈
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <Select value={contentFilter} onValueChange={(v) => setContentFilter(v as typeof contentFilter)}>
              <SelectTrigger className="w-full sm:w-40 min-h-10 sm:min-h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending_review">待批核</SelectItem>
                <SelectItem value="scheduled">已排程</SelectItem>
                <SelectItem value="published">已發佈</SelectItem>
                <SelectItem value="all">全部</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {contentLoading ? (
            <div className="py-12 text-center">
              <Loader2 className="w-6 h-6 animate-spin mx-auto" />
            </div>
          ) : (contentList?.posts.length ?? 0) === 0 ? (
            <div className="py-12 text-center text-muted-foreground border rounded-lg space-y-3 px-4">
              {contentFilter === "pending_review" && (contentStats?.weekTotal ?? 0) > 0 ? (
                <>
                  <p>
                    本週已有 {contentStats?.weekTotal} 篇，但冇待批核
                    {(contentStats?.weekScheduled ?? 0) > 0
                      ? `（${contentStats?.weekScheduled} 篇已排程）`
                      : ""}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setContentFilter((contentStats?.weekScheduled ?? 0) > 0 ? "scheduled" : "all")
                    }
                  >
                    睇{(contentStats?.weekScheduled ?? 0) > 0 ? "已排程" : "全部"}
                  </Button>
                </>
              ) : (
                <p>未有內容 — 撳「生成本週 3 篇」或等週一上午自動產生</p>
              )}
            </div>
          ) : (
            contentList?.posts.map((p) => (
              <div key={p.id} className="border rounded-lg p-3 sm:p-4 bg-card space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                  <div className="flex flex-wrap gap-2 items-center min-w-0">
                    <span className="text-xs px-2 py-0.5 rounded shrink-0" style={{ background: "#1a1a1a", color: "#d4a843" }}>
                      {p.typeLabel}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-muted shrink-0">{p.statusLabel}</span>
                    {p.bufferStatus && (
                      <span
                        className={`text-xs px-2 py-0.5 rounded border shrink-0 ${
                          p.bufferStatus === "queued"
                            ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                            : p.bufferStatus === "failed"
                              ? "bg-red-50 text-red-800 border-red-200"
                              : "bg-muted"
                        }`}
                      >
                        {(p as any).bufferStatusLabel || p.bufferStatus}
                      </span>
                    )}
                    <span className="font-medium text-sm break-words">{p.title}</span>
                  </div>
                  <div className="text-xs text-muted-foreground shrink-0">
                    {p.scheduledFor ? `排程 ${formatHkt(p.scheduledFor)} HKT` : ""}
                  </div>
                </div>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-4 break-words">{p.body}</p>
                {Array.isArray(p.selectedMedia) && p.selectedMedia.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto py-1 -mx-1 px-1">
                    {p.selectedMedia.map((m: any) => (
                      <a
                        key={`${p.id}-${m.id}-${m.slideOrder}`}
                        href={m.url}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 w-16 h-16 rounded border overflow-hidden bg-muted"
                        title={`#${m.id} ${m.fileName || ""}`}
                      >
                        <img src={m.url} alt="" className="w-full h-full object-cover" />
                      </a>
                    ))}
                  </div>
                )}
                {p.mediaHint && (
                  <p className="text-xs text-amber-700 dark:text-amber-400 break-words">配圖：{p.mediaHint}</p>
                )}
                {p.bufferError && (
                  <p className="text-xs text-destructive break-words">Buffer：{p.bufferError}</p>
                )}
                <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="min-h-10 sm:min-h-0" onClick={() => setEditingPost(p)}>
                    編輯／批核
                  </Button>
                  <Button size="sm" variant="ghost" className="gap-1 min-h-10 sm:min-h-0 border sm:border-0" onClick={() => copy(p.body)}>
                    <Copy className="w-3 h-3" />
                    複製
                  </Button>
                  {p.status === "pending_review" && (
                    <>
                      <Button size="sm" className="gap-1 min-h-10 sm:min-h-0 col-span-2 sm:col-span-1" onClick={() => approvePost.mutate({ id: p.id })}>
                        <Check className="w-3 h-3" />
                        批准 → Buffer
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1 text-muted-foreground min-h-10 sm:min-h-0 border sm:border-0"
                        onClick={() => rejectPost.mutate({ id: p.id })}
                      >
                        <X className="w-3 h-3" />
                        拒絕
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1 text-destructive min-h-10 sm:min-h-0 border sm:border-0 col-span-2 sm:col-span-1"
                        onClick={() => {
                          if (confirm("刪除呢篇草稿？")) deletePost.mutate({ id: p.id });
                        }}
                      >
                        <Trash2 className="w-3 h-3" />
                        刪除
                      </Button>
                    </>
                  )}
                  {p.status === "rejected" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1 text-destructive min-h-10 sm:min-h-0 border sm:border-0"
                      onClick={() => {
                        if (confirm("刪除呢篇？")) deletePost.mutate({ id: p.id });
                      }}
                    >
                      <Trash2 className="w-3 h-3" />
                      刪除
                    </Button>
                  )}
                  {(p.status === "scheduled" || p.status === "approved") &&
                    p.bufferStatus !== "queued" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 min-h-10 sm:min-h-0 col-span-2 sm:col-span-1"
                        disabled={pushBuffer.isPending}
                        onClick={() => pushBuffer.mutate({ id: p.id })}
                      >
                        {pushBuffer.isPending ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : null}
                        重試推 Buffer
                      </Button>
                    )}
                  {(p.status === "scheduled" || p.status === "approved") && (
                    <Button size="sm" className="gap-1 min-h-10 sm:min-h-0 col-span-2 sm:col-span-1" onClick={() => publishPost.mutate({ id: p.id })}>
                      標記已發佈
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* Content edit dialog */}
      <Dialog open={!!editingPost} onOpenChange={(o) => !o && setEditingPost(null)}>
        <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="pr-8 text-base sm:text-lg break-words">
              {editingPost?.typeLabel} · {editingPost?.title}
            </DialogTitle>
          </DialogHeader>
          {editingPost && (
            <div className="space-y-3">
              <div>
                <Label>標題（內部）</Label>
                <Input
                  value={editingPost.title}
                  onChange={(e) => setEditingPost({ ...editingPost, title: e.target.value })}
                />
              </div>
              <div>
                <Label>帖文</Label>
                <textarea
                  className="w-full min-h-[160px] sm:min-h-[200px] rounded-md border bg-muted/40 p-3 text-sm"
                  value={editingPost.body}
                  onChange={(e) => setEditingPost({ ...editingPost, body: e.target.value })}
                />
              </div>
              <div>
                <Label>配圖提示</Label>
                <Input
                  value={editingPost.mediaHint ?? ""}
                  onChange={(e) => setEditingPost({ ...editingPost, mediaHint: e.target.value })}
                />
              </div>
              <div>
                <Label>排程時間（HKT）</Label>
                <Input
                  type="datetime-local"
                  value={toHktDatetimeLocal(editingPost.scheduledFor)}
                  onChange={(e) => {
                    const iso = fromHktDatetimeLocal(e.target.value);
                    setEditingPost({ ...editingPost, scheduledFor: iso });
                  }}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  若時間已過，批准／推 Buffer 會自動改去約 15 分鐘後
                </p>
              </div>
              {Array.isArray(editingPost.selectedMedia) && editingPost.selectedMedia.length > 0 && (
                <div>
                  <Label>已抽庫存相</Label>
                  <div className="flex gap-2 flex-wrap mt-1">
                    {editingPost.selectedMedia.map((m: any) => (
                      <a
                        key={`edit-${m.id}`}
                        href={m.url}
                        target="_blank"
                        rel="noreferrer"
                        className="w-20 h-20 rounded border overflow-hidden"
                      >
                        <img src={m.url} alt="" className="w-full h-full object-cover" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2 flex-col-reverse sm:flex-row sm:flex-wrap">
            <Button variant="outline" className="w-full sm:w-auto min-h-10" onClick={() => setEditingPost(null)}>
              關閉
            </Button>
            <Button
              variant="outline"
              className="w-full sm:w-auto min-h-10"
              onClick={() =>
                editingPost &&
                savePost.mutate({
                  id: editingPost.id,
                  title: editingPost.title,
                  body: editingPost.body,
                  mediaHint: editingPost.mediaHint,
                  scheduledFor: editingPost.scheduledFor ?? null,
                })
              }
              disabled={savePost.isPending}
            >
              儲存修改
            </Button>
            {editingPost?.status === "pending_review" && (
              <Button
                className="w-full sm:w-auto min-h-10"
                onClick={() => {
                  if (!editingPost) return;
                  savePost.mutate(
                    {
                      id: editingPost.id,
                      title: editingPost.title,
                      body: editingPost.body,
                      mediaHint: editingPost.mediaHint,
                      scheduledFor: editingPost.scheduledFor ?? null,
                    },
                    { onSuccess: () => approvePost.mutate({ id: editingPost.id }) }
                  );
                }}
              >
                儲存並批准 → Buffer
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail */}
      <Dialog open={showDetail} onOpenChange={setShowDetail}>
        <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="pr-8 break-words text-base sm:text-lg">{selected?.companyName}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <span className="text-muted-foreground">階段：</span>
                  {selected.stageLabel}
                </div>
                <div>
                  <span className="text-muted-foreground">劇本：</span>
                  {PLAYBOOK_LABELS[selected.playbook]}
                </div>
              </div>
              <div className="space-y-2">
                <Label>聯絡人姓名</Label>
                <Input
                  className="min-h-10"
                  value={selected.personName ?? ""}
                  onChange={(e) => setSelected({ ...selected, personName: e.target.value })}
                  placeholder="例如 Mary Chan"
                />
                <Label>職稱</Label>
                <Input
                  className="min-h-10"
                  value={selected.personTitle ?? ""}
                  onChange={(e) => setSelected({ ...selected, personTitle: e.target.value })}
                  placeholder="HR Manager / Founder"
                />
                <Label>LinkedIn Profile URL</Label>
                <Input
                  className="min-h-10"
                  value={selected.linkedInProfileUrl ?? ""}
                  onChange={(e) => setSelected({ ...selected, linkedInProfileUrl: e.target.value })}
                  placeholder="https://www.linkedin.com/in/…"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full sm:w-auto min-h-10"
                  onClick={() =>
                    update.mutate({
                      id: selected.id,
                      personName: selected.personName,
                      personTitle: selected.personTitle,
                      linkedInProfileUrl: selected.linkedInProfileUrl,
                    })
                  }
                  disabled={update.isPending}
                >
                  儲存聯絡資料
                </Button>
              </div>
              <div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-2">
                  <Label>DM 草稿</Label>
                  <div className="grid grid-cols-2 sm:flex gap-2">
                    {selected.dmDraft && (
                      <Button variant="ghost" size="sm" className="gap-1 min-h-10 border sm:border-0" onClick={() => copy(selected.dmDraft)}>
                        <Copy className="w-3 h-3" />
                        複製
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1 min-h-10 border sm:border-0"
                      onClick={() => genDm.mutate({ id: selected.id })}
                      disabled={genDm.isPending}
                    >
                      {genDm.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                      生成
                    </Button>
                  </div>
                </div>
                <textarea
                  className="w-full min-h-[140px] rounded-md border bg-muted/40 p-3 text-sm"
                  value={selected.dmDraft ?? ""}
                  onChange={(e) => setSelected({ ...selected, dmDraft: e.target.value })}
                  onBlur={() => {
                    if (selected.dmDraft != null) {
                      update.mutate({ id: selected.id, dmDraft: selected.dmDraft });
                    }
                  }}
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 flex-col-reverse sm:flex-row sm:flex-wrap">
            <Button variant="outline" className="w-full sm:w-auto min-h-10" onClick={() => setShowDetail(false)}>
              關閉
            </Button>
            <Button
              variant="ghost"
              className="text-muted-foreground gap-1 w-full sm:w-auto min-h-10"
              onClick={() => selected && skip.mutate({ id: selected.id })}
            >
              <SkipForward className="w-4 h-4" />
              跳過
            </Button>
            {selected?.nextStage && (
              <Button
                className="gap-1 w-full sm:w-auto min-h-10"
                onClick={() => advance.mutate({ id: selected.id })}
                disabled={advance.isPending}
              >
                <ChevronRight className="w-4 h-4" />
                <span className="truncate">完成這步 → {selected.nextStageLabel}</span>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>手動新增 LinkedIn 聯絡</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>公司 *</Label>
              <Input
                className="min-h-10"
                value={createForm.companyName}
                onChange={(e) => setCreateForm({ ...createForm, companyName: e.target.value })}
              />
            </div>
            <div>
              <Label>聯絡人</Label>
              <Input
                className="min-h-10"
                value={createForm.personName}
                onChange={(e) => setCreateForm({ ...createForm, personName: e.target.value })}
              />
            </div>
            <div>
              <Label>職稱</Label>
              <Input
                className="min-h-10"
                value={createForm.personTitle}
                onChange={(e) => setCreateForm({ ...createForm, personTitle: e.target.value })}
              />
            </div>
            <div>
              <Label>Profile URL</Label>
              <Input
                className="min-h-10"
                value={createForm.linkedInProfileUrl}
                onChange={(e) => setCreateForm({ ...createForm, linkedInProfileUrl: e.target.value })}
              />
            </div>
            <div>
              <Label>劇本</Label>
              <Select
                value={createForm.playbook}
                onValueChange={(v) =>
                  setCreateForm({ ...createForm, playbook: v as typeof createForm.playbook })
                }
              >
                <SelectTrigger className="min-h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hire_signal">招聘訊號</SelectItem>
                  <SelectItem value="winback">舊客喚回</SelectItem>
                  <SelectItem value="general">一般開發</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button variant="outline" className="w-full sm:w-auto min-h-10" onClick={() => setShowCreate(false)}>
              取消
            </Button>
            <Button
              className="w-full sm:w-auto min-h-10"
              disabled={!createForm.companyName || create.isPending}
              onClick={() => create.mutate(createForm)}
            >
              {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "新增"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
