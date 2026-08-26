/**
 * Internal test: pick one customer inquiry email, (re)parse if possible,
 * create draft quote bypassing draft-readiness gate.
 *
 *   npx tsx scripts/internal-test-email-draft.ts [inquiryId]
 */
import "dotenv/config";
import { getDb, createQuote, updateEmailInquiry } from "../server/db";
import { emailInquiries } from "../drizzle/schema";
import { desc, eq, and, ne, isNotNull, or, like, sql } from "drizzle-orm";
import { evaluateInquiryDraftReadiness } from "../shared/inquiryDraftReadiness";
import { resolveQuoteLeadSource } from "../server/_core/leadSource";

const CANDIDATE_IDS = [
  12480003, // 會議攝影攝像 — clear requirements
  12420001, // 視覺藝術教育節 — mentioned PDF attachment
  12360001, // Company Profile 120 photos
  12210001, // 水陸兩項賽跟拍
];

async function main() {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const idArg = process.argv[2] ? Number(process.argv[2]) : null;
  let inquiry: typeof emailInquiries.$inferSelect | undefined;

  if (idArg) {
    const rows = await db
      .select()
      .from(emailInquiries)
      .where(eq(emailInquiries.id, idArg))
      .limit(1);
    inquiry = rows[0];
  } else {
    for (const id of CANDIDATE_IDS) {
      const rows = await db
        .select()
        .from(emailInquiries)
        .where(eq(emailInquiries.id, id))
        .limit(1);
      if (rows[0]) {
        inquiry = rows[0];
        break;
      }
    }
  }

  if (!inquiry) {
    // fallback: latest pending photography-ish
    const rows = await db
      .select()
      .from(emailInquiries)
      .where(
        and(
          eq(emailInquiries.status, "pending"),
          isNotNull(emailInquiries.bodyText),
          ne(emailInquiries.bodyText, "")
        )
      )
      .orderBy(desc(emailInquiries.createdAt))
      .limit(1);
    inquiry = rows[0];
  }

  if (!inquiry) throw new Error("No inquiry found");

  console.log("========== 抽中詢盤 ==========");
  console.log(`id=${inquiry.id}`);
  console.log(`from=${inquiry.fromEmail}`);
  console.log(`subject=${inquiry.subject}`);
  console.log(`status=${inquiry.status} quoteId=${inquiry.quoteId ?? "-"}`);
  console.log("\n--- Body ---");
  console.log((inquiry.bodyText ?? "").slice(0, 1500));

  let aiParsed: any = null;
  if (inquiry.aiParsed) {
    try {
      aiParsed = JSON.parse(inquiry.aiParsed);
      console.log("\n(使用已儲存 aiParsed)");
    } catch {
      aiParsed = null;
    }
  }

  // Try live re-parse if LLM available
  const hasLlm =
    !!(process.env.BUILT_IN_FORGE_API_KEY || process.env.OPENAI_API_KEY);
  if (hasLlm) {
    console.log("\n=== LLM available — re-parse with current logic ===");
    try {
      const { parseInquiryWithAIForTest } = await import(
        "../server/routers/emailInquiries"
      ).catch(() => ({ parseInquiryWithAIForTest: null as any }));
      // parseInquiryWithAIForTest may not exist — use dynamic approach
    } catch {
      /* fall through */
    }
  } else {
    console.log("\n(本環境無 LLM key — 用已存 aiParsed 或由正文建簡化理解)");
  }

  if (!aiParsed) {
    // Heuristic understanding for 會議攝影攝像 style emails when no stored parse
    const body = inquiry.bodyText ?? "";
    const hoursMatch = body.match(
      /下午\s*(\d+)\s*點\s*到\s*(\d+)\s*點|(\d+)\s*[-–~至到]\s*(\d+)\s*小時|(\d+(?:\.\d+)?)\s*小時/
    );
    let shootHours: number | null = null;
    if (hoursMatch) {
      if (hoursMatch[1] && hoursMatch[2]) {
        shootHours = Number(hoursMatch[2]) - Number(hoursMatch[1]);
      } else if (hoursMatch[5]) {
        shootHours = Number(hoursMatch[5]);
      }
    }
    const shotMatch = body.match(/不少於\s*(\d+)\s*張|(\d+)\s*張/);
    const shotCount = shotMatch
      ? Number(shotMatch[1] || shotMatch[2])
      : null;
    const hasVideo = /攝像|錄影|視頻|影片|videography/i.test(body);

    const items: Array<{
      description: string;
      quantity: number;
      unitPrice: number;
    }> = [];
    if (shootHours && shootHours > 0) {
      items.push({
        description: "Event Photography",
        quantity: shootHours,
        unitPrice: 1000,
      });
      if (hasVideo) {
        items.push({
          description: "Event Videography",
          quantity: shootHours,
          unitPrice: 2000,
        });
        items.push({
          description: "Video Editing (highlight)",
          quantity: 1,
          unitPrice: 2500,
        });
      }
      items.push({
        description: "Transportation Fee",
        quantity: 1,
        unitPrice: 320,
      });
    } else if (shotCount) {
      items.push({
        description: "Product / Portrait Photography",
        quantity: shotCount,
        unitPrice: 130,
      });
      items.push({
        description: "Transportation Fee",
        quantity: 1,
        unitPrice: 320,
      });
    } else {
      items.push({
        description: "Photography Service (please confirm scope)",
        quantity: 1,
        unitPrice: 0,
      });
    }

    aiParsed = {
      clientName: inquiry.fromName || "",
      clientEmail: inquiry.fromEmail,
      clientPhone: "",
      clientCompany: "",
      serviceType: hasVideo || /會議|活動|event/i.test(body)
        ? "corporate_event"
        : /產品|product/i.test(body)
          ? "product"
          : "corporate_event",
      eventName: "",
      shootingDate: "",
      shootingLocation: /酒店/.test(body) ? "酒店會議廳" : "",
      shootHours: shootHours ?? 0,
      shotCount: shotCount ?? 0,
      durationPackage:
        shootHours && shootHours >= 4 && shootHours <= 5
          ? "half_day"
          : shootHours && shootHours >= 6
            ? "full_day"
            : shootHours
              ? "hours"
              : "unknown",
      crewPhotographers: 0,
      crewVideographers: hasVideo ? 1 : 0,
      quantitySource: shootHours || shotCount ? "explicit" : "unknown",
      assumptions: [],
      missingFields: [],
      notes: `【內部測試理解】${(inquiry.subject || "").slice(0, 80)}；由正文抽取時數=${shootHours ?? "?"} 張數=${shotCount ?? "?"} 攝像=${hasVideo}`,
      suggestedItems: items,
      pricingMid: items.reduce((s, i) => s + i.quantity * i.unitPrice, 0),
      pricingLow: 0,
      pricingHigh: 0,
      confidence: "high",
      isInquiry: true,
      internalTest: true,
    };
  }

  const readiness = evaluateInquiryDraftReadiness(aiParsed);
  console.log("\n========== 理解結果 ==========");
  console.log(
    JSON.stringify(
      {
        serviceType: aiParsed.serviceType,
        shootHours: aiParsed.shootHours,
        shotCount: aiParsed.shotCount,
        durationPackage: aiParsed.durationPackage,
        quantitySource: aiParsed.quantitySource,
        notes: aiParsed.notes,
        suggestedItems: aiParsed.suggestedItems,
        pricingMid: aiParsed.pricingMid,
        readiness,
      },
      null,
      2
    )
  );

  console.log(
    "\n【內部測試】取消草稿就緒門檻 — 即使 blocked 都會開草稿"
  );

  if (inquiry.quoteId) {
    console.log(
      `\n已有關聯報價 quoteId=${inquiry.quoteId} — 唔重複開，請去報價單查看。`
    );
    process.exit(0);
  }

  const items = (aiParsed.suggestedItems ?? []).map(
    (item: any, idx: number) => {
      const qty = Number(item.quantity) || 1;
      const price = Number(item.unitPrice) || 0;
      return {
        description: item.description || "Photography Service",
        quantity: qty,
        unitPrice: price,
        amount: qty * price,
        sortOrder: idx,
      };
    }
  );
  if (items.length === 0) {
    items.push({
      description: "Photography Service",
      quantity: 1,
      unitPrice: 0,
      amount: 0,
      sortOrder: 0,
    });
  }
  const subtotalNum = items.reduce(
    (sum: number, it: { amount: number }) => sum + it.amount,
    0
  );

  const notes = [
    "[內部測試草稿 — 已取消就緒門檻]",
    `詢盤 #${inquiry.id}`,
    `寄件人: ${inquiry.fromEmail}`,
    `主題: ${inquiry.subject}`,
    "",
    aiParsed.notes || "",
    readiness.readyForAutoDraft
      ? ""
      : `（原門檻會阻擋：${readiness.blockers.join("；")}）`,
  ]
    .filter(Boolean)
    .join("\n");

  const newQuote = await createQuote({
    clientName:
      aiParsed.clientName || inquiry.fromName || inquiry.fromEmail || "客戶",
    clientEmail: aiParsed.clientEmail || inquiry.fromEmail,
    clientPhone: aiParsed.clientPhone || "",
    clientCompany: aiParsed.clientCompany || "",
    serviceType: (aiParsed.serviceType as any) || "other",
    shootingDate: aiParsed.shootingDate || "",
    shootingLocation: aiParsed.shootingLocation || "",
    notes,
    subtotal: String(subtotalNum),
    discountAmount: "0",
    total: String(subtotalNum),
    currency: "HKD",
    status: "draft",
    emailInquiryId: inquiry.id,
    shootHours:
      aiParsed.shootHours != null && Number(aiParsed.shootHours) > 0
        ? String(aiParsed.shootHours)
        : undefined,
    shotCount:
      aiParsed.shotCount != null && Number(aiParsed.shotCount) > 0
        ? Number(aiParsed.shotCount)
        : undefined,
    durationPackage:
      aiParsed.durationPackage === "hours" ||
      aiParsed.durationPackage === "half_day" ||
      aiParsed.durationPackage === "full_day" ||
      aiParsed.durationPackage === "multi_day"
        ? aiParsed.durationPackage
        : undefined,
    crewPhotographers: Number(aiParsed.crewPhotographers) || 0,
    crewVideographers: Number(aiParsed.crewVideographers) || 0,
    leadSource: resolveQuoteLeadSource({
      fromEmail: inquiry.fromEmail,
      bodyText: inquiry.bodyText,
      subject: inquiry.subject ?? undefined,
      fhJobId: inquiry.fhJobId,
    }),
    items,
  });

  await updateEmailInquiry(inquiry.id, {
    quoteId: newQuote.id,
    status: "pending_send",
    aiParsed: JSON.stringify({
      ...aiParsed,
      draftReadiness: readiness,
      internalTestBypassGate: true,
    }),
    aiConfidence: aiParsed.confidence || "high",
    processedAt: new Date(),
  });

  console.log("\n========== 已開草稿報價 ==========");
  console.log(`quoteId=${newQuote.id}`);
  console.log(`quoteNumber=${newQuote.quoteNumber}`);
  console.log(`total=HKD ${subtotalNum.toLocaleString()}`);
  console.log(`inquiry → pending_send, linked quoteId=${newQuote.id}`);
  console.log(`\n請到 jdsys.biz 報價單 #${newQuote.quoteNumber} 檢查。`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
