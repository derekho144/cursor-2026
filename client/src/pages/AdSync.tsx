import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { AlertCircle, CheckCircle2, CheckCircle, XCircle, Clock, DollarSign, TrendingUp, Upload, ChevronDown, ChevronUp, ExternalLink, PlusCircle, Settings, Eye, EyeOff, KeyRound, Loader2, RefreshCw, Shield, Trash2, Wifi, WifiOff } from "lucide-react";
import { useState, useMemo, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";

// Note: AdSync uses an extended platform definition with extra fields (description, website, hasApi, etc.)
// For simple value/label/color lookups, use @/lib/platformConstants instead.
const PLATFORMS = [
  {
    value: "hellotoby" as const,
    label: "HelloToby",
    color: "#FFB800",
    description: "香港本地服務媒合平台，提供攝影師接案機會",
    website: "https://www.hellotoby.com",
    hasApi: false,
    autoSync: true,
    loginUrl: "https://www.hellotoby.com/en/pro/login",
    billingNote: "登入 HelloToby Pro → 帳戶 → 購買記錄，查看每月 Credits 消費",
  },
  {
    value: "360pro" as const,
    label: "360Pro",
    color: "#00D4AA",
    description: "專業服務平台，連接企業與攝影師",
    website: "https://www.pro360.com.hk",
    hasApi: false,
    autoSync: true,
    loginUrl: "https://www.pro360.com.hk/zh-hk/login",
    billingNote: "登入 PRO360 → 我的帳戶 → 購買記錄，查看每月廣告費用",
  },
  {
    value: "freehunter" as const,
    label: "FreeHunter",
    color: "#FF6B6B",
    description: "自由工作者接案平台，廣告投放管理",
    website: "https://www.freehunter.hk",
    hasApi: false,
    loginUrl: "https://www.freehunter.hk",
    billingNote: "登入 FreeHunter → 帳戶設定 → 帳單記錄，查看廣告開支",
  },
  {
    value: "google_ads" as const,
    label: "Google Ads",
    color: "#7B8CFF",
    description: "Google 搜尋廣告與展示廣告管理平台",
    website: "https://ads.google.com",
    hasApi: true,
    loginUrl: "https://ads.google.com",
    billingNote: "Google Ads API 已整合，點擊「API 同步」自動抓取廣告費用數據（測試帳戶模式，需申請基本存取權後才能讀取真實數據）",
  },
];

type PlatformValue = "hellotoby" | "360pro" | "freehunter" | "google_ads";

const MONTHS = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `${i + 1}月` }));

export default function AdSync() {
  const utils = trpc.useUtils();
  const { data: configs } = trpc.adExpenses.getPlatformConfigs.useQuery();
  const { data: syncLogs, refetch: refetchLogs } = trpc.adExpenses.getSyncLogs.useQuery({ platform: undefined });

  // Credential management state
  const [credForms, setCredForms] = useState<Record<PlatformValue, { email: string; password: string; showPw: boolean }>>({
    hellotoby: { email: "", password: "", showPw: false },
    "360pro": { email: "", password: "", showPw: false },
    freehunter: { email: "", password: "", showPw: false },
    google_ads: { email: "", password: "", showPw: false },
  });
  const [syncingPlatform, setSyncingPlatform] = useState<PlatformValue | null>(null);
  const [syncYear, setSyncYear] = useState(new Date().getFullYear());

  const { data: credentials, refetch: refetchCreds } = trpc.adExpenses.getCredentials.useQuery();
  const { data: schedulerStatus, refetch: refetchScheduler } = trpc.adExpenses.getSchedulerStatus.useQuery();

  // PRO360 Cookie state
  const [pro360CookieJson, setPro360CookieJson] = useState("");
  const [showCookieForm, setShowCookieForm] = useState(false);

  // HelloToby Cookie state
  const [htCookieJson, setHtCookieJson] = useState("");
  const [showHtCookieForm, setShowHtCookieForm] = useState(false);

  const saveHelloTobyCookiesMutation = trpc.adExpenses.saveHelloTobyCookies.useMutation({
    onSuccess: () => {
      toast.success("HelloToby Session Cookies 已儲存！現在可以點擊「自動同步」");
      refetchCreds();
      setHtCookieJson("");
      setShowHtCookieForm(false);
    },
    onError: (e) => toast.error("儲存失敗：" + e.message),
  });

  const savePro360CookiesMutation = trpc.adExpenses.savePro360Cookies.useMutation({
    onSuccess: () => {
      toast.success("PRO360 Session Cookies 已儲存！現在可以點擊「自動同步」");
      refetchCreds();
      setPro360CookieJson("");
      setShowCookieForm(false);
    },
    onError: (e) => toast.error("儲存失敗：" + e.message),
  });

  const triggerAutoSyncMutation = trpc.adExpenses.triggerAutoSync.useMutation({
    onSuccess: (data) => {
      toast.success(`立即同步完成，更新 ${data.recordsUpdated} 筆記錄`);
      refetchScheduler();
      utils.adExpenses.list.invalidate();
      utils.adExpenses.summary.invalidate();
      utils.adExpenses.getSyncLogs.invalidate();
      utils.dashboard.stats.invalidate();
    },
    onError: (e) => toast.error(`立即同步失敗：${e.message}`),
  });

  const saveCredMutation = trpc.adExpenses.saveCredential.useMutation({
    onSuccess: (_data, vars) => {
      toast.success(PLATFORMS.find((p) => p.value === vars.platform)?.label + " 帳號已儲存");
      refetchCreds();
      setCredForms((prev) => ({ ...prev, [vars.platform]: { ...prev[vars.platform as PlatformValue], password: "" } }));
    },
    onError: (err) => toast.error("儲存失敗：" + err.message),
  });

  const deleteCredMutation = trpc.adExpenses.deleteCredential.useMutation({
    onSuccess: (_data, vars) => { toast.success("已移除 " + PLATFORMS.find((p) => p.value === vars.platform)?.label + " 帳號"); refetchCreds(); },
    onError: (err) => toast.error("移除失敗：" + err.message),
  });

  const getCredStatus = (platform: PlatformValue) => credentials?.find((c) => c.platform === platform);

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  // Quick entry state per platform
  const [quickEntry, setQuickEntry] = useState<Record<string, {
    year: number; month: number; amount: string;
    impressions: string; clicks: string; notes: string; open: boolean;
  }>>({
    hellotoby: { year: currentYear, month: currentMonth, amount: "", impressions: "", clicks: "", notes: "", open: false },
    "360pro": { year: currentYear, month: currentMonth, amount: "", impressions: "", clicks: "", notes: "", open: false },
    freehunter: { year: currentYear, month: currentMonth, amount: "", impressions: "", clicks: "", notes: "", open: false },
    google_ads: { year: currentYear, month: currentMonth, amount: "", impressions: "", clicks: "", notes: "", open: false },
  });

  // API config state
  const [editingPlatform, setEditingPlatform] = useState<PlatformValue | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [accountId, setAccountId] = useState("");

  const { data: allExpenses } = trpc.adExpenses.list.useQuery({ year: currentYear });

  const upsertMutation = trpc.adExpenses.upsert.useMutation({
    onSuccess: () => {
      toast.success("開支記錄已儲存！");
      utils.adExpenses.list.invalidate();
      utils.adExpenses.summary.invalidate();
      utils.dashboard.stats.invalidate();
    },
    onError: (e) => toast.error(`儲存失敗：${e.message}`),
  });

  const saveConfigMutation = trpc.adExpenses.savePlatformConfig.useMutation({
    onSuccess: () => {
      toast.success("設定已儲存");
      utils.adExpenses.getPlatformConfigs.invalidate();
      setEditingPlatform(null);
    },
    onError: (e) => toast.error(`儲存失敗：${e.message}`),
  });

  const syncMutation = trpc.adExpenses.syncPlatform.useMutation({
    onSuccess: (data) => {
      toast.success(`同步完成，更新 ${data.recordsUpdated} 筆記錄`);
      utils.adExpenses.getPlatformConfigs.invalidate();
      utils.adExpenses.getSyncLogs.invalidate();
      utils.adExpenses.list.invalidate();
      utils.adExpenses.summary.invalidate();
      utils.dashboard.stats.invalidate();
    },
    onError: (e) => toast.error(`同步失敗：${e.message}`),
  });

  const [googleAdsConnStatus, setGoogleAdsConnStatus] = useState<{ success: boolean; customerId?: string; error?: string } | null>(null);
  const testGoogleAdsConnectionMutation = trpc.adExpenses.testGoogleAdsConnection.useMutation({
    onSuccess: (data) => {
      setGoogleAdsConnStatus(data);
      if (data.success) {
        toast.success(`Google Ads API 連線成功！帳戶 ID: ${data.customerId}`);
      } else {
        // Don't show toast on auto-test failure, just update status
      }
    },
    onError: (e) => {
      setGoogleAdsConnStatus({ success: false, error: e.message });
    },
  });
  // Auto-test Google Ads connection on mount
  const hasAutoTested = useRef(false);
  useEffect(() => {
    if (!hasAutoTested.current) {
      hasAutoTested.current = true;
      testGoogleAdsConnectionMutation.mutate();
    }
  }, []);

  // Handle Google Ads OAuth callback result (from URL query param)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authResult = params.get("google_auth");
    const msg = params.get("msg");
    if (authResult === "success") {
      toast.success("✅ Google Ads 重新授權成功！新的 Refresh Token 已儲存，下次同步將自動生效。");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (authResult === "error") {
      toast.error(`授權失敗：${msg ?? "未知錯誤"}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const handleGoogleReauth = () => {
    const returnTo = `${window.location.origin}${window.location.pathname}`;
    window.location.href = `/api/google-ads/auth-url?origin=${encodeURIComponent(returnTo)}`;
  };

  const clearSyncLogsMutation = trpc.adExpenses.clearSyncLogs.useMutation({
    onSuccess: (data) => {
      toast.success(`已清除 ${data.deleted} 筆舊記錄，每個平台保留最新 3 筆`);
      utils.adExpenses.getSyncLogs.invalidate();
    },
    onError: (e) => toast.error(`清除失敗：${e.message}`),
  });

  const handleClearAllSyncLogs = () => {
    const platforms = ["hellotoby", "360pro", "freehunter", "google_ads"];
    let totalDeleted = 0;
    let completed = 0;
    for (const platform of platforms) {
      clearSyncLogsMutation.mutate(
        { platform, keepCount: 3 },
        {
          onSuccess: (data) => {
            totalDeleted += data.deleted;
            completed++;
            if (completed === platforms.length) {
              toast.success(`已清除舊記錄，共刪除 ${totalDeleted} 筆，每個平台保留最新 3 筆`);
              utils.adExpenses.getSyncLogs.invalidate();
            }
          },
        }
      );
    }
  };

  const getConfig = (platform: PlatformValue) => configs?.find((c) => c.platform === platform);

  const getMonthExpense = (platform: PlatformValue, year: number, month: number) => {
    return allExpenses?.find((e) => e.platform === platform && e.year === year && e.month === month);
  };

  const updateEntry = (platform: string, field: string, value: string | number | boolean) => {
    setQuickEntry((prev) => ({
      ...prev,
      [platform]: { ...prev[platform], [field]: value },
    }));
  };

  const handleSaveExpense = (platform: PlatformValue) => {
    const entry = quickEntry[platform];
    const amount = parseFloat(entry.amount);
    if (!entry.amount || isNaN(amount) || amount < 0) {
      toast.error("請輸入有效的金額");
      return;
    }
    upsertMutation.mutate({
      platform,
      year: entry.year,
      month: entry.month,
      amount,
      impressions: entry.impressions ? parseInt(entry.impressions) : undefined,
      clicks: entry.clicks ? parseInt(entry.clicks) : undefined,
      notes: entry.notes || undefined,
    });
    updateEntry(platform, "open", false);
  };

  const getSyncIcon = (status: string | null | undefined) => {
    switch (status) {
      case "success": return <CheckCircle className="h-3.5 w-3.5" style={{ color: "#4caf50" }} />;
      case "error": return <XCircle className="h-3.5 w-3.5" style={{ color: "#e53935" }} />;
      case "syncing": return <RefreshCw className="h-3.5 w-3.5 animate-spin" style={{ color: "#d4a843" }} />;
      default: return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  // Compute this year's total per platform
  const yearlyTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const e of allExpenses ?? []) {
      totals[e.platform] = (totals[e.platform] ?? 0) + Number(e.amount);
    }
    return totals;
  }, [allExpenses]);

  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <div style={{ fontSize: "0.6rem", letterSpacing: "0.2em", color: "#d4a843", textTransform: "uppercase", marginBottom: "6px" }}>
            Platform Sync
          </div>
          <h1 className="text-2xl font-light">廣告平台開支同步</h1>
          <p className="text-sm text-muted-foreground mt-1">
            記錄各廣告平台的每月開支，Google Ads 支援 API 自動同步。
          </p>
        </div>

        <div style={{ height: "1px", background: "linear-gradient(to right, #d4a843, rgba(212,168,67,0.1), transparent)" }} />

        {/* Notice */}
        <div
          className="flex items-start gap-3 p-4 rounded"
          style={{ background: "rgba(212,168,67,0.06)", border: "1px solid rgba(212,168,67,0.2)" }}
        >
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "#d4a843" }} />
          <div className="text-sm text-muted-foreground leading-relaxed">
            <span style={{ color: "#d4a843", fontWeight: 500 }}>同步說明：</span>
            360Pro 與 HelloToby 均已啟用<strong style={{ color: "#e8e0d0" }}>每 7 日自動同步 + Cookies 自動續期</strong>，系統在後台定期抓取最新開支數據。
            FreeHunter 請使用下方快速輸入手動記錄。Google Ads 可設定 API 憑證實現自動同步。
          </div>
        </div>

        {/* Auto-Sync Scheduler Status Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* 360Pro */}
          <div
            className="rounded p-4 flex flex-col gap-3"
            style={{ background: "#0f0f0f", border: "1px solid rgba(0,212,170,0.25)" }}
          >
            <div className="flex items-center gap-3">
              <div
                className="flex items-center justify-center rounded-full shrink-0"
                style={{ width: 32, height: 32, background: "rgba(0,212,170,0.12)", border: "1px solid rgba(0,212,170,0.3)" }}
              >
                <RefreshCw className="h-3.5 w-3.5" style={{ color: "#00D4AA" }} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium" style={{ color: "#00D4AA" }}>360Pro 自動排程</span>
                  <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: "rgba(0,212,170,0.15)", color: "#00D4AA", border: "1px solid rgba(0,212,170,0.3)", fontSize: "0.6rem" }}>每 7 日</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 space-y-0.5">
                  <div>上次：<span style={{ color: "#e8e0d0" }}>{schedulerStatus?.lastSyncAt ? new Date(schedulerStatus.lastSyncAt).toLocaleString("zh-HK") : "尚未執行"}</span></div>
                  <div>下次：<span style={{ color: "#d4a843" }}>{schedulerStatus?.nextSyncAt ? new Date(schedulerStatus.nextSyncAt).toLocaleString("zh-HK") : "設定 Cookies 後啟動"}</span></div>
                </div>
              </div>
            </div>
            <button
              onClick={() => triggerAutoSyncMutation.mutate({ platform: "360pro" })}
              disabled={triggerAutoSyncMutation.isPending}
              className="flex items-center justify-center gap-2 py-1.5 rounded text-xs font-medium transition-all hover:opacity-80 disabled:opacity-50"
              style={{ background: "rgba(0,212,170,0.15)", border: "1px solid rgba(0,212,170,0.4)", color: "#00D4AA" }}
            >
              {triggerAutoSyncMutation.isPending && triggerAutoSyncMutation.variables?.platform === "360pro"
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> 同步中...</>
                : <><RefreshCw className="h-3.5 w-3.5" /> 立即同步</>}
            </button>
          </div>

          {/* HelloToby */}
          <div
            className="rounded p-4 flex flex-col gap-3"
            style={{ background: "#0f0f0f", border: "1px solid rgba(255,184,0,0.25)" }}
          >
            <div className="flex items-center gap-3">
              <div
                className="flex items-center justify-center rounded-full shrink-0"
                style={{ width: 32, height: 32, background: "rgba(255,184,0,0.12)", border: "1px solid rgba(255,184,0,0.3)" }}
              >
                <RefreshCw className="h-3.5 w-3.5" style={{ color: "#FFB800" }} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium" style={{ color: "#FFB800" }}>HelloToby 自動排程</span>
                  <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: "rgba(255,184,0,0.15)", color: "#FFB800", border: "1px solid rgba(255,184,0,0.3)", fontSize: "0.6rem" }}>每 7 日</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 space-y-0.5">
                  <div>上次：<span style={{ color: "#e8e0d0" }}>{schedulerStatus?.hellotoby?.lastSyncAt ? new Date(schedulerStatus.hellotoby.lastSyncAt).toLocaleString("zh-HK") : "尚未執行"}</span></div>
                  <div>下次：<span style={{ color: "#d4a843" }}>{schedulerStatus?.hellotoby?.nextSyncAt ? new Date(schedulerStatus.hellotoby.nextSyncAt).toLocaleString("zh-HK") : "設定 Cookies 後啟動"}</span></div>
                </div>
              </div>
            </div>
            <button
              onClick={() => triggerAutoSyncMutation.mutate({ platform: "hellotoby" })}
              disabled={triggerAutoSyncMutation.isPending}
              className="flex items-center justify-center gap-2 py-1.5 rounded text-xs font-medium transition-all hover:opacity-80 disabled:opacity-50"
              style={{ background: "rgba(255,184,0,0.15)", border: "1px solid rgba(255,184,0,0.4)", color: "#FFB800" }}
            >
              {triggerAutoSyncMutation.isPending && triggerAutoSyncMutation.variables?.platform === "hellotoby"
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> 同步中...</>
                : <><RefreshCw className="h-3.5 w-3.5" /> 立即同步</>}
            </button>
          </div>

          {/* Google Ads */}
          <div
            className="rounded p-4 flex flex-col gap-3"
            style={{ background: "#0f0f0f", border: "1px solid rgba(123,140,255,0.25)" }}
          >
            <div className="flex items-center gap-3">
              <div
                className="flex items-center justify-center rounded-full shrink-0"
                style={{ width: 32, height: 32, background: "rgba(123,140,255,0.12)", border: "1px solid rgba(123,140,255,0.3)" }}
              >
                <RefreshCw className="h-3.5 w-3.5" style={{ color: "#7B8CFF" }} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium" style={{ color: "#7B8CFF" }}>Google Ads 自動排程</span>
                  <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: "rgba(123,140,255,0.15)", color: "#7B8CFF", border: "1px solid rgba(123,140,255,0.3)", fontSize: "0.6rem" }}>每 7 日</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 space-y-0.5">
                  <div>上次：<span style={{ color: "#e8e0d0" }}>{schedulerStatus?.googleAds?.lastSyncAt ? new Date(schedulerStatus.googleAds.lastSyncAt).toLocaleString("zh-HK") : "尚未執行"}</span></div>
                  <div>下次：<span style={{ color: "#d4a843" }}>{schedulerStatus?.googleAds?.nextSyncAt ? new Date(schedulerStatus.googleAds.nextSyncAt).toLocaleString("zh-HK") : "第一次同步後自動計算"}</span></div>
                </div>
              </div>
            </div>
            <button
              onClick={() => syncMutation.mutate({ platform: "google_ads" })}
              disabled={syncMutation.isPending}
              className="flex items-center justify-center gap-2 py-1.5 rounded text-xs font-medium transition-all hover:opacity-80 disabled:opacity-50"
              style={{ background: "rgba(123,140,255,0.15)", border: "1px solid rgba(123,140,255,0.4)", color: "#7B8CFF" }}
            >
              {syncMutation.isPending && syncMutation.variables?.platform === "google_ads"
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> 同步中...</>
                : <><RefreshCw className="h-3.5 w-3.5" /> 立即同步</>}
            </button>
          </div>
        </div>

        {/* Platform Cards */}
        <div className="space-y-4">
          {PLATFORMS.map((platform) => {
            const config = getConfig(platform.value);
            const entry = quickEntry[platform.value];
            const existingExpense = getMonthExpense(platform.value, entry.year, entry.month);
            const isSyncing = syncMutation.isPending && syncMutation.variables?.platform === platform.value;
            const isSaving = upsertMutation.isPending;
            const isEditing = editingPlatform === platform.value;
            const yearTotal = yearlyTotals[platform.value] ?? 0;

            return (
              <div
                key={platform.value}
                className="rounded overflow-hidden"
                style={{ border: `1px solid ${entry.open ? platform.color + "40" : "rgba(212,168,67,0.12)"}`, background: "#0f0f0f" }}
              >
                {/* Card Header Row */}
                <div className="flex items-center gap-4 px-5 py-4">
                  {/* Platform info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-medium text-sm" style={{ color: platform.color }}>{platform.label}</span>
                      {getSyncIcon(config?.syncStatus)}
                      {platform.hasApi && (
                        <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(255,107,107,0.15)", color: "#FF6B6B", fontSize: "0.6rem", letterSpacing: "0.1em" }}>
                          API
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{platform.description}</p>
                  </div>

                  {/* Year total */}
                  <div className="text-right shrink-0 hidden sm:block">
                    <div className="text-xs text-muted-foreground">{currentYear} 年累計</div>
                    <div className="text-sm font-medium" style={{ color: yearTotal > 0 ? "#d4a843" : "#555" }}>
                      HKD {yearTotal.toLocaleString()}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Quick entry toggle */}
                    <button
                      onClick={() => updateEntry(platform.value, "open", !entry.open)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-all hover:opacity-80"
                      style={{ background: `${platform.color}18`, border: `1px solid ${platform.color}35`, color: platform.color }}
                    >
                      <DollarSign className="h-3 w-3" />
                      輸入開支
                      {entry.open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>

                    {/* Auto sync (HelloToby & 360Pro) */}
                    {platform.autoSync && (() => {
                      const cred = getCredStatus(platform.value);
                      const isAutoSyncing = syncingPlatform === platform.value;
                      return (
                        <button
                          onClick={() => {
                            if (!cred) {
                              toast.error(`請先在下方設定 ${platform.label} 帳號`);
                              updateEntry(platform.value, "open", true);
                              return;
                            }
                            setSyncingPlatform(platform.value);
                            syncMutation.mutate({ platform: platform.value, year: syncYear });
                          }}
                          disabled={isAutoSyncing}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-all hover:opacity-80 disabled:opacity-50"
                          style={{
                            background: cred ? `${platform.color}20` : "rgba(255,255,255,0.04)",
                            border: `1px solid ${cred ? platform.color + "40" : "rgba(255,255,255,0.1)"}`,
                            color: cred ? platform.color : "#666"
                          }}
                          title={cred ? `自動登入並同步 ${syncYear} 年數據` : `請先設定 ${platform.label} 帳號`}
                        >
                          {isAutoSyncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                          {isAutoSyncing ? "同步中..." : "自動同步"}
                        </button>
                      );
                    })()}

                    {/* API sync (Google Ads only) */}
                    {platform.hasApi && (
                      <button
                        onClick={() => syncMutation.mutate({ platform: platform.value })}
                        disabled={isSyncing}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-all hover:opacity-80 disabled:opacity-50"
                        style={{ border: "1px solid rgba(255,255,255,0.1)", color: "#888" }}
                      >
                        <RefreshCw className={`h-3 w-3 ${isSyncing ? "animate-spin" : ""}`} />
                        {isSyncing ? "同步中" : "API 同步"}
                      </button>
                    )}

                    {/* External link */}
                    <a
                      href={platform.loginUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center h-7 w-7 rounded transition-all hover:opacity-70"
                      style={{ border: "1px solid rgba(255,255,255,0.08)", color: "#555" }}
                      title={`前往 ${platform.label}`}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>

                {/* Quick Entry Panel */}
                {entry.open && (
                  <div
                    className="px-5 pb-5 pt-0"
                    style={{ borderTop: `1px solid ${platform.color}25` }}
                  >
                    {/* Billing hint */}
                    <div
                      className="flex items-start gap-2 p-3 rounded mb-4 mt-4"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                    >
                      <TrendingUp className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: platform.color }} />
                      <p className="text-xs text-muted-foreground">{platform.billingNote}</p>
                    </div>

                    {/* Existing record warning */}
                    {existingExpense && (
                      <div
                        className="flex items-center gap-2 p-2.5 rounded mb-4 text-xs"
                        style={{ background: "rgba(212,168,67,0.08)", border: "1px solid rgba(212,168,67,0.2)", color: "#d4a843" }}
                      >
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        已有 {entry.year} 年 {entry.month} 月記錄（HKD {Number(existingExpense.amount).toLocaleString()}），儲存將覆蓋現有資料。
                      </div>
                    )}

                    {/* Form Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                      {/* Year */}
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1.5">年份</label>
                        <Select
                          value={String(entry.year)}
                          onValueChange={(v) => updateEntry(platform.value, "year", parseInt(v))}
                        >
                          <SelectTrigger style={{ background: "#0a0a0a", border: "1px solid rgba(212,168,67,0.2)", height: "34px", fontSize: "12px" }}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Month */}
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1.5">月份</label>
                        <Select
                          value={String(entry.month)}
                          onValueChange={(v) => updateEntry(platform.value, "month", parseInt(v))}
                        >
                          <SelectTrigger style={{ background: "#0a0a0a", border: "1px solid rgba(212,168,67,0.2)", height: "34px", fontSize: "12px" }}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {MONTHS.map((m) => <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Amount */}
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1.5">
                          廣告開支 (HKD) <span style={{ color: "#e57373" }}>*</span>
                        </label>
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          value={entry.amount}
                          onChange={(e) => updateEntry(platform.value, "amount", e.target.value)}
                          placeholder="例：1200"
                          style={{ background: "#0a0a0a", border: `1px solid ${entry.amount ? platform.color + "50" : "rgba(212,168,67,0.2)"}`, color: "#e8e0d0", height: "34px", fontSize: "12px" }}
                        />
                      </div>

                      {/* Clicks */}
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1.5">點擊次數（選填）</label>
                        <Input
                          type="number"
                          min="0"
                          value={entry.clicks}
                          onChange={(e) => updateEntry(platform.value, "clicks", e.target.value)}
                          placeholder="例：350"
                          style={{ background: "#0a0a0a", border: "1px solid rgba(212,168,67,0.15)", color: "#e8e0d0", height: "34px", fontSize: "12px" }}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                      {/* Impressions */}
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1.5">曝光次數（選填）</label>
                        <Input
                          type="number"
                          min="0"
                          value={entry.impressions}
                          onChange={(e) => updateEntry(platform.value, "impressions", e.target.value)}
                          placeholder="例：15000"
                          style={{ background: "#0a0a0a", border: "1px solid rgba(212,168,67,0.15)", color: "#e8e0d0", height: "34px", fontSize: "12px" }}
                        />
                      </div>
                      {/* Notes */}
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1.5">備註（選填）</label>
                        <Input
                          value={entry.notes}
                          onChange={(e) => updateEntry(platform.value, "notes", e.target.value)}
                          placeholder="例：3月促銷活動加碼"
                          style={{ background: "#0a0a0a", border: "1px solid rgba(212,168,67,0.15)", color: "#e8e0d0", height: "34px", fontSize: "12px" }}
                        />
                      </div>
                    </div>

                    {/* Save Button */}
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleSaveExpense(platform.value)}
                        disabled={isSaving || !entry.amount}
                        className="flex items-center gap-2 px-5 py-2 text-xs rounded transition-all hover:opacity-80 disabled:opacity-50"
                        style={{ background: platform.color, color: "#0a0a0a", fontWeight: 600, letterSpacing: "0.08em" }}
                      >
                        <PlusCircle className="h-3.5 w-3.5" />
                        {isSaving ? "儲存中..." : `儲存 ${entry.year} 年 ${entry.month} 月開支`}
                      </button>
                      <button
                        onClick={() => updateEntry(platform.value, "open", false)}
                        className="px-4 py-2 text-xs rounded transition-all hover:opacity-70"
                        style={{ border: "1px solid rgba(255,255,255,0.08)", color: "#666" }}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}

                {/* Auto-Login Credential Setup */}
                {platform.autoSync && (() => {
                  const cred = getCredStatus(platform.value);
                  const form = credForms[platform.value];

                  // 360Pro uses Cookie-based auth (not email/password)
                  if (platform.value === "360pro") {
                    return (
                      <div className="px-5 pb-5" style={{ borderTop: "1px solid rgba(0,212,170,0.15)" }}>
                        <div className="mt-4">
                          <div className="flex items-center gap-2 mb-3">
                            <KeyRound className="h-3.5 w-3.5" style={{ color: "#00D4AA" }} />
                            <span className="text-xs font-medium" style={{ color: "#00D4AA" }}>Session Cookies 認證</span>
                            {cred && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(76,175,80,0.15)", color: "#4caf50", fontSize: "0.6rem", letterSpacing: "0.08em" }}>已設定</span>}
                          </div>

                          {/* Explanation */}
                          <div className="flex items-start gap-2 p-3 rounded mb-3" style={{ background: "rgba(0,212,170,0.06)", border: "1px solid rgba(0,212,170,0.2)" }}>
                            <Shield className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: "#00D4AA" }} />
                            <div className="text-xs" style={{ color: "#a0d4d0" }}>
                              <p className="mb-1">PRO360 使用 Google OAuth 登入，無法直接儲存密碼。請改用 <strong style={{ color: "#00D4AA" }}>Session Cookies</strong> 方式認證：</p>
                              <ol className="list-decimal list-inside space-y-0.5 text-muted-foreground">
                                <li>在瀏覽器登入 <a href="https://www.pro360.com.hk/dashboard/settings/transaction" target="_blank" rel="noopener noreferrer" style={{ color: "#00D4AA" }}>PRO360 交易頁面</a></li>
                                <li>按 F12 開啟 DevTools → Console 標籤</li>
                                <li>貼上以下指令並按 Enter：</li>
                              </ol>
                              <div className="mt-2 p-2 rounded font-mono text-xs" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(0,212,170,0.2)", color: "#00D4AA", wordBreak: "break-all" }}>
                                {`copy(JSON.stringify(document.cookie.split(';').map(c=>c.trim().split('=')).map(([k,...v])=>({name:k,value:v.join('='),domain:'www.pro360.com.hk'}))))`}
                              </div>
                              <p className="mt-1.5 text-muted-foreground">4. 將複製的內容貼入下方框內</p>
                            </div>
                          </div>

                          {cred && (
                            <div className="space-y-2 mb-3">
                              <div className="flex items-center gap-2 text-xs">
                                <CheckCircle2 className="h-3.5 w-3.5" style={{ color: "#4caf50" }} />
                                <span className="text-muted-foreground">已儲存 Session Cookies（帳號：<span style={{ color: "#4caf50" }}>{cred.loginEmail}</span>）</span>
                              </div>
                              <div className="flex items-center gap-2 p-2.5 rounded text-xs" style={{ background: "rgba(0,212,170,0.06)", border: "1px solid rgba(0,212,170,0.2)" }}>
                                <RefreshCw className="h-3 w-3 shrink-0" style={{ color: "#00D4AA" }} />
                                <span style={{ color: "#a0d4d0" }}>
                                  <strong style={{ color: "#00D4AA" }}>自動續期已啟用</strong>——系統每次同步成功後會自動更新 Cookies，無需手動操作。每 7 天同步一次，確保 Session 永遠不會過期。
                                </span>
                              </div>
                            </div>
                          )}

                          {/* Cookie input toggle */}
                          {!showCookieForm ? (
                            <button
                              onClick={() => setShowCookieForm(true)}
                              className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded transition-all hover:opacity-80"
                              style={{ background: "rgba(0,212,170,0.15)", border: "1px solid rgba(0,212,170,0.4)", color: "#00D4AA" }}
                            >
                              <KeyRound className="h-3 w-3" />
                              {cred ? "更新 Cookies" : "設定 Cookies"}
                            </button>
                          ) : (
                            <div className="space-y-2">
                              <label className="text-xs text-muted-foreground block">貼上 Cookies JSON</label>
                              <textarea
                                value={pro360CookieJson}
                                onChange={(e) => setPro360CookieJson(e.target.value)}
                                placeholder='[{"name":"session_token","value":"...","domain":"www.pro360.com.hk"}]'
                                rows={4}
                                className="w-full text-xs font-mono rounded p-2 resize-none"
                                style={{ background: "#0a0a0a", border: "1px solid rgba(0,212,170,0.3)", color: "#e8e0d0", outline: "none" }}
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={() => {
                                    if (!pro360CookieJson.trim()) { toast.error("請貼上 Cookies JSON"); return; }
                                    savePro360CookiesMutation.mutate({ cookiesJson: pro360CookieJson.trim() });
                                  }}
                                  disabled={savePro360CookiesMutation.isPending}
                                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded transition-all hover:opacity-80 disabled:opacity-50"
                                  style={{ background: "rgba(0,212,170,0.2)", border: "1px solid rgba(0,212,170,0.5)", color: "#00D4AA" }}
                                >
                                  {savePro360CookiesMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <KeyRound className="h-3 w-3" />}
                                  儲存 Cookies
                                </button>
                                <button
                                  onClick={() => { setShowCookieForm(false); setPro360CookieJson(""); }}
                                  className="px-3 py-1.5 text-xs rounded"
                                  style={{ border: "1px solid rgba(255,255,255,0.08)", color: "#666" }}
                                >
                                  取消
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Delete + Sync */}
                          {cred && !showCookieForm && (
                            <div className="flex flex-wrap gap-2 mt-2">
                              <button
                                onClick={() => deleteCredMutation.mutate({ platform: platform.value })}
                                disabled={deleteCredMutation.isPending}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-all hover:opacity-80 disabled:opacity-50"
                                style={{ border: "1px solid rgba(229,57,53,0.3)", color: "#e57373" }}
                              >
                                <Trash2 className="h-3 w-3" />
                                移除 Cookies
                              </button>
                              <button
                                onClick={() => { setSyncingPlatform(platform.value); syncMutation.mutate({ platform: platform.value, year: syncYear }); }}
                                disabled={syncingPlatform === platform.value}
                                className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded transition-all hover:opacity-80 disabled:opacity-50 ml-auto"
                                style={{ background: "#00D4AA", color: "#0a0a0a", fontWeight: 600 }}
                              >
                                {syncingPlatform === platform.value ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                                {syncingPlatform === platform.value ? "同步中..." : `同步 ${syncYear} 年數據`}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }

                  // HelloToby: Cookie-based auth (same as PRO360)
                  return (
                    <div className="px-5 pb-5" style={{ borderTop: `1px solid ${platform.color}25` }}>
                      <div className="mt-4">
                        <div className="flex items-center gap-2 mb-3">
                          <KeyRound className="h-3.5 w-3.5" style={{ color: platform.color }} />
                          <span className="text-xs font-medium" style={{ color: platform.color }}>Session Cookies 認證</span>
                          {cred && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(76,175,80,0.15)", color: "#4caf50", fontSize: "0.6rem", letterSpacing: "0.08em" }}>已設定</span>}
                        </div>

                        {/* Explanation */}
                        <div className="flex items-start gap-2 p-3 rounded mb-3" style={{ background: `${platform.color}0d`, border: `1px solid ${platform.color}35` }}>
                          <Shield className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: platform.color }} />
                          <div className="text-xs" style={{ color: "#c8b88a" }}>
                            <p className="mb-1">HelloToby 使用 Google OAuth 登入，無法直接儲存密碼。請改用 <strong style={{ color: platform.color }}>Session Cookies</strong> 方式認證：</p>
                            <ol className="list-decimal list-inside space-y-0.5 text-muted-foreground">
                              <li>在瀏覽器登入 <a href="https://www.hellotoby.com/pro/credit-history" target="_blank" rel="noopener noreferrer" style={{ color: platform.color }}>HelloToby 金幣記錄頁面</a></li>
                              <li>按 F12 開啟 DevTools → Console 標籤</li>
                              <li>貼上以下指令並按 Enter：</li>
                            </ol>
                            <div className="mt-2 p-2 rounded font-mono text-xs" style={{ background: "rgba(0,0,0,0.4)", border: `1px solid ${platform.color}35`, color: platform.color, wordBreak: "break-all" }}>
                              {`copy(JSON.stringify(document.cookie.split(';').map(c=>c.trim().split('=')).map(([k,...v])=>({name:k,value:v.join('='),domain:'www.hellotoby.com'}))))`}
                            </div>
                            <p className="mt-1.5 text-muted-foreground">4. 將複製的內容貼入下方框內</p>
                          </div>
                        </div>

                        {cred && (
                          <div className="space-y-2 mb-3">
                            <div className="flex items-center gap-2 text-xs">
                              <CheckCircle2 className="h-3.5 w-3.5" style={{ color: "#4caf50" }} />
                              <span className="text-muted-foreground">已儲存 Session Cookies（帳號：<span style={{ color: "#4caf50" }}>{cred.loginEmail || "HelloToby Pro"}</span>）</span>
                            </div>
                            <div className="flex items-center gap-2 p-2.5 rounded text-xs" style={{ background: `${platform.color}0d`, border: `1px solid ${platform.color}35` }}>
                              <RefreshCw className="h-3 w-3 shrink-0" style={{ color: platform.color }} />
                              <span style={{ color: "#c8b88a" }}>
                                <strong style={{ color: platform.color }}>自動續期已啟用</strong>——系統每次同步成功後會自動更新 Cookies，無需手動操作。每 7 天同步一次，確保 Session 永遠不會過期。
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Cookie input toggle */}
                        {!showHtCookieForm ? (
                          <button
                            onClick={() => setShowHtCookieForm(true)}
                            className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded transition-all hover:opacity-80"
                            style={{ background: `${platform.color}25`, border: `1px solid ${platform.color}60`, color: platform.color }}
                          >
                            <KeyRound className="h-3 w-3" />
                            {cred ? "更新 Cookies" : "設定 Cookies"}
                          </button>
                        ) : (
                          <div className="space-y-2">
                            <label className="text-xs text-muted-foreground block">貼上 Cookies JSON</label>
                            <textarea
                              value={htCookieJson}
                              onChange={(e) => setHtCookieJson(e.target.value)}
                              placeholder='[{"name":"nftoken","value":"...","domain":"www.hellotoby.com"}]'
                              rows={4}
                              className="w-full text-xs font-mono rounded p-2 resize-none"
                              style={{ background: "#0a0a0a", border: `1px solid ${platform.color}50`, color: "#e8e0d0", outline: "none" }}
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  if (!htCookieJson.trim()) { toast.error("請貼上 Cookies JSON"); return; }
                                  saveHelloTobyCookiesMutation.mutate({ cookiesJson: htCookieJson.trim() });
                                }}
                                disabled={saveHelloTobyCookiesMutation.isPending}
                                className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded transition-all hover:opacity-80 disabled:opacity-50"
                                style={{ background: `${platform.color}30`, border: `1px solid ${platform.color}70`, color: platform.color }}
                              >
                                {saveHelloTobyCookiesMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <KeyRound className="h-3 w-3" />}
                                儲存 Cookies
                              </button>
                              <button
                                onClick={() => { setShowHtCookieForm(false); setHtCookieJson(""); }}
                                className="px-3 py-1.5 text-xs rounded"
                                style={{ border: "1px solid rgba(255,255,255,0.08)", color: "#666" }}
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Delete + Sync */}
                        {cred && !showHtCookieForm && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            <button
                              onClick={() => deleteCredMutation.mutate({ platform: platform.value })}
                              disabled={deleteCredMutation.isPending}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-all hover:opacity-80 disabled:opacity-50"
                              style={{ border: "1px solid rgba(229,57,53,0.3)", color: "#e57373" }}
                            >
                              <Trash2 className="h-3 w-3" />
                              移除 Cookies
                            </button>
                            <button
                              onClick={() => { setSyncingPlatform(platform.value); syncMutation.mutate({ platform: platform.value, year: syncYear }); }}
                              disabled={syncingPlatform === platform.value}
                              className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded transition-all hover:opacity-80 disabled:opacity-50 ml-auto"
                              style={{ background: platform.color, color: "#0a0a0a", fontWeight: 600 }}
                            >
                              {syncingPlatform === platform.value ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                              {syncingPlatform === platform.value ? "同步中..." : `同步 ${syncYear} 年數據`}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* API Config (Google Ads only) */}
                {platform.hasApi && isEditing && (
                  <div
                    className="px-5 pb-5"
                    style={{ borderTop: "1px solid rgba(150,206,180,0.2)" }}
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 mb-3">
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1.5">API Key</label>
                        <Input
                          type="password"
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          placeholder="輸入 Google Ads API Key"
                          style={{ background: "#0a0a0a", border: "1px solid rgba(150,206,180,0.3)", color: "#e8e0d0", height: "34px", fontSize: "12px" }}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1.5">Customer ID</label>
                        <Input
                          value={accountId}
                          onChange={(e) => setAccountId(e.target.value)}
                          placeholder="例：123-456-7890"
                          style={{ background: "#0a0a0a", border: "1px solid rgba(150,206,180,0.3)", color: "#e8e0d0", height: "34px", fontSize: "12px" }}
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          saveConfigMutation.mutate({
                            platform: platform.value,
                            isEnabled: true,
                            apiKey: apiKey || undefined,
                            accountId: accountId || undefined,
                          });
                        }}
                        disabled={saveConfigMutation.isPending}
                        className="px-4 py-1.5 text-xs rounded transition-all hover:opacity-80 disabled:opacity-50"
                        style={{ background: "#FF6B6B", color: "#0a0a0a", fontWeight: 600 }}
                      >
                        儲存 API 設定
                      </button>
                      <button
                        onClick={() => setEditingPlatform(null)}
                        className="px-3 py-1.5 text-xs rounded"
                        style={{ border: "1px solid rgba(255,255,255,0.08)", color: "#666" }}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}

                {/* Google Ads API status */}
                {platform.hasApi && !entry.open && (
                  <div
                    className="px-5 pb-4"
                    style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
                  >
                    {/* Prominent reauth banner when token expired */}
                    {googleAdsConnStatus !== null && !googleAdsConnStatus.success && (
                      <div className="mt-3 mb-2 rounded-lg px-4 py-3 flex items-start gap-3" style={{ background: "rgba(229,57,53,0.1)", border: "1px solid rgba(229,57,53,0.3)" }}>
                        <WifiOff className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: "#e53935" }} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium" style={{ color: "#e53935" }}>Google Ads API 連線失敗</div>
                          <div className="text-xs mt-0.5" style={{ color: "#aaa" }}>
                            {googleAdsConnStatus.error?.includes("invalid_grant") || googleAdsConnStatus.error?.includes("Bad Request")
                              ? "授權 Token 已過期，需要重新登入 Google 帳號以更新授權。"
                              : googleAdsConnStatus.error}
                          </div>
                          <button
                            onClick={handleGoogleReauth}
                            className="mt-2 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded transition-all hover:opacity-80"
                            style={{ background: "#7B8CFF", color: "#fff", fontWeight: 600 }}
                          >
                            <RefreshCw className="h-3 w-3" />
                            立即重新授權 Google Ads
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      {googleAdsConnStatus === null || testGoogleAdsConnectionMutation.isPending ? (
                        <span className="flex items-center gap-1.5 text-xs" style={{ color: "#888" }}>
                          <Loader2 className="h-3 w-3 animate-spin" />
                          正在測試連線...
                        </span>
                      ) : googleAdsConnStatus.success ? (
                        <span className="flex items-center gap-1.5 text-xs" style={{ color: "#4caf50" }}>
                          <CheckCircle2 className="h-3 w-3" />
                          連線成功（帳戶 {googleAdsConnStatus.customerId}）
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-xs" style={{ color: "#e53935" }}>
                          <WifiOff className="h-3 w-3" />
                          連線失敗
                        </span>
                      )}
                      <button
                        onClick={() => testGoogleAdsConnectionMutation.mutate()}
                        disabled={testGoogleAdsConnectionMutation.isPending}
                        className="flex items-center gap-1 text-xs px-2 py-1 rounded transition-all hover:opacity-70 disabled:opacity-50"
                        style={{ border: "1px solid rgba(255,255,255,0.1)", color: "#888" }}
                      >
                        {testGoogleAdsConnectionMutation.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Wifi className="h-3 w-3" />
                        )}
                        重新測試
                      </button>
                      <button
                        onClick={handleGoogleReauth}
                        className="flex items-center gap-1 text-xs px-2 py-1 rounded transition-all hover:opacity-80"
                        style={{ border: "1px solid rgba(123,140,255,0.4)", color: "#7B8CFF", background: "rgba(123,140,255,0.08)" }}
                        title="重新登入 Google 帳號以更新 Refresh Token"
                      >
                        <RefreshCw className="h-3 w-3" />
                        重新授權
                      </button>
                    </div>
                    {config?.lastSyncAt && (
                      <span className="text-xs text-muted-foreground mt-3">
                        上次同步：{new Date(config.lastSyncAt).toLocaleString("zh-HK")}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* This Year's Monthly Summary Table */}
        <div className="rounded overflow-hidden" style={{ border: "1px solid rgba(212,168,67,0.15)" }}>
          <div className="px-6 py-4 flex items-center justify-between" style={{ background: "#0f0f0f", borderBottom: "1px solid rgba(212,168,67,0.12)" }}>
            <div>
              <div style={{ fontSize: "0.6rem", letterSpacing: "0.2em", color: "#d4a843", textTransform: "uppercase" }}>
                Monthly Overview
              </div>
              <div className="text-sm font-light mt-0.5">{currentYear} 年各月開支總覽</div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead>
                <tr style={{ background: "#0a0a0a", borderBottom: "1px solid rgba(212,168,67,0.1)" }}>
                  <th className="text-left px-4 py-3" style={{ fontSize: "0.6rem", letterSpacing: "0.12em", color: "#d4a843", textTransform: "uppercase", fontWeight: 500 }}>月份</th>
                  {PLATFORMS.map((p) => (
                    <th key={p.value} className="text-right px-4 py-3" style={{ fontSize: "0.6rem", letterSpacing: "0.12em", color: p.color, textTransform: "uppercase", fontWeight: 500 }}>
                      {p.label}
                    </th>
                  ))}
                  <th className="text-right px-4 py-3" style={{ fontSize: "0.6rem", letterSpacing: "0.12em", color: "#d4a843", textTransform: "uppercase", fontWeight: 500 }}>合計</th>
                </tr>
              </thead>
              <tbody>
                {MONTHS.map((m, idx) => {
                  const rowAmounts = PLATFORMS.map((p) => {
                    const exp = allExpenses?.find((e) => e.platform === p.value && e.month === m.value);
                    return exp ? Number(exp.amount) : null;
                  });
                  const rowTotal = rowAmounts.reduce((s: number, v) => s + (v ?? 0), 0);
                  const isCurrentMonth = m.value === currentMonth;

                  return (
                    <tr
                      key={m.value}
                      style={{
                        background: isCurrentMonth ? "rgba(212,168,67,0.04)" : idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
                        borderBottom: "1px solid rgba(255,255,255,0.04)",
                      }}
                    >
                      <td className="px-4 py-2.5">
                        <span className="text-xs font-medium" style={{ color: isCurrentMonth ? "#d4a843" : "#888" }}>
                          {m.label}
                          {isCurrentMonth && <span className="ml-1.5 text-xs" style={{ color: "#d4a843", fontSize: "0.55rem" }}>▶ 本月</span>}
                        </span>
                      </td>
                      {rowAmounts.map((amount, pi) => (
                        <td key={pi} className="px-4 py-2.5 text-right">
                          {amount !== null ? (
                            <span className="text-xs" style={{ color: PLATFORMS[pi].color }}>
                              {amount.toLocaleString()}
                            </span>
                          ) : (
                            <span className="text-xs" style={{ color: "#333" }}>—</span>
                          )}
                        </td>
                      ))}
                      <td className="px-4 py-2.5 text-right">
                        <span className="text-xs font-medium" style={{ color: (rowTotal ?? 0) > 0 ? "#d4a843" : "#333" }}>
                          {(rowTotal ?? 0) > 0 ? (rowTotal ?? 0).toLocaleString() : "—"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {/* Total row */}
                <tr style={{ borderTop: "1px solid rgba(212,168,67,0.2)", background: "rgba(212,168,67,0.05)" }}>
                  <td className="px-4 py-3 text-xs font-medium" style={{ color: "#d4a843" }}>全年合計</td>
                  {PLATFORMS.map((p) => (
                    <td key={p.value} className="px-4 py-3 text-right text-xs font-medium" style={{ color: p.color }}>
                      {(yearlyTotals[p.value] ?? 0) > 0 ? (yearlyTotals[p.value] ?? 0).toLocaleString() : "—"}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right text-xs font-medium" style={{ color: "#d4a843" }}>
                    {Object.values(yearlyTotals).reduce((s, v) => s + v, 0).toLocaleString()}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Sync Logs */}
        {syncLogs && syncLogs.length > 0 && (
          <div className="rounded p-5" style={{ background: "#0f0f0f", border: "1px solid rgba(212,168,67,0.12)" }}>
            <div className="flex items-center justify-between mb-3">
              <div style={{ fontSize: "0.6rem", letterSpacing: "0.2em", color: "#d4a843", textTransform: "uppercase" }}>
                Sync History
              </div>
              <button
                onClick={handleClearAllSyncLogs}
                disabled={clearSyncLogsMutation.isPending}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded transition-all hover:opacity-70 disabled:opacity-50"
                style={{ border: "1px solid rgba(229,57,53,0.3)", color: "#e53935", background: "rgba(229,57,53,0.05)" }}
              >
                {clearSyncLogsMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
                清除舊記錄
              </button>
            </div>
            <div className="space-y-1.5">
              {syncLogs.slice(0, 8).map((log) => {
                const platform = PLATFORMS.find((p) => p.value === log.platform);
                return (
                  <div
                    key={log.id}
                    className="flex items-center gap-3 py-2 px-3 rounded text-xs"
                    style={{ background: "rgba(255,255,255,0.02)" }}
                  >
                    {log.status === "success"
                      ? <CheckCircle className="h-3.5 w-3.5 shrink-0" style={{ color: "#4caf50" }} />
                      : <XCircle className="h-3.5 w-3.5 shrink-0" style={{ color: "#e53935" }} />
                    }
                    <span className="w-20 shrink-0 font-medium" style={{ color: platform?.color ?? "#888" }}>
                      {platform?.label ?? log.platform}
                    </span>
                    <span className="flex-1 text-muted-foreground">{log.message}</span>
                    <span className="text-muted-foreground shrink-0">
                      {new Date(log.syncedAt).toLocaleString("zh-HK")}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
