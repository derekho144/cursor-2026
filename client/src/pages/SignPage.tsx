import { trpc } from "@/lib/trpc";
import { useParams } from "wouter";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, CheckCircle2, Paperclip, RotateCcw } from "lucide-react";
import { useLanguage, LangToggle } from "@/contexts/LanguageContext";
import { SERVICE_LABELS, SERVICE_LABELS_EN } from "@/lib/serviceLabels";

// ── Google Font injection ──────────────────────────────────────────────────────
if (typeof document !== "undefined" && !document.getElementById("sign-fonts")) {
  const link = document.createElement("link");
  link.id = "sign-fonts";
  link.rel = "stylesheet";
  link.href =
    "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&family=Montserrat:wght@300;400;500;600&display=swap";
  document.head.appendChild(link);
}

// ── Design tokens — Gradient Grey Premium ─────────────────────────────────────
const BG = "linear-gradient(160deg, #0c0c0c 0%, #141414 30%, #111111 60%, #0d0d0d 100%)";
const CARD_BG = "linear-gradient(145deg, rgba(255,255,255,0.055) 0%, rgba(255,255,255,0.025) 100%)";
const SIGN_CARD_BG = "linear-gradient(145deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.03) 100%)";
const ACCENT = "rgba(255,255,255,0.75)";
const ACCENT_MED = "rgba(255,255,255,0.50)";
const ACCENT_LOW = "rgba(255,255,255,0.28)";
const ACCENT_FAINT = "rgba(255,255,255,0.07)";
const BORDER = "rgba(255,255,255,0.10)";
const BORDER_ACTIVE = "rgba(255,255,255,0.35)";
const DIVIDER = "rgba(255,255,255,0.08)";
const BTN_ACTIVE = "linear-gradient(135deg, rgba(255,255,255,0.92) 0%, rgba(220,220,220,0.88) 100%)";
const BTN_ACTIVE_TEXT = "#0a0a0a";
const CANVAS_STROKE = "rgba(20,20,20,0.90)";
const TOP_BAR = "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.30) 40%, rgba(255,255,255,0.30) 60%, transparent 100%)";
const SERIF = "'Cormorant Garamond', Georgia, serif";
const SANS = "'Montserrat', 'Helvetica Neue', Arial, sans-serif";
const LOGO_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663457748523/VbnWSJV6UQ79sGuykqPPae/jd-studio-logo-dark_3217ad3b.png";

export default function SignPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const { t, lang } = useLanguage();

  const { data: quote, isLoading, error } = trpc.quotes.getBySignToken.useQuery(
    { token: token ?? "" },
    { enabled: !!token, retry: false }
  );

  const [signerName, setSignerName] = useState("");
  const [legalAgreed, setLegalAgreed] = useState(false);
  const [signed, setSigned] = useState(false);
  const [confirmedEmail, setConfirmedEmail] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  const submitSignatureMutation = trpc.quotes.submitSignature.useMutation({
    onSuccess: (data: { success: boolean; clientEmail?: string | null }) => {
      setSigned(true);
      setConfirmedEmail(data.clientEmail ?? null);
      toast.success(lang === "en" ? "Signed successfully! Thank you for confirming." : "簽署成功！感謝您的確認。");
    },
    onError: (e) => toast.error(`${lang === "en" ? "Sign failed" : "簽署失敗"}：${e.message}`),
  });

  const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      const touch = e.touches[0];
      return { x: (touch.clientX - rect.left) * scaleX, y: (touch.clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    setIsDrawing(true);
    lastPos.current = getPos(e, canvas);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !lastPos.current) return;
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = CANVAS_STROKE;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    lastPos.current = pos;
    setHasSignature(true);
  };

  const endDraw = () => { setIsDrawing(false); lastPos.current = null; };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  };

  const handleSubmit = () => {
    if (!signerName.trim()) { toast.error(t("sign.toast.noName")); return; }
    if (!hasSignature) { toast.error(t("sign.toast.noSignature")); return; }
    if (!legalAgreed) { toast.error(t("sign.toast.noLegal")); return; }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const exportCtx = exportCanvas.getContext("2d");
    if (!exportCtx) return;
    exportCtx.fillStyle = "#ffffff";
    exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    exportCtx.drawImage(canvas, 0, 0);
    const signatureData = exportCanvas.toDataURL("image/jpeg", 0.9);
    submitSignatureMutation.mutate({ token: token ?? "", signedByName: signerName.trim(), signatureData, origin: window.location.origin });
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: BG }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: "50%", border: `2px solid ${BORDER}`, borderTopColor: ACCENT_MED, animation: "spin 1s linear infinite" }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <p style={{ color: ACCENT_LOW, fontSize: 11, letterSpacing: "0.18em", fontFamily: SANS, fontWeight: 500 }}>{t("loading")}</p>
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error || !quote) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, background: BG, padding: "0 24px" }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: SERIF, color: ACCENT, fontSize: 24, fontWeight: 400, marginBottom: 8 }}>{t("error.invalidLink")}</div>
          <div style={{ fontFamily: SANS, color: ACCENT_MED, fontSize: 13 }}>{t("error.contactUs")}</div>
        </div>
        <a href="https://www.jdstudiohk.com" target="_blank" rel="noopener noreferrer" style={{ color: ACCENT_LOW, fontFamily: SANS, fontSize: 13, textDecoration: "none" }}>
          www.jdstudiohk.com
        </a>
      </div>
    );
  }

  // ── Already signed ─────────────────────────────────────────────────────────
  if (signed || quote.signedAt) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: BG, fontFamily: SANS }}>
        <div style={{ height: 1, background: TOP_BAR }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 28px", borderBottom: `1px solid ${DIVIDER}` }}>
          <img src={LOGO_URL} alt="JD Studio" style={{ height: 30 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <LangToggle />
            <div style={{ fontSize: 10, letterSpacing: "0.2em", color: ACCENT_LOW, textTransform: "uppercase" }}>{t("sign.header.label")}</div>
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24, padding: "40px 24px" }}>
          <div style={{ width: 80, height: 80, borderRadius: "50%", background: ACCENT_FAINT, border: `1px solid ${BORDER}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <CheckCircle2 style={{ width: 36, height: 36, color: ACCENT }} />
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: SERIF, color: ACCENT, fontSize: 32, fontWeight: 300, fontStyle: "italic", marginBottom: 8 }}>{t("sign.alreadySigned.title")}</div>
            <div style={{ fontFamily: SANS, color: ACCENT_MED, fontSize: 13, letterSpacing: "0.06em" }}>
              {quote.signedByName || signerName} {t("sign.alreadySigned.signedBy")} {new Date(quote.signedAt ?? Date.now()).toLocaleString(lang === "en" ? "en-HK" : "zh-HK")}
            </div>
          </div>
          <div style={{ height: 1, width: 60, background: `linear-gradient(90deg, transparent, ${BORDER_ACTIVE}, transparent)` }} />
          <div style={{ fontFamily: SANS, color: ACCENT_LOW, fontSize: 12, textAlign: "center", lineHeight: 1.8, letterSpacing: "0.04em" }}>
            {t("sign.alreadySigned.thankYou")}<br />
            <span style={{ fontStyle: "italic", color: "rgba(255,255,255,0.2)" }}>{t("sign.alreadySigned.thankYouSub")}</span>
          </div>
          {(confirmedEmail || quote.clientEmail) && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", background: "rgba(255,255,255,0.05)", border: `1px solid ${BORDER}`, borderRadius: 4 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={ACCENT_MED} strokeWidth="1.5" style={{ flexShrink: 0 }}>
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
              <span style={{ fontFamily: SANS, fontSize: 12, color: ACCENT_MED }}>
                {t("sign.alreadySigned.emailSent")} <strong style={{ color: ACCENT }}>{confirmedEmail || quote.clientEmail}</strong>
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }

  const items: Array<{ description: string; quantity: string; unit?: string; unitPrice: string; amount: string; isIncluded?: boolean }> = (quote as any).items ?? [];
  const attachments: Array<{ name: string; url: string; key: string }> =
    Array.isArray(quote.signAttachments) ? quote.signAttachments : [];
  const clientCompany = (quote as any).clientCompany as string | undefined;

  const canSubmit = signerName.trim() && hasSignature && legalAgreed && !submitSignatureMutation.isPending;

  const serviceLabel = lang === "en"
    ? (SERVICE_LABELS_EN[quote.serviceType] ?? quote.serviceType)
    : (SERVICE_LABELS[quote.serviceType] ?? quote.serviceType);

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: SANS }}>
      {/* Top shimmer bar */}
      <div style={{ height: 1, background: TOP_BAR }} />

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 28px", borderBottom: `1px solid ${DIVIDER}` }}>
        <img src={LOGO_URL} alt="JD Studio" style={{ height: 30 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <LangToggle />
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: SERIF, color: ACCENT, fontSize: 15, fontWeight: 300, fontStyle: "italic" }}>
              {clientCompany || quote.clientName}
            </div>
            <div style={{ fontFamily: SANS, color: ACCENT_LOW, fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", marginTop: 2 }}>{t("sign.header.label")}</div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 800, margin: "0 auto", padding: "32px 20px 80px" }}>

        {/* Quote card */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 6, overflow: "hidden", marginBottom: 24, backdropFilter: "blur(4px)" }}>
          {/* Quote header */}
          <div className="flex justify-between items-start flex-wrap gap-3" style={{ background: "rgba(255,255,255,0.04)", borderBottom: `1px solid ${DIVIDER}`, padding: "20px 20px" }}>
            <div>
              <div style={{ fontSize: 9, letterSpacing: "0.28em", color: ACCENT_LOW, textTransform: "uppercase", marginBottom: 4, fontFamily: SANS }}>{t("sign.quotation.label")}</div>
              <div style={{ fontFamily: SERIF, color: ACCENT, fontSize: 28, fontWeight: 300, letterSpacing: "0.05em" }}>{quote.quoteNumber}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: SANS, color: ACCENT_LOW, fontSize: 11, letterSpacing: "0.1em" }}>
                DATE {new Date(quote.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase()}
              </div>
              {quote.validUntil && (
                <div style={{ fontFamily: SANS, color: ACCENT_MED, fontSize: 11, marginTop: 4, letterSpacing: "0.08em" }}>
                  VALID UNTIL {quote.validUntil}
                </div>
              )}
            </div>
          </div>

          <div style={{ padding: "24px 28px" }}>
            {/* Client + Service */}
            <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: 24, marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: 9, letterSpacing: "0.2em", color: ACCENT_LOW, textTransform: "uppercase", marginBottom: 8, fontFamily: SANS }}>{t("sign.preparedFor")}</div>
                {clientCompany && (
                  <div style={{ fontFamily: SANS, fontWeight: 500, fontSize: 13, color: ACCENT_LOW, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>{clientCompany}</div>
                )}
                <div style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 18, color: ACCENT }}>{quote.clientName}</div>
                {quote.clientEmail && <div style={{ color: ACCENT_MED, fontSize: 13, marginTop: 4, fontFamily: SANS }}>{quote.clientEmail}</div>}
                {quote.clientPhone && <div style={{ color: ACCENT_MED, fontSize: 13, fontFamily: SANS }}>{quote.clientPhone}</div>}
              </div>
              <div>
                <div style={{ fontSize: 9, letterSpacing: "0.2em", color: ACCENT_LOW, textTransform: "uppercase", marginBottom: 8, fontFamily: SANS }}>{t("sign.serviceDetails")}</div>
                <div style={{ display: "inline-block", background: "rgba(255,255,255,0.08)", color: ACCENT_MED, padding: "4px 12px", borderRadius: 2, fontSize: 12, letterSpacing: "0.1em", border: `1px solid ${BORDER}`, fontFamily: SANS }}>
                  {serviceLabel}
                </div>
                {quote.shootingDate && <div style={{ color: ACCENT_MED, fontSize: 13, marginTop: 8, fontFamily: SANS }}>{t("sign.shootingDate")}{quote.shootingDate}</div>}
                {quote.shootingLocation && <div style={{ color: ACCENT_MED, fontSize: 13, fontFamily: SANS }}>{t("sign.shootingLocation")}{quote.shootingLocation}</div>}
              </div>
            </div>

            {/* Items table */}
            <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 360, borderCollapse: "collapse", marginBottom: 16 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${DIVIDER}` }}>
                  {[t("sign.qty"), t("sign.description"), t("sign.unitPrice"), t("sign.amount")].map((h, i) => (
                    <th key={h} style={{ textAlign: i === 0 ? "left" : i < 2 ? "left" : "right", padding: "8px 0", fontSize: 9, letterSpacing: "0.15em", color: ACCENT_LOW, textTransform: "uppercase", fontWeight: 400, fontFamily: SANS, width: i === 0 ? 40 : undefined }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={idx} style={{ borderBottom: `1px solid rgba(255,255,255,0.04)`, background: idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)" }}>
                    <td style={{ padding: "10px 0", fontSize: 13, color: ACCENT_MED, verticalAlign: "top", fontFamily: SANS }}>{item.quantity}</td>
                    <td style={{ padding: "10px 8px 10px 0", fontSize: 13, color: ACCENT, verticalAlign: "top", fontFamily: SANS }}>{item.description}</td>
                    <td style={{ padding: "10px 0", fontSize: 13, color: item.isIncluded ? ACCENT_LOW : ACCENT_MED, textAlign: "right", verticalAlign: "top", fontFamily: SANS }}>
                      {item.isIncluded ? t("sign.included") : `${quote.currency} ${Number(item.unitPrice).toLocaleString()}`}
                    </td>
                    <td style={{ padding: "10px 0", fontSize: 13, color: item.isIncluded ? ACCENT_LOW : ACCENT, textAlign: "right", verticalAlign: "top", fontFamily: SANS }}>
                      {item.isIncluded ? t("sign.included") : `${quote.currency} ${Number(item.amount).toLocaleString()}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>

            {/* Total */}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <div style={{ textAlign: "right" }}>
                {Number(quote.discountAmount) > 0 && (
                  <div style={{ fontFamily: SANS, fontSize: 12, color: ACCENT_LOW, marginBottom: 4 }}>
                    {t("sign.subtotal")}: {quote.currency} {Number(quote.subtotal ?? 0).toLocaleString()}
                    <span style={{ marginLeft: 12, color: "#f87171" }}>{t("sign.discount")}{Number((quote as any).discountPercent) > 0 ? ` (${Number((quote as any).discountPercent)}%)` : ""}: -{quote.currency} {Number(quote.discountAmount ?? 0).toLocaleString()}</span>
                  </div>
                )}
                <div style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 400, color: ACCENT, letterSpacing: "0.05em" }}>
                  {quote.currency} {Number(quote.total).toLocaleString()}
                </div>
              </div>
            </div>

            {/* Notes */}
            {(quote as any).notes && (
              <div style={{ marginTop: 16, padding: "12px 16px", background: ACCENT_FAINT, borderLeft: `2px solid ${BORDER_ACTIVE}`, borderRadius: 2 }}>
                <div style={{ fontSize: 9, letterSpacing: "0.2em", color: ACCENT_LOW, textTransform: "uppercase", marginBottom: 6, fontFamily: SANS }}>{t("sign.notes")}</div>
                <div style={{ fontFamily: SANS, color: ACCENT_MED, fontSize: 13, lineHeight: 1.7 }}>{(quote as any).notes}</div>
              </div>
            )}
          </div>
        </div>

        {/* Attachments */}
        {attachments.length > 0 && (
          <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 6, padding: "20px 24px", marginBottom: 24 }}>
            <div style={{ fontSize: 9, letterSpacing: "0.2em", color: ACCENT_LOW, textTransform: "uppercase", marginBottom: 14, fontFamily: SANS }}>{t("sign.attachments")}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {attachments.map((att) => (
                <a
                  key={att.key}
                  href={att.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: ACCENT_FAINT, border: `1px solid ${BORDER}`, borderRadius: 3, textDecoration: "none", transition: "all 0.15s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = BORDER_ACTIVE; e.currentTarget.style.background = "rgba(255,255,255,0.10)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.background = ACCENT_FAINT; }}
                >
                  <Paperclip style={{ width: 13, height: 13, color: ACCENT_MED, flexShrink: 0 }} />
                  <span style={{ fontFamily: SANS, fontSize: 13, color: ACCENT_MED }}>{att.name}</span>
                  <span style={{ marginLeft: "auto", fontFamily: SANS, fontSize: 10, color: ACCENT_LOW, letterSpacing: "0.1em" }}>{t("sign.download")}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* ── Signature section ──────────────────────────────────────────────── */}
        <div style={{ background: SIGN_CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 6, padding: "28px 28px 24px", backdropFilter: "blur(4px)" }}>

          {/* Section label */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
            <div style={{ height: 1, flex: 1, background: DIVIDER }} />
            <div style={{ fontSize: 9, letterSpacing: "0.28em", color: ACCENT_LOW, textTransform: "uppercase", fontFamily: SANS, whiteSpace: "nowrap" }}>{t("sign.signature.label")}</div>
            <div style={{ height: 1, flex: 1, background: DIVIDER }} />
          </div>

          <div style={{ fontFamily: SANS, color: ACCENT_MED, fontSize: 13, lineHeight: 1.8, marginBottom: 24 }}>
            {t("sign.signature.consent")}
          </div>

          {/* Signer name */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontFamily: SANS, fontSize: 9, letterSpacing: "0.18em", color: ACCENT_LOW, textTransform: "uppercase", marginBottom: 8 }}>
              {t("sign.signerName.label")}
            </label>
            <input
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder={t("sign.signerName.placeholder")}
              style={{
                width: "100%", padding: "11px 14px", boxSizing: "border-box",
                background: "rgba(255,255,255,0.05)", border: `1px solid ${BORDER}`,
                borderRadius: 3, color: ACCENT, fontFamily: SANS, fontSize: 14,
                outline: "none", transition: "border-color 0.2s",
              }}
              onFocus={(e) => { e.target.style.borderColor = BORDER_ACTIVE; }}
              onBlur={(e) => { e.target.style.borderColor = BORDER; }}
            />
          </div>

          {/* Signature canvas */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <label style={{ fontFamily: SANS, fontSize: 9, letterSpacing: "0.18em", color: ACCENT_LOW, textTransform: "uppercase" }}>
                {t("sign.canvas.label")}
              </label>
              {hasSignature && (
                <button
                  onClick={clearCanvas}
                  style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: SANS, fontSize: 11, color: ACCENT_LOW, background: "none", border: "none", cursor: "pointer", letterSpacing: "0.08em" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = ACCENT_MED; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = ACCENT_LOW; }}
                >
                  <RotateCcw style={{ width: 11, height: 11 }} />
                  {t("sign.canvas.clear")}
                </button>
              )}
            </div>
            <div style={{ position: "relative", border: "1px solid #d0d0d0", borderRadius: 3, background: "#ffffff", touchAction: "none" }}>
              <canvas
                ref={canvasRef}
                width={720}
                height={160}
                style={{ width: "100%", height: 160, display: "block", cursor: "crosshair", touchAction: "none" }}
                onMouseDown={startDraw}
                onMouseMove={draw}
                onMouseUp={endDraw}
                onMouseLeave={endDraw}
                onTouchStart={startDraw}
                onTouchMove={draw}
                onTouchEnd={endDraw}
              />
              {!hasSignature && (
                <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", display: "flex", alignItems: "center", gap: 8, color: "rgba(0,0,0,0.30)", pointerEvents: "none" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                  <span style={{ fontFamily: SANS, fontSize: 13, letterSpacing: "0.06em" }}>{t("sign.canvas.placeholder")}</span>
                </div>
              )}
            </div>
          </div>

          {/* Terms */}
          <div style={{ background: "rgba(255,255,255,0.04)", padding: "14px 18px", borderRadius: 4, marginBottom: 16, border: `1px solid ${DIVIDER}` }}>
            <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 10, letterSpacing: "0.15em", color: ACCENT_LOW, textTransform: "uppercase", marginBottom: 10 }}>{t("sign.terms.label")}</div>
            {[t("sign.terms.1"), t("sign.terms.2"), t("sign.terms.3"), t("sign.terms.4")].map((term) => (
              <div key={term} style={{ fontFamily: SANS, color: ACCENT_LOW, fontSize: 12, lineHeight: 1.9, letterSpacing: "0.02em" }}>· {term}</div>
            ))}
          </div>

          {/* Legal confirmation checkbox */}
          <label
            style={{
              display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 24,
              cursor: "pointer", padding: "14px 16px", borderRadius: 4,
              border: legalAgreed ? `1px solid ${BORDER_ACTIVE}` : `1px solid ${BORDER}`,
              background: legalAgreed ? "rgba(255,255,255,0.07)" : ACCENT_FAINT,
              transition: "all 0.2s",
            }}
          >
            <input
              type="checkbox"
              checked={legalAgreed}
              onChange={(e) => setLegalAgreed(e.target.checked)}
              style={{ marginTop: 2, width: 15, height: 15, flexShrink: 0, cursor: "pointer", accentColor: ACCENT }}
            />
            <span>
              <span style={{ fontFamily: SANS, fontSize: 13, color: ACCENT_MED, lineHeight: 1.7, display: "block" }}>
                {t("sign.legal.zh")}
              </span>
              <span style={{ fontFamily: SANS, fontSize: 11, color: ACCENT_LOW, lineHeight: 1.6, fontStyle: "italic", display: "block", marginTop: 4 }}>
                {t("sign.legal.en")}
              </span>
            </span>
          </label>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              width: "100%", padding: "15px", border: "none", borderRadius: 4,
              background: canSubmit ? BTN_ACTIVE : "rgba(255,255,255,0.08)",
              color: canSubmit ? BTN_ACTIVE_TEXT : ACCENT_LOW,
              fontFamily: SANS, fontWeight: 700, fontSize: 13, letterSpacing: "0.18em",
              cursor: canSubmit ? "pointer" : "not-allowed",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => { if (canSubmit) (e.currentTarget as HTMLButtonElement).style.opacity = "0.90"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
          >
            {submitSignatureMutation.isPending ? (
              <Loader2 style={{ width: 16, height: 16, animation: "spin 1s linear infinite" }} />
            ) : (
              <CheckCircle2 style={{ width: 16, height: 16 }} />
            )}
            {submitSignatureMutation.isPending ? t("sign.submit.pending") : t("sign.submit.button")}
          </button>
        </div>

        {/* Footer */}
        <div style={{ textAlign: "center", marginTop: 32, fontFamily: SANS }}>
          <div style={{ height: 1, background: `linear-gradient(90deg, transparent, ${BORDER}, transparent)`, marginBottom: 20 }} />
          <div style={{ fontSize: 10, letterSpacing: "0.2em", color: ACCENT_LOW, textTransform: "uppercase", marginBottom: 8 }}>JD Studio HK</div>
          <div style={{ display: "flex", justifyContent: "center", gap: 20 }}>
            <a href="tel:+85291531976" style={{ color: ACCENT_LOW, fontSize: 12, textDecoration: "none", fontFamily: SANS }}>{t("footer.phone")}</a>
            <span style={{ color: "rgba(255,255,255,0.15)" }}>·</span>
            <a href="https://www.jdstudiohk.com" target="_blank" rel="noopener noreferrer" style={{ color: ACCENT_MED, fontSize: 12, textDecoration: "none", fontFamily: SANS }}>{t("footer.website")}</a>
          </div>
        </div>
      </div>
    </div>
  );
}
