import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Loader2,
  RefreshCw,
  Copy,
  Sparkles,
  Check,
  ImagePlus,
  Trash2,
  ExternalLink,
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
  const utils = trpc.useUtils();

  const { data: contentStats } = trpc.linkedinContent.getStats.useQuery(undefined, {
    refetchInterval: 30000,
  });
  const { data: contentMeta } = trpc.linkedinContent.meta.useQuery(undefined);
  const [contentFilter, setContentFilter] = useState<"all" | "pending_review" | "scheduled" | "published">("pending_review");
  const { data: contentList, isLoading: contentLoading } = trpc.linkedinContent.listPosts.useQuery(
    {
      // 「已發佈」睇歷史；其餘鎖定本週
      weekKey: contentFilter === "published" ? undefined : contentStats?.weekKey,
      status: contentFilter === "all" ? "all" : contentFilter,
      limit: 20,
    },
    { refetchInterval: 30000 }
  );
  const { data: duePosts } = trpc.linkedinContent.dueToday.useQuery(undefined, {
    refetchInterval: 30000,
  });
  const [editingPost, setEditingPost] = useState<any>(null);
  const [uploadCategory, setUploadCategory] = useState<(typeof ASSET_CATEGORIES)[number]["value"]>("product");
  const [uploadPreferred, setUploadPreferred] = useState<(typeof ASSET_PREFERRED)[number]["value"]>("any");
  const [uploadCaption, setUploadCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [editingAssetId, setEditingAssetId] = useState<number | null>(null);

  const { data: assets, isLoading: assetsLoading } = trpc.linkedinContent.listAssets.useQuery(undefined);
  const editingAsset = assets?.find((a) => a.id === editingAssetId) ?? null;

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
        const sched = (d as any).schedule?.map((s: any) => s.atHkt).join(" · ");
        toast.success(
          `本週內容：新增 ${d.created}，已有 ${d.existing}${used ? `，抽相 ${used} 張` : ""}（${d.weekKey}${
            (d as any).rolledFromPastWeek ? " · 已轉下週時間表" : ""
          }）${sched ? `\n${sched}` : ""}`
        );
        if (d.created > 0) setContentFilter("pending_review");
      }
      utils.linkedinContent.getStats.invalidate();
      utils.linkedinContent.listPosts.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const resetRegen = trpc.linkedinContent.resetAndRegenerate.useMutation({
    onSuccess: (d) => {
      const g = d.generated;
      const sched = g.schedule?.map((s) => s.atHkt).join(" · ") || "";
      toast.success(
        `已取消 ${d.deleted} 篇排程（Buffer ${d.bufferCancelled}）→ 重新生成 ${g.created} 篇（${g.weekKey}）${
          sched ? `\n時間表：${sched}` : ""
        }`
      );
      if (d.bufferErrors?.length) {
        toast.warning(`Buffer 取消部分失敗：${d.bufferErrors.slice(0, 2).join("；")}`);
      }
      setContentFilter("pending_review");
      utils.linkedinContent.getStats.invalidate();
      utils.linkedinContent.listPosts.invalidate();
      utils.linkedinContent.dueToday.invalidate();
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

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("已複製");
    } catch {
      toast.error("複製失敗");
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6 max-w-full overflow-x-hidden">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold text-foreground">LinkedIn 營運</h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1 leading-relaxed">
          內容工廠：每週 3 篇 → 批核 → Buffer → LinkedIn 自動發佈。招聘 DM／聯絡人跟進請去「客戶開拓」。
        </p>
      </div>

      <div className="space-y-4">
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

        {/* Image library — collapsed by default; open = compact scroll grid */}
        <div className="border rounded-lg p-3 sm:p-4 bg-card space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <button
              type="button"
              className="min-w-0 text-left"
              onClick={() => setLibraryOpen((o) => !o)}
            >
              <div className="font-medium text-sm flex flex-wrap items-center gap-2">
                <ImagePlus className="w-4 h-4 shrink-0" style={{ color: "#d4a843" }} />
                圖片庫
                <span className="text-xs font-normal text-muted-foreground">
                  {contentStats?.libraryCount ?? assets?.length ?? 0} 張
                </span>
                <span className="text-xs font-normal text-muted-foreground underline-offset-2 hover:underline">
                  {libraryOpen ? "收起" : "展開管理"}
                </span>
              </div>
              {!libraryOpen && (
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  生成時自動抽相；需要上傳／改主題／移出先展開。
                </p>
              )}
            </button>
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1 w-full sm:w-auto min-h-10"
                disabled={harvestWebsite.isPending}
                onClick={() => {
                  setLibraryOpen(true);
                  harvestWebsite.mutate({ maxNew: 8, preferredFor: uploadPreferred });
                }}
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
                    setLibraryOpen(true);
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

          {libraryOpen && (
            <>
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
                <div className="max-h-56 sm:max-h-64 overflow-y-auto rounded-md border bg-muted/10 p-2">
                  <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-1.5">
                    {assets?.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        title={`#${a.id} · 用過 ${a.timesUsed} 次 · 撳入去改`}
                        className="relative aspect-square rounded border overflow-hidden bg-muted hover:ring-2 hover:ring-[#d4a843]/70 focus:outline-none focus:ring-2 focus:ring-[#d4a843]"
                        onClick={() => setEditingAssetId(a.id)}
                      >
                        <img src={a.url} alt={a.fileName} className="w-full h-full object-cover" loading="lazy" />
                        <span className="absolute bottom-0 inset-x-0 bg-black/55 text-[9px] text-white text-center truncate px-0.5">
                          #{a.id}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
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
              variant="outline"
              className="gap-2 w-full sm:w-auto min-h-10 border-amber-600/40 text-amber-800 dark:text-amber-300"
              disabled={resetRegen.isPending || genWeek.isPending}
              onClick={() => {
                if (
                  confirm(
                    "取消全部未發佈排程（含 Buffer），並按時間表重新生成？\n（Tue 08:00 項目 · Wed 12:00 教育 · Fri 16:00 數據；若本週已過會自動轉下週）"
                  )
                ) {
                  resetRegen.mutate();
                }
              }}
            >
              {resetRegen.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              取消排程並重來
            </Button>
            <Button
              className="gap-2 w-full sm:w-auto min-h-10"
              onClick={() => genWeek.mutate({ force: (contentStats?.weekPending ?? 0) > 0 })}
              disabled={genWeek.isPending || resetRegen.isPending}
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
          <div className="space-y-3">
            {contentList?.posts.map((p) => {
              const media = Array.isArray(p.selectedMedia) ? p.selectedMedia : [];
              const hasMedia = media.length > 0;
              const bufferFailed = p.bufferStatus === "failed";
              const bufferQueued = p.bufferStatus === "queued";
              const needsRepush = p.status === "scheduled" || p.status === "approved";

              return (
                <div key={p.id} className="border rounded-lg bg-card overflow-hidden">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-3 px-3 sm:px-4 pt-3 pb-2">
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className="text-[11px] px-1.5 py-0.5 rounded shrink-0"
                          style={{ background: "#1a1a1a", color: "#d4a843" }}
                        >
                          {p.typeLabel}
                        </span>
                        {bufferQueued ? (
                          <span className="text-[11px] px-1.5 py-0.5 rounded border bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300">
                            Buffer 已排程
                          </span>
                        ) : bufferFailed ? (
                          <span className="text-[11px] px-1.5 py-0.5 rounded border bg-red-50 text-red-800 border-red-200">
                            Buffer 失敗
                          </span>
                        ) : (
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            {p.statusLabel}
                          </span>
                        )}
                      </div>
                      <h3 className="font-medium text-sm leading-snug line-clamp-2">{p.title}</h3>
                    </div>
                    {p.scheduledFor && (
                      <div className="shrink-0 text-right text-[11px] text-muted-foreground leading-tight pt-0.5">
                        <div>排程</div>
                        <div className="tabular-nums">{formatHkt(p.scheduledFor)}</div>
                        <div>HKT</div>
                      </div>
                    )}
                  </div>

                  {/* Body preview */}
                  <p className="px-3 sm:px-4 text-sm text-muted-foreground line-clamp-3 whitespace-pre-wrap break-words">
                    {p.body}
                  </p>

                  {/* Media strip — thumbs only, no filename dump */}
                  <div className="px-3 sm:px-4 mt-2.5 mb-1">
                    {hasMedia ? (
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1.5 overflow-x-auto max-w-full py-0.5">
                          {media.slice(0, 6).map((m: any) => (
                            <a
                              key={`${p.id}-${m.id}-${m.slideOrder}`}
                              href={m.url}
                              target="_blank"
                              rel="noreferrer"
                              className="shrink-0 w-12 h-12 rounded-md border overflow-hidden bg-muted"
                              title={`#${m.id}`}
                            >
                              <img src={m.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                            </a>
                          ))}
                        </div>
                        <span className="text-[11px] text-muted-foreground shrink-0">
                          {media.length > 6 ? `+${media.length - 6}` : `${media.length} 張`}
                        </span>
                      </div>
                    ) : (
                      <p className="text-[11px] text-destructive">未配圖</p>
                    )}
                  </div>

                  {bufferFailed && p.bufferError && (
                    <p className="px-3 sm:px-4 text-[11px] text-destructive line-clamp-2 break-words mb-1">
                      {p.bufferError}
                    </p>
                  )}

                  {/* Actions — one primary + compact secondary */}
                  <div className="flex flex-wrap items-center gap-1.5 px-3 sm:px-4 py-2.5 border-t bg-muted/20">
                    <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setEditingPost(p)}>
                      編輯
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 text-xs gap-1" onClick={() => copy(p.body)}>
                      <Copy className="w-3 h-3" />
                      複製
                    </Button>

                    {p.status === "pending_review" && (
                      <>
                        <Button
                          size="sm"
                          className="h-8 text-xs gap-1 ml-auto"
                          onClick={() => approvePost.mutate({ id: p.id })}
                        >
                          <Check className="w-3 h-3" />
                          批准 → Buffer
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 text-xs text-muted-foreground"
                          onClick={() => rejectPost.mutate({ id: p.id })}
                        >
                          拒絕
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 text-xs text-destructive"
                          onClick={() => {
                            if (confirm("刪除呢篇草稿？")) deletePost.mutate({ id: p.id });
                          }}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </>
                    )}

                    {p.status === "rejected" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-xs text-destructive ml-auto"
                        onClick={() => {
                          if (confirm("刪除呢篇？")) deletePost.mutate({ id: p.id });
                        }}
                      >
                        <Trash2 className="w-3 h-3" />
                        刪除
                      </Button>
                    )}

                    {needsRepush && (
                      <>
                        <Button
                          size="sm"
                          variant={hasMedia && bufferQueued ? "ghost" : "outline"}
                          className="h-8 text-xs gap-1 ml-auto"
                          disabled={pushBuffer.isPending}
                          onClick={() => pushBuffer.mutate({ id: p.id, force: true })}
                        >
                          {pushBuffer.isPending ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <ImagePlus className="w-3 h-3" />
                          )}
                          {!hasMedia ? "補相重推" : bufferFailed ? "重試 Buffer" : "重推 Buffer"}
                        </Button>
                        <Button
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => publishPost.mutate({ id: p.id })}
                        >
                          已發佈
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Asset edit dialog */}
      <Dialog open={!!editingAsset} onOpenChange={(o) => !o && setEditingAssetId(null)}>
        <DialogContent className="max-w-sm p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="text-base">
              圖片 #{editingAsset?.id}
            </DialogTitle>
          </DialogHeader>
          {editingAsset && (
            <div className="space-y-3">
              <a href={editingAsset.url} target="_blank" rel="noreferrer" className="block">
                <img
                  src={editingAsset.url}
                  alt={editingAsset.fileName}
                  className="w-full max-h-48 object-contain rounded border bg-muted"
                />
              </a>
              <p className="text-xs text-muted-foreground truncate" title={editingAsset.fileName}>
                {editingAsset.fileName} · 用過 {editingAsset.timesUsed} 次
              </p>
              <div className="space-y-1">
                <Label className="text-xs">分類</Label>
                <Select
                  value={editingAsset.category}
                  onValueChange={(v) => updateAsset.mutate({ id: editingAsset.id, category: v as any })}
                >
                  <SelectTrigger className="min-h-10">
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
                <Select
                  value={editingAsset.preferredFor}
                  onValueChange={(v) => updateAsset.mutate({ id: editingAsset.id, preferredFor: v as any })}
                >
                  <SelectTrigger className="min-h-10">
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
            </div>
          )}
          <DialogFooter className="gap-2 flex-col-reverse sm:flex-row">
            <Button variant="outline" className="min-h-10" onClick={() => setEditingAssetId(null)}>
              關閉
            </Button>
            <Button
              variant="ghost"
              className="min-h-10 text-destructive gap-1"
              onClick={() => {
                if (!editingAsset) return;
                if (confirm("移出圖片庫？")) {
                  archiveAsset.mutate(
                    { id: editingAsset.id },
                    { onSuccess: () => setEditingAssetId(null) }
                  );
                }
              }}
            >
              <Trash2 className="w-3 h-3" />
              移出
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
    </div>
  );
}
