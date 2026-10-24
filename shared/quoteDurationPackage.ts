/**
 * Event / time-based shoot duration packaging.
 * Half-day / full-day / multi-day historically lose more often when priced as flat hourly.
 *
 * When durationPackage = multi_day, `shootHours` stores **day count** (1 = 一日),
 * not clock hours.
 */

export type DurationPackage =
  | "hours"
  | "half_day"
  | "full_day"
  | "multi_day"
  | "unknown";

/** Nominal hours per calendar day when converting multi_day → learning hours. */
export const MULTI_DAY_HOURS_PER_DAY = 8;

export const DURATION_PACKAGE_OPTIONS: Array<{
  value: Exclude<DurationPackage, "unknown">;
  label: string;
  hint: string;
}> = [
  { value: "hours", label: "按小時", hint: "短活動／不足半日" },
  { value: "half_day", label: "半日", hint: "約 4–5 小時" },
  { value: "full_day", label: "全日", hint: "約 6–10 小時" },
  { value: "multi_day", label: "多日／N 日", hint: "跨日或連續多日；數量＝日數" },
];

export function isMultiDayDurationPackage(
  pkg: string | null | undefined
): boolean {
  return (pkg ?? "").trim() === "multi_day";
}

function trimDurationNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

/** Compact list label: `2日` or `2h`. */
export function formatShootDurationDisplay(
  value: number | string | null | undefined,
  durationPackage?: string | null
): string {
  const n = value == null || value === "" ? NaN : Number(value);
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (isMultiDayDurationPackage(durationPackage)) {
    return `${trimDurationNumber(n)}日`;
  }
  return `${trimDurationNumber(n)}h`;
}

/** Form / detail Chinese label: `2 日` or `2 小時`. */
export function formatShootDurationZh(
  value: number | string | null | undefined,
  durationPackage?: string | null
): string {
  const n = value == null || value === "" ? NaN : Number(value);
  if (!Number.isFinite(n) || n <= 0) return "未填";
  if (isMultiDayDurationPackage(durationPackage)) {
    return `${trimDurationNumber(n)} 日`;
  }
  return `${trimDurationNumber(n)} 小時`;
}

/**
 * Convert stored shootHours to clock-hours for learning rates / buckets.
 * multi_day: N days × 8h/day.
 */
export function shootValueAsLearningHours(
  value: number | string | null | undefined,
  durationPackage?: string | null
): number | null {
  const n = value == null || value === "" ? NaN : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (isMultiDayDurationPackage(durationPackage)) {
    return n * MULTI_DAY_HOURS_PER_DAY;
  }
  return n;
}

export function durationPackageLabel(pkg: DurationPackage): string {
  switch (pkg) {
    case "hours":
      return "按小時";
    case "half_day":
      return "半日";
    case "full_day":
      return "全日";
    case "multi_day":
      return "多日／N 日";
    default:
      return "時長未標明";
  }
}

/**
 * Form auto-suggest from clock hours. Never returns multi_day — that package
 * stores day count in shootHours, so it must be chosen explicitly.
 */
export function inferDurationPackageFromHours(
  hours: number | null | undefined
): DurationPackage {
  if (hours == null || !Number.isFinite(hours) || hours <= 0) return "unknown";
  if (hours < 4) return "hours";
  if (hours < 6) return "half_day";
  if (hours <= 10) return "full_day";
  return "unknown";
}

/**
 * Analytics / win-rate bucket when package column empty.
 * Long unlabeled clock hours still group under multi_day (legacy), but
 * extractQuoteShootFeatures only expands day→hours when package is explicit.
 */
export function resolveDurationPackage(input: {
  durationPackage?: string | null;
  shootHours?: number | string | null;
}): DurationPackage {
  const raw = (input.durationPackage ?? "").trim();
  if (
    raw === "hours" ||
    raw === "half_day" ||
    raw === "full_day" ||
    raw === "multi_day"
  ) {
    return raw;
  }
  const h =
    input.shootHours == null || input.shootHours === ""
      ? null
      : Number(input.shootHours);
  if (h == null || !Number.isFinite(h) || h <= 0) return "unknown";
  if (h < 4) return "hours";
  if (h < 6) return "half_day";
  if (h <= 10) return "full_day";
  return "multi_day";
}
