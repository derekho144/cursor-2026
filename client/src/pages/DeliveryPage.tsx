import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useLanguage, LangToggle } from "@/contexts/LanguageContext";
import { useIsMobile } from "@/hooks/useMobile";

const LOGO_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663457748523/VbnWSJV6UQ79sGuykqPPae/jd-studio-logo-dark_3217ad3b.png";

const GOOGLE_REVIEW_URL =
  "https://www.google.com/maps/place/JD+Studio/@22.3360662,114.1980294,17z/data=!4m8!3m7!1s0x34040714d8082109:0x60cb3968ea99b2e6!8m2!3d22.3360662!4d114.1980294!9m1!1b1!16s%2Fg%2F11x8hbsvg7?entry=ttu&g_ep=EgoyMDI2MDMyNC4wIKXMDSoASAFQAw%3D%3D";

// Google Fonts are now preloaded in index.html — no dynamic injection needed

type DeliveryContent = {
  id: number;
  clientName: string;
  title: string;
  googleDriveUrl: string;
  message: string | null;
  createdAt: Date;
  receiptUrl?: string | null;
  quoteId?: number | null;
  token?: string;
};

// ── Design tokens ─────────────────────────────────────────────────────────────
const GOLD = "#d4a843";
const GOLD_LIGHT = "rgba(212,168,67,0.15)";
const GOLD_BORDER = "rgba(212,168,67,0.25)";
const GOLD_DIM = "rgba(212,168,67,0.5)";
const WHITE_HIGH = "rgba(255,255,255,0.88)";
const WHITE_MED = "rgba(255,255,255,0.55)";
const WHITE_LOW = "rgba(255,255,255,0.28)";
const WHITE_FAINT = "rgba(255,255,255,0.07)";
const SERIF = "'Cormorant Garamond', Georgia, serif";
const SANS = "'Montserrat', 'Helvetica Neue', Arial, sans-serif";

// ── Grey palette (password page only) ────────────────────────────────────────
const GREY_BG = "linear-gradient(145deg, #1a1a1a 0%, #222222 30%, #1c1c1c 60%, #181818 100%)";
const GREY_CARD = "rgba(255,255,255,0.04)";
const GREY_BORDER = "rgba(255,255,255,0.1)";
const GREY_BORDER_FOCUS = "rgba(255,255,255,0.3)";
const GREY_BTN = "linear-gradient(135deg, #3a3a3a 0%, #2a2a2a 100%)";
const GREY_BTN_HOVER = "linear-gradient(135deg, #444444 0%, #333333 100%)";
const GREY_LOCK_BG = "rgba(255,255,255,0.06)";
const GREY_LOCK_BORDER = "rgba(255,255,255,0.12)";
const GREY_DIVIDER = "rgba(255,255,255,0.08)";
const GREY_LOGO_FILTER = "grayscale(1) brightness(1.8)";

// Helper: detect cold-start / service-unavailable errors (non-JSON responses)
// Covers: Cloud Run cold start (503), iOS Safari WebKit errors, network errors
function isColdStartError(error: unknown): boolean {
  if (!error) return false;
  const msg = (error as Error)?.message ?? "";
  return (
    msg.includes("Service Unavailable") ||
    msg.includes("not valid JSON") ||
    msg.includes("Unexpected token") ||
    msg.includes("Failed to fetch") ||
    msg.includes("NetworkError") ||
    msg.includes("503") ||
    // iOS Safari / WebKit specific errors during cold start or network issues
    msg.includes("The string did not match the expected pattern") ||
    msg.includes("The network connection was lost") ||
    msg.includes("A server with the specified hostname could not be found") ||
    msg.includes("Could not connect to the server") ||
    msg.includes("The request timed out") ||
    msg.includes("Load failed") ||
    // Generic timeout / connection reset errors
    msg.includes("timeout") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ETIMEDOUT")
  );
}

export default function DeliveryPage() {
  const params = useParams<{ token: string }>();
  const token = params.token ?? "";
  const { t, lang } = useLanguage();

  // 單次請求載入所有資料（取代原來的 getByToken → accessDelivery 兩次串行請求）
  // 有密碼時：第一次請求不傳 password → 返回 hasPassword:true → 顯示密碼輸入框
  // 用戶輸入密碼後：再次請求傳入 password → 返回完整內容
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pwError, setPwError] = useState("");
  const [submittedPassword, setSubmittedPassword] = useState<string | undefined>(undefined);

  const {
    data: deliveryData,
    isLoading: metaLoading,
    error: metaError,
  } = trpc.deliveries.getByTokenFull.useQuery(
    { token, password: submittedPassword },
    {
      enabled: !!token,
      retry: (failureCount, error) => {
        if (isColdStartError(error)) return failureCount < 5;
        return false;
      },
      retryDelay: (attemptIndex) => Math.min(3000 * (attemptIndex + 1), 10000),
    }
  );

  // Derive meta and content from the single query result
  const meta = deliveryData ? { hasPassword: deliveryData.hasPassword, clientName: deliveryData.clientName, title: deliveryData.title, createdAt: deliveryData.createdAt } : null;
  const content: DeliveryContent | null = (deliveryData && !deliveryData.hasPassword && deliveryData.googleDriveUrl)
    ? { ...deliveryData, googleDriveUrl: deliveryData.googleDriveUrl, token }
    : null;

  // Cold-start waking state (for retry UX)
  const [isWakingServer, setIsWakingServer] = useState(false);
  useEffect(() => {
    if (metaError && isColdStartError(metaError)) setIsWakingServer(true);
    else if (!metaLoading) setIsWakingServer(false);
  }, [metaError, metaLoading]);

  // Password submission: update submittedPassword to trigger re-query with password
  const handlePasswordSubmit = () => {
    if (!password.trim()) return;
    setPwError("");
    setSubmittedPassword(password.trim());
  };

  // Show password error when query fails with UNAUTHORIZED
  useEffect(() => {
    if (metaError && !isColdStartError(metaError)) {
      if (submittedPassword) {
        setPwError(metaError.message);
        setSubmittedPassword(undefined); // reset so user can retry
      }
    }
  }, [metaError, submittedPassword]);

  // ── Loading ────────────────────────────────────────────────────────────────────────────
  if (metaLoading || isWakingServer) {
    return (
      <FullPageCenter bg="linear-gradient(160deg, #0c0c0c 0%, #111111 35%, #0e0e0e 65%, #0a0a0a 100%)">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <div style={{
            width: 40, height: 40, borderRadius: "50%",
            border: `2px solid ${GOLD_BORDER}`,
            borderTopColor: GOLD,
            animation: "spin 1s linear infinite",
          }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <p style={{ color: WHITE_LOW, fontSize: 11, letterSpacing: "0.18em", fontFamily: SANS, fontWeight: 500 }}>
            {isWakingServer ? t("delivery.waking").toUpperCase() : t("loading").toUpperCase()}
          </p>
          {isWakingServer && (
            <p style={{ color: "rgba(212,168,67,0.4)", fontSize: 10, letterSpacing: "0.1em", fontFamily: SANS, maxWidth: 260, textAlign: "center" }}>
              {t("delivery.wakingRetry")}
            </p>
          )}
        </div>
      </FullPageCenter>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (metaError && !isColdStartError(metaError) && !isWakingServer) {
    const rawMsg = metaError?.message ?? "";
    // Show friendly message for cold-start errors instead of raw JSON parse errors
    const msg = isColdStartError({ message: rawMsg })
      ? t("delivery.error.invalidLink")
      : (rawMsg || t("delivery.error.invalidLink"));
    return (
      <FullPageCenter bg="linear-gradient(160deg, #0c0c0c 0%, #111111 35%, #0e0e0e 65%, #0a0a0a 100%)">
        <div style={{ textAlign: "center", padding: "0 24px" }}>
          {/* Lang toggle */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
            <LangToggle />
          </div>
          <div style={{
            width: 64, height: 64, borderRadius: "50%",
            background: "rgba(239,68,68,0.07)",
            border: "1px solid rgba(239,68,68,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 20px",
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2 style={{ fontFamily: SERIF, color: WHITE_HIGH, fontSize: 24, fontWeight: 400, marginBottom: 12 }}>{msg}</h2>
          <p style={{ fontFamily: SANS, color: WHITE_MED, fontSize: 13, marginBottom: 16 }}>{t("delivery.error.contactUs")}</p>
          <a href="https://www.jdstudiohk.com" target="_blank" rel="noopener noreferrer"
            style={{ color: GOLD_DIM, fontFamily: SANS, fontSize: 13, textDecoration: "none" }}>
            www.jdstudiohk.com
          </a>
        </div>
      </FullPageCenter>
    );
  }

  // ── Password Gate ──────────────────────────────────────────────────────────
  if (meta?.hasPassword && !content) {
    return (
      <div style={{
        minHeight: "100vh", height: "100vh", overflow: "hidden",
        background: GREY_BG, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        fontFamily: SANS, padding: "0 24px", boxSizing: "border-box",
      }}>
        {/* Subtle top line */}
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 1, background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.12) 40%, rgba(255,255,255,0.12) 60%, transparent 100%)" }} />

        {/* Lang toggle top-right */}
        <div style={{ position: "fixed", top: 16, right: 20 }}>
          <LangToggle />
        </div>

        {/* Card */}
        <div style={{
          width: "100%", maxWidth: 380,
          background: GREY_CARD, border: `1px solid ${GREY_BORDER}`,
          borderRadius: 6, padding: "44px 36px 40px",
          boxShadow: "0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03)",
          backdropFilter: "blur(12px)",
        }}>
          {/* Logo + Brand */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 20 }}>
            <img src={LOGO_URL} alt="JD Studio" style={{ height: 56, filter: GREY_LOGO_FILTER, opacity: 0.92, marginBottom: 10 }} />
            <p style={{ fontFamily: SANS, fontSize: 10, letterSpacing: "0.28em", color: "rgba(255,255,255,0.35)", fontWeight: 500, textTransform: "uppercase", margin: 0 }}>
              JD STUDIO HK
            </p>
          </div>

          {/* Welcome message */}
          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <p style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 300, fontStyle: "italic", color: WHITE_HIGH, letterSpacing: "0.04em", marginBottom: 4 }}>
              {t("delivery.welcome")}{meta.clientName}
            </p>
            <p style={{ fontFamily: SANS, fontSize: 11, color: "rgba(255,255,255,0.3)", letterSpacing: "0.06em" }}>
              {t("delivery.photosReady")}
            </p>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: GREY_DIVIDER, marginBottom: 22 }} />

          {/* Lock icon */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
            <div style={{
              position: "relative", width: 56, height: 56, borderRadius: "50%",
              background: GREY_LOCK_BG, border: `1px solid ${GREY_LOCK_BORDER}`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <div style={{ position: "absolute", inset: -5, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.05)" }} />
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
          </div>

          {/* Title */}
          <h2 style={{ fontFamily: SERIF, color: WHITE_HIGH, fontSize: 20, fontWeight: 400, letterSpacing: "0.05em", textAlign: "center", marginBottom: 6 }}>
            {t("delivery.privateGallery")}
          </h2>
          <p style={{ fontFamily: SANS, color: WHITE_LOW, fontSize: 12, textAlign: "center", marginBottom: 24, lineHeight: 1.65, letterSpacing: "0.04em" }}>
            {meta.title}
          </p>

          {/* Input */}
          <div style={{ position: "relative", marginBottom: 10 }}>
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setPwError(""); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && password.trim()) handlePasswordSubmit();
              }}
              placeholder={t("delivery.enterPassword")}
              autoFocus
              style={{
                width: "100%", padding: "12px 44px 12px 16px",
                background: "rgba(255,255,255,0.05)",
                border: pwError ? "1px solid rgba(239,68,68,0.45)" : `1px solid ${GREY_BORDER}`,
                borderRadius: 4, color: WHITE_HIGH, fontFamily: SANS,
                fontSize: 14, letterSpacing: "0.05em", outline: "none",
                boxSizing: "border-box", transition: "border-color 0.2s",
              }}
              onFocus={(e) => { if (!pwError) e.target.style.borderColor = GREY_BORDER_FOCUS; }}
              onBlur={(e) => { if (!pwError) e.target.style.borderColor = GREY_BORDER; }}
            />
            <button type="button" onClick={() => setShowPassword((s) => !s)} style={{
              position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)",
              background: "none", border: "none", cursor: "pointer", color: WHITE_LOW, padding: 0,
            }}>
              {showPassword ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>

          {/* Error */}
          {pwError && (
            <p style={{ color: "#f87171", fontFamily: SANS, fontSize: 12, marginBottom: 10, letterSpacing: "0.04em" }}>
              {pwError}
            </p>
          )}

          {/* Submit */}
          <button
            onClick={handlePasswordSubmit}
            disabled={metaLoading || !password.trim()}
            style={{
              width: "100%", padding: "13px 0",
              background: GREY_BTN,
              border: `1px solid ${GREY_BORDER}`,
              borderRadius: 4, color: WHITE_HIGH, fontFamily: SANS,
              fontWeight: 500, fontSize: 12, letterSpacing: "0.14em",
              cursor: password.trim() ? "pointer" : "not-allowed",
              opacity: password.trim() ? 1 : 0.5,
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => { if (password.trim()) e.currentTarget.style.background = GREY_BTN_HOVER; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = GREY_BTN; }}
          >
            {metaLoading ? t("delivery.verifying") : t("delivery.accessGallery")}
          </button>

          {/* Contact */}
          <div style={{ marginTop: 28, textAlign: "center" }}>
            <p style={{ fontFamily: SANS, fontSize: 10, color: "rgba(255,255,255,0.2)", letterSpacing: "0.1em", marginBottom: 8 }}>
              {t("delivery.forAssistance")}
            </p>
            <p style={{ fontFamily: SANS, fontSize: 11, color: "rgba(255,255,255,0.25)", letterSpacing: "0.06em", lineHeight: 1.8 }}>
              Derek &nbsp;·&nbsp; +852 9153 1976
              &nbsp;·&nbsp;
              <a href="https://www.jdstudiohk.com" target="_blank" rel="noopener noreferrer"
                style={{ color: "rgba(255,255,255,0.25)", textDecoration: "none" }}>
                www.jdstudiohk.com
              </a>
            </p>
          </div>
        </div>

        {/* Bottom line */}
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: 1, background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 40%, rgba(255,255,255,0.08) 60%, transparent 100%)" }} />
      </div>
    );
  }

  // ── Content (unlocked) ─────────────────────────────────────────────────────
  if (!content) return null;

  return <DeliveryContentView content={content} />;
}

// ── Full-screen delivery layout ───────────────────────────────────────────────
function DeliveryContentView({ content }: { content: DeliveryContent }) {
  const [desktopIframeLoaded, setDesktopIframeLoaded] = useState(false);
  const [desktopIframeError, setDesktopIframeError] = useState(false);
  const { t, lang } = useLanguage();
  const isMobile = useIsMobile();

  // Fallback: force show desktop iframe after 4s in case onLoad doesn't fire
  useEffect(() => {
    if (isMobile || desktopIframeLoaded || desktopIframeError) return;
    const timer = setTimeout(() => setDesktopIframeLoaded(true), 4000);
    return () => clearTimeout(timer);
  }, [isMobile, desktopIframeLoaded, desktopIframeError]);

  function handleDownloadReceipt() {
    // Open the public receipt print page in a new tab
    // This renders the receipt in the browser using window.print() — no server PDF generation needed
    const token = content.token ?? "";
    window.open(`/receipt/${token}`, "_blank");
  }

  const formattedDate = new Date(content.createdAt).toLocaleDateString(lang === "zh" ? "zh-HK" : "en-GB", {
    year: "numeric", month: "long", day: "numeric",
  });

  // Build Google Drive open URL — support all common Drive URL formats
  const driveOpenUrl = (() => {
    const raw = content.googleDriveUrl || "";
    try {
      const url = new URL(raw);
      // Format 1: /drive/folders/FOLDER_ID or /embeddedfolderview?id=FOLDER_ID
      const folderMatch = url.pathname.match(/\/folders\/([^/?#]+)/);
      if (folderMatch) {
        return `https://drive.google.com/drive/folders/${folderMatch[1]}`;
      }
      // Format 2: /open?id=FILE_OR_FOLDER_ID or /drive/u/0/folders/... with id param
      const idParam = url.searchParams.get("id");
      if (idParam) {
        return `https://drive.google.com/drive/folders/${idParam}`;
      }
      // Format 3: embeddedfolderview?id=FOLDER_ID
      if (url.pathname.includes("embeddedfolderview")) {
        const embId = url.searchParams.get("id");
        if (embId) return `https://drive.google.com/drive/folders/${embId}`;
      }
      // Fallback: return as-is (strip query/hash to avoid redirect loops)
      return `${url.origin}${url.pathname}`;
    } catch {
      return raw;
    }
  })();

  const packages = [
    {
      tag: t("pkg.1.tag"),
      tagColor: GOLD,
      headline: t("pkg.1.headline"),
      desc: t("pkg.1.desc"),
      services: [t("pkg.1.s1"), t("pkg.1.s2"), t("pkg.1.s3")],
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <path d="M3 9h18M9 21V9"/>
        </svg>
      ),
    },
    {
      tag: t("pkg.2.tag"),
      tagColor: "#c084fc",
      headline: t("pkg.2.headline"),
      desc: t("pkg.2.desc"),
      services: [t("pkg.2.s1"), t("pkg.2.s2"), t("pkg.2.s3")],
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#c084fc" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8h1a4 4 0 0 1 0 8h-1"/>
          <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/>
          <line x1="6" y1="1" x2="6" y2="4"/>
          <line x1="10" y1="1" x2="10" y2="4"/>
          <line x1="14" y1="1" x2="14" y2="4"/>
        </svg>
      ),
    },
    {
      tag: t("pkg.3.tag"),
      tagColor: "#4285F4",
      headline: t("pkg.3.headline"),
      desc: t("pkg.3.desc"),
      services: [t("pkg.3.s1"), t("pkg.3.s2"), t("pkg.3.s3")],
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
      ),
    },
    {
      tag: t("pkg.4.tag"),
      tagColor: "#f472b6",
      headline: t("pkg.4.headline"),
      desc: t("pkg.4.desc"),
      services: [t("pkg.4.s1"), t("pkg.4.s2"), t("pkg.4.s3")],
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f472b6" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
          <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
          <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
        </svg>
      ),
    },
  ];

  if (isMobile) return <DeliveryMobileView content={content} driveOpenUrl={driveOpenUrl} formattedDate={formattedDate} packages={packages} />;

  return (
    <div style={{
      minHeight: "100vh",
      height: "100vh",
      overflow: "hidden",
      background: "linear-gradient(160deg, #0c0c0c 0%, #111111 35%, #0e0e0e 65%, #0a0a0a 100%)",
      display: "flex",
      flexDirection: "column",
      fontFamily: SANS,
    }}>
      {/* Top gold bar */}
      <div style={{ height: 2, background: `linear-gradient(90deg, transparent 0%, ${GOLD} 40%, ${GOLD} 60%, transparent 100%)`, opacity: 0.75, flexShrink: 0 }} />

      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 28px", borderBottom: `1px solid ${WHITE_FAINT}`,
        flexShrink: 0,
      }}>
        <img src={LOGO_URL} alt="JD Studio" style={{ height: 30 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <LangToggle />
          <div style={{ textAlign: "right" }}>
            <p style={{ fontFamily: SERIF, color: WHITE_HIGH, fontSize: 15, fontWeight: 300, fontStyle: "italic", margin: 0 }}>
              {content.clientName}
            </p>
            <p style={{ fontFamily: SANS, color: WHITE_LOW, fontSize: 10, letterSpacing: "0.1em", margin: "2px 0 0" }}>
              {formattedDate}
            </p>
          </div>
        </div>
      </div>

      {/* Main 3-column layout */}
      <div style={{
        flex: 1,
        display: "grid",
        gridTemplateColumns: "1fr 2fr 1fr",
        overflow: "hidden",
        minHeight: 0,
      }}>

        {/* ── LEFT PANEL: Message from JD STUDIO ── */}
        <div style={{
          borderRight: `1px solid ${WHITE_FAINT}`,
          padding: "28px 20px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          overflowY: "auto",
          gap: 0,
        }}>

          {/* Brand label */}
          <div style={{
            fontSize: 11, letterSpacing: "0.28em", color: GOLD_DIM,
            fontFamily: SANS, fontWeight: 600, marginBottom: 6,
            textTransform: "uppercase",
          }}>
            JD STUDIO HK
          </div>
          <div style={{ width: 20, height: 1, background: GOLD, opacity: 0.4, marginBottom: 18 }} />

          {/* Heading */}
          <h3 style={{
            fontFamily: SERIF, color: WHITE_HIGH,
            fontSize: 26, fontWeight: 300, fontStyle: "italic",
            letterSpacing: "0.03em", marginBottom: 4, lineHeight: 1.35,
          }}>
            {t("delivery.thankYou")}
          </h3>
          <p style={{ fontFamily: SANS, color: WHITE_LOW, fontSize: 12, letterSpacing: "0.12em", marginBottom: 16 }}>
            {t("delivery.thankYouSub")}
          </p>

          {/* Message body */}
          <p style={{
            fontFamily: SANS, color: WHITE_MED,
            fontSize: 14, lineHeight: 1.85, letterSpacing: "0.02em",
            marginBottom: 6,
          }}>
            {t("delivery.message1")}
            <br />{t("delivery.message2")}
          </p>
          {lang === "zh" && (
            <p style={{ fontFamily: SANS, color: "rgba(255,255,255,0.25)", fontSize: 12, lineHeight: 1.7, letterSpacing: "0.04em", marginBottom: 20, fontStyle: "italic" }}>
              {t("delivery.message1En")}<br />{t("delivery.message2En")}
            </p>
          )}

          {/* Divider */}
          <div style={{ height: 1, background: WHITE_FAINT, width: "100%", marginBottom: 20 }} />

          {/* Stars */}
          <div style={{ display: "flex", gap: 4, marginBottom: 10, justifyContent: "center" }}>
            {[1,2,3,4,5].map((s) => (
              <svg key={s} width="15" height="15" viewBox="0 0 24 24" fill={GOLD} stroke={GOLD} strokeWidth="0.5">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            ))}
          </div>

          {/* Review invitation */}
          <p style={{ fontFamily: SANS, color: WHITE_MED, fontSize: 14, lineHeight: 1.75, letterSpacing: "0.02em", marginBottom: 4 }}>
            {t("delivery.reviewInvite")}
            <br />{t("delivery.reviewInvite2")}
          </p>
          {lang === "zh" && (
            <p style={{ fontFamily: SANS, color: "rgba(255,255,255,0.25)", fontSize: 12, lineHeight: 1.65, letterSpacing: "0.04em", marginBottom: 18, fontStyle: "italic" }}>
              {t("delivery.reviewInviteEn")}<br />{t("delivery.reviewInviteEn2")}
            </p>
          )}

          {/* Google Review Button */}
          <a
            href={GOOGLE_REVIEW_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              gap: 8, padding: "13px 20px",
              background: "rgba(255,255,255,0.06)", color: WHITE_HIGH,
              fontFamily: SANS, fontWeight: 700, fontSize: 13,
              letterSpacing: "0.18em", borderRadius: 3,
              border: `1px solid rgba(255,255,255,0.28)`,
              textDecoration: "none", transition: "all 0.2s",
              marginBottom: 20, width: "100%",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.55)"; e.currentTarget.style.background = "rgba(255,255,255,0.1)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.28)"; e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            {t("delivery.leaveReview")}
          </a>

          {/* Divider */}
          <div style={{ height: 1, background: WHITE_FAINT, width: "100%", marginBottom: 18 }} />

          {/* Contact info */}
          <div style={{ width: "100%" }}>
            <p style={{ fontFamily: SANS, fontSize: 11, letterSpacing: "0.2em", color: WHITE_LOW, marginBottom: 10, textTransform: "uppercase", textAlign: "center" }}>
              {t("delivery.contactUs")}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
              <a href="tel:+85291531976" style={{ display: "flex", alignItems: "center", gap: 7, color: WHITE_MED, fontFamily: SANS, fontSize: 13, textDecoration: "none", letterSpacing: "0.06em" }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.18 6.18l1.97-1.97a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                +852 9153 1976
              </a>
              <a href="https://www.jdstudiohk.com" target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 7, color: GOLD_DIM, fontFamily: SANS, fontSize: 13, textDecoration: "none", letterSpacing: "0.04em" }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
                WWW.JDSTUDIOHK.COM
              </a>
            </div>
          </div>
        </div>

        {/* ── CENTER PANEL: Google Drive ── */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          borderRight: `1px solid ${WHITE_FAINT}`,
        }}>
          {/* Drive header */}
          <div style={{
            padding: "16px 20px 12px",
            borderBottom: `1px solid ${WHITE_FAINT}`,
            display: "flex", alignItems: "center", justifyContent: "space-between",
            flexShrink: 0,
          }}>
            <div>
              <div style={{ fontSize: 9, letterSpacing: "0.2em", color: WHITE_LOW, fontFamily: SANS, fontWeight: 500, marginBottom: 4, textTransform: "uppercase" }}>
                {t("delivery.yourPhotos")}
              </div>
              <h2 style={{ fontFamily: SERIF, color: WHITE_HIGH, fontSize: 18, fontWeight: 400, fontStyle: "italic", margin: 0 }}>
                {content.title}
              </h2>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
              <a
                href={driveOpenUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 7,
                  padding: "9px 18px", background: GOLD, color: "#0a0a0a",
                  fontFamily: SANS, fontWeight: 600, fontSize: 10,
                  letterSpacing: "0.14em", borderRadius: 3, textDecoration: "none",
                  transition: "opacity 0.2s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.2 }}>
                  <span style={{ fontSize: 10, letterSpacing: "0.14em", fontWeight: 700 }}>{t("delivery.openDownload")}</span>
                  <span style={{ fontSize: 8, letterSpacing: "0.1em", fontWeight: 500, opacity: 0.75 }}>{t("delivery.openDownloadSub")}</span>
                </span>
              </a>
              <button
                  onClick={handleDownloadReceipt}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 7,
                    padding: "9px 16px", background: "transparent", color: WHITE_HIGH,
                    fontFamily: SANS, fontWeight: 600, fontSize: 10,
                    letterSpacing: "0.14em", borderRadius: 3, cursor: "pointer",
                    border: `1px solid rgba(255,255,255,0.2)`,
                    transition: "opacity 0.2s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.7"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                  </svg>
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.2 }}>
                    <span style={{ fontSize: 10, letterSpacing: "0.14em", fontWeight: 700 }}>
                      {t("delivery.downloadReceipt")}
                    </span>
                    <span style={{ fontSize: 8, letterSpacing: "0.1em", fontWeight: 500, opacity: 0.75 }}>{t("delivery.downloadReceiptSub")}</span>
                  </span>
                </button>
            </div>
          </div>

          {/* Drive preview — iframe with loading placeholder */}
          <div style={{
            flex: 1, overflow: "hidden",
            background: "#0d0d0d",
            display: "flex", flexDirection: "column",
            position: "relative",
          }}>
            {/* Loading placeholder */}
            {!desktopIframeLoaded && (
              <div style={{
                position: "absolute", inset: 0,
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                background: "linear-gradient(160deg, #0d0d0d 0%, #111 60%, #0a0a0a 100%)",
                gap: 14, zIndex: 1,
              }}>
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="rgba(212,168,67,0.55)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(212,168,67,0.4)" strokeWidth="2.5"
                    style={{ animation: "spin 1s linear infinite" }}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  <span style={{ fontFamily: SANS, fontSize: 11, letterSpacing: "0.12em", color: "rgba(255,255,255,0.3)", fontWeight: 500 }}>LOADING</span>
                </div>
              </div>
            )}
            {!desktopIframeError ? (
              <iframe
                src={content.googleDriveUrl}
                title={t("delivery.yourPhotos")}
                width="100%"
                height="100%"
                frameBorder="0"
                allowFullScreen
                onLoad={() => setDesktopIframeLoaded(true)}
                onError={() => { setDesktopIframeError(true); setDesktopIframeLoaded(true); }}
                style={{ display: "block", width: "100%", height: "100%", opacity: desktopIframeLoaded ? 1 : 0, transition: "opacity 0.4s ease", border: "none" }}
              />
            ) : (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, padding: 40 }}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(212,168,67,0.5)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                <p style={{ fontFamily: SANS, color: WHITE_LOW, fontSize: 11, letterSpacing: "0.1em", textAlign: "center", margin: 0 }}>
                  {t("delivery.driveHint")}
                </p>
                <a href={driveOpenUrl} target="_blank" rel="noopener noreferrer" style={{ fontFamily: SANS, fontSize: 12, color: GOLD, letterSpacing: "0.1em", textDecoration: "underline" }}>
                  {t("delivery.openDownload")}
                </a>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT PANEL: Package Promotions ── */}
        <div style={{
          padding: "24px 20px",
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
          gap: 0,
        }}>
          {/* Section label */}
          <div style={{
            fontSize: 9, letterSpacing: "0.22em", color: GOLD_DIM,
            fontFamily: SANS, fontWeight: 600, marginBottom: 10,
            textTransform: "uppercase",
          }}>
            {t("delivery.nextStep")}
          </div>
          <div style={{ width: 24, height: 1, background: GOLD, opacity: 0.5, marginBottom: 16 }} />

          {/* Package cards */}
          {packages.map((pkg) => (
            <div key={pkg.headline} style={{
              marginBottom: 10,
              padding: "13px 14px",
              background: "rgba(255,255,255,0.025)",
              border: `1px solid ${WHITE_FAINT}`,
              borderRadius: 4,
              position: "relative",
            }}>
              {/* Tag */}
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                marginBottom: 7,
              }}>
                <div style={{ width: 4, height: 4, borderRadius: "50%", background: pkg.tagColor, flexShrink: 0 }} />
                <span style={{ fontFamily: SANS, fontSize: 9, color: pkg.tagColor, letterSpacing: "0.14em", fontWeight: 600 }}>
                  {pkg.tag}
                </span>
              </div>
              {/* Headline */}
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
                <div style={{ flexShrink: 0, marginTop: 1 }}>{pkg.icon}</div>
                <p style={{ fontFamily: SERIF, color: WHITE_HIGH, fontSize: 14, fontWeight: 400, fontStyle: "italic", letterSpacing: "0.02em", lineHeight: 1.3, margin: 0 }}>
                  {pkg.headline}
                </p>
              </div>
              {/* Desc */}
              <p style={{ fontFamily: SANS, color: WHITE_LOW, fontSize: 11, lineHeight: 1.65, letterSpacing: "0.02em", marginBottom: 8 }}>
                {pkg.desc}
              </p>
              {/* Service tags */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {pkg.services.map((s) => (
                  <span key={s} style={{
                    fontFamily: SANS, fontSize: 9, color: WHITE_LOW,
                    padding: "3px 8px", border: `1px solid rgba(255,255,255,0.1)`,
                    borderRadius: 2, letterSpacing: "0.06em",
                  }}>{s}</span>
                ))}
              </div>
            </div>
          ))}

          {/* CTA */}
          <a
            href="https://www.jdstudiohk.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              gap: 8, padding: "11px 16px",
              background: "transparent", color: GOLD,
              fontFamily: SANS, fontWeight: 600, fontSize: 10,
              letterSpacing: "0.14em", borderRadius: 3,
              border: `1px solid ${GOLD_BORDER}`,
              textDecoration: "none", transition: "all 0.2s",
              marginTop: 4, marginBottom: 12,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = GOLD_LIGHT; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.18 6.18l1.97-1.97a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
            </svg>
            {t("delivery.enquireNow")}
          </a>

          {/* Footer brand */}
          <div style={{ marginTop: "auto", paddingTop: 8, textAlign: "center" }}>
            <div style={{ width: 24, height: 1, background: GOLD, opacity: 0.3, margin: "0 auto 10px" }} />
            <img src={LOGO_URL} alt="JD Studio" style={{ height: 20, opacity: 0.45, display: "block", margin: "0 auto 5px" }} />
            <p style={{ fontFamily: SERIF, color: "rgba(255,255,255,0.18)", fontSize: 10, fontStyle: "italic", letterSpacing: "0.04em" }}>
              © {new Date().getFullYear()} JD Studio HK
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function FullPageCenter({ children, bg }: { children: React.ReactNode; bg: string }) {
  return (
    <div style={{
      minHeight: "100vh", height: "100vh", overflow: "hidden",
      background: bg, display: "flex", alignItems: "center",
      justifyContent: "center", fontFamily: SANS,
    }}>
      {children}
    </div>
  );
}

// ── Mobile layout ─────────────────────────────────────────────────────────────
type MobileViewProps = {
  content: DeliveryContent;
  driveOpenUrl: string;
  formattedDate: string;
  packages: Array<{
    tag: string; tagColor: string; headline: string;
    desc: string; services: string[];
    icon: React.ReactNode;
  }>;
};

function DeliveryMobileView({ content, driveOpenUrl, formattedDate, packages }: MobileViewProps) {
  const { t, lang } = useLanguage();
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [iframeError, setIframeError] = useState(false);

  // Fallback: force show iframe after 4s in case onLoad doesn't fire (iOS Safari quirk)
  useEffect(() => {
    if (iframeLoaded || iframeError) return;
    const timer = setTimeout(() => setIframeLoaded(true), 4000);
    return () => clearTimeout(timer);
  }, [iframeLoaded, iframeError]);

  function handleDownloadReceipt() {
    // Open the public receipt print page in a new tab
    // This renders the receipt in the browser using window.print() — no server PDF generation needed
    const token = content.token ?? "";
    window.open(`/receipt/${token}`, "_blank");
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(160deg, #0c0c0c 0%, #111111 35%, #0e0e0e 65%, #0a0a0a 100%)",
      display: "flex", flexDirection: "column", fontFamily: SANS,
      overflowY: "auto", WebkitOverflowScrolling: "touch" as React.CSSProperties["WebkitOverflowScrolling"],
    }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        .mob-dl-btn:active { opacity: 0.82 !important; transform: scale(0.98); }
        .mob-review-btn:active { background: rgba(255,255,255,0.12) !important; }
        .mob-pkg-card { transition: border-color 0.2s; }
        .mob-pkg-card:active { border-color: rgba(212,168,67,0.3) !important; }
      `}</style>

      {/* ── TOP GOLD LINE ── */}
      <div style={{ height: 2, background: `linear-gradient(90deg, transparent 0%, ${GOLD} 40%, ${GOLD} 60%, transparent 100%)`, opacity: 0.8, flexShrink: 0 }} />

      {/* ── HERO SECTION ── */}
      <div style={{
        padding: "32px 20px 28px",
        display: "flex", flexDirection: "column", alignItems: "center",
        textAlign: "center",
        borderBottom: `1px solid ${WHITE_FAINT}`,
        animation: "fadeUp 0.5s ease both",
      }}>
        {/* Logo */}
        <img src={LOGO_URL} alt="JD Studio" style={{ height: 36, marginBottom: 20, opacity: 0.92 }} />

        {/* Lang toggle */}
        <div style={{ position: "absolute", top: 12, right: 16 }}>
          <LangToggle />
        </div>

        {/* Label */}
        <div style={{ fontSize: 9, letterSpacing: "0.22em", color: WHITE_LOW, fontFamily: SANS, fontWeight: 500, marginBottom: 8, textTransform: "uppercase" }}>
          {t("delivery.yourPhotos")}
        </div>

        {/* Client name */}
        <h1 style={{ fontFamily: SERIF, color: WHITE_HIGH, fontSize: 28, fontWeight: 300, fontStyle: "italic", letterSpacing: "0.03em", margin: "0 0 4px", lineHeight: 1.25 }}>
          {content.clientName}
        </h1>

        {/* Date */}
        <p style={{ fontFamily: SANS, color: WHITE_LOW, fontSize: 11, letterSpacing: "0.12em", margin: "0 0 6px" }}>
          {formattedDate}
        </p>

        {/* Gold divider */}
        <div style={{ width: 32, height: 1, background: GOLD, opacity: 0.45, margin: "10px auto 20px" }} />

        {/* Album title */}
        <p style={{ fontFamily: SERIF, color: "rgba(255,255,255,0.5)", fontSize: 14, fontStyle: "italic", letterSpacing: "0.04em", margin: "0 0 24px" }}>
          {content.title}
        </p>

        {/* ── DRIVE PREVIEW ── */}
        <div style={{
          width: "100%",
          borderRadius: 8,
          overflow: "hidden",
          border: `1px solid rgba(212,168,67,0.15)`,
          marginBottom: 20,
          background: "#111",
          position: "relative",
          height: iframeError ? 160 : 420,
        }}>
          {/* Loading placeholder */}
          {!iframeLoaded && (
            <div style={{
              position: "absolute", inset: 0,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              background: "linear-gradient(160deg, #111 0%, #0e0e0e 100%)",
              gap: 14, zIndex: 1,
            }}>
              {/* Camera icon */}
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="rgba(212,168,67,0.55)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              {/* Spinner */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(212,168,67,0.4)" strokeWidth="2.5"
                  style={{ animation: "spin 1s linear infinite" }}>
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                <span style={{ fontFamily: SANS, fontSize: 11, letterSpacing: "0.12em", color: "rgba(255,255,255,0.3)", fontWeight: 500 }}>
                  LOADING
                </span>
              </div>
            </div>
          )}
          {!iframeError ? (
            <iframe
              src={content.googleDriveUrl}
              title={t("delivery.yourPhotos")}
              width="100%"
              height="420"
              frameBorder="0"
              allowFullScreen
              onLoad={() => setIframeLoaded(true)}
              onError={() => { setIframeError(true); setIframeLoaded(true); }}
              style={{ display: "block", width: "100%", height: 420, opacity: iframeLoaded ? 1 : 0, transition: "opacity 0.4s ease" }}
            />
          ) : (
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="rgba(212,168,67,0.5)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              <a href={driveOpenUrl} target="_blank" rel="noopener noreferrer" style={{ fontFamily: SANS, fontSize: 11, color: GOLD, letterSpacing: "0.1em", textDecoration: "underline" }}>
                {t("delivery.openDownload")}
              </a>
            </div>
          )}
        </div>

        {/* ── MAIN DOWNLOAD BUTTON ── */}
        <a
          href={driveOpenUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mob-dl-btn"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
            width: "100%", padding: "18px 20px",
            background: `linear-gradient(135deg, ${GOLD} 0%, #c49a30 100%)`,
            color: "#0a0a0a",
            fontFamily: SANS, fontWeight: 700, fontSize: 14,
            letterSpacing: "0.1em", borderRadius: 6, textDecoration: "none",
            boxShadow: `0 4px 24px rgba(212,168,67,0.25)`,
            transition: "opacity 0.15s, transform 0.15s",
            marginBottom: 12,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.3 }}>
            <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.1em" }}>{t("delivery.openDownload")}</span>
            <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.65, letterSpacing: "0.06em" }}>{t("delivery.openDownloadSub")}</span>
          </span>
        </a>

        {/* Receipt button - always shown */}
          <button
            onClick={handleDownloadReceipt}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              width: "100%", padding: "13px 20px",
              background: "transparent", color: WHITE_MED,
              fontFamily: SANS, fontWeight: 500, fontSize: 12,
              letterSpacing: "0.1em", borderRadius: 6, cursor: "pointer",
              border: `1px solid rgba(255,255,255,0.15)`,
              transition: "opacity 0.15s",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            {t("delivery.downloadReceipt")}
          </button>
      </div>

      {/* ── THANK YOU SECTION ── */}
      <div style={{
        padding: "32px 20px 28px",
        borderBottom: `1px solid ${WHITE_FAINT}`,
        animation: "fadeUp 0.5s 0.1s ease both",
      }}>
        {/* Brand label */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <div style={{ flex: 1, height: 1, background: WHITE_FAINT }} />
          <span style={{ fontSize: 9, letterSpacing: "0.22em", color: GOLD_DIM, fontFamily: SANS, fontWeight: 600, textTransform: "uppercase" }}>JD STUDIO HK</span>
          <div style={{ flex: 1, height: 1, background: WHITE_FAINT }} />
        </div>

        {/* Heading */}
        <h2 style={{ fontFamily: SERIF, color: WHITE_HIGH, fontSize: 26, fontWeight: 300, fontStyle: "italic", letterSpacing: "0.03em", margin: "0 0 6px", lineHeight: 1.3 }}>
          {t("delivery.thankYou")}
        </h2>
        <p style={{ fontFamily: SANS, color: WHITE_LOW, fontSize: 11, letterSpacing: "0.1em", margin: "0 0 16px" }}>
          {t("delivery.thankYouSub")}
        </p>

        {/* Message */}
        <p style={{ fontFamily: SANS, color: WHITE_MED, fontSize: 14, lineHeight: 1.9, letterSpacing: "0.02em", margin: "0 0 6px" }}>
          {t("delivery.message1")}<br />{t("delivery.message2")}
        </p>
        {lang === "zh" && (
          <p style={{ fontFamily: SANS, color: "rgba(255,255,255,0.22)", fontSize: 12, lineHeight: 1.75, letterSpacing: "0.03em", margin: "0 0 24px", fontStyle: "italic" }}>
            {t("delivery.message1En")}<br />{t("delivery.message2En")}
          </p>
        )}

        {/* Stars + Review */}
        <div style={{
          background: "rgba(255,255,255,0.03)",
          border: `1px solid rgba(212,168,67,0.15)`,
          borderRadius: 8, padding: "20px 16px",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
        }}>
          <div style={{ display: "flex", gap: 5 }}>
            {[1,2,3,4,5].map((s) => (
              <svg key={s} width="18" height="18" viewBox="0 0 24 24" fill={GOLD} stroke={GOLD} strokeWidth="0.3">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            ))}
          </div>
          <p style={{ fontFamily: SANS, color: WHITE_MED, fontSize: 13, lineHeight: 1.75, letterSpacing: "0.02em", textAlign: "center", margin: 0 }}>
            {t("delivery.reviewInvite")}<br />{t("delivery.reviewInvite2")}
          </p>
          {lang === "zh" && (
            <p style={{ fontFamily: SANS, color: "rgba(255,255,255,0.22)", fontSize: 11, lineHeight: 1.65, letterSpacing: "0.03em", textAlign: "center", margin: 0, fontStyle: "italic" }}>
              {t("delivery.reviewInviteEn")}<br />{t("delivery.reviewInviteEn2")}
            </p>
          )}
          <a
            href={GOOGLE_REVIEW_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mob-review-btn"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              gap: 8, padding: "13px 20px", width: "100%",
              background: "rgba(255,255,255,0.06)", color: WHITE_HIGH,
              fontFamily: SANS, fontWeight: 600, fontSize: 12,
              letterSpacing: "0.12em", borderRadius: 6,
              border: `1px solid rgba(255,255,255,0.2)`,
              textDecoration: "none", transition: "background 0.15s",
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            {t("delivery.leaveReview")}
          </a>
        </div>
      </div>

      {/* ── CONTACT SECTION ── */}
      <div style={{
        padding: "24px 20px",
        borderBottom: `1px solid ${WHITE_FAINT}`,
        display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
        animation: "fadeUp 0.5s 0.2s ease both",
      }}>
        <p style={{ fontFamily: SANS, fontSize: 9, letterSpacing: "0.22em", color: WHITE_LOW, textTransform: "uppercase", margin: 0 }}>
          {t("delivery.contactUs")}
        </p>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <a href="tel:+85291531976" style={{
            display: "flex", alignItems: "center", gap: 6,
            color: WHITE_MED, fontFamily: SANS, fontSize: 14, textDecoration: "none",
            padding: "10px 16px", border: `1px solid rgba(255,255,255,0.1)`, borderRadius: 6,
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.18 6.18l1.97-1.97a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
            +852 9153 1976
          </a>
          <a href="https://www.jdstudiohk.com" target="_blank" rel="noopener noreferrer" style={{
            display: "flex", alignItems: "center", gap: 6,
            color: GOLD_DIM, fontFamily: SANS, fontSize: 12, textDecoration: "none",
            padding: "10px 16px", border: `1px solid rgba(212,168,67,0.15)`, borderRadius: 6,
            letterSpacing: "0.04em",
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            JDSTUDIOHK.COM
          </a>
        </div>
      </div>

      {/* ── PACKAGES SECTION ── */}
      <div style={{ padding: "28px 20px 36px", animation: "fadeUp 0.5s 0.3s ease both" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
          <div style={{ width: 20, height: 1, background: GOLD, opacity: 0.5 }} />
          <span style={{ fontSize: 9, letterSpacing: "0.22em", color: GOLD_DIM, fontFamily: SANS, fontWeight: 600, textTransform: "uppercase" }}>
            {t("delivery.nextStep")}
          </span>
        </div>

        {/* Horizontal scroll cards */}
        <div style={{
          display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8,
          scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" as React.CSSProperties["WebkitOverflowScrolling"],
          marginBottom: 20,
        }}>
          {packages.map((pkg) => (
            <div key={pkg.headline} className="mob-pkg-card" style={{
              flexShrink: 0, width: 220,
              padding: "16px 14px",
              background: "rgba(255,255,255,0.025)",
              border: `1px solid ${WHITE_FAINT}`, borderRadius: 6,
              scrollSnapAlign: "start",
            }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 5, marginBottom: 8 }}>
                <div style={{ width: 4, height: 4, borderRadius: "50%", background: pkg.tagColor, flexShrink: 0 }} />
                <span style={{ fontFamily: SANS, fontSize: 9, color: pkg.tagColor, letterSpacing: "0.14em", fontWeight: 600 }}>{pkg.tag}</span>
              </div>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
                <div style={{ flexShrink: 0, marginTop: 1 }}>{pkg.icon}</div>
                <p style={{ fontFamily: SERIF, color: WHITE_HIGH, fontSize: 15, fontWeight: 400, fontStyle: "italic", letterSpacing: "0.02em", lineHeight: 1.3, margin: 0 }}>
                  {pkg.headline}
                </p>
              </div>
              <p style={{ fontFamily: SANS, color: WHITE_LOW, fontSize: 12, lineHeight: 1.65, letterSpacing: "0.02em", marginBottom: 8 }}>{pkg.desc}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {pkg.services.map((s) => (
                  <span key={s} style={{ fontFamily: SANS, fontSize: 9, color: WHITE_LOW, padding: "3px 8px", border: `1px solid rgba(255,255,255,0.1)`, borderRadius: 2, letterSpacing: "0.06em" }}>{s}</span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <a
          href="https://www.jdstudiohk.com"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            gap: 8, padding: "13px 16px",
            background: "transparent", color: GOLD,
            fontFamily: SANS, fontWeight: 600, fontSize: 11,
            letterSpacing: "0.14em", borderRadius: 4,
            border: `1px solid ${GOLD_BORDER}`,
            textDecoration: "none", marginBottom: 24,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.18 6.18l1.97-1.97a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
          </svg>
          {t("delivery.enquireNow")}
        </a>

        {/* Footer */}
        <div style={{ textAlign: "center", paddingTop: 8 }}>
          <div style={{ width: 24, height: 1, background: GOLD, opacity: 0.3, margin: "0 auto 10px" }} />
          <img src={LOGO_URL} alt="JD Studio" style={{ height: 20, opacity: 0.45, display: "block", margin: "0 auto 5px" }} />
          <p style={{ fontFamily: SERIF, color: "rgba(255,255,255,0.18)", fontSize: 10, fontStyle: "italic", letterSpacing: "0.04em" }}>
            © {new Date().getFullYear()} JD Studio HK
          </p>
        </div>
      </div>
    </div>
  );
}
