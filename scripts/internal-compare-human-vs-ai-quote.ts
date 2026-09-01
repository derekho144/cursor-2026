/**
 * Internal test: take a human-made quote + original inquiry content,
 * re-price with the same AI billing rules used in email parse, compare gap.
 *
 *   npx tsx scripts/internal-compare-human-vs-ai-quote.ts [quoteId]
 *
 * Default: JD202607-DE4A (C.S. Ng 小型音樂會) — human draft from clear email.
 */
import "dotenv/config";
import { getDb } from "../server/db";
import { quotes, quoteItems, emailInquiries } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

type Line = {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  note?: string;
};

const TRANSPORT = 320;

/** Same corporate_event mid rates as server/routers/emailInquiries BILLING_RULES. */
function aiCorporateEventQuote(input: {
  photoHours: number;
  videoHours: number;
  days: number;
  editMid: number;
  photoRate?: number;
  videoRate?: number;
}): { items: Line[]; low: number; mid: number; high: number; assumptions: string[] } {
  const photoRate = input.photoRate ?? 1000;
  const videoLow = 1500;
  const videoMid = input.videoRate ?? 2000;
  const videoHigh = 2500;
  const editLow = Math.round(input.editMid * 0.7);
  const editHigh = Math.round(input.editMid * 1.35);
  const transportQty = Math.max(1, input.days);
  const assumptions: string[] = [];

  const photoQty = round2(input.photoHours);
  const videoQty = round2(input.videoHours);

  const midItems: Line[] = [];
  if (photoQty > 0) {
    midItems.push({
      description: "Event Photography",
      quantity: photoQty,
      unitPrice: photoRate,
      amount: photoQty * photoRate,
      note: `corporate ${photoRate}/hr × ${photoQty}h`,
    });
  }
  if (videoQty > 0) {
    midItems.push({
      description: "Event Videography",
      quantity: videoQty,
      unitPrice: videoMid,
      amount: videoQty * videoMid,
      note: `mid ${videoMid}/hr (rule band ${videoLow}-${videoHigh})`,
    });
    midItems.push({
      description: "Video Editing",
      quantity: 1,
      unitPrice: input.editMid,
      amount: input.editMid,
      note: "flat edit mid",
    });
  }
  midItems.push({
    description: "Transportation Fee",
    quantity: transportQty,
    unitPrice: TRANSPORT,
    amount: transportQty * TRANSPORT,
  });

  const mid = sum(midItems);
  const low =
    photoQty * photoRate +
    videoQty * videoLow +
    (videoQty > 0 ? editLow : 0) +
    transportQty * TRANSPORT;
  const high =
    photoQty * photoRate +
    videoQty * videoHigh +
    (videoQty > 0 ? editHigh : 0) +
    transportQty * TRANSPORT;

  if (input.days > 1) {
    assumptions.push(`按 ${input.days} 日分開計時數；交通費 ×${transportQty}`);
  }
  assumptions.push("單位價跟電郵 AI BILLING_RULES（corporate_event）");

  return { items: midItems, low, mid, high, assumptions };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function sum(items: Line[]) {
  return items.reduce((s, i) => s + i.amount, 0);
}

function money(n: number) {
  return `HKD ${Math.round(n).toLocaleString("en-HK")}`;
}

function pct(delta: number, base: number) {
  if (!base) return "n/a";
  return `${delta >= 0 ? "+" : ""}${((delta / base) * 100).toFixed(1)}%`;
}

const CASES: Record<
  number,
  {
    label: string;
    /** Reconstruct hours from inquiry content (not from human unit prices). */
    parse: (body: string, notes: string) => {
      photoHours: number;
      videoHours: number;
      days: number;
      editMid: number;
      brief: string;
    };
  }
> = {
  // C.S. Ng — 2 days × 13:30–16:30, 1P + 1V + 3–5min highlight
  7770001: {
    label: "C.S. Ng 小型音樂會（人手草稿）",
    parse: () => ({
      photoHours: 3 * 2,
      videoHours: 3 * 2,
      days: 2,
      editMid: 3000,
      brief:
        "兩日小型音樂會；每日 13:30–16:30（3h）；1 攝影師 + 1 花絮錄影；成品 3–5 分鐘精華片 + 相片",
    }),
  },
  // Andy Leung — 1P 1000–1830 (8.5≈9), 1P 1000–1500 (5), 1V 1000–1830 (9), 2–3min edit
  8250001: {
    label: "Andy Leung 室內及營地活動（人手草稿）",
    parse: () => ({
      photoHours: 9 + 5,
      videoHours: 9,
      days: 1,
      editMid: 2500,
      brief:
        "1 日；攝影師 A 10:00–18:30（~9h）+ 攝影師 B 10:00–15:00（5h）；錄影 10:00–18:30（~9h）；2–3 分鐘片",
    }),
  },
  // 江sir 畢業典禮 — 18:45–20:15 = 1.5h, human used ~2h photo+video
  6150001: {
    label: "江sir 畢業典禮（已接受）",
    parse: () => ({
      photoHours: 1.5,
      videoHours: 1.5,
      days: 1,
      editMid: 2500,
      brief:
        "畢業典禮；18:45–20:15（1.5h）；活動攝影 + 短片錄影 + 後期；地點伊利沙伯中學禮堂",
    }),
  },
};

async function tryLiveAiParse(subject: string, body: string, fromEmail?: string) {
  try {
    const { parseInquiryWithAIForTest } = await import(
      "../server/routers/emailInquiries"
    );
    const parsed = await parseInquiryWithAIForTest(subject, body, fromEmail);
    return parsed;
  } catch (e: any) {
    return { error: String(e?.message || e) };
  }
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const quoteId = process.argv[2] ? Number(process.argv[2]) : 7770001;
  const caseDef = CASES[quoteId];

  const [q] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
  if (!q) throw new Error(`Quote ${quoteId} not found`);
  const items = await db
    .select()
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, quoteId));

  let inquiry: typeof emailInquiries.$inferSelect | null = null;
  if (q.emailInquiryId) {
    const rows = await db
      .select()
      .from(emailInquiries)
      .where(eq(emailInquiries.id, q.emailInquiryId))
      .limit(1);
    inquiry = rows[0] ?? null;
  }

  const humanTotal = Number(q.total) || 0;
  const humanItems = items
    .filter((i) => Number(i.amount) > 0)
    .map((i) => ({
      description: i.description,
      quantity: Number(i.quantity),
      unitPrice: Number(i.unitPrice),
      amount: Number(i.amount),
    }));

  const parsedHours = caseDef
    ? caseDef.parse(inquiry?.bodyText || "", q.notes || "")
    : {
        photoHours: Number(q.shootHours) || 4,
        videoHours: 0,
        days: 1,
        editMid: 2500,
        brief: (q.notes || "").slice(0, 200) || "（無預設 case，用 shootHours）",
      };

  const aiRule = aiCorporateEventQuote({
    photoHours: parsedHours.photoHours,
    videoHours: parsedHours.videoHours,
    days: parsedHours.days,
    editMid: parsedHours.editMid,
  });

  let liveAi: any = null;
  if (inquiry?.bodyText) {
    liveAi = await tryLiveAiParse(
      inquiry.subject || "",
      inquiry.bodyText.slice(0, 8000),
      inquiry.fromEmail || undefined
    );
  }

  const deltaMid = aiRule.mid - humanTotal;
  const report = {
    title: "內部測試：人手報價 vs AI 規則再報價",
    caseLabel: caseDef?.label ?? q.quoteNumber,
    human: {
      quoteId: q.id,
      quoteNumber: q.quoteNumber,
      status: q.status,
      serviceType: q.serviceType,
      clientName: q.clientName,
      total: humanTotal,
      items: humanItems,
      notes: (q.notes || "").slice(0, 500),
    },
    inquiry: inquiry
      ? {
          id: inquiry.id,
          from: inquiry.fromEmail,
          subject: inquiry.subject,
          bodyPreview: (inquiry.bodyText || "").slice(0, 900),
        }
      : null,
    understoodBrief: parsedHours.brief,
    aiRuleBased: {
      source: "emailInquiries BILLING_RULES (corporate_event mid)",
      assumptions: aiRule.assumptions,
      hours: {
        photo: parsedHours.photoHours,
        video: parsedHours.videoHours,
        days: parsedHours.days,
      },
      items: aiRule.items,
      pricingLow: aiRule.low,
      pricingMid: aiRule.mid,
      pricingHigh: aiRule.high,
    },
    liveAiParse: liveAi,
    gap: {
      midVsHuman: deltaMid,
      midVsHumanPct: pct(deltaMid, humanTotal),
      lowVsHuman: aiRule.low - humanTotal,
      lowVsHumanPct: pct(aiRule.low - humanTotal, humanTotal),
      highVsHuman: aiRule.high - humanTotal,
      highVsHumanPct: pct(aiRule.high - humanTotal, humanTotal),
      verdict:
        Math.abs(deltaMid) / Math.max(humanTotal, 1) <= 0.15
          ? "接近（±15% 內）"
          : deltaMid > 0
            ? "AI 規則偏高"
            : "AI 規則偏低",
    },
  };

  // Console summary
  console.log("\n========== 內部測試：人手 vs AI 再報價 ==========");
  console.log(`Case: ${report.caseLabel}`);
  console.log(`Human: ${q.quoteNumber} (${q.status}) = ${money(humanTotal)}`);
  console.log(`Brief: ${parsedHours.brief}`);
  console.log("\n--- 人手明細（有金額）---");
  for (const i of humanItems) {
    console.log(
      `  ${i.description} | ${i.quantity} × ${i.unitPrice} = ${i.amount}`
    );
  }
  console.log("\n--- AI 規則再報價（mid）---");
  for (const i of aiRule.items) {
    console.log(
      `  ${i.description} | ${i.quantity} × ${i.unitPrice} = ${i.amount}${i.note ? `  (${i.note})` : ""}`
    );
  }
  console.log(
    `\nAI band: low ${money(aiRule.low)} | mid ${money(aiRule.mid)} | high ${money(aiRule.high)}`
  );
  console.log(
    `Gap (mid−human): ${money(deltaMid)} (${pct(deltaMid, humanTotal)}) → ${report.gap.verdict}`
  );
  if (liveAi?.error) {
    console.log(`\nLive LLM parse: SKIPPED (${liveAi.error})`);
  } else if (liveAi?.pricingMid != null) {
    const liveMid = Number(liveAi.pricingMid) || 0;
    console.log(`\nLive LLM mid: ${money(liveMid)} | gap vs human ${money(liveMid - humanTotal)} (${pct(liveMid - humanTotal, humanTotal)})`);
    console.log(`serviceType=${liveAi.serviceType} confidence=${liveAi.confidence}`);
  }

  const outDir = resolve("/opt/cursor/artifacts");
  try {
    mkdirSync(outDir, { recursive: true });
  } catch {
    /* ignore */
  }
  const outPath = resolve(
    outDir,
    `human-vs-ai-quote-${q.quoteNumber}.json`
  );
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nWrote ${outPath}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
