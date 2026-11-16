import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { useState, useEffect } from "react";
import { useLanguage, LangToggle } from "@/contexts/LanguageContext";
import { DeliveryGalleryView } from "@/components/DeliveryGalleryView";

const LOGO_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663457748523/VbnWSJV6UQ79sGuykqPPae/jd-studio-logo-dark_3217ad3b.png";

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

  return (
    <DeliveryContentView
      content={content}
      password={submittedPassword}
    />
  );
}

// ── Full-screen delivery layout (PicSpot-style gallery) ───────────────────────
function DeliveryContentView({
  content,
  password,
}: {
  content: DeliveryContent;
  password?: string;
}) {
  return <DeliveryGalleryView content={content} password={password} />;
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

