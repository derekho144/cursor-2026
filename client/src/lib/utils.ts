import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a UTC timestamp (ms) to Hong Kong local date/time string.
 * e.g. 1714204800000 → "2026/4/27 下午3:00:00"
 */
export function formatDate(
  utcMs: number | Date | string | null | undefined,
  opts?: Intl.DateTimeFormatOptions
): string {
  if (utcMs == null) return "—";
  const d = utcMs instanceof Date ? utcMs : new Date(utcMs);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong", ...opts });
}

/**
 * Format a number as HKD currency string.
 * e.g. 12345 → "HK$12,345"
 */
export function formatHKD(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return `HK$${Math.round(amount).toLocaleString("en-HK")}`;
}
