/**
 * PicSpot-inspired delivery gallery layout:
 * cover + title bar + justified masonry (or Drive iframe fallback) + thank-you / packages.
 */
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLanguage, LangToggle } from "@/contexts/LanguageContext";
import { DeliveryPhotoGallery } from "@/components/DeliveryPhotoGallery";

const LOGO_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663457748523/VbnWSJV6UQ79sGuykqPPae/jd-studio-logo-dark_3217ad3b.png";
const GOOGLE_REVIEW_URL =
  "https://www.google.com/maps/place/JD+Studio/@22.3360662,114.1980294,17z/data=!4m8!3m7!1s0x34040714d8082109:0x60cb3968ea99b2e6!8m2!3d22.3360662!4d114.1980294!9m1!1b1!16s%2Fg%2F11x8hbsvg7?entry=ttu";

const GOLD = "#d4a843";
const GOLD_BORDER = "rgba(212,168,67,0.25)";
const GOLD_DIM = "rgba(212,168,67,0.5)";
const WHITE_HIGH = "rgba(255,255,255,0.88)";
const WHITE_MED = "rgba(255,255,255,0.55)";
const WHITE_LOW = "rgba(255,255,255,0.28)";
const WHITE_FAINT = "rgba(255,255,255,0.07)";
const SERIF = "'Cormorant Garamond', Georgia, serif";
const SANS = "'Montserrat', 'Helvetica Neue', Arial, sans-serif";

export type DeliveryGalleryContent = {
  id: number;
  clientName: string;
  title: string;
  googleDriveUrl: string;
  message: string | null;
  createdAt: Date;
  token?: string;
};

function driveOpenUrlFrom(raw: string): string {
  try {
    const url = new URL(raw);
    const folderMatch = url.pathname.match(/\/folders\/([^/?#]+)/);
    if (folderMatch) return `https://drive.google.com/drive/folders/${folderMatch[1]}`;
    const idParam = url.searchParams.get("id");
    if (idParam) return `https://drive.google.com/drive/folders/${idParam}`;
    return `${url.origin}${url.pathname}`;
  } catch {
    return raw;
  }
}

export function DeliveryGalleryView({
  content,
  password,
}: {
  content: DeliveryGalleryContent;
  password?: string;
}) {
  const { t, lang } = useLanguage();
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const driveOpenUrl = driveOpenUrlFrom(content.googleDriveUrl);

  const { data: photoData, isLoading: photosLoading } =
    trpc.deliveries.listPhotos.useQuery(
      { token: content.token ?? "", password },
      { enabled: !!content.token, retry: 1, refetchOnWindowFocus: false }
    );

  const photos = photoData?.photos ?? [];
  const coverSrc = photos[0]?.fullSrc || photos[0]?.src || null;

  useEffect(() => {
    if (photos.length > 0 || iframeLoaded) return;
    const timer = setTimeout(() => setIframeLoaded(true), 4000);
    return () => clearTimeout(timer);
  }, [photos.length, iframeLoaded]);

  const formattedDate = new Date(content.createdAt).toLocaleDateString(
    lang === "zh" ? "zh-HK" : "en-GB",
    { year: "numeric", month: "long", day: "numeric" }
  );

  function handleDownloadReceipt() {
    window.open(`/receipt/${content.token ?? ""}`, "_blank");
  }

  const packages = [
    {
      tag: t("pkg.1.tag"),
      tagColor: GOLD,
      headline: t("pkg.1.headline"),
      desc: t("pkg.1.desc"),
      services: [t("pkg.1.s1"), t("pkg.1.s2"), t("pkg.1.s3")],
    },
    {
      tag: t("pkg.2.tag"),
      tagColor: "#c084fc",
      headline: t("pkg.2.headline"),
      desc: t("pkg.2.desc"),
      services: [t("pkg.2.s1"), t("pkg.2.s2"), t("pkg.2.s3")],
    },
    {
      tag: t("pkg.3.tag"),
      tagColor: "#4285F4",
      headline: t("pkg.3.headline"),
      desc: t("pkg.3.desc"),
      services: [t("pkg.3.s1"), t("pkg.3.s2"), t("pkg.3.s3")],
    },
    {
      tag: t("pkg.4.tag"),
      tagColor: "#f472b6",
      headline: t("pkg.4.headline"),
      desc: t("pkg.4.desc"),
      services: [t("pkg.4.s1"), t("pkg.4.s2"), t("pkg.4.s3")],
    },
  ];

  const iframeFallback = (
    <div style={{ position: "relative", width: "100%", height: "min(72vh, 780px)", background: "#0a0a0a" }}>
      {!iframeLoaded && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: WHITE_LOW,
            fontFamily: SANS,
            fontSize: 11,
            letterSpacing: "0.14em",
            zIndex: 1,
          }}
        >
          LOADING
        </div>
      )}
      <iframe
        src={content.googleDriveUrl}
        title={t("delivery.yourPhotos")}
        width="100%"
        height="100%"
        frameBorder="0"
        allowFullScreen
        onLoad={() => setIframeLoaded(true)}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          border: "none",
          opacity: iframeLoaded ? 1 : 0,
          transition: "opacity 0.35s ease",
        }}
      />
    </div>
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#050505",
        color: WHITE_HIGH,
        fontFamily: SANS,
      }}
    >
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(10px);} to { opacity:1; transform:none;} }
      `}</style>

      {/* Top bar */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "12px 18px",
          background: "rgba(5,5,5,0.92)",
          backdropFilter: "blur(10px)",
          borderBottom: `1px solid ${WHITE_FAINT}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src={LOGO_URL} alt="JD Studio" style={{ height: 28 }} />
          <div style={{ display: "none" }} className="title-desktop" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <LangToggle />
          <a
            href={driveOpenUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              background: GOLD,
              color: "#0a0a0a",
              fontFamily: SANS,
              fontWeight: 700,
              fontSize: 10,
              letterSpacing: "0.12em",
              textDecoration: "none",
              borderRadius: 2,
            }}
          >
            {t("delivery.openDownload")}
          </a>
          <button
            type="button"
            onClick={handleDownloadReceipt}
            style={{
              padding: "8px 12px",
              background: "transparent",
              border: `1px solid rgba(255,255,255,0.2)`,
              color: WHITE_HIGH,
              fontFamily: SANS,
              fontSize: 10,
              letterSpacing: "0.1em",
              cursor: "pointer",
              borderRadius: 2,
            }}
          >
            {t("delivery.downloadReceipt")}
          </button>
        </div>
      </div>

      {/* Cover — PicSpot center-cover feel */}
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "min(48vh, 520px)",
          overflow: "hidden",
          background: "#111",
          animation: "fadeUp 0.55s ease both",
        }}
      >
        {coverSrc ? (
          <img
            src={coverSrc}
            alt=""
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              filter: "brightness(0.72)",
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              background:
                "radial-gradient(ellipse at 50% 40%, rgba(212,168,67,0.18), transparent 55%), linear-gradient(160deg,#111,#050505)",
            }}
          />
        )}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: 24,
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.45) 100%)",
          }}
        >
          <p
            style={{
              fontFamily: SANS,
              fontSize: 10,
              letterSpacing: "0.28em",
              color: GOLD_DIM,
              marginBottom: 10,
              textTransform: "uppercase",
            }}
          >
            JD STUDIO HK
          </p>
          <h1
            style={{
              fontFamily: SERIF,
              fontWeight: 300,
              fontStyle: "italic",
              fontSize: "clamp(28px, 5vw, 48px)",
              margin: "0 0 8px",
              letterSpacing: "0.03em",
            }}
          >
            {content.title}
          </h1>
          <p
            style={{
              fontFamily: SANS,
              fontSize: 12,
              letterSpacing: "0.1em",
              color: WHITE_MED,
              margin: 0,
            }}
          >
            {content.clientName} · {formattedDate}
          </p>
        </div>
      </div>

      {/* Thank you + review — directly under cover */}
      <div
        style={{
          width: "100%",
          background: "#050505",
          borderTop: `1px solid ${WHITE_FAINT}`,
          borderBottom: `1px solid ${WHITE_FAINT}`,
          padding: "48px 20px 44px",
          textAlign: "center",
          boxSizing: "border-box",
          animation: "fadeUp 0.55s 0.05s ease both",
        }}
      >
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <h2
            style={{
              fontFamily: SANS,
              fontWeight: 500,
              fontSize: "clamp(22px, 3.5vw, 28px)",
              margin: "0 0 10px",
              letterSpacing: "0.04em",
              color: WHITE_HIGH,
            }}
          >
            {t("delivery.thankYou")}
          </h2>
          <p
            style={{
              fontFamily: SANS,
              color: WHITE_LOW,
              fontSize: 11,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              marginBottom: 22,
            }}
          >
            {t("delivery.thankYouSub")}
          </p>
          <p
            style={{
              fontFamily: SANS,
              color: WHITE_MED,
              fontSize: 14,
              lineHeight: 1.9,
              letterSpacing: "0.02em",
              marginBottom: 22,
            }}
          >
            {t("delivery.message1")}
            <br />
            {t("delivery.message2")}
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: 5, marginBottom: 18 }}>
            {[1, 2, 3, 4, 5].map((s) => (
              <svg key={s} width="18" height="18" viewBox="0 0 24 24" fill={GOLD}>
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            ))}
          </div>
          <p
            style={{
              fontFamily: SANS,
              color: WHITE_MED,
              fontSize: 14,
              lineHeight: 1.8,
              marginBottom: 20,
            }}
          >
            {t("delivery.reviewInvite")}
            <br />
            {t("delivery.reviewInvite2")}
          </p>
          <a
            href={GOOGLE_REVIEW_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: "13px 22px",
              border: `1px solid rgba(255,255,255,0.28)`,
              color: WHITE_HIGH,
              textDecoration: "none",
              fontFamily: SANS,
              fontSize: 12,
              letterSpacing: "0.16em",
              fontWeight: 600,
              background: "transparent",
            }}
          >
            {t("delivery.leaveReview")}
          </a>
        </div>
      </div>

      {/* Title strip */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          padding: "18px 18px 14px",
          maxWidth: 1400,
          margin: "0 auto",
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: SERIF,
              fontSize: 22,
              fontStyle: "italic",
              fontWeight: 400,
              marginBottom: 4,
            }}
          >
            {content.title}
          </div>
          <div
            style={{
              fontFamily: SANS,
              fontSize: 11,
              color: WHITE_LOW,
              letterSpacing: "0.08em",
            }}
          >
            {t("delivery.yourPhotos")} · {photos.length > 0 ? `${photos.length} photos` : "Google Drive"}
          </div>
        </div>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 11,
            color: WHITE_LOW,
            letterSpacing: "0.12em",
          }}
        >
          {content.clientName}
        </div>
      </div>

      {/* Gallery */}
      <div
        style={{
          maxWidth: 1400,
          margin: "0 auto",
          padding: "10px 10px 28px",
          width: "100%",
          boxSizing: "border-box",
          animation: "fadeUp 0.6s 0.08s ease both",
        }}
      >
        <DeliveryPhotoGallery
          photos={photos}
          loading={photosLoading}
          fallback={iframeFallback}
          gap={5}
          targetRowHeight={280}
        />
      </div>

      {/* Packages */}
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "8px 16px 40px" }}>
        <div
          style={{
            fontSize: 9,
            letterSpacing: "0.22em",
            color: GOLD_DIM,
            fontFamily: SANS,
            fontWeight: 600,
            textTransform: "uppercase",
            marginBottom: 14,
          }}
        >
          {t("delivery.nextStep")}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
          }}
        >
          {packages.map((pkg) => (
            <div
              key={pkg.headline}
              style={{
                padding: "14px 14px",
                background: "rgba(255,255,255,0.025)",
                border: `1px solid ${WHITE_FAINT}`,
              }}
            >
              <div style={{ fontSize: 9, color: pkg.tagColor, letterSpacing: "0.14em", marginBottom: 8 }}>
                {pkg.tag}
              </div>
              <div style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: 15, marginBottom: 6 }}>
                {pkg.headline}
              </div>
              <p style={{ fontFamily: SANS, color: WHITE_LOW, fontSize: 12, lineHeight: 1.6, marginBottom: 8 }}>
                {pkg.desc}
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {pkg.services.map((s) => (
                  <span
                    key={s}
                    style={{
                      fontSize: 9,
                      color: WHITE_LOW,
                      border: `1px solid rgba(255,255,255,0.1)`,
                      padding: "2px 7px",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{ textAlign: "center", marginTop: 22 }}>
          <a
            href="https://www.jdstudiohk.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              padding: "12px 18px",
              border: `1px solid ${GOLD_BORDER}`,
              color: GOLD,
              textDecoration: "none",
              fontFamily: SANS,
              fontSize: 11,
              letterSpacing: "0.14em",
              fontWeight: 600,
            }}
          >
            {t("delivery.enquireNow")}
          </a>
        </div>
        <div style={{ textAlign: "center", marginTop: 28, opacity: 0.45 }}>
          <img src={LOGO_URL} alt="" style={{ height: 18, marginBottom: 6 }} />
          <div style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: 10 }}>
            © {new Date().getFullYear()} JD Studio HK
          </div>
        </div>
      </div>
    </div>
  );
}
