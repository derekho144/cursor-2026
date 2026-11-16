import { useEffect, useMemo, useRef, useState } from "react";
import {
  computeJustifiedLayout,
  type JustifiedItem,
} from "@shared/justifiedLayout";

const GOLD = "#d4a843";
const SANS = "'Montserrat', 'Helvetica Neue', Arial, sans-serif";

export type GalleryPhoto = {
  id: string;
  name?: string;
  src: string;
  fullSrc?: string;
  width: number;
  height: number;
};

type Props = {
  photos: GalleryPhoto[];
  loading?: boolean;
  /** Fallback node when photos cannot be listed (e.g. Drive iframe) */
  fallback?: React.ReactNode;
  gap?: number;
  targetRowHeight?: number;
};

export function DeliveryPhotoGallery({
  photos,
  loading,
  fallback,
  gap = 5,
  targetRowHeight = 280,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const items: JustifiedItem[] = useMemo(
    () =>
      photos.map((p) => ({
        id: p.id,
        width: p.width || 1200,
        height: p.height || 800,
        src: p.src,
        fullSrc: p.fullSrc ?? p.src,
        name: p.name,
      })),
    [photos]
  );

  const layout = useMemo(
    () =>
      width > 0
        ? computeJustifiedLayout(items, {
            containerWidth: width,
            targetRowHeight: width < 640 ? 180 : targetRowHeight,
            gap,
          })
        : { placements: [], totalHeight: 0 },
    [items, width, targetRowHeight, gap]
  );

  useEffect(() => {
    if (lightboxIndex == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxIndex(null);
      if (e.key === "ArrowRight") {
        setLightboxIndex((i) =>
          i == null ? i : Math.min(photos.length - 1, i + 1)
        );
      }
      if (e.key === "ArrowLeft") {
        setLightboxIndex((i) => (i == null ? i : Math.max(0, i - 1)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIndex, photos.length]);

  if (loading) {
    return (
      <div
        ref={containerRef}
        style={{
          minHeight: 320,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: "50%",
              border: `2px solid rgba(212,168,67,0.25)`,
              borderTopColor: GOLD,
              animation: "spin 0.9s linear infinite",
            }}
          />
          <span
            style={{
              fontFamily: SANS,
              fontSize: 11,
              letterSpacing: "0.14em",
              color: "rgba(255,255,255,0.35)",
            }}
          >
            LOADING GALLERY
          </span>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (photos.length === 0) {
    return (
      <div ref={containerRef} style={{ minHeight: 280, background: "#0a0a0a" }}>
        {fallback}
      </div>
    );
  }

  return (
    <>
      <div
        ref={containerRef}
        style={{
          position: "relative",
          width: "100%",
          height: layout.totalHeight,
          background: "#050505",
        }}
      >
        {layout.placements.map((p, index) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setLightboxIndex(index)}
            aria-label={p.name || `Photo ${index + 1}`}
            style={{
              position: "absolute",
              left: p.x,
              top: p.y,
              width: p.displayWidth,
              height: p.displayHeight,
              padding: 0,
              border: "none",
              cursor: "zoom-in",
              background: "#111",
              overflow: "hidden",
            }}
          >
            <img
              src={p.src}
              alt={p.name || ""}
              loading="lazy"
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
                transition: "transform 0.35s ease, opacity 0.25s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "scale(1.03)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "scale(1)";
              }}
              onError={(e) => {
                // Try alternate Googleusercontent URL
                const img = e.currentTarget;
                if (!img.dataset.retried) {
                  img.dataset.retried = "1";
                  img.src = `https://lh3.googleusercontent.com/d/${p.id}=w1200`;
                }
              }}
            />
          </button>
        ))}
      </div>

      {lightboxIndex != null && photos[lightboxIndex] && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setLightboxIndex(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(0,0,0,0.92)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => setLightboxIndex(null)}
            style={{
              position: "absolute",
              top: 18,
              left: 18,
              background: "transparent",
              border: "none",
              color: "#fff",
              fontSize: 28,
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            ×
          </button>
          {lightboxIndex > 0 && (
            <button
              type="button"
              aria-label="Previous"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex((i) => (i == null ? i : i - 1));
              }}
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.2)",
                color: "#fff",
                width: 44,
                height: 44,
                borderRadius: "50%",
                cursor: "pointer",
                fontSize: 22,
              }}
            >
              ‹
            </button>
          )}
          {lightboxIndex < photos.length - 1 && (
            <button
              type="button"
              aria-label="Next"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex((i) => (i == null ? i : i + 1));
              }}
              style={{
                position: "absolute",
                right: 12,
                top: "50%",
                transform: "translateY(-50%)",
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.2)",
                color: "#fff",
                width: 44,
                height: 44,
                borderRadius: "50%",
                cursor: "pointer",
                fontSize: 22,
              }}
            >
              ›
            </button>
          )}
          <img
            src={
              photos[lightboxIndex]!.fullSrc || photos[lightboxIndex]!.src
            }
            alt={photos[lightboxIndex]!.name || ""}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "92vw",
              maxHeight: "88vh",
              objectFit: "contain",
              boxShadow: "0 20px 80px rgba(0,0,0,0.55)",
            }}
          />
          {photos[lightboxIndex]!.name && (
            <div
              style={{
                position: "absolute",
                bottom: 16,
                left: 0,
                right: 0,
                textAlign: "center",
                fontFamily: SANS,
                fontSize: 12,
                color: "rgba(255,255,255,0.55)",
                letterSpacing: "0.04em",
              }}
            >
              {photos[lightboxIndex]!.name}
            </div>
          )}
        </div>
      )}
    </>
  );
}
