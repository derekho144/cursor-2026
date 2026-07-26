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
  { value: "other", label: "其他" },
] as const;

const ASSET_PREFERRED = [
  { value: "any", label: "全部主題" },
  { value: "carousel", label: "輪播案例" },
  { value: "debate", label: "外包辯論" },
  { value: "contrarian", label: "反常識" },
] as const;

const PLAYBOOK_LABELS: Record<string, string> = {
  hire_signal: "招聘訊號",
  winback: "舊客喚回",
  general: "一般開發",
};

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
      weekKey:
        contentFilter === "published" || contentFilter === "all"
          ? undefined
          : contentStats?.weekKey,
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
      toast.success(
        `本週內容：新增 ${d.created}，已有 ${d.existing}${used ? `，抽相 ${used} 張` : ""}（${d.weekKey}）`
      );
      utils.linkedinContent.getStats.invalidate();
      utils.linkedinContent.listPosts.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const approvePost = trpc.linkedinContent.approve.useMutation({
    onSuccess: (d) => {
      if (d.bufferPushed) {
        toast.success("已批准 → Buffer 已排程，到點自動發 LinkedIn");
      } else if (d.bufferError) {
        toast.warning(`已批准，但 Buffer 失敗：${d.bufferError}`);
      } else {
        toast.success("已批准並排程");
      }
      utils.linkedinContent.getStats.invalidate();
      utils.linkedinContent.listPosts.invalidate();
      utils.linkedinContent.dueToday.invalidate();
      setEditingPost(null);
    },
    onError: (e) => toast.error(e.message),
  });
  const pushBuffer = trpc.linkedinContent.pushToBuffer.useMutation({
    onSuccess: (d) => {
      toast.success(d.alreadyQueued ? "已在 Buffer 排程" : "已推去 Buffer，到點自動發 LinkedIn");
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
      className="border rounded-lg p-4 bg-card flex flex-col gap-3 md:flex-row md:items-start md:justify-between"
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-foreground">{c.companyName}</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
            {c.stageLabel}
          </span>
          <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
            {PLAYBOOK_LABELS[c.playbook] ?? c.playbook}
          </span>
        </div>
        {c.jobTitle && <p className="text-sm text-muted-foreground">訊號職位：{c.jobTitle}</p>}
        {(c.personName || c.personTitle) && (
          <p className="text-sm text-foreground">
            {c.personName ?? "（未填姓名）"}
            {c.personTitle ? ` · ${c.personTitle}` : ""}
          </p>
        )}
        {c.nextStageLabel && (
          <p className="text-xs text-muted-foreground">下一步：{c.nextStageLabel}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2 shrink-0">
        <Button variant="outline" size="sm" className="gap-1" asChild>
          <a href={c.searchUrl || c.linkedInProfileUrl} target="_blank" rel="noopener noreferrer">
            <Linkedin className="w-3.5 h-3.5" />
            {c.linkedInProfileUrl ? "開 Profile" : "搵人"}
          </a>
        </Button>
        {c.jobUrl && (
          <Button variant="ghost" size="sm" className="gap-1" asChild>
            <a href={c.jobUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-3.5 h-3.5" />
              職位
            </a>
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => openDetail(c)}>
          詳情
        </Button>
        {c.nextStage && (
          <Button
            size="sm"
            className="gap-1"
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
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">LinkedIn 營運</h1>
          <p className="text-sm text-muted-foreground mt-1">
            招聘訊號 → 暖場 → 連線 → DM。系統管進度同草稿；你（或 Manus）喺 LinkedIn 執行。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-2" onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4" />
            手動新增
          </Button>
          <Button
            className="gap-2"
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
          >
            {sync.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            從開拓客戶同步
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "今日待辦", value: stats?.dueToday ?? 0, color: "text-amber-600" },
          { label: "總聯絡", value: stats?.total ?? 0, color: "text-foreground" },
          { label: "已發 DM", value: stats?.dmSent ?? 0, color: "text-blue-600" },
          { label: "有回覆", value: stats?.replied ?? 0, color: "text-purple-600" },
          { label: "成交", value: stats?.won ?? 0, color: "text-emerald-600" },
        ].map((s) => (
          <div key={s.label} className="bg-card border rounded-lg p-3 text-center">
            <div className={`text-2xl font-bold ${s.color}`}>{statsLoading ? "…" : s.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="today" className="gap-1.5">
            <ListTodo className="w-3.5 h-3.5" />
            今日任務
          </TabsTrigger>
          <TabsTrigger value="all" className="gap-1.5">
            <Users className="w-3.5 h-3.5" />
            全部聯絡
          </TabsTrigger>
          <TabsTrigger value="playbooks" className="gap-1.5">
            <BookOpen className="w-3.5 h-3.5" />
            劇本
          </TabsTrigger>
          <TabsTrigger value="content" className="gap-1.5">
            <PenLine className="w-3.5 h-3.5" />
            內容工廠
          </TabsTrigger>
        </TabsList>

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
              <SelectTrigger className="w-40">
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
          <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            每週 3 篇高互動主題：🥇 輪播成功案例 · 🥈 外包 vs 自聘辯論 · 🥉 反常識觀點。你批核後按排程發佈（複製貼上 LinkedIn），再標記已發。
            <div className="text-xs mt-1">{contentMeta?.scheduleNote}</div>
            {contentMeta?.typeBlurbs && (
              <ul className="text-xs mt-2 space-y-1 list-none">
                <li>🥇 輪播成功案例 — {(contentMeta.typeBlurbs as any).carousel_case_study}</li>
                <li>🥈 外包 vs 自聘 — {(contentMeta.typeBlurbs as any).outsource_vs_inhire}</li>
                <li>🥉 反常識觀點 — {(contentMeta.typeBlurbs as any).contrarian_take}</li>
              </ul>
            )}
            {(contentMeta as any)?.buffer && (
              <div className="text-xs mt-2 pt-2 border-t border-border/60">
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
          <div className="border rounded-lg p-4 bg-card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium text-sm flex items-center gap-2">
                  <ImagePlus className="w-4 h-4" style={{ color: "#d4a843" }} />
                  圖片庫
                  <span className="text-xs font-normal text-muted-foreground">
                    {contentStats?.libraryCount ?? assets?.length ?? 0} 張 · 生成時自動抽相寫主題
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  上傳作品後設分類／適用主題；輪播會抽約 6 張，辯論／反常識約 1–2 張（優先少用過嘅）。
                </p>
              </div>
              <label className="inline-flex">
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
                  className="gap-1"
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

            <div className="flex flex-wrap gap-2 items-end">
              <div className="space-y-1">
                <Label className="text-xs">分類</Label>
                <Select value={uploadCategory} onValueChange={(v) => setUploadCategory(v as any)}>
                  <SelectTrigger className="w-36 h-8 text-xs">
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
              <div className="space-y-1">
                <Label className="text-xs">適用主題</Label>
                <Select value={uploadPreferred} onValueChange={(v) => setUploadPreferred(v as any)}>
                  <SelectTrigger className="w-36 h-8 text-xs">
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
              <div className="space-y-1 flex-1 min-w-[160px]">
                <Label className="text-xs">說明（可選）</Label>
                <Input
                  className="h-8 text-xs"
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

          <div className="flex flex-wrap gap-2 items-center justify-between">
            <div className="flex flex-wrap gap-2 text-sm">
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
            <Button
              className="gap-2"
              onClick={() => genWeek.mutate({})}
              disabled={genWeek.isPending}
            >
              {genWeek.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              生成本週 3 篇
            </Button>
          </div>

          {(duePosts?.length ?? 0) > 0 && (
            <div className="border rounded-lg p-3 space-y-2" style={{ borderColor: "#d4a843" }}>
              <div className="text-sm font-medium" style={{ color: "#d4a843" }}>
                今日要發佈
              </div>
              {duePosts?.map((p) => (
                <div key={p.id} className="flex flex-wrap gap-2 items-center justify-between text-sm bg-card rounded p-2 border">
                  <div>
                    <span className="font-medium">{p.typeLabel}</span>
                    <span className="text-muted-foreground ml-2">{p.title}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => copy(p.body)}>
                      <Copy className="w-3 h-3" />
                      複製
                    </Button>
                    <Button size="sm" className="gap-1" onClick={() => publishPost.mutate({ id: p.id })}>
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
              <SelectTrigger className="w-40">
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
            <div className="py-12 text-center text-muted-foreground border rounded-lg">
              未有內容 — 撳「生成本週 3 篇」或等週一上午自動產生
            </div>
          ) : (
            contentList?.posts.map((p) => (
              <div key={p.id} className="border rounded-lg p-4 bg-card space-y-2">
                <div className="flex flex-wrap gap-2 items-center justify-between">
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="text-xs px-2 py-0.5 rounded" style={{ background: "#1a1a1a", color: "#d4a843" }}>
                      {p.typeLabel}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-muted">{p.statusLabel}</span>
                    {p.bufferStatus && (
                      <span
                        className={`text-xs px-2 py-0.5 rounded border ${
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
                    <span className="font-medium text-sm">{p.title}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {p.scheduledFor
                      ? `排程 ${new Date(p.scheduledFor).toLocaleString("zh-HK", {
                          timeZone: "Asia/Hong_Kong",
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })} HKT`
                      : ""}
                  </div>
                </div>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-4">{p.body}</p>
                {Array.isArray(p.selectedMedia) && p.selectedMedia.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto py-1">
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
                  <p className="text-xs text-amber-700 dark:text-amber-400">配圖：{p.mediaHint}</p>
                )}
                {p.bufferError && (
                  <p className="text-xs text-destructive">Buffer：{p.bufferError}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditingPost(p)}>
                    編輯／批核
                  </Button>
                  <Button size="sm" variant="ghost" className="gap-1" onClick={() => copy(p.body)}>
                    <Copy className="w-3 h-3" />
                    複製
                  </Button>
                  {p.status === "pending_review" && (
                    <>
                      <Button size="sm" className="gap-1" onClick={() => approvePost.mutate({ id: p.id })}>
                        <Check className="w-3 h-3" />
                        批准 → Buffer
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1 text-muted-foreground"
                        onClick={() => rejectPost.mutate({ id: p.id })}
                      >
                        <X className="w-3 h-3" />
                        拒絕
                      </Button>
                    </>
                  )}
                  {(p.status === "scheduled" || p.status === "approved") &&
                    p.bufferStatus !== "queued" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1"
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
                    <Button size="sm" className="gap-1" onClick={() => publishPost.mutate({ id: p.id })}>
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
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
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
                  className="w-full min-h-[200px] rounded-md border bg-muted/40 p-3 text-sm"
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
          <DialogFooter className="gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setEditingPost(null)}>
              關閉
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                editingPost &&
                savePost.mutate({
                  id: editingPost.id,
                  title: editingPost.title,
                  body: editingPost.body,
                  mediaHint: editingPost.mediaHint,
                })
              }
              disabled={savePost.isPending}
            >
              儲存修改
            </Button>
            {editingPost?.status === "pending_review" && (
              <Button
                onClick={() => {
                  if (!editingPost) return;
                  savePost.mutate(
                    {
                      id: editingPost.id,
                      title: editingPost.title,
                      body: editingPost.body,
                      mediaHint: editingPost.mediaHint,
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
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selected?.companyName}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-2">
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
                  value={selected.personName ?? ""}
                  onChange={(e) => setSelected({ ...selected, personName: e.target.value })}
                  placeholder="例如 Mary Chan"
                />
                <Label>職稱</Label>
                <Input
                  value={selected.personTitle ?? ""}
                  onChange={(e) => setSelected({ ...selected, personTitle: e.target.value })}
                  placeholder="HR Manager / Founder"
                />
                <Label>LinkedIn Profile URL</Label>
                <Input
                  value={selected.linkedInProfileUrl ?? ""}
                  onChange={(e) => setSelected({ ...selected, linkedInProfileUrl: e.target.value })}
                  placeholder="https://www.linkedin.com/in/…"
                />
                <Button
                  variant="outline"
                  size="sm"
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
                <div className="flex items-center justify-between mb-2">
                  <Label>DM 草稿</Label>
                  <div className="flex gap-1">
                    {selected.dmDraft && (
                      <Button variant="ghost" size="sm" className="gap-1" onClick={() => copy(selected.dmDraft)}>
                        <Copy className="w-3 h-3" />
                        複製
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1"
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
          <DialogFooter className="gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setShowDetail(false)}>
              關閉
            </Button>
            <Button
              variant="ghost"
              className="text-muted-foreground gap-1"
              onClick={() => selected && skip.mutate({ id: selected.id })}
            >
              <SkipForward className="w-4 h-4" />
              跳過
            </Button>
            {selected?.nextStage && (
              <Button
                className="gap-1"
                onClick={() => advance.mutate({ id: selected.id })}
                disabled={advance.isPending}
              >
                <ChevronRight className="w-4 h-4" />
                完成這步 → {selected.nextStageLabel}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>手動新增 LinkedIn 聯絡</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>公司 *</Label>
              <Input
                value={createForm.companyName}
                onChange={(e) => setCreateForm({ ...createForm, companyName: e.target.value })}
              />
            </div>
            <div>
              <Label>聯絡人</Label>
              <Input
                value={createForm.personName}
                onChange={(e) => setCreateForm({ ...createForm, personName: e.target.value })}
              />
            </div>
            <div>
              <Label>職稱</Label>
              <Input
                value={createForm.personTitle}
                onChange={(e) => setCreateForm({ ...createForm, personTitle: e.target.value })}
              />
            </div>
            <div>
              <Label>Profile URL</Label>
              <Input
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
                <SelectTrigger>
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              取消
            </Button>
            <Button
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
