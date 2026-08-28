/**
 * Post-process AI inquiry parse with deterministic extractors.
 * Goals:
 * 1) Never treat billing defaults (20 shots / 5 hours) as explicit structured qty
 * 2) Prefer keyword-extracted hours / shots / crew over LLM guesses
 */

import { quotePricingMode } from "../shared/quotePricingMode";
import {
  inferDurationPackageFromHours,
  type DurationPackage,
} from "../shared/quoteDurationPackage";
import {
  extractCrewHighConfidence,
  extractHoursFromText,
  extractShotCountFromText,
  hasHighConfidenceHoursSignal,
  hasHighConfidenceShotCountSignal,
} from "./pricingLearningExtract";

const SERVICE_TYPES = [
  "corporate_event",
  "product",
  "food_beverage",
  "jewelry",
  "artwork",
  "interior",
  "video_production",
  "graphic_design",
  "ad_video",
  "web_development",
  "ai_photography",
  "menu_design",
  "portrait",
  "360_photography",
  "drone",
  "kol_mi",
  "other",
] as const;

export type InquiryServiceType = (typeof SERVICE_TYPES)[number];

export function isInquiryServiceType(raw: string): raw is InquiryServiceType {
  return (SERVICE_TYPES as readonly string[]).includes(raw);
}

/** Broader text for Step-1 serviceType classify (not just body[:300]). */
export function buildInquiryClassifyText(
  subject: string,
  body: string,
  maxChars = 2500
): string {
  const subj = String(subject ?? "").trim();
  const raw = String(body ?? "");
  const pdfMarker = "=== PDF ATTACHMENT TEXT ===";
  const pdfIdx = raw.indexOf(pdfMarker);
  let main = raw;
  let pdf = "";
  if (pdfIdx >= 0) {
    main = raw.slice(0, pdfIdx);
    pdf = raw.slice(pdfIdx, pdfIdx + 1800);
  }
  // Prefer head of body + PDF extract head (briefs often put qty in attachment)
  const combined = [
    subj ? `Subject: ${subj}` : "",
    main.slice(0, Math.max(800, maxChars - pdf.length)),
    pdf,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, maxChars);
  return combined;
}

/** Cheap keyword hint when LLM classify is weak / returns other. */
export function hintServiceTypeFromText(text: string): InquiryServiceType | null {
  const t = text.toLowerCase();
  if (/kol\b|influencer|網紅|網紅推廣|mi\s*推廣|social\s*media\s*content/.test(t)) {
    return "kol_mi";
  }
  if (/drone|航拍|無人機|aerial\s*photo/.test(t)) return "drone";
  if (/360\b|虛擬導覽|virtual\s*tour/.test(t)) return "360_photography";
  if (/jewelry|珠寶|首飾|鑽石/.test(t)) return "jewelry";
  if (/artwork|藝術品|畫作|sculpture/.test(t)) return "artwork";
  if (/food|beverage|餐飲|菜式|食物攝影|menu\s*photo/.test(t)) return "food_beverage";
  if (/menu\s*design|餐牌設計|menu\s*card/.test(t)) return "menu_design";
  if (/interior|室內|建築攝影|房地產攝影|property\s*photo/.test(t)) {
    return "interior";
  }
  if (/portrait|人像|形象照|headshot/.test(t)) return "portrait";
  if (/product\s*photo|產品攝影|白底|靜物|sku|e-?commerce\s*photo/.test(t)) {
    return "product";
  }
  if (/ai\s*photo|ai攝影|generative\s*photo/.test(t)) return "ai_photography";
  if (/web\s*(dev|site|design)|網頁|網站製作/.test(t)) return "web_development";
  if (/graphic\s*design|平面設計|poster|海報設計/.test(t)) return "graphic_design";
  if (/ad\s*video|廣告片|廣告影片|tv\s*c|commercial\s*video/.test(t)) {
    return "ad_video";
  }
  if (
    /videograph|videography|錄影|攝錄|短片|影片製作|short\s*film|filming/.test(t) &&
    !/photo\s*\+\s*video|攝影加錄影|活動攝影/.test(t)
  ) {
    return "video_production";
  }
  if (
    /corporate\s*event|event\s*photo|活動攝影|宴會|開幕|記者會|conference|forum/.test(
      t
    )
  ) {
    return "corporate_event";
  }
  if (/photoshoot|photography|攝影師|攝影服務/.test(t)) return "corporate_event";
  return null;
}

function normalizeChineseCounts(raw: string): string {
  let t = raw;
  const map: Array<[RegExp, string]> = [
    [/兩位|两位|兩名|两名|兩台|两台/g, "2位"],
    [/三位|三名|三台/g, "3位"],
    [/四位|四名|四台/g, "4位"],
    [/五位|五名/g, "5位"],
    [/一位|一名|一台/g, "1位"],
  ];
  for (const [re, rep] of map) t = t.replace(re, rep);
  return t;
}

function pushUnique(arr: string[], value: string) {
  if (!arr.includes(value)) arr.push(value);
}

function extractDurationPackageFromText(text: string): DurationPackage | null {
  const t = text.toLowerCase();
  if (/多日|連續\s*\d+\s*日|multi\s*[- ]?day|\d+\s*days?/.test(t)) {
    return "multi_day";
  }
  if (/全(?:天|日)|full\s*[- ]?day/.test(t)) return "full_day";
  if (/半(?:天|日)|half\s*[- ]?day/.test(t)) return "half_day";
  return null;
}

function asPositive(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Refine LLM parse: structured qty must match extractable signals.
 * Billing defaults may remain in suggestedItems; shootHours/shotCount stay 0 if not explicit.
 */
export function refineInquiryParseWithExtractors(input: {
  subject: string;
  body: string;
  parsed: Record<string, any>;
}): Record<string, any> {
  const parsed = { ...input.parsed };
  const text = normalizeChineseCounts(
    `${input.subject ?? ""}\n${input.body ?? ""}`
  );
  const assumptions = Array.isArray(parsed.assumptions)
    ? [...parsed.assumptions]
    : [];
  const missingFields = Array.isArray(parsed.missingFields)
    ? [...parsed.missingFields]
    : [];

  // Fix line qty confused with hours, e.g. "Event Photography (3 hours)" qty=3
  if (Array.isArray(parsed.suggestedItems)) {
    parsed.suggestedItems = parsed.suggestedItems.map((it: any) => {
      const desc = String(it?.description ?? "");
      const hourMatch = desc.match(/\((\d+(?:\.\d+)?)\s*hours?\)/i);
      if (!hourMatch) return it;
      const hoursInDesc = Number(hourMatch[1]);
      const qty = Number(it?.quantity);
      if (
        Number.isFinite(hoursInDesc) &&
        Number.isFinite(qty) &&
        qty === hoursInDesc
      ) {
        return { ...it, quantity: 1 };
      }
      return it;
    });
  }

  const serviceType = String(parsed.serviceType ?? "other").trim() || "other";
  const mode = quotePricingMode(serviceType);

  const extractedHours = extractHoursFromText(text);
  const extractedShots = extractShotCountFromText(text);
  const durationFromText = extractDurationPackageFromText(text);
  const hoursSignal = hasHighConfidenceHoursSignal(text);
  const shotsSignal = hasHighConfidenceShotCountSignal(text);
  const crewText = normalizeChineseCounts(
    [
      text,
      String(parsed.notes ?? ""),
      ...assumptions,
    ].join("\n")
  );
  const crew = extractCrewHighConfidence(crewText);

  let quantitySource = String(parsed.quantitySource ?? "")
    .trim()
    .toLowerCase();
  if (
    quantitySource !== "explicit" &&
    quantitySource !== "assumed" &&
    quantitySource !== "unknown"
  ) {
    const assumedFromItems = (parsed.suggestedItems ?? []).some((it: any) =>
      /assumed|假設/i.test(String(it?.description ?? ""))
    );
    quantitySource = assumedFromItems ? "assumed" : "unknown";
  }

  // ── Hours / duration ──────────────────────────────────────────
  if (hoursSignal && extractedHours != null) {
    parsed.shootHours = extractedHours;
    parsed.durationPackage =
      durationFromText ?? inferDurationPackageFromHours(extractedHours);
    quantitySource = "explicit";
    // Drop stale "assumed hours" notes when we found real hours
    for (let i = assumptions.length - 1; i >= 0; i--) {
      if (/假設.*(?:時|小時|半日|全日)|assumed.*hour/i.test(assumptions[i])) {
        assumptions.splice(i, 1);
      }
    }
  } else if (durationFromText) {
    parsed.durationPackage = durationFromText;
    if (extractedHours != null) parsed.shootHours = extractedHours;
    else if (durationFromText === "half_day") parsed.shootHours = 4;
    else if (durationFromText === "full_day") parsed.shootHours = 8;
    quantitySource = "explicit";
  } else if (mode === "time_crew") {
    // No explicit duration signal — clear LLM defaults (e.g. 5h) from structured fields
    const llmHours = asPositive(parsed.shootHours);
    if (llmHours != null) {
      parsed.shootHours = 0;
      pushUnique(assumptions, `報價項目或用預設時數估算；客人未明確寫時長（AI 曾填 ${llmHours}）`);
      quantitySource = quantitySource === "explicit" ? "assumed" : quantitySource;
    } else {
      parsed.shootHours = 0;
    }
    const pkg = String(parsed.durationPackage ?? "").trim();
    if (
      pkg === "hours" ||
      pkg === "half_day" ||
      pkg === "full_day" ||
      pkg === "multi_day"
    ) {
      // LLM invented package without text signal
      parsed.durationPackage = "unknown";
    }
    pushUnique(missingFields, "shootHours");
    if (quantitySource === "explicit") quantitySource = "assumed";
  }

  // ── Shot count ────────────────────────────────────────────────
  if (shotsSignal && extractedShots != null) {
    parsed.shotCount = extractedShots;
    if (mode === "shot_count") quantitySource = "explicit";
  } else if (mode === "shot_count") {
    const llmShots = asPositive(parsed.shotCount);
    if (llmShots != null) {
      parsed.shotCount = 0;
      pushUnique(
        assumptions,
        `報價項目或用預設張數估算；客人未明確寫張數（AI 曾填 ${llmShots}）`
      );
    } else {
      parsed.shotCount = 0;
    }
    pushUnique(missingFields, "shotCount");
    if (quantitySource === "explicit") quantitySource = "assumed";
  }

  // ── Crew (high-confidence numeric only) ───────────────────────
  if (crew) {
    if (crew.photographers > 0) {
      parsed.crewPhotographers = crew.photographers;
    }
    if (crew.videographers > 0) {
      parsed.crewVideographers = crew.videographers;
    }
  }

  // If items look assumed but quantitySource still unknown
  if (
    quantitySource === "unknown" &&
    (parsed.suggestedItems ?? []).some((it: any) =>
      /assumed|假設/i.test(String(it?.description ?? ""))
    )
  ) {
    quantitySource = "assumed";
  }

  parsed.quantitySource = quantitySource;
  parsed.assumptions = assumptions;
  parsed.missingFields = missingFields;
  return parsed;
}
