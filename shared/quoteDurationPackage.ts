/**
 * Event / time-based shoot duration packaging.
 * Half-day / full-day / multi-day historically lose more often when priced as flat hourly.
 */

export type DurationPackage =
  | "hours"
  | "half_day"
  | "full_day"
  | "multi_day"
  | "unknown";

export const DURATION_PACKAGE_OPTIONS: Array<{
  value: Exclude<DurationPackage, "unknown">;
  label: string;
  hint: string;
}> = [
  { value: "hours", label: "按小時", hint: "短活動／不足半日" },
  { value: "half_day", label: "半日", hint: "約 3–5 小時" },
  { value: "full_day", label: "全日", hint: "約 6–10 小時" },
  { value: "multi_day", label: "多日／N 日", hint: "跨日或連續多日" },
];

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

/** Infer package from shoot hours when structured package not set. */
export function inferDurationPackageFromHours(
  hours: number | null | undefined
): DurationPackage {
  if (hours == null || !Number.isFinite(hours) || hours <= 0) return "unknown";
  if (hours <= 2.5) return "hours";
  if (hours <= 5) return "half_day";
  if (hours <= 10) return "full_day";
  return "multi_day";
}

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
  return inferDurationPackageFromHours(
    h != null && Number.isFinite(h) ? h : null
  );
}
