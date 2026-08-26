/**
 * Pass 1 of inquiry parse: facts / work packages only. No prices, no billing rules.
 * Billing in the same prompt is what collapsed HKSEA into "event 4 hours".
 */
import { invokeLLM } from "./_core/llm";
import {
  formatSignalsForPrompt,
  type RequirementSignal,
} from "../shared/inquiryRequirementSignals";

export type InquiryWorkPackage = {
  kind: string;
  summary: string;
  quantity: number;
  unit: string;
  date: string;
  location: string;
  quantitySource: string;
};

export type InquiryFacts = {
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  clientCompany: string;
  eventName: string;
  primaryServiceType: string;
  multiScope: boolean;
  shootingDate: string;
  shootingLocation: string;
  shootHours: number;
  shotCount: number;
  durationPackage: string;
  crewPhotographers: number;
  crewVideographers: number;
  quantitySource: string;
  assumptions: string[];
  missingFields: string[];
  notes: string;
  confidence: string;
  isInquiry: boolean;
  workPackages: InquiryWorkPackage[];
};

const FACTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "clientName",
    "clientEmail",
    "clientPhone",
    "clientCompany",
    "eventName",
    "primaryServiceType",
    "multiScope",
    "shootingDate",
    "shootingLocation",
    "shootHours",
    "shotCount",
    "durationPackage",
    "crewPhotographers",
    "crewVideographers",
    "quantitySource",
    "assumptions",
    "missingFields",
    "notes",
    "confidence",
    "isInquiry",
    "workPackages",
  ],
  properties: {
    clientName: { type: "string" },
    clientEmail: { type: "string" },
    clientPhone: { type: "string" },
    clientCompany: { type: "string" },
    eventName: { type: "string" },
    primaryServiceType: { type: "string" },
    multiScope: { type: "boolean" },
    shootingDate: { type: "string" },
    shootingLocation: { type: "string" },
    shootHours: { type: "number" },
    shotCount: { type: "number" },
    durationPackage: { type: "string" },
    crewPhotographers: { type: "number" },
    crewVideographers: { type: "number" },
    quantitySource: { type: "string" },
    assumptions: { type: "array", items: { type: "string" } },
    missingFields: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
    confidence: { type: "string" },
    isInquiry: { type: "boolean" },
    workPackages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "kind",
          "summary",
          "quantity",
          "unit",
          "date",
          "location",
          "quantitySource",
        ],
        properties: {
          kind: { type: "string" },
          summary: { type: "string" },
          quantity: { type: "number" },
          unit: { type: "string" },
          date: { type: "string" },
          location: { type: "string" },
          quantitySource: { type: "string" },
        },
      },
    },
  },
} as const;

function buildFactsPrompt(
  subject: string,
  body: string,
  signals: RequirementSignal[],
  retryGaps?: string[]
): string {
  const retry = retryGaps?.length
    ? `
YOU DROPPED THESE REQUIREMENTS LAST TIME. Create a workPackage for each, or put a missingFields note explaining why it is NOT in scope:
${retryGaps.map((g) => `- ${g}`).join("\n")}
`
    : "";

  return `You extract photography-job FACTS for JD Studio HK. Do NOT price anything. Do NOT apply billing rules. Do NOT default to 4–5 event hours.

Email Subject: ${subject}
Email Body (may include === PDF ATTACHMENT TEXT === — that is part of the brief):
${body}

MACHINE-EXTRACTED SIGNALS (regex; treat as must-account-for unless clearly not a shoot requirement):
${formatSignalsForPrompt(signals)}
${retry}

Rules:
1. Split distinct jobs into separate workPackages. Counted deliverables are jobs: event coverage, artwork/product stills, 去背/cutout, video clips / 剪片 / 精選視頻, extra days, explicit 精修 N 張, on-site crew.
2. kind must be one of: event, product_shoot, artwork_shoot, background_removal, video, retouch, crew, other.
3. unit must be one of: hours, days, shots, pieces, cutouts, clips, seconds, minutes, people, unknown.
4. Never collapse 去背 / 作品特寫 / per-piece stills / 剪片 / 精選視頻 / 精修 N 張 / 攝像師 into event "retouching included" or one photographer.
5. "N days" is days, not N hours. "活動後7天內交付" and job-board 「N日內」are deadlines, not shoot days.
6. If PDF lists quantities/dates, copy them. Do not invent shootingDate.
7. multiScope=true if more than one real work package.
8. primaryServiceType: one of corporate_event, product, food_beverage, jewelry, artwork, interior, video_production, graphic_design, ad_video, web_development, ai_photography, menu_design, portrait, 360_photography, drone, kol_mi, other.
9. quantitySource: explicit if the brief states the number; assumed only if you invented a default; unknown if missing.
10. notes: Traditional Chinese, max 280 chars, list every work package first.
11. confidence high ONLY if every machine signal is in a workPackage (or justified in missingFields).
12. If the body says 詳見附件 / see attached but there is no PDF ATTACHMENT TEXT section, confidence medium/low and missingFields includes attachmentText.
13. 「N 條影片／clips」+「每條 N 秒」= one video workPackage. quantity = number of clips; put per-clip duration in summary (e.g. 「3 條影片，每條 20 秒」). Do not fold this into Event Photography hours.
14. 「下午1點到5點」= event hours from the clock range. 「1分鐘精選視頻」= highlight duration, NEVER event hours.
15. 「不少於200張合格照片」and「精修不少於30張」are two packages. Do not keep only the larger shot count.
16. If the brief needs both photography (攝影/照片) AND video (攝像/影片/視頻), on-site crew is always 1 photographer + 1 videographer (1P+1V). Not one person dual-role. Set crewPhotographers=1, crewVideographers=1. Add a workPackage kind=crew, summary「現場 1 攝影師 + 1 攝像師」.

Return JSON only.`;
}

export async function understandInquiryFacts(input: {
  subject: string;
  body: string;
  signals: RequirementSignal[];
  retryGaps?: string[];
}): Promise<InquiryFacts | null> {
  try {
    const result = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "You extract structured photography-job facts. No prices. JSON only.",
        },
        {
          role: "user",
          content: buildFactsPrompt(
            input.subject,
            input.body,
            input.signals,
            input.retryGaps
          ),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "inquiry_facts",
          strict: true,
          schema: FACTS_SCHEMA as unknown as Record<string, unknown>,
        },
      },
    });
    const content = result.choices?.[0]?.message?.content;
    const parsed = JSON.parse(
      typeof content === "string" ? content : JSON.stringify(content)
    );
    if (!Array.isArray(parsed.workPackages)) parsed.workPackages = [];
    return applyStudioCrewDefaults(parsed as InquiryFacts, input.signals);
  } catch (e) {
    console.error("[EmailInquiry] facts pass failed:", e);
    return null;
  }
}

export function applyStudioCrewDefaults(
  facts: InquiryFacts,
  signals: RequirementSignal[]
): InquiryFacts {
  if (!signals.some((s) => s.kind === "crew_1p1v")) return facts;
  facts.crewPhotographers = Math.max(Number(facts.crewPhotographers) || 0, 1);
  facts.crewVideographers = Math.max(Number(facts.crewVideographers) || 0, 1);
  const hasCrewPkg = (facts.workPackages ?? []).some((p) => {
    const t = `${p.kind ?? ""} ${p.summary ?? ""}`;
    return (
      p.kind === "crew" ||
      (/1\s*p/i.test(t) && /1\s*v/i.test(t)) ||
      (/攝影師/.test(t) && /攝像師|錄影師/.test(t))
    );
  });
  if (!hasCrewPkg) {
    facts.workPackages = [
      ...(facts.workPackages ?? []),
      {
        kind: "crew",
        summary: "現場 1 攝影師 + 1 攝像師（影相兼拍片）",
        quantity: 2,
        unit: "people",
        date: facts.shootingDate || "",
        location: facts.shootingLocation || "",
        quantitySource: "explicit",
      },
    ];
  }
  return facts;
}

export function formatFrozenFactsForPricing(facts: InquiryFacts | null): string {
  if (!facts) return "";
  return `
=== FROZEN WORK PACKAGES (from understanding pass — do NOT drop, merge, or ignore) ===
${JSON.stringify(
    {
      primaryServiceType: facts.primaryServiceType,
      multiScope: facts.multiScope,
      eventName: facts.eventName,
      shootingDate: facts.shootingDate,
      shootingLocation: facts.shootingLocation,
      shootHours: facts.shootHours,
      shotCount: facts.shotCount,
      durationPackage: facts.durationPackage,
      crewPhotographers: facts.crewPhotographers,
      crewVideographers: facts.crewVideographers,
      workPackages: facts.workPackages,
      notes: facts.notes,
    },
    null,
    2
  )}
RULE: suggestedItems MUST include a billable line (or an explicit bundled $0 line with reason) for EVERY workPackage.
If multiScope is true, do NOT output a single Event Photography hours line as the whole job.
Event "retouching included" does NOT cover explicit 去背 / cutout / 作品特寫.
If crewPhotographers>=1 and crewVideographers>=1 (1P+1V), Event Photography does NOT include the videographer — emit a Videographer line.
`;
}
