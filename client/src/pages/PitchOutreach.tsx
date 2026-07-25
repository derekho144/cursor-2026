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
  Mail,
  SkipForward,
  Eye,
  Send,
  Building2,
  ExternalLink,
  Search,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  UserSearch,
  CheckCircle2,
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

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending_email: { label: "搜尋Email中", color: "bg-yellow-100 text-yellow-800" },
  pending_review: { label: "待發送", color: "bg-blue-100 text-blue-800" },
  approved: { label: "已審核", color: "bg-green-100 text-green-800" },
  sent: { label: "已發送", color: "bg-emerald-100 text-emerald-800" },
  skipped: { label: "已跳過", color: "bg-gray-100 text-gray-600" },
  bounced: { label: "退信", color: "bg-red-100 text-red-800" },
  replied: { label: "已回覆", color: "bg-purple-100 text-purple-800" },
};

const SOURCE_LABELS: Record<string, string> = {
  jobsdb: "JobsDB",
  linkedin: "LinkedIn",
  indeed: "Indeed HK",
  ctgoodjobs: "CTgoodjobs",
};

const FOUND_VIA_LABELS: Record<string, string> = {
  job_ad: "職位廣告",
  company_website: "公司官網",
  hunter_io: "Hunter.io",
  snovio: "Snov.io",
  website: "公司官網",
  smtp_guess: "SMTP 驗證",
  manual: "手動填入",
  decision_maker_website: "官網決策者",
};

type EmailCandidate = { email: string; name?: string; position?: string; foundVia: string; confidence?: number };
type EmailSearchResult = { candidates: EmailCandidate[]; hasHunterKey: boolean; searchedLayers?: string[]; domain?: string };

export default function PitchOutreach() {
  const [statusFilter, setStatusFilter] = useState<LeadStatus>("all");
  const [sourceFilter, setSourceFilter] = useState<LeadSource>("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [editEmail, setEditEmail] = useState("");
  const [editName, setEditName] = useState("");

  // Email search state
  const [showEmailSearchDialog, setShowEmailSearchDialog] = useState(false);
  const [emailSearchLeadId, setEmailSearchLeadId] = useState<number | null>(null);
  const [emailCandidates, setEmailCandidates] = useState<EmailCandidate[]>([]);
  const [isSearchingEmail, setIsSearchingEmail] = useState(false);
  const [selectedCandidateEmail, setSelectedCandidateEmail] = useState<string>("");

  const utils = trpc.useUtils();

  const { data: stats, isLoading: statsLoading } = trpc.pitchOutreach.getStats.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const { data: leadsData, isLoading: leadsLoading } = trpc.pitchOutreach.listLeads.useQuery(
    {
      status: statusFilter,
      source: sourceFilter,
      search: search || undefined,
      page,
      pageSize: 20,
    },
    { refetchInterval: 30000 }
  );

  const runPipeline = trpc.pitchOutreach.runPipeline.useMutation({
    onSuccess: (data) => {
      toast.success(`流程執行完成：抓取 ${data.scraped} 個職位，找到 ${data.emailsFound} 個 email，發送 ${data.sent} 封`);
      utils.pitchOutreach.getStats.invalidate();
      utils.pitchOutreach.listLeads.invalidate();
    },
    onError: (err) => {
      toast.error(`執行失敗：${err.message}`);
    },
  });

  const updateStatus = trpc.pitchOutreach.updateLeadStatus.useMutation({
    onSuccess: () => {
      utils.pitchOutreach.listLeads.invalidate();
      utils.pitchOutreach.getStats.invalidate();
    },
  });

  const updateEmail = trpc.pitchOutreach.updateLeadEmail.useMutation({
    onSuccess: () => {
      toast.success("Email 已更新");
      setShowEmailDialog(false);
      setShowEmailSearchDialog(false);
      utils.pitchOutreach.listLeads.invalidate();
    },
    onError: (err) => {
      toast.error(`更新失敗：${err.message}`);
    },
  });

  const regeneratePitch = trpc.pitchOutreach.regeneratePitch.useMutation({
    onSuccess: (data) => {
      toast.success("AI 內容已重新生成");
      setSelectedLead((prev: any) =>
        prev ? { ...prev, aiPitchSubject: data.subject, aiPitchBody: data.body } : prev
      );
      utils.pitchOutreach.listLeads.invalidate();
    },
    onError: (err) => {
      toast.error(`生成失敗：${err.message}`);
    },
  });

  const sendPitch = trpc.pitchOutreach.sendPitch.useMutation({
    onSuccess: () => {
      toast.success("Email 已發送");
      setShowDetailDialog(false);
      utils.pitchOutreach.listLeads.invalidate();
      utils.pitchOutreach.getStats.invalidate();
    },
    onError: (err) => {
      toast.error(`發送失敗：${err.message}`);
    },
  });

  const [searchedLayers, setSearchedLayers] = useState<string[]>([]);
  const [searchDomain, setSearchDomain] = useState<string | undefined>();

  const findEmailMutation = trpc.pitchOutreach.findEmailForLead.useMutation({
    onSuccess: (data) => {
      setIsSearchingEmail(false);
      setEmailCandidates(data.candidates);
      setSearchedLayers((data as any).searchedLayers ?? []);
      setSearchDomain((data as any).domain);
      if (data.candidates.length === 0) {
        toast.info("未找到任何電郵，請手動填入");
      } else {
        setSelectedCandidateEmail(data.candidates[0].email);
        toast.success(`找到 ${data.candidates.length} 個候選電郵`);
      }
    },
    onError: (err) => {
      setIsSearchingEmail(false);
      toast.error(`搜尋失敗：${err.message}`);
    },
  });

  const handleSearchEmail = (lead: any) => {
    setEmailSearchLeadId(lead.id);
    setEmailCandidates([]);
    setSelectedCandidateEmail("");
    setSearchedLayers([]);
    setSearchDomain(undefined);
    setIsSearchingEmail(true);
    setShowEmailSearchDialog(true);
    findEmailMutation.mutate({ id: lead.id });
  };

  const handleConfirmEmailSelection = () => {
    if (!emailSearchLeadId || !selectedCandidateEmail) return;
    const candidate = emailCandidates.find(c => c.email === selectedCandidateEmail);
    updateEmail.mutate({
      id: emailSearchLeadId,
      contactEmail: selectedCandidateEmail,
      contactName: candidate?.name,
    });
  };

  const totalPages = Math.ceil((leadsData?.total ?? 0) / 20);

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">客戶開拓</h1>
          <p className="text-sm text-muted-foreground mt-1">
            自動從招聘網站搜尋有攝影需求的公司，發送合作邀請
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {statsLoading ? "載入中..." : stats?.lastLeadCreatedAt
              ? `最後更新：${new Date(stats.lastLeadCreatedAt).toLocaleString("zh-HK", {
                  year: "numeric", month: "2-digit", day: "2-digit",
                  hour: "2-digit", minute: "2-digit", hour12: false,
                  timeZone: "Asia/Hong_Kong",
                })} HKT`
              : "尚未有資料"
            }
          </p>
        </div>
        <Button
          onClick={() => runPipeline.mutate()}
          disabled={runPipeline.isPending}
          className="gap-2"
        >
          {runPipeline.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4" />
          )}
          {runPipeline.isPending ? "執行中..." : "立即執行"}
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: "今日已發", value: stats?.todaySent ?? 0, sub: `/ ${stats?.dailyLimit ?? 10} 封`, color: "text-blue-600" },
          { label: "總 Leads", value: stats?.total ?? 0, color: "text-foreground" },
          { label: "搜尋Email中", value: stats?.pendingEmail ?? 0, color: "text-yellow-600" },
          { label: "待發送", value: stats?.pendingReview ?? 0, color: "text-blue-600" },
          { label: "已發送", value: stats?.sent ?? 0, color: "text-emerald-600" },
          { label: "已跳過", value: stats?.skipped ?? 0, color: "text-gray-500" },
          { label: "已回覆", value: stats?.replied ?? 0, color: "text-purple-600" },
        ].map((s) => (
          <div key={s.label} className="bg-card border rounded-lg p-3 text-center">
            <div className={`text-2xl font-bold ${s.color}`}>{statsLoading ? "..." : s.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
            {s.sub && <div className="text-xs text-muted-foreground">{s.sub}</div>}
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-2 flex-1 min-w-[200px]">
          <Input
            placeholder="搜尋公司、職位、Email..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="flex-1"
          />
          <Button variant="outline" size="icon" onClick={handleSearch}>
            <Search className="w-4 h-4" />
          </Button>
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as LeadStatus); setPage(1); }}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="狀態" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部狀態</SelectItem>
            <SelectItem value="pending_email">搜尋Email中</SelectItem>
            <SelectItem value="pending_review">待發送</SelectItem>
            <SelectItem value="sent">已發送</SelectItem>
            <SelectItem value="skipped">已跳過</SelectItem>
            <SelectItem value="replied">已回覆</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={(v) => { setSourceFilter(v as LeadSource); setPage(1); }}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="來源" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部來源</SelectItem>
            <SelectItem value="jobsdb">JobsDB</SelectItem>
            <SelectItem value="linkedin">LinkedIn</SelectItem>
            <SelectItem value="indeed">Indeed HK</SelectItem>
            <SelectItem value="ctgoodjobs">CTgoodjobs</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium">公司</th>
                <th className="text-left p-3 font-medium">職位</th>
                <th className="text-left p-3 font-medium">來源</th>
                <th className="text-left p-3 font-medium">聯絡 Email</th>
                <th className="text-left p-3 font-medium">狀態</th>
                <th className="text-left p-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {leadsLoading ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-muted-foreground">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                    載入中...
                  </td>
                </tr>
              ) : leadsData?.leads.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-muted-foreground">
                    <Building2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    暫無記錄
                  </td>
                </tr>
              ) : (
                leadsData?.leads.map((lead) => {
                  const statusInfo = STATUS_LABELS[lead.status] ?? { label: lead.status, color: "bg-gray-100 text-gray-600" };
                  return (
                    <tr key={lead.id} className="border-b hover:bg-muted/30 transition-colors">
                      <td className="p-3">
                        <div className="font-medium text-foreground">{lead.companyName}</div>
                        {lead.companyWebsite && (
                          <a
                            href={lead.companyWebsite}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-500 hover:underline flex items-center gap-1 mt-0.5"
                          >
                            <ExternalLink className="w-3 h-3" />
                            {lead.companyDomain}
                          </a>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="text-foreground">{lead.jobTitle}</div>
                        {lead.jobUrl ? (() => {
                          const isJobsDB = lead.source === "jobsdb";
                          const isExpired = isJobsDB && lead.createdAt &&
                            Date.now() - new Date(lead.createdAt).getTime() > 30 * 24 * 60 * 60 * 1000;
                          const href = isExpired
                            ? `https://hk.jobsdb.com/jobs?q=${encodeURIComponent(lead.companyName)}`
                            : lead.jobUrl;
                          return (
                            <div className="flex items-center gap-1">
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-500 hover:underline"
                                title={isExpired ? `職位已下架，轉跳至 ${lead.companyName} 的 JobsDB 搜尋頁` : undefined}
                              >
                                {isExpired ? "🔍 搜尋公司職位" : "查看職位"}
                              </a>
                              {isExpired && (
                                <span className="text-xs text-amber-500">⚠ 已下架</span>
                              )}
                            </div>
                          );
                        })() : (
                          <span className="text-xs text-muted-foreground">無連結</span>
                        )}
                      </td>
                      <td className="p-3">
                        <span className="text-xs bg-muted px-2 py-0.5 rounded">
                          {SOURCE_LABELS[lead.source] ?? lead.source}
                        </span>
                      </td>
                      <td className="p-3">
                        {lead.contactEmail ? (
                          <div>
                            <div className="text-foreground text-xs">{lead.contactEmail}</div>
                            {lead.contactName && (
                              <div className="text-xs text-muted-foreground">{lead.contactName}</div>
                            )}
                            {lead.emailFoundVia && (
                              <div className="text-xs text-muted-foreground/60">
                                via {FOUND_VIA_LABELS[lead.emailFoundVia] ?? lead.emailFoundVia}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex flex-col gap-1">
                            <button
                              className="text-xs text-amber-600 hover:text-amber-700 hover:underline flex items-center gap-1 font-medium"
                              onClick={() => handleSearchEmail(lead)}
                            >
                              <UserSearch className="w-3 h-3" />
                              搜尋 HR/CEO 電郵
                            </button>
                            <button
                              className="text-xs text-blue-500 hover:underline"
                              onClick={() => {
                                setSelectedLead(lead);
                                setEditEmail("");
                                setEditName("");
                                setShowEmailDialog(true);
                              }}
                            >
                              + 手動填入
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="p-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusInfo.color}`}>
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="查看詳情"
                            onClick={() => {
                              setSelectedLead(lead);
                              setShowDetailDialog(true);
                            }}
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                          {/* Search email button in action column for pending_email leads */}
                          {lead.status === "pending_email" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-amber-600"
                              title="搜尋 HR/CEO 電郵"
                              onClick={() => handleSearchEmail(lead)}
                              disabled={isSearchingEmail && emailSearchLeadId === lead.id}
                            >
                              {isSearchingEmail && emailSearchLeadId === lead.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <UserSearch className="w-3.5 h-3.5" />
                              )}
                            </Button>
                          )}
                          {lead.status === "pending_review" && lead.contactEmail && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-emerald-600"
                              title="立即發送"
                              onClick={() => sendPitch.mutate({ id: lead.id })}
                              disabled={sendPitch.isPending}
                            >
                              <Send className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {lead.status !== "skipped" && lead.status !== "sent" && (
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
                          {lead.status === "sent" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-purple-600"
                              title="標記為已回覆"
                              onClick={() => updateStatus.mutate({ id: lead.id, status: "replied" })}
                            >
                              <Mail className="w-3.5 h-3.5" />
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

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between p-3 border-t">
            <span className="text-sm text-muted-foreground">
              共 {leadsData?.total ?? 0} 筆，第 {page} / {totalPages} 頁
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
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

      {/* Detail Dialog */}
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
                <div>
                  <span className="text-muted-foreground">聯絡 Email：</span>
                  <span className="font-medium">{selectedLead.contactEmail ?? "未找到"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Email 來源：</span>
                  <span>{selectedLead.emailFoundVia ? (FOUND_VIA_LABELS[selectedLead.emailFoundVia] ?? selectedLead.emailFoundVia) : "-"}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">職位連結：</span>
                  {selectedLead.jobUrl ? (() => {
                    const isJobsDB = selectedLead.source === "jobsdb";
                    const isExpired = isJobsDB && selectedLead.createdAt &&
                      Date.now() - new Date(selectedLead.createdAt).getTime() > 30 * 24 * 60 * 60 * 1000;
                    const href = isExpired
                      ? `https://hk.jobsdb.com/jobs?q=${encodeURIComponent(selectedLead.companyName)}`
                      : selectedLead.jobUrl;
                    return (
                      <span className="ml-1 flex items-center gap-2">
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-500 hover:underline"
                          title={isExpired ? `職位已下架，轉跳至 ${selectedLead.companyName} 的 JobsDB 搜尋頁` : undefined}
                        >
                          {isExpired ? "🔍 搜尋公司最新職位" : "查看原始職位"}
                        </a>
                        {isExpired && (
                          <span className="text-xs text-amber-500">⚠ 原職位已下架</span>
                        )}
                      </span>
                    );
                  })() : (
                    <span className="text-muted-foreground ml-1">無連結</span>
                  )}
                </div>
              </div>

              {!selectedLead.contactEmail && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-amber-600 border-amber-300 hover:bg-amber-50"
                    onClick={() => {
                      setShowDetailDialog(false);
                      handleSearchEmail(selectedLead);
                    }}
                  >
                    <UserSearch className="w-4 h-4" />
                    搜尋 HR/CEO 電郵
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      setShowDetailDialog(false);
                      setEditEmail("");
                      setEditName("");
                      setShowEmailDialog(true);
                    }}
                  >
                    <Mail className="w-4 h-4" />
                    手動填入電郵
                  </Button>
                </div>
              )}

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
                  <Label className="font-medium">AI 生成 Pitch Email</Label>
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
                    重新生成
                  </Button>
                </div>
                {selectedLead.aiPitchSubject ? (
                  <div className="space-y-2">
                    <div className="text-sm">
                      <span className="text-muted-foreground">主旨：</span>
                      <span className="font-medium">{selectedLead.aiPitchSubject}</span>
                    </div>
                    <div className="text-sm bg-muted/50 rounded p-3 whitespace-pre-wrap max-h-48 overflow-y-auto">
                      {selectedLead.aiPitchBody}
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground italic">尚未生成</div>
                )}
              </div>

              {selectedLead.notes && (
                <div>
                  <Label className="text-muted-foreground text-xs">備註</Label>
                  <div className="mt-1 text-sm text-muted-foreground">{selectedLead.notes}</div>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowDetailDialog(false)}>
              關閉
            </Button>
            {selectedLead?.status === "pending_review" && selectedLead?.contactEmail && (
              <Button
                onClick={() => sendPitch.mutate({ id: selectedLead.id })}
                disabled={sendPitch.isPending}
                className="gap-2"
              >
                {sendPitch.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                立即發送
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Email Search Results Dialog */}
      <Dialog open={showEmailSearchDialog} onOpenChange={(open) => {
        if (!open) { setShowEmailSearchDialog(false); setEmailCandidates([]); setSelectedCandidateEmail(""); }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserSearch className="w-5 h-5 text-amber-600" />
              搜尋 HR/CEO 電郵
            </DialogTitle>
          </DialogHeader>

          {isSearchingEmail ? (
            <div className="py-10 text-center space-y-4">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-amber-600" />
              <p className="text-sm text-muted-foreground">正在多層次搜尋公司聯絡電郵...</p>
              <div className="text-xs text-muted-foreground space-y-1">
                <p>① 職位廣告頁面</p>
                <p>② Hunter.io 資料庫</p>
                <p>③ Snov.io 資料庫</p>
                <p>④ 公司官網爬取</p>
                <p>⑤ SMTP 電郵驗證</p>
              </div>
            </div>
          ) : emailCandidates.length === 0 ? (
            <div className="py-8 text-center space-y-3">
              <Mail className="w-10 h-10 mx-auto text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">未找到任何電郵地址</p>
              {searchedLayers.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  已搜尋：{searchedLayers.join('、')}
                </p>
              )}
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => {
                  setShowEmailSearchDialog(false);
                  setEditEmail("");
                  setEditName("");
                  const lead = leadsData?.leads.find(l => l.id === emailSearchLeadId);
                  if (lead) { setSelectedLead(lead); setShowEmailDialog(true); }
                }}
              >
                手動填入電郵
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">找到 {emailCandidates.length} 個候選電郵，請選擇最合適的：</p>
                {searchedLayers.length > 0 && (
                  <span className="text-xs text-muted-foreground/60">已搜尋：{searchedLayers.join('、')}</span>
                )}
              </div>
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {emailCandidates.map((c) => (
                  <button
                    key={c.email}
                    onClick={() => setSelectedCandidateEmail(c.email)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      selectedCandidateEmail === c.email
                        ? "border-amber-500 bg-amber-50 dark:bg-amber-950/30"
                        : "border-border hover:border-amber-300 hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <div className="font-medium text-sm text-foreground">{c.email}</div>
                        {/* 聯絡人姓名 */}
                        {c.name
                          ? <div className="text-xs text-muted-foreground">👤 {c.name}</div>
                          : <div className="text-xs text-muted-foreground/40 italic">未知聯絡人</div>
                        }
                        {/* 職位 */}
                        {c.position
                          ? <div className="text-xs text-amber-700 dark:text-amber-400 font-medium">🏷 {c.position}</div>
                          : <div className="text-xs text-muted-foreground/40 italic">未知職位</div>
                        }
                        {/* 通用信箱警告 */}
                        {/^(admin|info|contact|hello|support|enquiry|enquiries|general|office|mail|webmaster)@/i.test(c.email) && (
                          <div className="text-xs text-orange-500 dark:text-orange-400">⚠ 通用信箱，未必直達決策者</div>
                        )}
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground/60">
                            來源：{FOUND_VIA_LABELS[c.foundVia] ?? c.foundVia}
                          </span>
                          {c.confidence !== undefined && (
                            <span className={`text-xs font-medium ${
                              c.confidence >= 80 ? 'text-green-600 dark:text-green-400' :
                              c.confidence >= 60 ? 'text-amber-600 dark:text-amber-400' :
                              'text-muted-foreground/60'
                            }`}>
                              信心度 {c.confidence}%
                            </span>
                          )}
                        </div>
                      </div>
                      {selectedCandidateEmail === c.email && (
                        <CheckCircle2 className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEmailSearchDialog(false)}>
              取消
            </Button>
            {emailCandidates.length > 0 && (
              <Button
                onClick={handleConfirmEmailSelection}
                disabled={!selectedCandidateEmail || updateEmail.isPending}
                className="gap-2"
              >
                {updateEmail.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                使用此電郵
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual Email Dialog */}
      <Dialog open={showEmailDialog} onOpenChange={setShowEmailDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>手動填入聯絡 Email</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>公司</Label>
              <div className="text-sm text-muted-foreground mt-1">{selectedLead?.companyName}</div>
            </div>
            <div>
              <Label htmlFor="contact-email">Email *</Label>
              <Input
                id="contact-email"
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                placeholder="contact@company.com"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="contact-name">聯絡人姓名（選填）</Label>
              <Input
                id="contact-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="例如：Mary Chan"
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEmailDialog(false)}>
              取消
            </Button>
            <Button
              onClick={() => {
                if (!selectedLead || !editEmail) return;
                updateEmail.mutate({
                  id: selectedLead.id,
                  contactEmail: editEmail,
                  contactName: editName || undefined,
                });
              }}
              disabled={!editEmail || updateEmail.isPending}
            >
              {updateEmail.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              儲存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
