import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Crown, Gift, Mail, RefreshCw, Star, Users } from "lucide-react";

// 等級顏色和樣式
const TIER_CONFIG = {
  silver: {
    label: "銀鏡 Silver Lens",
    color: "#9ca3af",
    bg: "rgba(156,163,175,0.1)",
    border: "rgba(156,163,175,0.3)",
    icon: "🥈",
    discount: 5,
    anniversaryDiscount: 5,
    minSpend: 0,
  },
  golden: {
    label: "金鏡 Golden Lens",
    color: "#d4a843",
    bg: "rgba(212,168,67,0.1)",
    border: "rgba(212,168,67,0.3)",
    icon: "🥇",
    discount: 10,
    anniversaryDiscount: 10,
    minSpend: 15000,
  },
  diamond: {
    label: "鑽石鏡 Diamond Lens",
    color: "#60a5fa",
    bg: "rgba(96,165,250,0.1)",
    border: "rgba(96,165,250,0.3)",
    icon: "💎",
    discount: 20,
    anniversaryDiscount: 20,
    minSpend: 40000,
  },
  black_diamond: {
    label: "黑鑽石鏡+ Black Diamond Lens",
    color: "#e879f9",
    bg: "rgba(232,121,249,0.1)",
    border: "rgba(232,121,249,0.3)",
    icon: "⭐",
    discount: 60,
    anniversaryDiscount: 60,
    minSpend: 90000,
  },
} as const;

type Tier = keyof typeof TIER_CONFIG;

function TierBadge({ tier }: { tier: Tier }) {
  const cfg = TIER_CONFIG[tier];
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium"
      style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}` }}
    >
      {cfg.icon} {cfg.label}
    </span>
  );
}

function ProgressToNextTier({ tier, totalSpend }: { tier: Tier; totalSpend: number }) {
  if (tier === "black_diamond") {
    return <span className="text-xs text-muted-foreground">已達最高等級</span>;
  }
  const nextTier = tier === "silver" ? "golden" : tier === "golden" ? "diamond" : "black_diamond";
  const nextMin = TIER_CONFIG[nextTier].minSpend;
  const progress = Math.min((totalSpend / nextMin) * 100, 100);
  const remaining = nextMin - totalSpend;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>距升等 {TIER_CONFIG[nextTier].icon} 還差 HK${remaining.toLocaleString()}</span>
        <span>{progress.toFixed(0)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${progress}%`,
            background: `linear-gradient(to right, ${TIER_CONFIG[tier].color}, ${TIER_CONFIG[nextTier].color})`,
          }}
        />
      </div>
    </div>
  );
}

export default function LoyaltyPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [showDetailDialog, setShowDetailDialog] = useState(false);

  const { data: memberships, refetch: refetchAll, isLoading } = trpc.loyalty.getAll.useQuery();
  const { data: stats } = trpc.loyalty.getStats.useQuery();
  const { data: clientDetail } = trpc.loyalty.getByClientId.useQuery(
    { clientId: selectedClientId! },
    { enabled: !!selectedClientId }
  );

  const syncAllMutation = trpc.loyalty.syncAll.useMutation({
    onSuccess: (data) => {
      toast.success(`同步完成！已更新 ${data.synced} 位客戶的會員資料`);
      refetchAll();
    },
    onError: (err) => toast.error(`同步失敗：${err.message}`),
  });

  const generateCodeMutation = trpc.loyalty.generateReferralCode.useMutation({
    onSuccess: (code) => {
      toast.success(`推薦碼已生成：${code.code}，可分享給客戶用於推薦新客戶`);
    },
    onError: (err) => toast.error(`生成失敗：${err.message}`),
  });

  const filtered = (memberships ?? []).filter((m) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      m.clientName?.toLowerCase().includes(q) ||
      m.clientEmail?.toLowerCase().includes(q) ||
      m.tier.includes(q)
    );
  });

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6" style={{ background: "#0a0a0a", minHeight: "100vh" }}>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1
              className="text-2xl font-light tracking-widest"
              style={{ fontFamily: "'Playfair Display', serif", color: "#d4a843" }}
            >
              LOYALTY PROGRAM
            </h1>
            <p className="text-sm text-muted-foreground mt-1">JD Studio 會員方案管理</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncAllMutation.mutate()}
            disabled={syncAllMutation.isPending}
            className="gap-2"
            style={{ borderColor: "rgba(212,168,67,0.3)", color: "#d4a843" }}
          >
            <RefreshCw className={`h-4 w-4 ${syncAllMutation.isPending ? "animate-spin" : ""}`} />
            {syncAllMutation.isPending ? "同步中..." : "從報價單同步所有會員"}
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: "總會員數", value: stats?.memberStats.total ?? 0, icon: Users, color: "#d4a843" },
            { label: "銀鏡會員", value: stats?.memberStats.silver ?? 0, icon: Star, color: "#9ca3af" },
            { label: "金鏡會員", value: stats?.memberStats.golden ?? 0, icon: Crown, color: "#d4a843" },
            { label: "鑽石會員", value: stats?.memberStats.diamond ?? 0, icon: Gift, color: "#60a5fa" },
            { label: "黑鑽石會員", value: (stats?.memberStats as Record<string, number>)?.black_diamond ?? 0, icon: Crown, color: "#e879f9" },
          ].map((item) => (
            <Card key={item.label} style={{ background: "#111", border: "1px solid #222" }}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <item.icon className="h-4 w-4" style={{ color: item.color }} />
                  <span className="text-xs text-muted-foreground">{item.label}</span>
                </div>
                <div className="text-2xl font-light" style={{ color: item.color }}>
                  {item.value}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Tier Benefits Overview */}
        <Tabs defaultValue="members">
          <TabsList style={{ background: "#111", border: "1px solid #222" }}>
            <TabsTrigger value="members">會員列表</TabsTrigger>
            <TabsTrigger value="benefits">等級福利</TabsTrigger>
            <TabsTrigger value="remarketing">再行銷計劃</TabsTrigger>
          </TabsList>

          {/* Members Tab */}
          <TabsContent value="members" className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="搜尋客戶名稱或電郵..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ background: "#111", border: "1px solid #333", color: "#e5e5e5" }}
                className="max-w-xs"
              />
            </div>

            {isLoading ? (
              <div className="text-center py-12 text-muted-foreground">載入中...</div>
            ) : filtered.length === 0 ? (
              <Card style={{ background: "#111", border: "1px solid #222" }}>
                <CardContent className="py-12 text-center">
                  <Crown className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-muted-foreground text-sm">
                    {memberships?.length === 0
                      ? "尚無會員資料，請先點擊「從報價單同步所有會員」"
                      : "找不到符合條件的會員"}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {filtered.map((m) => (
                  <Card
                    key={m.id}
                    style={{ background: "#111", border: "1px solid #222", cursor: "pointer" }}
                    className="hover:border-[#333] transition-colors"
                    onClick={() => {
                      setSelectedClientId(m.clientId);
                      setShowDetailDialog(true);
                    }}
                  >
                    <CardContent className="p-4">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm text-foreground truncate">
                              {m.clientName ?? "未知客戶"}
                            </span>
                            <TierBadge tier={m.tier as Tier} />
                          </div>
                          {m.clientEmail && (
                            <p className="text-xs text-muted-foreground mt-0.5">{m.clientEmail}</p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <span className="text-sm font-medium" style={{ color: "#d4a843" }}>
                            HK${Number(m.totalSpend).toLocaleString()}
                          </span>
                          <span className="text-xs text-muted-foreground">累計消費</span>
                        </div>
                      </div>
                      <div className="mt-3">
                        <ProgressToNextTier tier={m.tier as Tier} totalSpend={Number(m.totalSpend)} />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Benefits Tab */}
          <TabsContent value="benefits" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {([
                {
                  tier: "silver" as Tier,
                  benefits: [
                    { label: "回頭客折扣", value: "5%" },
                    { label: "合作週年折扣", value: "5%" },
                    { label: "優先排期", value: "—" },
                    { label: "免費加印 (4R×5)", value: "—" },
                    { label: "指定攝影師", value: "—" },
                    { label: "產品拍攝免費贈送三張（含修圖）", value: "—" },
                    { label: "免費加急服務", value: "—" },
                    { label: "保證3日內交付", value: "—" },
                    { label: "活動攝影 QR Code 直播服務", value: "—" },
                  ],
                },
                {
                  tier: "golden" as Tier,
                  benefits: [
                    { label: "回頭客折扣", value: "10%" },
                    { label: "合作週年折扣", value: "10%" },
                    { label: "優先排期", value: "✓" },
                    { label: "免費加印 (4R×5)", value: "✓" },
                    { label: "指定攝影師", value: "—" },
                    { label: "產品拍攝免費贈送三張（含修圖）", value: "—" },
                    { label: "免費加急服務", value: "—" },
                    { label: "保證3日內交付", value: "—" },
                    { label: "活動攝影 QR Code 直播服務", value: "—" },
                  ],
                },
                {
                  tier: "diamond" as Tier,
                  benefits: [
                    { label: "回頭客折扣", value: "20%" },
                    { label: "合作週年折扣", value: "20%" },
                    { label: "優先排期", value: "✓" },
                    { label: "免費加印 (4R×5)", value: "✓" },
                    { label: "指定攝影師", value: "✓" },
                    { label: "產品拍攝免費贈送三張（含修圖）", value: "✓" },
                    { label: "免費加急服務", value: "—" },
                    { label: "保證3日內交付", value: "—" },
                    { label: "活動攝影 QR Code 直播服務", value: "—" },
                  ],
                },
                {
                  tier: "black_diamond" as Tier,
                  benefits: [
                    { label: "回頭客折扣", value: "60%" },
                    { label: "合作週年折扣", value: "60%" },
                    { label: "優先排期", value: "✓" },
                    { label: "免費加印 (4R×5)", value: "✓" },
                    { label: "指定攝影師", value: "✓" },
                    { label: "產品拍攝免費贈送三張（含修圖）", value: "✓" },
                    { label: "免費加急服務一次", value: "✓" },
                    { label: "保證3日內交付相片", value: "✓" },
                    { label: "活動攝影 QR Code 直播服務", value: "✓" },
                  ],
                },
              ]).map(({ tier, benefits }) => {
                const cfg = TIER_CONFIG[tier];
                return (
                  <Card
                    key={tier}
                    style={{
                      background: cfg.bg,
                      border: `1px solid ${cfg.border}`,
                    }}
                  >
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2" style={{ color: cfg.color }}>
                        <span className="text-xl">{cfg.icon}</span>
                        <span className="leading-tight">{cfg.label}</span>
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">
                        {tier === "silver" ? "首次成交即加入" : `累計消費 ≥ HK$${cfg.minSpend.toLocaleString()}`}
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      {benefits.map((b) => (
                        <div key={b.label} className="flex justify-between items-center gap-2">
                          <span className="text-muted-foreground text-xs">{b.label}</span>
                          <span
                            className="font-medium text-xs shrink-0"
                            style={{ color: b.value === "✓" ? cfg.color : b.value === "—" ? "#444" : cfg.color }}
                          >
                            {b.value}
                          </span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Referral Program */}
            <Card style={{ background: "#111", border: "1px solid #222" }}>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2" style={{ color: "#d4a843" }}>
                  <Gift className="h-4 w-4" />
                  推薦及好評獎勵計劃
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div
                    className="p-3 rounded-lg"
                    style={{ background: "rgba(212,168,67,0.05)", border: "1px solid rgba(212,168,67,0.2)" }}
                  >
                    <p className="font-medium mb-1" style={{ color: "#d4a843" }}>推薦人獎勵</p>
                    <p className="text-muted-foreground">每成功推薦一位新客戶成交</p>
                    <p className="text-lg font-medium mt-1" style={{ color: "#d4a843" }}>HK$200 現金券</p>
                  </div>
                  <div
                    className="p-3 rounded-lg"
                    style={{ background: "rgba(96,165,250,0.05)", border: "1px solid rgba(96,165,250,0.2)" }}
                  >
                    <p className="font-medium mb-1" style={{ color: "#60a5fa" }}>Google 留言好評</p>
                    <p className="text-muted-foreground">每新客戶留言好評一則</p>
                    <p className="text-lg font-medium mt-1" style={{ color: "#60a5fa" }}>10% 折扣優惠</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Remarketing Tab */}
          <TabsContent value="remarketing" className="space-y-4">
            <Card style={{ background: "#111", border: "1px solid #222" }}>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2" style={{ color: "#d4a843" }}>
                  <Mail className="h-4 w-4" />
                  自動再行銷郵件觸發時機
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {[
                    {
                      trigger: "季節性業務提醒（1月/6月/11月）",
                      subject: "💼 即將來臨，預訂貴公司年度拍攝項目！",
                      content: "農曆新年企业影像 / 夏季活動影像 / 年底年報影像提醒",
                      offer: "季節專屬優惠（詳情另議）",
                      color: "#d4a843",
                    },
                    {
                      trigger: "長期未合作（12 個月）",
                      subject: "👋 我們想念貴公司！",
                      content: "長期未合作關係激活，分享最新作品集並提供回頭專屬優惠",
                      offer: "10% 回頭專屬折扣（30天限期）",
                      color: "#60a5fa",
                    },
                    {
                      trigger: "升等通知",
                      subject: "🎉 恭喜升級！",
                      content: "升等恭賀 + 新等級福利說明",
                      offer: "升等禮遇",
                      color: "#60a5fa",
                    },
                  ].map((item, i) => (
                    <div
                      key={i}
                      className="flex flex-col sm:flex-row gap-3 p-3 rounded-lg"
                      style={{ background: "#0d0d0d", border: "1px solid #1a1a1a" }}
                    >
                      <div className="shrink-0">
                        <Badge
                          variant="outline"
                          className="text-xs whitespace-nowrap"
                          style={{ borderColor: item.color, color: item.color }}
                        >
                          {item.trigger}
                        </Badge>
                      </div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <p className="text-sm font-medium text-foreground">{item.subject}</p>
                        <p className="text-xs text-muted-foreground">{item.content}</p>
                        {item.offer !== "—" && (
                          <p className="text-xs" style={{ color: item.color }}>
                            優惠：{item.offer}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-4 p-3 rounded" style={{ background: "#0d0d0d" }}>
                  💡 再行銷郵件由系統排程自動觸發，每日凌晨檢查符合條件的客戶。所有觸發機制均針對公司客戶設計，每位客戶每種類型的郵件只會發送一次，避免重複打擾。
                </p>
              </CardContent>
            </Card>

            {/* Email Stats */}
            {stats?.emailStats && stats.emailStats.length > 0 && (
              <Card style={{ background: "#111", border: "1px solid #222" }}>
                <CardHeader>
                  <CardTitle className="text-sm text-muted-foreground">已發送再行銷郵件統計</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {stats.emailStats.map((stat) => (
                      <div key={stat.emailType} className="text-center">
                        <div className="text-xl font-light" style={{ color: "#d4a843" }}>
                          {Number(stat.count)}
                        </div>
                        <div className="text-xs text-muted-foreground capitalize">{stat.emailType}</div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        {/* Client Detail Dialog */}
        <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
          <DialogContent style={{ background: "#111", border: "1px solid #333" }} className="max-w-lg">
            <DialogHeader>
              <DialogTitle style={{ color: "#d4a843" }}>會員詳情</DialogTitle>
            </DialogHeader>
            {clientDetail ? (
              <div className="space-y-4">
                {clientDetail.membership ? (
                  <>
                    <div className="flex items-center justify-between">
                      <TierBadge tier={clientDetail.membership.tier as Tier} />
                      <span className="text-sm text-muted-foreground">
                        加入：{new Date(clientDetail.membership.joinedAt!).toLocaleDateString("zh-HK")}
                      </span>
                    </div>
                    <div className="p-3 rounded-lg" style={{ background: "#0d0d0d" }}>
                      <div className="flex justify-between mb-2">
                        <span className="text-sm text-muted-foreground">累計消費</span>
                        <span className="text-sm font-medium" style={{ color: "#d4a843" }}>
                          HK${Number(clientDetail.membership.totalSpend).toLocaleString()}
                        </span>
                      </div>
                      <ProgressToNextTier
                        tier={clientDetail.membership.tier as Tier}
                        totalSpend={Number(clientDetail.membership.totalSpend)}
                      />
                    </div>

                    {/* Recent Quotes */}
                    {clientDetail.acceptedQuotes.length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-2">最近成交記錄</p>
                        <div className="space-y-1">
                          {clientDetail.acceptedQuotes.slice(0, 5).map((q) => (
                            <div
                              key={q.id}
                              className="flex justify-between text-xs p-2 rounded"
                              style={{ background: "#0d0d0d" }}
                            >
                              <span className="text-muted-foreground">{q.quoteNumber}</span>
                              <span className="text-muted-foreground">{q.serviceType}</span>
                              <span style={{ color: "#d4a843" }}>HK${Number(q.total).toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Generate Referral Code */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-2"
                      style={{ borderColor: "rgba(212,168,67,0.3)", color: "#d4a843" }}
                      onClick={() => {
                        if (clientDetail.membership?.clientId) {
                          generateCodeMutation.mutate({ clientId: clientDetail.membership.clientId });
                        }
                      }}
                      disabled={generateCodeMutation.isPending}
                    >
                      <Gift className="h-4 w-4" />
                      生成推薦碼
                    </Button>
                  </>
                ) : (
                  <p className="text-muted-foreground text-sm">此客戶尚無會員資料</p>
                )}
              </div>
            ) : (
              <div className="py-8 text-center text-muted-foreground">載入中...</div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
