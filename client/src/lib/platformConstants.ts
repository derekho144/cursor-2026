/**
 * Shared platform constants used across AdExpenses, AdSync, MonthlyReport, and PlatformEfficiency pages.
 * Single source of truth for platform definitions.
 */

/** Paid advertising platforms (have ad spend tracking) */
export const AD_PLATFORMS = [
  { value: "hellotoby",  label: "HelloToby",  color: "#FFB800" },
  { value: "360pro",     label: "360Pro",     color: "#00D4AA" },
  { value: "freehunter", label: "FreeHunter", color: "#FF6B6B" },
  { value: "google_ads", label: "Google Ads", color: "#7B8CFF" },
] as const;

/** All lead source platforms (ad + organic) */
export const ALL_PLATFORMS = [
  { value: "hellotoby",  label: "HelloToby",  color: "#FFB800", hasAd: true },
  { value: "360pro",     label: "360Pro",     color: "#00D4AA", hasAd: true },
  { value: "freehunter", label: "FreeHunter", color: "#FF6B6B", hasAd: true },
  { value: "google_ads", label: "Google Ads", color: "#7B8CFF", hasAd: true },
  { value: "instagram",  label: "Instagram",  color: "#E1306C", hasAd: false },
  { value: "facebook",   label: "Facebook",   color: "#1877F2", hasAd: false },
  { value: "88db",       label: "88DB",       color: "#f97316", hasAd: false },
  { value: "referral",   label: "朋友介紹",   color: "#34d399", hasAd: false },
  { value: "website",    label: "自家網站",   color: "#60a5fa", hasAd: false },
  { value: "repeat",     label: "回頭客",     color: "#a78bfa", hasAd: false },
  { value: "other",      label: "其他",       color: "#9ca3af", hasAd: false },
] as const;

export type AdPlatformValue = typeof AD_PLATFORMS[number]["value"];
export type AllPlatformValue = typeof ALL_PLATFORMS[number]["value"];

/** Get color for a platform value, with fallback */
export function getPlatformColor(value: string): string {
  const p = ALL_PLATFORMS.find(p => p.value === value);
  return p?.color ?? "#888";
}

/** Get label for a platform value, with fallback */
export function getPlatformLabel(value: string): string {
  const p = ALL_PLATFORMS.find(p => p.value === value);
  return p?.label ?? value;
}
