import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Loader2,
  Play,
  SkipForward,
  Eye,
  Building2,
  ExternalLink,
  Search,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  CheckCircle2,
  MessageCircle,
  Copy,
  Linkedin,
  Trophy,
} from "lucide-react";

type LeadStatus =
  | "all"
  | "pending_email"
  | "pending_review"
  | "approved"
  | "sent"
  | "skipped"
  | "bounced"
  | "replied";

type LeadSource = "all" | "jobsdb" | "linkedin" | "indeed" | "ctgoodjobs";

/** Status semantics for LinkedIn follow-up workflow */
const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending_email: { label: "待跟進", color: "bg-amber-100 text-amber-800" },
  pending_review: { label: "待跟進", color: "bg-amber-100 text-amber-800" },
  approved: { label: "成交", color: "bg-emerald-100 text-emerald-800" },
  sent: { label: "已聯絡", color: "bg-blue-100 text-blue-800" },
  skipped: { label: "已跳過", color: "bg-gray-100 text-gray-600" },
  bounced: { label: "無效", color: "bg-red-100 text-red-800" },
  replied: { label: "有回覆", color: "bg-purple-100 text-purple-800" },
};

const SOURCE_LABELS: Record<string, string> = {
  jobsdb: "JobsDB",
  linkedin: "LinkedIn",
  indeed: "Indeed HK",
  ctgoodjobs: "CTgoodjobs",
};

function linkedInPeopleUrl(companyName: string) {
  const q = `${companyName} HR OR "Talent" OR "Hiring Manager" OR Founder Hong Kong`;
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`;
}

function linkedInCompanyUrl(companyName: string) {
  return `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(companyName)}`;
}

export default function PitchOutreach() {
  const [statusFilter, setStatusFilter] = useState<LeadStatus>("pending_review");
  const [sourceFilter, setSourceFilter] = useState<LeadSource>("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [showDetailDialog, setShowDetailDialog] = useState(false);

  const utils = trpc.useUtils();

  const { data: stats, isLoading: statsLoading } = trpc.pitchOutreach.getStats.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const { data: leadsData, isLoading: leadsLoading } = trpc.pitchOutreach.listLeads.useQuery(
    {
      status: statusFilter === "pending_review" ? "pending_review" : statusFilter,
      source: sourceFilter,
      search: search || undefined,
      page,
      pageSize: 20,
    },
    { refetchInterval: 30000 }
  );

  const runPipeline = trpc.pitchOutreach.runPipeline.useMutation({
    onSuccess: (data) => {
      toast.success(
        `已更新招聘線索：抓取 ${data.scraped} 個職位，新增 ${(data as any).saved ?? 0} 條；過期已清理 ${data.skipped ?? 0} 條`
      );
      utils.pitchOutreach.getStats.invalidate();
      utils.pitchOutreach.listLeads.invalidate();
    },
    onError: (err) => {
      toast.error(`執行失敗：${err.message}`);
    },
  });

  const updateStatus = trpc.pitchOutreach.updateLeadStatus.useMutation({
    onSuccess: (_d, vars) => {
      const msg =
        vars.status === "sent"
          ? "已標記為已聯絡"
          : vars.status === "replied"
            ? "已標記為有回覆"
            : vars.status === "approved"
              ? "已標記為成交"
              : vars.status === "skipped"
                ? "已跳過"
                : "狀態已更新";
      toast.success(msg);
      utils.pitchOutreach.listLeads.invalidate();
      utils.pitchOutreach.getStats.invalidate();
    },
  });

  const regeneratePitch = trpc.pitchOutreach.regeneratePitch.useMutation({
    onSuccess: (data) => {
      toast.success("LinkedIn DM 草稿已生成");
      setSelectedLead((prev: any) =>
        prev ? { ...prev, aiPitchSubject: data.subject, aiPitchBody: data.body } : prev
      );
      utils.pitchOutreach.listLeads.invalidate();
    },
    onError: (err) => {
      toast.error(`生成失敗：${err.message}`);
    },
  });

  const totalPages = Math.ceil((leadsData?.total ?? 0) / 20);

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  const copyDm = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("已複製到剪貼簿");
    } catch {
      toast.error("複製失敗");
    }
  };

  const openDetail = (lead: any) => {
    setSelectedLead(lead);
    setShowDetailDialog(true);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">客戶開拓</h1>
          <p className="text-sm text-muted-foreground mt-1">
            每日掃描 JobsDB / Indeed / CTgoodjobs「請攝影師／攝錄師」公司 → 你用 LinkedIn 聯絡 HR，建議外判畀 JD Studio
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {statsLoading
              ? "載入中..."
              : stats?.lastLeadCreatedAt
                ? `最後更新：${new Date(stats.lastLeadCreatedAt).toLocaleString("zh-HK", {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                    timeZone: "Asia/Hong_Kong",
                  })} HKT`
                : "尚未有資料"}
          </p>
        </div>
        <Button onClick={() => runPipeline.mutate()} disabled={runPipeline.isPending} className="gap-2">
          {runPipeline.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {runPipeline.isPending ? "掃描中..." : "立即掃描職位"}
        </Button>
      </div>

      <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        系統只負責<strong className="text-foreground font-medium">搵訊號</strong>
        （邊間公司而家請 in-house）。聯絡用 LinkedIn DM；已停自動寄冷電郵。
        超過 {(stats as any)?.maxAgeDays ?? 21} 日嘅職位會自動標為已過期並移出「待跟進」。
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "待跟進", value: (stats as any)?.toContact ?? stats?.pendingReview ?? 0, color: "text-amber-600" },
          { label: "今日已聯絡", value: (stats as any)?.todayContacted ?? stats?.todaySent ?? 0, color: "text-blue-600" },
          { label: "已聯絡（總）", value: (stats as any)?.contacted ?? stats?.sent ?? 0, color: "text-blue-600" },
          { label: "有回覆", value: stats?.replied ?? 0, color: "text-purple-600" },
          { label: "成交", value: (stats as any)?.won ?? 0, color: "text-emerald-600" },
          { label: "總線索", value: stats?.total ?? 0, color: "text-foreground" },
        ].map((s) => (
          <div key={s.label} className="bg-card border rounded-lg p-3 text-center">
            <div className={`text-2xl font-bold ${s.color}`}>{statsLoading ? "..." : s.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-2 flex-1 min-w-[200px]">
          <Input
            placeholder="搜尋公司、職位..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="flex-1"
          />
          <Button variant="outline" size="icon" onClick={handleSearch}>
            <Search className="w-4 h-4" />
          </Button>
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v as LeadStatus);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="狀態" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部狀態</SelectItem>
            <SelectItem value="pending_review">待跟進</SelectItem>
            <SelectItem value="sent">已聯絡</SelectItem>
            <SelectItem value="replied">有回覆</SelectItem>
            <SelectItem value="approved">成交</SelectItem>
            <SelectItem value="skipped">已跳過</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={sourceFilter}
          onValueChange={(v) => {
            setSourceFilter(v as LeadSource);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="來源" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部來源</SelectItem>
            <SelectItem value="jobsdb">JobsDB</SelectItem>
            <SelectItem value="indeed">Indeed HK</SelectItem>
            <SelectItem value="linkedin">LinkedIn</SelectItem>
            <SelectItem value="ctgoodjobs">CTgoodjobs</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium">公司</th>
                <th className="text-left p-3 font-medium">職位</th>
                <th className="text-left p-3 font-medium">來源</th>
                <th className="text-left p-3 font-medium">狀態</th>
                <th className="text-left p-3 font-medium">跟進</th>
              </tr>
            </thead>
            <tbody>
              {leadsLoading ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-muted-foreground">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                    載入中...
                  </td>
                </tr>
              ) : leadsData?.leads.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-muted-foreground">
                    <Building2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    暫無記錄 — 撳「立即掃描職位」或等每日排程
                  </td>
                </tr>
              ) : (
                leadsData?.leads.map((lead) => {
                  const statusInfo = STATUS_LABELS[lead.status] ?? {
                    label: lead.status,
                    color: "bg-gray-100 text-gray-600",
                  };
                  const isOpen = lead.status === "pending_review" || lead.status === "pending_email";
                  return (
                    <tr key={lead.id} className="border-b hover:bg-muted/30 transition-colors">
                      <td className="p-3">
                        <div className="font-medium text-foreground">{lead.companyName}</div>
                      </td>
                      <td className="p-3">
                        <div className="text-foreground">{lead.jobTitle}</div>
                        {lead.jobUrl ? (
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            <a
                              href={(lead as any).jobLinkUrl || lead.jobUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-500 hover:underline inline-flex items-center gap-1"
                            >
                              <ExternalLink className="w-3 h-3" />
                              {(lead as any).isExpired ? "搜尋公司職位" : "查看職位"}
                            </a>
                            {(lead as any).isExpired && (
                              <span className="text-xs text-amber-600">已過期</span>
                            )}
                          </div>
                        ) : null}
                      </td>
                      <td className="p-3">
                        <span className="text-xs bg-muted px-2 py-0.5 rounded">
                          {SOURCE_LABELS[lead.source] ?? lead.source}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-col gap-1">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium w-fit ${statusInfo.color}`}>
                            {lead.status === "skipped" && String(lead.notes || "").includes("expired")
                              ? "已過期"
                              : statusInfo.label}
                          </span>
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 text-xs"
                            asChild
                          >
                            <a href={linkedInPeopleUrl(lead.companyName)} target="_blank" rel="noopener noreferrer">
                              <Linkedin className="w-3.5 h-3.5" />
                              搵人
                            </a>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="詳情／DM 草稿"
                            onClick={() => openDetail(lead)}
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                          {isOpen && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-blue-600"
                              title="標記已聯絡（LinkedIn）"
                              onClick={() => updateStatus.mutate({ id: lead.id, status: "sent" })}
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {(isOpen || lead.status === "sent") && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-purple-600"
                              title="有回覆"
                              onClick={() => updateStatus.mutate({ id: lead.id, status: "replied" })}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {(lead.status === "sent" || lead.status === "replied") && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-emerald-600"
                              title="成交"
                              onClick={() => updateStatus.mutate({ id: lead.id, status: "approved" })}
                            >
                              <Trophy className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {lead.status !== "skipped" && lead.status !== "approved" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-gray-400"
                              title="跳過"
                              onClick={() => updateStatus.mutate({ id: lead.id, status: "skipped" })}
                            >
                              <SkipForward className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between p-3 border-t">
            <span className="text-sm text-muted-foreground">
              共 {leadsData?.total ?? 0} 筆，第 {page} / {totalPages} 頁
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedLead?.companyName}</DialogTitle>
          </DialogHeader>
          {selectedLead && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">職位：</span>
                  <span className="font-medium">{selectedLead.jobTitle}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">來源：</span>
                  <span>{SOURCE_LABELS[selectedLead.source]}</span>
                </div>
                <div className="col-span-2 flex flex-wrap gap-2">
                  {selectedLead.jobUrl && (
                    <Button variant="outline" size="sm" className="gap-1" asChild>
                      <a
                        href={(selectedLead as any).jobLinkUrl || selectedLead.jobUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        {(selectedLead as any).isExpired ? "搜尋公司職位（原連結或已下架）" : "職位連結"}
                      </a>
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="gap-1" asChild>
                    <a
                      href={linkedInPeopleUrl(selectedLead.companyName)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Linkedin className="w-3.5 h-3.5" />
                      LinkedIn 搵 HR
                    </a>
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1" asChild>
                    <a
                      href={linkedInCompanyUrl(selectedLead.companyName)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Building2 className="w-3.5 h-3.5" />
                      公司頁搜尋
                    </a>
                  </Button>
                </div>
              </div>

              {selectedLead.jobDescription && (
                <div>
                  <Label className="text-muted-foreground text-xs">職位描述</Label>
                  <div className="mt-1 text-sm bg-muted/50 rounded p-3 max-h-32 overflow-y-auto whitespace-pre-wrap">
                    {selectedLead.jobDescription}
                  </div>
                </div>
              )}

              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-2">
                  <Label className="font-medium">LinkedIn DM 草稿</Label>
                  <div className="flex gap-2">
                    {selectedLead.aiPitchBody && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1"
                        onClick={() => copyDm(selectedLead.aiPitchBody)}
                      >
                        <Copy className="w-3 h-3" />
                        複製
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      onClick={() => regeneratePitch.mutate({ id: selectedLead.id })}
                      disabled={regeneratePitch.isPending}
                    >
                      {regeneratePitch.isPending ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Sparkles className="w-3 h-3" />
                      )}
                      {selectedLead.aiPitchBody ? "重新生成" : "生成草稿"}
                    </Button>
                  </div>
                </div>
                {selectedLead.aiPitchBody ? (
                  <div className="space-y-2">
                    {selectedLead.aiPitchSubject && (
                      <div className="text-sm">
                        <span className="text-muted-foreground">開場：</span>
                        <span className="font-medium">{selectedLead.aiPitchSubject}</span>
                      </div>
                    )}
                    <div className="text-sm bg-muted/50 rounded p-3 whitespace-pre-wrap max-h-48 overflow-y-auto">
                      {selectedLead.aiPitchBody}
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground italic">尚未生成 — 撳「生成草稿」再貼去 LinkedIn</div>
                )}
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setShowDetailDialog(false)}>
              關閉
            </Button>
            {selectedLead &&
              (selectedLead.status === "pending_review" || selectedLead.status === "pending_email") && (
                <Button
                  className="gap-2"
                  onClick={() => {
                    updateStatus.mutate({ id: selectedLead.id, status: "sent" });
                    setShowDetailDialog(false);
                  }}
                >
                  <MessageCircle className="w-4 h-4" />
                  已發 LinkedIn → 標記已聯絡
                </Button>
              )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
