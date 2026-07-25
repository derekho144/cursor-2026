import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Mail,
  RefreshCw,
  Settings,
  CheckCircle2,
  Clock,
  XCircle,
  SkipForward,
  Send,
  Info,
  Ban,
  PlayCircle,
} from "lucide-react";

const STATUS_CONFIG = {
  pending: { label: "等待跟進", color: "bg-amber-500/15 text-amber-400 border-amber-500/30", icon: Clock },
  sent: { label: "已發送", color: "bg-blue-500/15 text-blue-400 border-blue-500/30", icon: Send },
  replied: { label: "已回覆", color: "bg-green-500/15 text-green-400 border-green-500/30", icon: CheckCircle2 },
  skipped: { label: "已跳過", color: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30", icon: XCircle },
};

function formatDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("zh-HK", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function daysSince(d: Date | string | null | undefined) {
  if (!d) return null;
  const diff = Date.now() - new Date(d).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export default function QuoteFollowUpPage() {
  const utils = trpc.useUtils();

  // Settings
  const { data: settings, isLoading: settingsLoading } = trpc.followUp.getSettings.useQuery();
  const updateSettings = trpc.followUp.updateSettings.useMutation({
    onSuccess: () => {
      utils.followUp.getSettings.invalidate();
      toast.success("設定已儲存");
    },
    onError: (e) => toast.error(`儲存失敗：${e.message}`),
  });

  // List
  const [statusFilter, setStatusFilter] = useState<"pending" | "sent" | "replied" | "skipped" | undefined>(undefined);
  const { data: listData, isLoading: listLoading } = trpc.followUp.getList.useQuery({
    status: statusFilter,
    limit: 50,
    offset: 0,
  });

  // Actions
  const skipMutation = trpc.followUp.skip.useMutation({
    onSuccess: () => {
      utils.followUp.getList.invalidate();
      toast.success("已標記為跳過");
    },
  });
  const triggerScan = trpc.followUp.triggerScan.useMutation({
    onSuccess: (r) => {
      utils.followUp.getList.invalidate();
      toast.success(`掃描完成：發現 ${r.found} 封報價郵件，新增 ${r.newTracked} 筆跟進記錄`);
    },
    onError: (e) => toast.error(`掃描失敗：${e.message}`),
  });
  const triggerSend = trpc.followUp.triggerSend.useMutation({
    onSuccess: (r) => {
      utils.followUp.getList.invalidate();
      toast.success(`跟進完成：發送 ${r.sent} 封，跳過 ${r.skipped} 封`);
    },
    onError: (e) => toast.error(`發送失敗：${e.message}`),
  });

  // Settings form state
  const [localSettings, setLocalSettings] = useState<{
    enabled: boolean;
    daysAfterSent: number;
    emailSubjectTemplate: string;
    emailBodyTemplate: string;
    sendTimeHktStart: number;
    sendTimeHktEnd: number;
  } | null>(null);

  // Sync settings to local state when loaded
  if (settings && !localSettings) {
    setLocalSettings({
      enabled: settings.enabled,
      daysAfterSent: settings.daysAfterSent,
      emailSubjectTemplate: settings.emailSubjectTemplate,
      emailBodyTemplate: settings.emailBodyTemplate,
      sendTimeHktStart: settings.sendTimeHktStart,
      sendTimeHktEnd: settings.sendTimeHktEnd,
    });
  }

  const toggleStopFollowUp = trpc.followUp.toggleStopFollowUp.useMutation({
    onSuccess: (r) => {
      utils.followUp.getList.invalidate();
      toast.success(r.stopFollowUp ? "已停止跟進此報價單" : "已恢復跟進此報價單");
    },
    onError: (e) => toast.error(`操作失敗：${e.message}`),
  });

  const [skipDialogId, setSkipDialogId] = useState<number | null>(null);
  const [skipNotes, setSkipNotes] = useState("");

  const items = listData?.data ?? [];
  const total = listData?.total ?? 0;
  const pendingCount = items.filter((i) => i.status === "pending").length;

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-light tracking-wide" style={{ color: "#d4a843" }}>
              報價跟進
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              自動偵測已發送報價但未收到回覆的郵件，並在指定天數後發送跟進郵件
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => triggerScan.mutate()}
              disabled={triggerScan.isPending}
              className="flex-1 sm:flex-none"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${triggerScan.isPending ? "animate-spin" : ""}`} />
              揃描標籤
            </Button>
            <Button
              size="sm"
              onClick={() => triggerSend.mutate()}
              disabled={triggerSend.isPending || pendingCount === 0}
              style={{ background: "#d4a843", color: "#0a0a0a" }}
              className="flex-1 sm:flex-none"
            >
              <Send className="h-4 w-4 mr-2" />
              發送跟進 ({pendingCount})
            </Button>
          </div>
        </div>

        {/* Info banner */}
        <div
          className="flex items-start gap-3 p-4 rounded-lg border text-sm"
          style={{ background: "rgba(212,168,67,0.06)", borderColor: "rgba(212,168,67,0.2)" }}
        >
          <Info className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "#d4a843" }} />
          <div className="text-muted-foreground leading-relaxed">
            <strong className="text-foreground">運作方式：</strong>
            系統每小時自動掃描 Gmail 中帶有 <strong>jd-followup</strong> 標籤的郵件，找出需要跟進的客人，並在原有 email thread 內發送跟進郵件。若客人已回覆，系統自動停止跟進。
            <br />
            <strong className="text-foreground mt-1 block">使用方法：</strong>
            在 Gmail 建立標籤 <strong>jd-followup</strong>，然後對需要跟進的客人郵件（INBOX 或 Sent Box 皆可）貼上此標籤，系統即會自動追蹤。
          </div>
        </div>

        <Tabs defaultValue="records">
          <TabsList>
            <TabsTrigger value="records">跟進記錄</TabsTrigger>
            <TabsTrigger value="settings">
              <Settings className="h-3.5 w-3.5 mr-1.5" />
              設定
            </TabsTrigger>
          </TabsList>

          {/* Records Tab */}
          <TabsContent value="records" className="mt-4 space-y-4">
            {/* Status filter */}
            <div className="flex gap-2 flex-wrap">
              {([undefined, "pending", "sent", "replied", "skipped"] as const).map((s) => (
                <Button
                  key={String(s)}
                  variant={statusFilter === s ? "default" : "outline"}
                  size="sm"
                  onClick={() => setStatusFilter(s)}
                  style={statusFilter === s ? { background: "#d4a843", color: "#0a0a0a" } : {}}
                >
                  {s === undefined ? "全部" : STATUS_CONFIG[s].label}
                </Button>
              ))}
            </div>

            <Card style={{ background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.08)" }}>
              <CardContent className="p-0">
                {listLoading ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">載入中...</div>
                ) : items.length === 0 ? (
                  <div className="p-12 text-center space-y-3">
                    <Mail className="h-10 w-10 text-muted-foreground mx-auto opacity-40" />
                    <p className="text-muted-foreground text-sm">
                      {statusFilter ? `沒有「${STATUS_CONFIG[statusFilter].label}」的記錄` : "尚無跟進記錄"}
                    </p>
                    <p className="text-xs text-muted-foreground opacity-60">
                      在 Gmail 對需要跟進的客人郵件貼上 jd-followup 標籤，系統會自動追蹤
                    </p>
                  </div>
                ) : (
                  <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                    {items.map((item) => {
                      const cfg = STATUS_CONFIG[item.status];
                      const StatusIcon = cfg.icon;
                      const days = daysSince(item.sentAt);
                      const isStopped = item.stopFollowUp;
                      return (
                        <div key={item.id} className="p-4 space-y-3">
                          {/* Row 1: Name + Status + Stop badge */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="font-medium text-sm truncate">{item.toName || item.toEmail}</div>
                              {item.toName && (
                                <div className="text-xs text-muted-foreground truncate">{item.toEmail}</div>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {isStopped ? (
                                <Badge variant="outline" className="text-xs gap-1 bg-red-500/10 text-red-400 border-red-500/30">
                                  <Ban className="h-3 w-3" />
                                  已停止
                                </Badge>
                              ) : (
                                <Badge variant="outline" className={`text-xs gap-1 ${cfg.color}`}>
                                  <StatusIcon className="h-3 w-3" />
                                  {cfg.label}
                                </Badge>
                              )}
                            </div>
                          </div>

                          {/* Row 2: Subject */}
                          <div className="text-xs text-muted-foreground truncate" title={item.subject}>
                            {item.subject}
                          </div>

                          {/* Row 3: Dates + Days */}
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span>報價發送：{formatDate(item.sentAt)}</span>
                            {item.followUpSentAt && (
                              <span>跟進發送：{formatDate(item.followUpSentAt)}</span>
                            )}
                            {days !== null && !isStopped && (
                              <span
                                className={
                                  days >= (settings?.daysAfterSent ?? 3) && item.status === "pending"
                                    ? "text-amber-400 font-medium"
                                    : ""
                                }
                              >
                                等待 {days} 天
                              </span>
                            )}
                          </div>

                          {/* Row 4: Action buttons */}
                          <div className="flex gap-2 flex-wrap">
                            {item.status === "pending" && !isStopped && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-muted-foreground hover:text-foreground"
                                onClick={() => {
                                  setSkipDialogId(item.id);
                                  setSkipNotes("");
                                }}
                              >
                                <SkipForward className="h-3 w-3 mr-1" />
                                跳過
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className={`h-7 text-xs ${
                                isStopped
                                  ? "text-green-400 hover:text-green-300"
                                  : "text-red-400 hover:text-red-300"
                              }`}
                              disabled={toggleStopFollowUp.isPending}
                              onClick={() =>
                                toggleStopFollowUp.mutate({
                                  followUpId: item.id,
                                  stopFollowUp: !isStopped,
                                })
                              }
                            >
                              {isStopped ? (
                                <><PlayCircle className="h-3 w-3 mr-1" />恢復跟進</>
                              ) : (
                                <><Ban className="h-3 w-3 mr-1" />停止跟進</>
                              )}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
            {total > 0 && (
              <p className="text-xs text-muted-foreground text-right">共 {total} 筆記錄</p>
            )}
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings" className="mt-4">
            {settingsLoading || !localSettings ? (
              <div className="p-8 text-center text-muted-foreground text-sm">載入中...</div>
            ) : (
              <div className="grid gap-6 max-w-2xl">
                <Card style={{ background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.08)" }}>
                  <CardHeader>
                    <CardTitle className="text-base font-light">基本設定</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    {/* Enable toggle */}
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm">啟用自動跟進</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          關閉後系統不會自動發送跟進郵件，但仍會繼續掃描和記錄
                        </p>
                      </div>
                      <Switch
                        checked={localSettings.enabled}
                        onCheckedChange={(v) => setLocalSettings({ ...localSettings, enabled: v })}
                      />
                    </div>

                    {/* Days after sent */}
                    <div className="space-y-1.5">
                      <Label className="text-sm">報價發送後幾天沒回覆才跟進</Label>
                      <div className="flex items-center gap-3">
                        <Input
                          type="number"
                          min={1}
                          max={30}
                          value={localSettings.daysAfterSent}
                          onChange={(e) =>
                            setLocalSettings({ ...localSettings, daysAfterSent: Number(e.target.value) })
                          }
                          className="w-24"
                          style={{ background: "rgba(255,255,255,0.05)" }}
                        />
                        <span className="text-sm text-muted-foreground">天（建議 3–5 天）</span>
                      </div>
                    </div>

                    {/* Send time */}
                    <div className="space-y-1.5">
                      <Label className="text-sm">發送時段（HKT）</Label>
                      <div className="flex items-center gap-3">
                        <Input
                          type="number"
                          min={0}
                          max={23}
                          value={localSettings.sendTimeHktStart}
                          onChange={(e) =>
                            setLocalSettings({ ...localSettings, sendTimeHktStart: Number(e.target.value) })
                          }
                          className="w-20"
                          style={{ background: "rgba(255,255,255,0.05)" }}
                        />
                        <span className="text-sm text-muted-foreground">時 至</span>
                        <Input
                          type="number"
                          min={1}
                          max={24}
                          value={localSettings.sendTimeHktEnd}
                          onChange={(e) =>
                            setLocalSettings({ ...localSettings, sendTimeHktEnd: Number(e.target.value) })
                          }
                          className="w-20"
                          style={{ background: "rgba(255,255,255,0.05)" }}
                        />
                        <span className="text-sm text-muted-foreground">時（建議 10:00–18:00）</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card style={{ background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.08)" }}>
                  <CardHeader>
                    <CardTitle className="text-base font-light">郵件模板</CardTitle>
                    <CardDescription className="text-xs">
                      可用變數：<code className="text-amber-400">{"{{client_name}}"}</code>（收件人名稱）、
                      <code className="text-amber-400">{"{{original_subject}}"}</code>（原郵件主題）、
                      <code className="text-amber-400">{"{{sent_date}}"}</code>（報價發送日期）
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                      <Label className="text-sm">郵件主題</Label>
                      <Input
                        value={localSettings.emailSubjectTemplate}
                        onChange={(e) =>
                          setLocalSettings({ ...localSettings, emailSubjectTemplate: e.target.value })
                        }
                        style={{ background: "rgba(255,255,255,0.05)" }}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm">郵件正文</Label>
                      <Textarea
                        value={localSettings.emailBodyTemplate}
                        onChange={(e) =>
                          setLocalSettings({ ...localSettings, emailBodyTemplate: e.target.value })
                        }
                        rows={12}
                        className="font-mono text-xs leading-relaxed"
                        style={{ background: "rgba(255,255,255,0.05)" }}
                      />
                    </div>
                  </CardContent>
                </Card>

                <Button
                  onClick={() => updateSettings.mutate(localSettings)}
                  disabled={updateSettings.isPending}
                  style={{ background: "#d4a843", color: "#0a0a0a", width: "fit-content" }}
                >
                  {updateSettings.isPending ? "儲存中..." : "儲存設定"}
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Skip Dialog */}
      <Dialog open={skipDialogId !== null} onOpenChange={() => setSkipDialogId(null)}>
        <DialogContent style={{ background: "#1a1a1a", borderColor: "rgba(255,255,255,0.1)" }}>
          <DialogHeader>
            <DialogTitle className="font-light">跳過此跟進</DialogTitle>
            <DialogDescription>
              此記錄將標記為「已跳過」，系統不會再自動發送跟進郵件。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-sm">備注（選填）</Label>
            <Textarea
              value={skipNotes}
              onChange={(e) => setSkipNotes(e.target.value)}
              placeholder="例如：客人已口頭確認不需要、已透過 WhatsApp 跟進..."
              rows={3}
              style={{ background: "rgba(255,255,255,0.05)" }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSkipDialogId(null)}>
              取消
            </Button>
            <Button
              onClick={() => {
                if (skipDialogId !== null) {
                  skipMutation.mutate({ id: skipDialogId, notes: skipNotes || undefined });
                  setSkipDialogId(null);
                }
              }}
              disabled={skipMutation.isPending}
            >
              確認跳過
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
