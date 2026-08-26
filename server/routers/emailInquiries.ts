import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM, extractLLMText } from "../_core/llm";
import {
  createEmailInquiry,
  createQuote,
  getEmailInquiries,
  getEmailInquiryById,
  getEmailInquiryByMessageId,
  getHistoricalPricingByServiceType,
  getFrequentItemsByServiceType,
  getWinRateByPriceTier,
  getClientQuoteHistory,
  getTimeWeightedHistoricalPricing,
  getDeviationCorrectionFactor,
  getQuoteById,
  updateEmailInquiry,
  updateQuote,
  hasAlreadySentToEmail,
} from "../db";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { ENV } from "../_core/env";
import { sendEmail, sendViaGmail } from "../resendEmail";
import { getDb } from "../db";
import { freehunterJobs, emailInquiries } from "../../drizzle/schema";
import { eq, like, or, and, desc } from "drizzle-orm";
import { resolveQuoteLeadSource } from "../_core/leadSource";
import { appBaseUrl, buildWaTrackUrl, waTrackAnchor } from "../_core/waTracking";
import { CREW_BILLING_RULES, detectCrewHighValue } from "../inquiryCrewHighValue";
import {
  evaluateInquiryDraftReadiness,
  formatInquiryDraftNotes,
} from "../../shared/inquiryDraftReadiness";
import { getLearningAutoDraftGate } from "../pricingLearning";
import {
  extractTextFromPdfAttachments,
  mergeEmailBodyWithPdfText,
} from "../emailPdfAttachments";
import {
  applyAttachmentUnderstandingToParsed,
  resolveAttachmentUnderstanding,
} from "../../shared/emailAttachmentUnderstanding";

/** After AI parse: annotate attachment status (none/used/missing) and gate confidence. */
function enrichParsedWithAttachmentGate(
  aiResult: Record<string, unknown> | null | undefined,
  opts: {
    subject: string;
    bodyText: string;
    attachmentText?: string | null;
    attachmentMeta?: Array<{ filename: string; chars?: number; error?: string }> | null;
  }
): Record<string, unknown> | null {
  if (!aiResult) return null;
  const pdfFileCount = Array.isArray(opts.attachmentMeta)
    ? opts.attachmentMeta.length
    : 0;
  const understanding = resolveAttachmentUnderstanding({
    subject: opts.subject,
    bodyText: opts.bodyText,
    attachmentText: opts.attachmentText,
    pdfFileCount,
  });
  let enriched = applyAttachmentUnderstandingToParsed(aiResult, understanding);
  if (pdfFileCount > 0) {
    enriched = {
      ...enriched,
      pdfAttachments: opts.attachmentMeta,
      pdfTextUsed: understanding.status === "used",
    };
    if (understanding.status === "used") {
      const names = (opts.attachmentMeta ?? []).map((m) => m.filename).join(", ");
      const note = `已讀取 PDF 附件：${names}`;
      const notes = String(enriched.notes ?? "");
      enriched.notes = notes.includes(note)
        ? notes
        : notes.trim()
          ? `${notes.trim()}（${note}）`
          : note;
    }
  }
  return enriched;
}

// ─── FH Notification email detection ─────────────────────────────────────────
// FH 系統通知郵件的識別方式：subject 包含「【Freehunter】」或「[Freehunter]」
// 真實郵件格式：subject = 「【Freehunter】新工作邀請：婚禮攝影及錄影服務」
// 注意：from 是自己的 Gmail 帳號（FH 轉發通知），不是 freehunter.hk 域名
function isFHSystemNotification(subject: string): boolean {
  const lower = subject.toLowerCase();
  return lower.includes("【freehunter】") || lower.includes("[freehunter]") || lower.includes("freehunter】") || lower.includes("freehunter]");
}

// 從 FH 通知郵件正文中提取客戶資料
// 真實郵件正文格式：
// 客戶姓名：陳小明 (Chan Siu Ming)
// 電郵地址：chansiuming@gmail.com
// 服務類型：婚禮攝影及錄影
function extractClientInfoFromFHBody(bodyText: string): { email: string | null; name: string | null; jobTitle: string | null } {
  // 提取電郵地址
  const emailPatterns = [
    /電郵地址[：:][\s]*([\w.+-]+@[\w.-]+\.[a-zA-Z]{2,})/,
    /Email[：:][\s]*([\w.+-]+@[\w.-]+\.[a-zA-Z]{2,})/i,
    /E-mail[：:][\s]*([\w.+-]+@[\w.-]+\.[a-zA-Z]{2,})/i,
  ];
  let email: string | null = null;
  for (const p of emailPatterns) {
    const m = bodyText.match(p);
    if (m) { email = m[1].trim(); break; }
  }

  // 提取客戶姓名（取英文名部分，括號內）
  let name: string | null = null;
  const namePatterns = [
    /客戶姓名[：:][\s]*[^(\n]*(\([^)]+\))/,  // 取括號內的英文名
    /客戶姓名[：:][\s]*([^\n]+)/,
    /Name[：:][\s]*([^\n]+)/i,
  ];
  for (const p of namePatterns) {
    const m = bodyText.match(p);
    if (m) {
      // 如果是括號內的英文名，去掉括號
      name = m[1].replace(/[()]/g, "").trim();
      break;
    }
  }

  // 提取工作/服務標題
  let jobTitle: string | null = null;
  const titlePatterns = [
    /服務類型[：:][\s]*([^\n]+)/,
    /活動名稱[：:][\s]*([^\n]+)/,
    /工作類型[：:][\s]*([^\n]+)/,
    /Service[：:][\s]*([^\n]+)/i,
  ];
  for (const p of titlePatterns) {
    const m = bodyText.match(p);
    if (m) { jobTitle = m[1].trim(); break; }
  }

  // Fallback: 從 subject 提取（在外部傳入）
  return { email, name, jobTitle };
}

// Translate/clean a job title into a concise English phrase using AI
export async function translateJobTitleToEnglish(jobTitle: string): Promise<string> {
  // If already all-ASCII (English), skip AI call
  if (/^[\x00-\x7F]+$/.test(jobTitle)) return jobTitle;
  try {
    const result = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "You are a professional translator. Translate the given Freelancer job title into a concise, natural English phrase suitable for a business email. Output ONLY the translated phrase, no explanation, no punctuation at end.",
        },
        { role: "user", content: jobTitle },
      ],
    });
    const translated = extractLLMText(result?.choices?.[0]?.message?.content) || undefined;
    if (translated && translated.length > 0 && translated.length < 120) {
      console.log(`[FH AutoEmail] Translated job title: "${jobTitle}" → "${translated}"`);
      return translated;
    }
  } catch (e) {
    console.warn("[FH AutoEmail] Job title translation failed, using original:", e);
  }
  return jobTitle; // fallback to original
}

// Generate a personalised 1-2 sentence opening based on the job description
async function generatePersonalisedOpening(jobTitle: string, jobDescription: string): Promise<string> {
  const defaultOpening = `We noticed your posting on Freehunter regarding the ${jobTitle} opportunity and are very interested in this project. We would welcome the chance to participate in the event coverage.`;
  if (!jobDescription || jobDescription.trim().length < 20) return defaultOpening;
  try {
    const result = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are a professional business development writer for JD STUDIO HK, a Hong Kong photography, videography, and design company.\nJD Studio offers: photography (event, corporate, product, food, portrait, wedding), videography (corporate video, event filming, promotional), and design (graphic design, branding, logo, annual report, poster, print design, namecard).\nWrite 1-2 short, natural English sentences that:\n1. Show you have read the specific job posting (reference a specific detail from the description)\n2. Express genuine interest in the project\n3. Sound warm and professional, NOT generic\n4. Are suitable as an opening paragraph in a cold outreach email\nDo NOT start with "I" or "We noticed". Do NOT mention the company name. Do NOT mention any price, budget, estimate, HK$, or dollar amount. Output ONLY the 1-2 sentences, no greeting, no sign-off.`,
        },
        {
          role: "user",
          content: `Job title: ${jobTitle}\n\nJob description:\n${jobDescription.slice(0, 800)}`,
        },
      ],
    });
    const opening = extractLLMText(result?.choices?.[0]?.message?.content) || undefined;
    if (opening && opening.length > 20 && opening.length < 400) {
      console.log(`[FH AutoEmail] AI personalised opening generated for: "${jobTitle}"`);
      return opening;
    }
  } catch (e) {
    console.warn("[FH AutoEmail] AI personalised opening failed, using default:", e);
  }
  return defaultOpening;
}

/**
 * Clean a FH client display name for use in email salutation.
 * Handles:
 * 1. Leading CJK characters concatenated before English name (e.g. "歷史建築Iris N" → "Iris N")
 * 2. English service/job-type prefix words before the real name
 *    (e.g. "ReelsJerry Kwan" → "Jerry Kwan", "Photo John Smith" → "John Smith")
 * 3. More than 3 English words (likely job-title prefix) → take last 2 words
 * 4. Falls back to "Sir/Madam" if nothing usable remains
 */
const FH_NAME_PREFIX_WORDS = [
  "reels", "reel", "photo", "photos", "photography", "photographer",
  "video", "videos", "videography", "videographer", "film", "films", "filmmaker",
  "studio", "studios", "production", "productions", "media", "creative",
  "design", "designs", "designer", "art", "arts", "artist",
  "drone", "aerial", "360", "vr", "live", "event", "events",
  "wedding", "portrait", "commercial", "corporate",
  // Business/management prefixes
  "management", "manager", "marketing", "content", "social", "digital",
  "brand", "branding", "agency", "freelance", "freelancer", "consultant",
  "director", "editor", "coordinator", "executive", "officer",
  "hk", "hong", "kong",
  // Additional job/channel prefixes
  "channel", "specialist", "creator", "new", "youtube", "instagram", "tiktok",
  "project", "service", "services", "solution", "solutions",
  "team", "group", "company", "co", "ltd", "limited",
  "professional", "pro", "expert", "senior", "junior",
  // Common English connectors/prepositions that appear in job titles
  "and", "or", "for", "of", "the", "a", "an", "with", "in", "on", "at", "by", "to",
  "online", "web", "mobile", "app", "platform",
  // Additional truncated/partial words found in FH scraped names
  "sme", "spot", "spots", "revamp", "filter", "enhance",
  "host", "booking", "book",
  // Interior/design related
  "interior", "exterior", "architect", "architecture",
  // Inquiry/pricing related words that may appear in email subjects parsed as names
  "quotation", "quote", "pricing", "price", "enquiry", "inquiry", "request", "proposal",
];

const FH_PREFIX_SET = new Set(FH_NAME_PREFIX_WORDS.map((w) => w.toLowerCase()));

// Prefixes to EXCLUDE from Step 4 (concatenated-first-word check) because they
// are too short or too common and risk false-matching real name prefixes
// e.g. "and" would match "Andrew", "or" would match "Orlando"
const FH_STEP4_EXCLUDED = new Set(["and", "or", "for", "of", "the", "a", "an", "with", "in", "on", "at", "by", "to", "co", "vr"]);

export function cleanClientName(raw: string): string {
  if (!raw || !raw.trim()) return "Sir/Madam";
  let name = raw.trim();

  // Step 1: Strip leading CJK block (no space between CJK and English)
  name = name.replace(/^[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef\u3010-\u301f\u3040-\u309f\u30a0-\u30ff]+/, "").trim();

  // Step 1b: Extract last English name segment if CJK appears in the middle
  // e.g. "caption 內文Leo C" → "Leo C", "Freelance工作公司人像攝影Kylie HU" → "Kylie HU"
  const cjkInMiddle = /[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef\u3010-\u301f\u3040-\u309f\u30a0-\u30ff]/;
  if (cjkInMiddle.test(name)) {
    const segments = name.split(/[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef\u3010-\u301f\u3040-\u309f\u30a0-\u30ff]+/);
    const lastEnglish = segments[segments.length - 1].trim();
    if (lastEnglish && lastEnglish.length > 1) {
      name = lastEnglish;
    }
  }

  // Step 1c: Strip leading truncated fragments (1-2 chars followed by a space)
  // ONLY if the NEXT word is a known prefix word (meaning the fragment is a truncated prefix)
  // e.g. "l Marketing FreelancerKaren lam" → "Marketing FreelancerKaren lam"
  // e.g. "ic Design FreelancerLee Oi Ming" → "Design FreelancerLee Oi Ming"
  // But NOT: "CK Lam", "Mr Chan", "WY TAI" (next word is NOT a prefix word)
  {
    const firstSpaceIdx = name.indexOf(" ");
    if (firstSpaceIdx > 0 && firstSpaceIdx <= 2) {
      const rest = name.slice(firstSpaceIdx + 1).trim();
      const secondWord = rest.split(/\s+/)[0] || "";
      if (FH_PREFIX_SET.has(secondWord.toLowerCase())) {
        name = rest;
      }
    }
  }

  // Step 2: If name starts with a known service/job-type prefix word (case-insensitive),
  // strip it. Handles both "ReelsJerry" (no space) and "Reels Jerry" (with space).
  // We keep stripping until the first word is NOT a prefix word.
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of FH_NAME_PREFIX_WORDS) {
      const reSpaced = new RegExp(`^${prefix}(?=\\s)`, "i");
      const reConcatenated = new RegExp(`^${prefix}(?=[A-Z][a-z])`, "i");
      let after: string | null = null;
      if (reSpaced.test(name)) {
        after = name.replace(reSpaced, "").trim();
      } else if (reConcatenated.test(name)) {
        const matchLen = prefix.length;
        const nextChar = name[matchLen];
        if (nextChar && /[A-Z]/.test(nextChar)) {
          after = name.slice(matchLen).trim();
        }
      }
      if (after !== null && after !== name && after.length > 0) {
        name = after;
        changed = true;
        break;
      }
    }
  }

  if (!name) {
    // Fallback: take last 2 words of original
    const parts = raw.trim().split(/\s+/);
    name = parts.slice(-2).join(" ");
  }

  // Step 3: If still more than 3 words, likely has remaining prefix — take last 2 words
  const parts = name.split(/\s+/);
  if (parts.length > 3) name = parts.slice(-2).join(" ");

  // Step 4: Final pass — clean any concatenated prefix in the first word
  // Only use prefixes with length >= 3 to avoid false matches on name initials (e.g. "a" matching "Abby")
  const finalParts = name.split(/\s+/);
  if (finalParts.length > 0) {
    let firstWord = finalParts[0];
    for (const prefix of FH_NAME_PREFIX_WORDS) {
      if (prefix.length < 3) continue; // Skip very short prefixes to avoid false matches
      if (FH_STEP4_EXCLUDED.has(prefix.toLowerCase())) continue; // Skip common words that risk false matches
      const reConcatenatedAny = new RegExp(`^${prefix}(?=[A-Za-z])`, "i");
      if (reConcatenatedAny.test(firstWord)) {
        const matchLen = prefix.length;
        const nextChar = firstWord[matchLen];
        if (nextChar && /[A-Za-z]/.test(nextChar)) {
          const candidate = firstWord.slice(matchLen);
          if (candidate.length >= 2) {
            firstWord = candidate;
            finalParts[0] = firstWord;
            name = finalParts.join(" ");
            break;
          }
        }
      }
    }
  }

  // Step 5: Final sanity check — reject results that are clearly not a person name:
  // - Single word that is all-uppercase and <= 3 chars (e.g. "AI", "HK", "VR")
  // - Single word that is a known tech/abbreviation term
  // - Result is still in the FH_PREFIX_SET (e.g. "Logo", "Design")
  // - Looks like an email username (contains . or _ without spaces, e.g. "tangram.stephanie")
  const KNOWN_NON_NAMES = new Set(["ai", "hk", "vr", "ar", "cg", "3d", "2d", "it", "ui", "ux", "pr", "hr", "bd", "ceo", "cto", "coo", "cfo"]);
  if (name) {
    const lower = name.toLowerCase();
    const wordCount = name.split(/\s+/).length;
    const isAllCapsShort = wordCount === 1 && name === name.toUpperCase() && name.length <= 3;
    const isKnownNonName = wordCount === 1 && KNOWN_NON_NAMES.has(lower);
    const isPrefixWord = wordCount === 1 && FH_PREFIX_SET.has(lower);
    // 過濾電郵用戶名格式：含有 . 或 _ 且沒有空格（如 tangram.stephanie）
    const isEmailUsername = /[._]/.test(name) && !name.includes(' ');
    if (isAllCapsShort || isKnownNonName || isPrefixWord || isEmailUsername) {
      name = "Sir/Madam";
    }
  }

  return name || "Sir/Madam";
}

// 發送第一封 FH 客戶開發郵件
export async function sendFHFirstEmail(clientEmail: string, clientName: string, jobTitle: string, fhInquiryId?: number, jobDescription?: string): Promise<{ success: boolean; messageId: string | undefined }> {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPassword = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPassword) {
    console.error("[FH AutoEmail] Gmail credentials not configured");
    return { success: false, messageId: undefined };
  }

  // Clean clientName using shared cleanClientName() helper
  const displayName = cleanClientName(clientName);

  // Translate job title to English for the email body
  const englishJobTitle = await translateJobTitleToEnglish(jobTitle);

  // Generate AI personalised opening (uses job description if available)
  const personalisedOpening = await generatePersonalisedOpening(englishJobTitle, jobDescription ?? "");

  const emailBody = `Dear ${displayName},\n\nWe are JD STUDIO HK, a production company providing professional photography, videography, and design services. ${personalisedOpening}\nWe would love to connect with you via WhatsApp to better understand your requirements and provide an accurate quote: ${buildWaTrackUrl("fh_first_email", { inq: fhInquiryId })}\n\n---\n\n您好 ${displayName}，\n\n我們是 JD STUDIO HK，專業攝影、影片製作及設計公司。我們留意到您在 Freehunter 上的工作邀請，非常有興趣參與這個項目。\n\n歡迎透過 WhatsApp 聯絡我們，以便更深入了解您的需求並提供準確報價：${buildWaTrackUrl("fh_first_email", { inq: fhInquiryId })}\n\nCheers!\n\nDerek\nJD STUDIO HK\nTel No: (852) 9153 1976\nWeb: https://jdstudiohk.com/`;
  // 追蹤像素：客戶開啟郵件時觸發，記錄到 emailInquiries.replyOpenedAt
  const trackingPixel = fhInquiryId
    ? `<img src="${appBaseUrl()}/api/track/fh/${fhInquiryId}" width="1" height="1" style="display:none" alt="" />`
    : "";
  const whatsappLine = `We would love to connect with you via WhatsApp to better understand your requirements and provide an accurate quote: ${waTrackAnchor("fh_first_email", { inq: fhInquiryId })}`;
  const whatsappLineCN = `歡迎透過 WhatsApp 聯絡我們，以便更深入了解您的需求並提供準確報價：${waTrackAnchor("fh_first_email", { inq: fhInquiryId })}`;
  const htmlEmailBody = `Dear ${displayName},<br><br>We are JD STUDIO HK, a production company providing professional photography, videography, and design services. ${personalisedOpening}<br>${whatsappLine}<br><br><hr style="border:none;border-top:1px solid #e0e0e0;margin:20px 0"><br>您好 ${displayName}，<br><br>我們是 JD STUDIO HK，專業攝影、影片製作及設計公司。我們留意到您在 Freehunter 上的工作邀請，非常有興趣參與這個項目。<br><br>${whatsappLineCN}<br><br>Cheers!<br><br>Derek<br>JD STUDIO HK<br>Tel No: (852) 9153 1976<br>Web: <a href="https://jdstudiohk.com/">https://jdstudiohk.com/</a>`;
  try {
    const htmlBody = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
<div style="background:#1a1a1a;padding:20px 30px"><h2 style="color:#fff;margin:0;font-size:18px;letter-spacing:2px">JD STUDIO HK</h2></div>
<div style="padding:30px;line-height:1.6">${htmlEmailBody}</div>
<div style="background:#f5f5f5;padding:15px 30px;font-size:12px;color:#888"><p style="margin:0">JD Studio &middot; Hong Kong &nbsp;|&nbsp; info.exposurehk@gmail.com &nbsp;|&nbsp; www.jdstudiohk.com</p></div>
${trackingPixel}
</div>`;
    // FH first emails MUST use Gmail SMTP (not Resend) so they appear in Gmail Sent box
    // and are actually delivered to any recipient (Resend onboarding domain is test-only)
    const result = await sendViaGmail({
      to: clientEmail,
      subject: `Re: ${jobTitle}`,
      html: htmlBody,
      text: emailBody,
    });
    if (result.success) {
      console.log(`[FH AutoEmail] First email sent via Gmail to ${clientEmail} for job: ${jobTitle} (id: ${result.messageId})`);
      return { success: true, messageId: result.messageId };
    } else {
      console.error(`[FH AutoEmail] Gmail send failed for ${clientEmail}:`, result.error);
      return { success: false, messageId: undefined };
    }
  } catch (e) {
    console.error(`[FH AutoEmail] Failed to send email to ${clientEmail}:`, e);
    return { success: false, messageId: undefined };
  }
}

/**
 * Send a 3-day follow-up email to a FH client who hasn't replied.
 * Uses a shorter, warmer tone to re-engage the client.
 */
export async function sendFHFollowUpEmail(
  clientEmail: string,
  clientName: string,
  jobTitle: string,
  fhInquiryId: number,
  jobDescription?: string
): Promise<{ success: boolean; messageId: string | undefined }> {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPassword = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPassword) {
    console.error("[FH FollowUp] Gmail credentials not configured");
    return { success: false, messageId: undefined };
  }

  // Clean display name using shared cleanClientName() helper
  const displayName = cleanClientName(clientName);

  const englishJobTitle = await translateJobTitleToEnglish(jobTitle);

    const emailBody = `Dear ${displayName},\n\nJust wanted to follow up on my previous email regarding the ${englishJobTitle} project. We are still very interested and would love to discuss how JD STUDIO HK — photography, videography, and design — can help bring your vision to life.\n\nWe would love to connect with you via WhatsApp to better understand your requirements and provide an accurate quote: ${buildWaTrackUrl("fh_follow_up", { inq: fhInquiryId })}\n\nFeel free to reply to this email or reach out directly -- we are happy to answer any questions.\n\n---\n\n您好 ${displayName}，\n\n想跟進一下之前發送的郵件。我們對 ${englishJobTitle} 項目依然非常有興趣，希望能與您進一步溝通。\n\n歡迎透過 WhatsApp 聯絡我們，我們很樂意解答您的任何問題：${buildWaTrackUrl("fh_follow_up", { inq: fhInquiryId })}\n\nCheers!\n\nDerek\nJD STUDIO HK\nTel No: (852) 9153 1976\nWeb: https://jdstudiohk.com/`;
  // Tracking pixel (reuse the same inquiryId so open events are still tracked)
  const trackingPixel = `<img src="${appBaseUrl()}/api/track/fh/${fhInquiryId}" width="1" height="1" style="display:none" alt="" />`;
  const followUpWhatsappLine = `We would love to connect with you via WhatsApp to better understand your requirements and provide an accurate quote: ${waTrackAnchor("fh_follow_up", { inq: fhInquiryId })}`;
  const followUpWhatsappLineCN = `歡迎透過 WhatsApp 聯絡我們，我們很樂意解答您的任何問題：${waTrackAnchor("fh_follow_up", { inq: fhInquiryId })}`;
  const htmlFollowUpBody = `Dear ${displayName},<br><br>Just wanted to follow up on my previous email regarding the ${englishJobTitle} project. We are still very interested and would love to discuss how JD STUDIO HK can help bring your vision to life.<br><br>${followUpWhatsappLine}<br><br>Feel free to reply to this email or reach out directly -- we are happy to answer any questions.<br><br><hr style="border:none;border-top:1px solid #e0e0e0;margin:20px 0"><br>您好 ${displayName}，<br><br>想跟進一下之前發送的郵件。我們對 ${englishJobTitle} 項目依然非常有興趣，希望能與您進一步溝通。<br><br>${followUpWhatsappLineCN}<br><br>Cheers!<br><br>Derek<br>JD STUDIO HK<br>Tel No: (852) 9153 1976<br>Web: <a href="https://jdstudiohk.com/">https://jdstudiohk.com/</a>`;
  try {
    const htmlBody = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
<div style="background:#1a1a1a;padding:20px 30px"><h2 style="color:#fff;margin:0;font-size:18px;letter-spacing:2px">JD STUDIO HK</h2></div>
<div style="padding:30px;line-height:1.6">${htmlFollowUpBody}</div>
<div style="background:#f5f5f5;padding:15px 30px;font-size:12px;color:#888"><p style="margin:0">JD Studio &middot; Hong Kong &nbsp;|&nbsp; info.exposurehk@gmail.com &nbsp;|&nbsp; www.jdstudiohk.com</p></div>
${trackingPixel}
</div>`;
    // Use Gmail SMTP directly for follow-up emails (more reliable than Resend for thread continuity)
    const result = await sendViaGmail({
      to: clientEmail,
      subject: `Re: ${jobTitle}`,
      html: htmlBody,
      text: emailBody,
    });
    if (result.success) {
      console.log(`[FH FollowUp] Follow-up email sent to ${clientEmail} for job: ${jobTitle} (id: ${result.messageId})`);
      return { success: true, messageId: result.messageId };
    } else {
      console.error(`[FH FollowUp] Gmail send failed for ${clientEmail}:`, result.error);
      return { success: false, messageId: undefined };
    }
  } catch (e) {
    console.error(`[FH FollowUp] Failed to send email to ${clientEmail}:`, e);
    return { success: false, messageId: undefined };
  }
}

// 處理 FH 系統通知郵件：直接從郵件正文提取客戶資料並發送第一封回覆
async function processFHNotificationEmail(subject: string, bodyText: string): Promise<void> {
  console.log(`[FH AutoEmail] Processing FH notification: "${subject}"`);

  // 從郵件正文直接提取客戶資料（電郵、姓名、服務類型）
  const { email: clientEmail, name: clientName, jobTitle: serviceType } = extractClientInfoFromFHBody(bodyText);

  if (!clientEmail) {
    console.warn(`[FH AutoEmail] Could not extract client email from FH notification body. Subject: ${subject}`);
    return;
  }

  // 從 subject 提取工作標題（格式：【Freehunter】新工作邀請：{工作標題}）
  let jobTitle = serviceType || "";
  const subjectMatch = subject.match(/[：:]\s*(.+)$/);
  if (subjectMatch) {
    jobTitle = subjectMatch[1].trim();
  }
  if (!jobTitle) jobTitle = "Photography/Video Service";

  console.log(`[FH AutoEmail] Extracted - Email: ${clientEmail}, Name: ${clientName}, Job: ${jobTitle}`);

  // 發送第一封郵件
  const result = await sendFHFirstEmail(clientEmail, clientName || "", jobTitle);
  if (result.success) {
    console.log(`[FH AutoEmail] First email sent to ${clientEmail} for: ${jobTitle}`);
  }
}

// ─── Sender domains/emails to exclude (system notifications, job alerts) ─────
const EXCLUDED_SENDER_PATTERNS = [
  "linkedin.com", "jobalerts-noreply", "jobs-listings",
  // freehunter.com.hk is a valid inquiry source — do NOT exclude it
  "hellotoby.com", "noreply", "no-reply", "donotreply", "mailer-daemon",
  "notifications@", "newsletter", "unsubscribe", "bounce", "postmaster",
  "vimeo.com", "youtube.com", "google.com", "facebook.com", "instagram.com",
  "twitter.com", "apple.com", "microsoft.com", "dropbox.com", "slack.com",
  "support@", "team@", "hello@", "welcome@",
  // MailSuite tracking notifications — not real client inquiries
  "mailsuite.com", "notification@mailsuite",
];

function isExcludedSender(fromEmail: string): boolean {
  const lower = fromEmail.toLowerCase();
  return EXCLUDED_SENDER_PATTERNS.some((pattern) => lower.includes(pattern));
}

// ─── Photography / Videography / Design trigger keywords ────────────
const TRIGGER_KEYWORDS = [
  // Photography
  "攝影", "photography", "photoshoot", "拍攝", "拍照", "photo",
  // Video
  "錄影", "video", "影片", "短片", "filming", "videography",
  // Design (expanded)
  "設計", "design", "designer",
  "平面設計", "graphic design", "graphic designer",
  "品牌設計", "branding", "brand design",
  "logo", "標誌", "商標",
  "年報", "annual report",
  "海報", "poster", "flyer", "傳單",
  "名片", "namecard", "business card",
  "社交媒體設計", "social media design",
  "印刷", "print design", "排版", "layout",
  "特刊", "刊物", "publication",
  "餐牌", "menu design",
  "網頁", "web design",
  // Inquiry intent
  "報價", "quotation", "quote", "pricing", "price", "費用", "收費", "enquiry", "inquiry",
];

function containsTriggerKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return TRIGGER_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

// ─── Freehunter detection ─────────────────────────────────────────
// Freehunter 詢價郵件的寄件人是客人自己的電郵，不是 freehunter.hk 域名
// 識別方式：郵件 HTML 內容包含 freehunter 連結，或寄件人是 freehunter 域名（舊格式）
function isFreehunterEmail(fromEmail: string, htmlBody?: string): boolean {
  const lower = fromEmail.toLowerCase();
  // 舊格式：寄件人是 freehunter 域名
  if (lower.includes("freehunter.com.hk") || lower.includes("freehunter.hk")) return true;
  // 新格式：郵件 HTML 包含 freehunter 連結（客人電郵轉發的工作通知）
  if (htmlBody) {
    const htmlLower = htmlBody.toLowerCase();
    if (htmlLower.includes("freehunter.com.hk") || htmlLower.includes("freehunter.hk")) return true;
  }
  return false;
}


// ─── HK Market Reference Pricing (fallback when no historical data) ─────────
const HK_MARKET_PRICING: Record<string, { low: number; mid: number; high: number; note?: string; items: Array<{desc: string; unitPrice: number}> }> = {
  // 2026 HK Market Reference (Sources: freelance.com.hk, jdstudiohk.com, hellotoby.com, freehunter.hk)
  corporate_event: {
    low: 2800, mid: 5600, high: 10000,
    note: "BILLING: per hour HK$700-1,000. Corporate events HK$1,000/hr; personal events HK$700/hr. Retouching included. Transportation HK$320.",
    items: [
      {desc:"Event Photography (per hour)",unitPrice:800},
      {desc:"Transportation Fee",unitPrice:320},
    ]
  },
  product: {
    low: 1300, mid: 3200, high: 7000,
    note: "BILLING: per image - white bg HK$130, styled bg HK$200, custom designer bg +HK$2,000/bg. Retouching included. Volume discount applies.",
    items: [
      {desc:"Product Photography - White Background (per image)",unitPrice:130},
      {desc:"Product Photography - Styled Background (per image)",unitPrice:200},
      {desc:"Custom Designer Background Design (per background, optional)",unitPrice:2000},
    ]
  },
  food_beverage: {
    low: 1300, mid: 3000, high: 6000,
    note: "BILLING: per image - white bg HK$130, styled bg HK$200, custom designer bg +HK$2,000/bg. Retouching included. Volume discount applies.",
    items: [
      {desc:"Food & Beverage Photography - White Background (per image)",unitPrice:130},
      {desc:"Food & Beverage Photography - Styled Background (per image)",unitPrice:200},
      {desc:"Custom Designer Background Design (per background, optional)",unitPrice:2000},
    ]
  },
  jewelry: {
    low: 1500, mid: 3000, high: 6000,
    note: "BILLING: per image HK$300. Retouching included. Volume discount applies.",
    items: [
      {desc:"Jewelry Photography (per image, retouching included)",unitPrice:300},
    ]
  },
  interior: {
    low: 3320, mid: 5820, high: 10000,
    note: "BILLING: per hour HK$1,000 (volume discount for more hours) + retouching HK$150/image. Transportation HK$320.",
    items: [
      {desc:"Interior Photography (per hour)",unitPrice:1000},
      {desc:"Photo Retouching (per image)",unitPrice:150},
      {desc:"Transportation Fee",unitPrice:320},
    ]
  },
  video_production: {
    low: 5000, mid: 14000, high: 35000,
    note: "HK market 2026: social media short video HK$3,000-8,000; corporate video HK$12,000-35,000; full production with crew HK$20,000-50,000",
    items: [
      {desc:"Video Production (full day shoot)",unitPrice:9000},
      {desc:"Post-Production (Editing, Color Grading, Sound Mix)",unitPrice:4500},
      {desc:"Motion Graphics / Title Cards",unitPrice:2000},
      {desc:"Transportation Fee",unitPrice:320},
    ]
  },
  ad_video: {
    low: 8000, mid: 20000, high: 50000,
    note: "HK market 2026: commercial ad video HK$15,000-50,000+; social media ad HK$8,000-20,000",
    items: [
      {desc:"Commercial Video Production (1 day)",unitPrice:12000},
      {desc:"Post-Production & Color Grading",unitPrice:6000},
      {desc:"Motion Graphics & VFX",unitPrice:4000},
      {desc:"Transportation & Equipment",unitPrice:500},
    ]
  },
  portrait: {
    low: 2000, mid: 4500, high: 8000,
    note: "BILLING: per hour HK$1,000 (volume discount for more hours) + retouching HK$150/image. Transportation HK$320.",
    items: [
      {desc:"Portrait Photography (per hour)",unitPrice:1000},
      {desc:"Photo Retouching (per image)",unitPrice:150},
      {desc:"Transportation Fee",unitPrice:320},
    ]
  },
  drone: {
    low: 3000, mid: 6500, high: 13000,
    note: "BILLING: per hour HK$2,000-3,500. HK market 2026: drone photography/video HK$3,000-6,500 per session; requires CAD permit",
    items: [
      {desc:"Drone Photography / Aerial Videography (2 hrs)",unitPrice:5000},
      {desc:"Post-Processing & Video Edit",unitPrice:1500},
    ]
  },
  menu_design: {
    low: 3000, mid: 6000, high: 12000,
    note: "BILLING: per dish HK$250-350 + design flat HK$2,000-4,000. HK market 2026: menu photography + design HK$3,000-12,000 depending on item count",
    items: [
      {desc:"Menu Item Photography (per dish)",unitPrice:300},
      {desc:"Menu Layout Design",unitPrice:2500},
      {desc:"Photo Retouching",unitPrice:1000},
    ]
  },
  graphic_design: {
    low: 2000, mid: 5000, high: 15000,
    note: "HK market 2026: freelance graphic design HK$200-600/hr; project-based HK$3,000-80,000",
    items: [
      {desc:"Graphic Design (project)",unitPrice:4000},
      {desc:"Revision Rounds",unitPrice:500},
    ]
  },
  kol_mi: {
    low: 4000, mid: 9000, high: 20000,
    note: "HK market 2026: KOL/MI content creation HK$5,000-12,000 per campaign; full-day shoot with video HK$8,000-20,000; includes Reels/TikTok/IG format",
    items: [
      {desc:"KOL/MI Content Creation (Photo + Video for Social Media)",unitPrice:7000},
      {desc:"Post-Production & Editing (Reels/TikTok/IG format)",unitPrice:2000},
      {desc:"Transportation Fee",unitPrice:320},
    ]
  },
  other: {
    low: 2500, mid: 6000, high: 12000,
    note: "HK market 2026: general commercial photography HK$2,500+; video production HK$5,000-50,000",
    items: [
      {desc:"Photography / Videography Service",unitPrice:4500},
      {desc:"Post-Processing & Editing",unitPrice:1500},
      {desc:"Transportation Fee",unitPrice:320},
    ]
  },
};

// ─── AI parse inquiry email ────────────────────────────────────────
async function parseInquiryWithAI(subject: string, body: string, fromEmail?: string) {
  // Step 1: 快速解析服務類型（用於查詢歷史數據）
  const quickParsePrompt = `Identify the photography service type from this email inquiry. Return only the serviceType value.
Service types: corporate_event, product, food_beverage, jewelry, artwork, interior, video_production, graphic_design, ad_video, web_development, ai_photography, menu_design, portrait, 360_photography, drone, other
Email Subject: ${subject}\nEmail Body (first 300 chars): ${body.substring(0, 300)}`;

  let detectedServiceType = "other";
  try {
    const quickResult = await invokeLLM({
      messages: [
        { role: "system", content: "Return only the service type string, nothing else." },
        { role: "user", content: quickParsePrompt },
      ],
    });
    const raw = (quickResult.choices?.[0]?.message?.content as string ?? "").trim().toLowerCase();
    const validTypes = ["corporate_event","product","food_beverage","jewelry","artwork","interior","video_production","graphic_design","ad_video","web_development","ai_photography","menu_design","portrait","360_photography","drone","kol_mi","other"];
    if (validTypes.includes(raw)) detectedServiceType = raw;
  } catch {}

  // Step 2: 查詢歷史成交數據（並行查詢所有四種 context）
  const [historicalData, frequentItems, winRateData, timeWeightedData, deviationFactor] = await Promise.all([
    getHistoricalPricingByServiceType(detectedServiceType).catch(() => null),
    getFrequentItemsByServiceType(detectedServiceType).catch(() => []),
    getWinRateByPriceTier(detectedServiceType).catch(() => null),
    getTimeWeightedHistoricalPricing(detectedServiceType).catch(() => null),
    getDeviationCorrectionFactor(detectedServiceType).catch(() => null),
  ]);
  const marketRef = HK_MARKET_PRICING[detectedServiceType] ?? HK_MARKET_PRICING["other"];

  // 建立定價參考資訊注入 prompt（四種 context 合併）
  let pricingContext = "";
  if (historicalData && historicalData.count >= 3) {
    // A: 時間加權定價（D）優先於普通歷史平均
    const avgToUse = timeWeightedData ? timeWeightedData.weightedAvg : historicalData.avgTotal;
    const p25ToUse = timeWeightedData ? timeWeightedData.p25 : historicalData.p25;
    const p75ToUse = timeWeightedData ? timeWeightedData.p75 : historicalData.p75;
    const timeNote = timeWeightedData?.note ?? "";

    pricingContext = `
=== JD STUDIO HK HISTORICAL PRICING DATA — FOR VALIDATION ONLY (${historicalData.count} accepted quotes for ${detectedServiceType}) ===
ROLE: This data validates your final total — it does NOT set unit prices. Always use TIERED PRICING rules to calculate unit prices first.
- Time-weighted average accepted total (recent 3 months count double): HKD ${avgToUse}${timeNote ? ` [${timeNote}]` : ""}
- Accepted total range: HKD ${historicalData.minTotal} – ${historicalData.maxTotal}
- Conservative (P25): HKD ${p25ToUse} | Aggressive (P75): HKD ${p75ToUse}
- Recent accepted quotes (item descriptions are naming references ONLY — do NOT copy unit prices to override tiered rates):
${historicalData.recentQuotes.slice(0, 5).map((q, i) => `  Quote ${i+1}: HKD ${q.total} | Items: ${q.items.map(it => `${it.description} x${it.quantity} @${it.unitPrice}`).join(", ")}`).join("\n")}
VALIDATION RULE:
- After calculating pricingMid from tiered pricing, check if it falls within HKD ${p25ToUse} – ${p75ToUse}.
- If pricingMid is more than 30% outside this range, add a note in the "notes" field explaining why (e.g. "Larger order than historical average — volume discount applied").
- Do NOT adjust unit prices to force the total into the historical range. Tiered pricing is the source of truth for unit prices.
`;
  } else {
    pricingContext = `
=== HONG KONG MARKET REFERENCE PRICING (no sufficient historical data yet) ===
- LOW tier: HKD ${marketRef.low} | MID tier: HKD ${marketRef.mid} | HIGH tier: HKD ${marketRef.high}
- Reference items: ${marketRef.items.map(i => `${i.desc} ~HKD ${i.unitPrice}`).join(", ")}
`;
  }

  // B: Win-rate context（成交率分析）
  if (winRateData) {
    pricingContext += `
=== WIN RATE ANALYSIS (${winRateData.totalQuotes} total quotes, ${winRateData.overallWinRate}% overall win rate) ===
- Low tier (≤HKD ${winRateData.lowTier.maxPrice}): ${winRateData.lowTier.winRate}% win rate (${winRateData.lowTier.count} quotes)
- Mid tier (HKD ${winRateData.midTier.minPrice}–${winRateData.midTier.maxPrice}): ${winRateData.midTier.winRate}% win rate (${winRateData.midTier.count} quotes)
- High tier (>HKD ${winRateData.highTier.minPrice}): ${winRateData.highTier.winRate}% win rate (${winRateData.highTier.count} quotes)
IMPORTANT: Prefer the price tier with the highest win rate unless the inquiry signals premium budget.
`;
  }

  // E: Deviation correction factor context
  if (deviationFactor && deviationFactor.correctionFactor !== 1.0) {
    const dir = deviationFactor.avgDeviation > 0 ? "UNDERESTIMATING" : "OVERESTIMATING";
    pricingContext += `
=== AI SELF-CORRECTION FACTOR (${deviationFactor.confidence} confidence, ${deviationFactor.sampleCount} samples) ===
- Historical bias: AI has been ${dir} by ${Math.abs(deviationFactor.avgDeviation)}% on average for ${detectedServiceType}
- Correction factor: ${deviationFactor.correctionFactor}x (applied automatically to pricingMid)
- Note: ${deviationFactor.note}
INSTRUCTION: The pricingMid you output will be multiplied by ${deviationFactor.correctionFactor} automatically. Account for this in your item-level pricing.
`;
  }
  // A: Item-level frequency context（最常用項目）
  if (frequentItems && frequentItems.length > 0) {
    pricingContext += `
=== MOST FREQUENTLY USED ITEMS IN ACCEPTED QUOTES (use for item naming reference only) ===
${frequentItems.map(item => `- "${item.description}": historical avg HKD ${item.avgUnitPrice} (range ${item.minUnitPrice}–${item.maxUnitPrice}), used ${item.usageCount}x`).join("\n")}
INSTRUCTION: Use these exact item descriptions for naming consistency. However, for unit prices, ALWAYS apply the TIERED PRICING rules based on quantity — do NOT blindly copy the historical avg unit price if the quantity falls in a different tier.
`;
  }

  // C: Client history context（客戶歷史記憶）
  if (fromEmail) {
    const clientHistory = await getClientQuoteHistory(fromEmail).catch(() => null);
    if (clientHistory) {
      pricingContext += `
=== RETURNING CLIENT HISTORY (${clientHistory.totalAccepted} previous accepted quotes) ===
- Client email: ${clientHistory.email}
- Average accepted total: HKD ${clientHistory.avgTotal}
- Previous accepted quotes:
${clientHistory.recentQuotes.map((q, i) => `  Quote ${i+1}: HKD ${q.total} (${q.serviceType}) | Items: ${q.items.map(it => `${it.description} x${it.quantity} @${it.unitPrice}`).join(", ")}`).join("\n")}
IMPORTANT: This is a returning client. Use their previous accepted prices as the primary reference.
`;
    }
  }

  // Per-service billing rules: tells AI HOW to calculate quantity x unitPrice
  const BILLING_RULES = `
=== BILLING RULES BY SERVICE TYPE (CRITICAL - read before building suggestedItems) ===
Each service type has a specific billing unit. Extract the relevant quantity from the email and use it.
If the email does NOT mention a quantity, use the DEFAULT VALUE shown and note the assumption in the item description.

product photography
  - Main item: "Product Photography" - billed PER IMAGE. Extract number of images/products/SKUs from email. Default: 20 images.
  - White background: HKD 130/image. Styled background: HKD 200/image. Custom designer background: +HKD 2,000 per background (optional add-on).
  - Retouching is INCLUDED in the per-image price. Do NOT add a separate retouching line item.
  - Volume discount: the more images, the lower the per-image rate. For large orders (50+ images) use HKD 110-120/image for white bg.
  - Example (20 white bg): 20 x HKD 130 = HKD 2,600. Example (30 styled bg): 30 x HKD 200 = HKD 6,000.
  - If client mentions both white bg and styled bg, split into two line items.

food_beverage photography
  - Main item: "Food & Beverage Photography" - billed PER IMAGE. Extract number of dishes/images from email. Default: 20 images.
  - White background: HKD 130/image. Styled background: HKD 200/image. Custom designer background: +HKD 2,000 per background (optional add-on).
  - Retouching is INCLUDED in the per-image price. Do NOT add a separate retouching line item.
  - Volume discount applies for large orders.
  - Example (15 white bg): 15 x HKD 130 = HKD 1,950. Example (20 styled bg): 20 x HKD 200 = HKD 4,000.

jewelry photography
  - Main item: "Jewelry Photography" - billed PER IMAGE. Extract number of jewelry pieces/images from email. Default: 10 images.
  - unitPrice: HKD 300/image. Retouching is INCLUDED. Volume discount applies.
  - Example: 20 pieces x HKD 300 = HKD 6,000.

corporate_event photography
  - Main item: "Event Photography" - billed PER HOUR. Extract event duration from email. Default: 5 hours (half-day) only if duration missing — then quantitySource must be "assumed".
  - Corporate/commercial events: HKD 1,000/hr. Personal events (birthday, wedding, etc.): HKD 700/hr.
  - Half-day ≈ 4–5 hours; full-day ≈ 6–10 hours. Set durationPackage accordingly.
  - Retouching is INCLUDED. Add "Transportation Fee" HKD 320 (fixed, always include).
  - If videography also requested, add "Event Videography" per hour HKD 1,500-2,500 + "Video Editing" flat HKD 2,000-4,000.
  - Example (corporate, 4 hrs): 4 x HKD 1,000 + transport HKD 320 = HKD 4,320.
  - Example (personal, 3 hrs): 3 x HKD 700 + transport HKD 320 = HKD 2,420.

interior photography
  - Main item: "Interior Photography" - billed PER HOUR. Extract hours or number of rooms from email. Default: 3 hours.
  - unitPrice: HKD 1,000/hr. Volume discount: more hours = lower per-hour rate (e.g. 5+ hrs use HKD 900/hr).
  - Add: "Photo Retouching" per image HKD 150. Extract number of final edited images. Default: 20 images.
  - Add: "Transportation Fee" HKD 320 (fixed, always include).
  - Example: 3 hrs x HKD 1,000 + retouching 20 x HKD 150 + transport HKD 320 = HKD 6,320.

portrait photography
  - Main item: "Portrait Photography" - billed PER HOUR. Extract session length from email. Default: 2 hours.
  - unitPrice: HKD 1,000/hr. Volume discount: more hours = lower per-hour rate.
  - Add: "Photo Retouching" per image HKD 150. Extract number of final edited images. Default: 10 images.
  - Add: "Transportation Fee" HKD 320 (fixed, always include).
  - Example: 2 hrs x HKD 1,000 + retouching 10 x HKD 150 + transport HKD 320 = HKD 3,820.

drone photography/videography
  - Main item: "Drone Photography / Aerial Videography" - billed PER HOUR. Extract flight duration. Default: 2 hours.
  - unitPrice per hour: HKD 2,000-3,500
  - Add: "Post-Processing & Video Edit" flat HKD 1,500-3,000. Add: "Transportation Fee" HKD 320 (fixed).
  - Example: 2 hrs x HKD 2,500 + editing HKD 2,000 + transport HKD 320 = HKD 7,320.

menu_design (photography + design)
  - Main item: "Menu Item Photography" - billed PER IMAGE. Extract number of menu items. Default: 20 images.
  - White background: HKD 130/image. Styled background: HKD 200/image. Custom designer background: +HKD 2,000 per background (optional).
  - Retouching INCLUDED. Add: "Menu Layout Design" flat HKD 2,000-4,000 if design work requested.
  - Example: 30 dishes white bg x HKD 130 + design HKD 2,500 = HKD 6,400.

artwork photography
  - Main item: "Artwork Photography" - billed PER PIECE. Extract number of artworks. Default: 10 pieces.
  - unitPrice per piece: HKD 400-700. Add: "Color Calibration & Retouching" per image HKD 200-350. Add: "Studio Setup" flat HKD 800-1,500.

360_photography
  - Main item: "360 Photography" - billed PER LOCATION/ROOM. Extract number of locations. Default: 5 locations.
  - unitPrice per location: HKD 800-1,500. Add: "Virtual Tour Stitching & Hosting" flat HKD 1,500-3,000.

RETOUCHING SUMMARY (CRITICAL):
  - product, food_beverage, jewelry, corporate_event: retouching INCLUDED in per-image/per-hour price. Do NOT add separate retouching line.
  - interior, portrait: retouching is SEPARATE at HKD 150/image. ALWAYS add as a line item.

IMPORTANT RULES FOR ALL SERVICE TYPES:
1. ALWAYS extract quantity signals from the email: number of items/products/dishes/hours/rooms/pieces mentioned.
2. If no quantity is mentioned, use the DEFAULT VALUE above, set quantitySource="assumed", list the assumption in assumptions[], and append "(assumed X - please confirm)" to the item description.
3. If quantity IS clearly stated in the email, set quantitySource="explicit".
4. Transportation Fee is ALWAYS HKD 320 (fixed). Never change this amount.
5. pricingMid MUST equal the exact sum of (quantity x unitPrice) across all suggestedItems.
6. pricingLow = pricingMid x 0.7 (rounded to nearest 100). pricingHigh = pricingMid x 1.35 (rounded to nearest 100).
7. HISTORICAL DATA above is for VALIDATION only — do NOT override the tiered unit prices in this section with historical totals. Always apply the TIERED PRICING rules above to calculate unit prices based on quantity.
8. Prefer accurate understanding over guessing. Put unclear fields in missingFields[]. Never invent a shooting date.
9. Not every email has an attachment — that is normal. If the body says details are in an attachment (e.g. 詳見附件 / see attached) but there is NO "=== PDF ATTACHMENT TEXT ===" section below, set confidence to "medium" or "low", add "attachmentText" to missingFields, and do NOT invent shootHours / shotCount / durationPackage defaults as if the brief were complete.
${CREW_BILLING_RULES}

=== TIERED PRICING (VOLUME DISCOUNT) - APPLY THESE EXACT TIERS ===
These tiers use PSYCHOLOGICAL PRICING principles: each tier boundary is set at a natural decision point where clients feel they are getting meaningful value. Use the EXACT unit prices below — do NOT interpolate.

PRODUCT PHOTOGRAPHY (white background) — per image:
  1–9 images:   HKD 130/image   (standard rate)
  10–19 images: HKD 120/image   (8% off — "small batch" threshold)
  20–49 images: HKD 110/image   (15% off — "medium batch" threshold)
  50–99 images: HKD 100/image   (23% off — "large batch" threshold)
  100+ images:  HKD 90/image    (31% off — "bulk" threshold, negotiate)

PRODUCT PHOTOGRAPHY (styled background) — per image:
  1–9 images:   HKD 200/image
  10–19 images: HKD 185/image   (8% off)
  20–49 images: HKD 170/image   (15% off)
  50+ images:   HKD 155/image   (23% off)

FOOD & BEVERAGE PHOTOGRAPHY (white background) — per dish/image:
  1–9 images:   HKD 130/image
  10–19 images: HKD 120/image
  20–49 images: HKD 110/image
  50+ images:   HKD 100/image

FOOD & BEVERAGE PHOTOGRAPHY (styled background) — per dish/image:
  1–9 images:   HKD 200/image
  10–19 images: HKD 185/image
  20–49 images: HKD 170/image
  50+ images:   HKD 155/image

JEWELRY PHOTOGRAPHY — per piece/image:
  1–9 pieces:   HKD 300/piece
  10–19 pieces: HKD 270/piece   (10% off)
  20–29 pieces: HKD 250/piece   (17% off)
  30–49 pieces: HKD 230/piece   (23% off)
  50+ pieces:   HKD 210/piece   (30% off)

INTERIOR PHOTOGRAPHY — per hour (shooting fee only):
  1–2 hours:  HKD 1,000/hour   (standard)
  3–4 hours:  HKD 950/hour     (5% off — "half-day" threshold)
  5–7 hours:  HKD 900/hour     (10% off — "full-day" threshold)
  8+ hours:   HKD 850/hour     (15% off — "full-day extended")
  NOTE: Retouching (HKD 150/image) is ALWAYS a separate line item for interior photography.

PORTRAIT PHOTOGRAPHY — per hour (shooting fee only):
  1–2 hours:  HKD 1,000/hour   (standard)
  3–4 hours:  HKD 950/hour     (5% off)
  5+ hours:   HKD 900/hour     (10% off)
  NOTE: Retouching (HKD 150/image) is ALWAYS a separate line item for portrait photography.

EVENT PHOTOGRAPHY (corporate/commercial) — per hour:
  1–2 hours:  HKD 1,000/hour   (standard)
  3–5 hours:  HKD 950/hour     (5% off — "half-day event")
  6–8 hours:  HKD 900/hour     (10% off — "full-day event")
  9+ hours:   HKD 850/hour     (15% off — "multi-day/extended")

EVENT PHOTOGRAPHY (personal: birthday, family, graduation, etc.) — per hour:
  1–2 hours:  HKD 700/hour     (standard)
  3–4 hours:  HKD 650/hour     (7% off)
  5+ hours:   HKD 600/hour     (14% off)

PHOTO RETOUCHING (interior & portrait only) — per image:
  1–10 images:  HKD 150/image  (standard)
  11–20 images: HKD 140/image  (7% off)
  21–50 images: HKD 130/image  (13% off)
  51+ images:   HKD 120/image  (20% off)

PSYCHOLOGICAL PRICING RULES (CRITICAL — always apply):
A. Use the TIER that matches the TOTAL quantity. Apply ONE consistent unit price across all images in that tier (not a blended rate).
   Example: 25 white-bg product images → ALL 25 at HKD 110 = HKD 2,750 (NOT 9x130 + 10x120 + 6x110).
B. When quantity is at a tier BOUNDARY (e.g. exactly 10, 20, 50), always use the LOWER (discounted) rate — this rewards the client for reaching the threshold.
C. For large orders (50+ images), add a note in the description: "Volume rate applied" to signal the discount.
D. Never apply volume discount to Transportation Fee (always fixed HKD 320).
E. If client mentions a range (e.g. "about 20-30 products"), use the HIGHER end of the range for the tier calculation (gives client best value, increases conversion).
`;

  const prompt = `You are an assistant for JD Studio HK, a professional photography studio in Hong Kong.
Analyze the following email inquiry and extract structured information for creating a quotation.

Email Subject: ${subject}
Email Body:
${body}

IMPORTANT: If the body contains a section "=== PDF ATTACHMENT TEXT ===", that text was extracted from PDF attachments. Treat it as part of the client requirements (often more detailed than the email body). Prefer explicit quantities/dates/locations found in the PDF.

${pricingContext}

${BILLING_RULES}

Extract and return a JSON object with these fields:
- clientName: string (name of the person/company sending inquiry, or empty string)
- clientEmail: string (reply-to email if mentioned, or empty string)
- clientPhone: string (phone number if mentioned, or empty string)
- clientCompany: string (company name if mentioned, or empty string)
- serviceType: one of ["corporate_event","product","food_beverage","jewelry","artwork","interior","video_production","graphic_design","ad_video","web_development","ai_photography","menu_design","portrait","360_photography","drone","kol_mi","other"]
  (use "kol_mi" for KOL/influencer marketing, social media content creation, MI promotions)
- eventName: string (event / project name if mentioned, else empty string)
- shootingDate: string (date mentioned, YYYY-MM-DD format, or empty string — do NOT invent)
- shootingLocation: string (location mentioned, or empty string)
- shootHours: number (hours clearly stated or 0 if unknown; half-day ≈ 4–5, full-day ≈ 6–10)
- shotCount: number (delivered image/piece count clearly stated, or 0 if unknown)
- durationPackage: one of ["hours","half_day","full_day","multi_day","unknown"]
- crewPhotographers: number (photographers if stated, else 0)
- crewVideographers: number (videographers if stated, else 0)
- quantitySource: "explicit" | "assumed" | "unknown"
  (explicit = email clearly states hours or shot count; assumed = you used a default; unknown = cannot tell)
- assumptions: string[] (Traditional Chinese list of assumptions you made, empty array if none)
- missingFields: string[] (field names still unclear, e.g. ["shootHours","shotCount","shootingDate"])
- notes: string (summary of requirements in Traditional Chinese, max 280 chars; mention key needs first)
- pricingTier: "low" | "mid" | "high" (which tier was used for suggestedItems)
- pricingSource: "historical" | "market_reference" (data source used)
- pricingLow: number (= pricingMid x 0.7, rounded to nearest 100)
- pricingMid: number (= exact sum of quantity x unitPrice across all suggestedItems)
- pricingHigh: number (= pricingMid x 1.35, rounded to nearest 100)
- suggestedItems: array of objects with { description: string, quantity: number, unitPrice: number }
  - MUST follow the BILLING RULES / TIERED PRICING above for the detected serviceType (tiered rates are source of truth for unit prices)
  - Extract quantity from the email; if not mentioned, use the default, set quantitySource="assumed", and note in description + assumptions
  - Descriptions in English (professional photography terms)
  - Transportation Fee MUST always be HKD 320 (fixed rate) - never $0, never other amounts
  - unitPrice CAN be 0 ONLY if the service is genuinely bundled/complimentary
- confidence: "high" | "medium" | "low" (how confident you are this is a genuine photography inquiry AND you understood the core need)
- isInquiry: boolean (true if this is genuinely a photography/design service inquiry)`;


  try {
    const result = await invokeLLM({
      messages: [
        { role: "system", content: "You are a helpful assistant that extracts structured data from emails. Always respond with valid JSON only." },
        { role: "user", content: prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "inquiry_parse",
          strict: true,
          schema: {
            type: "object",
            properties: {
              clientName: { type: "string" },
              clientEmail: { type: "string" },
              clientPhone: { type: "string" },
              clientCompany: { type: "string" },
              serviceType: { type: "string" },
              eventName: { type: "string" },
              shootingDate: { type: "string" },
              shootingLocation: { type: "string" },
              shootHours: { type: "number" },
              shotCount: { type: "number" },
              durationPackage: { type: "string" },
              crewPhotographers: { type: "number" },
              crewVideographers: { type: "number" },
              quantitySource: { type: "string" },
              assumptions: {
                type: "array",
                items: { type: "string" },
              },
              missingFields: {
                type: "array",
                items: { type: "string" },
              },
              notes: { type: "string" },
              suggestedItems: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    description: { type: "string" },
                    quantity: { type: "number" },
                    unitPrice: { type: "number" },
                  },
                  required: ["description", "quantity", "unitPrice"],
                  additionalProperties: false,
                },
              },
              pricingTier: { type: "string" },
              pricingSource: { type: "string" },
              pricingLow: { type: "number" },
              pricingMid: { type: "number" },
              pricingHigh: { type: "number" },
              confidence: { type: "string" },
              isInquiry: { type: "boolean" },
            },
            required: [
              "clientName",
              "clientEmail",
              "clientPhone",
              "clientCompany",
              "serviceType",
              "eventName",
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
              "pricingTier",
              "pricingSource",
              "pricingLow",
              "pricingMid",
              "pricingHigh",
              "suggestedItems",
              "confidence",
              "isInquiry",
            ],
            additionalProperties: false,
          },
        },
      },
    });
    const content = result.choices?.[0]?.message?.content;
    const parsed = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));

    // 重新計算定價信心區間：以 suggestedItems 總計為基準，確保與建議報僷項目一致
    if (Array.isArray(parsed.suggestedItems) && parsed.suggestedItems.length > 0) {
      const itemsTotal = parsed.suggestedItems.reduce(
        (sum: number, item: any) => sum + (item.quantity ?? 1) * (item.unitPrice ?? 0),
        0
      );
      if (itemsTotal > 0) {
        // mid = exact items total (direct sum of quantity x unitPrice)
        // Apply deviation correction factor (E) if available
        const cf = deviationFactor && deviationFactor.correctionFactor !== 1.0 ? deviationFactor.correctionFactor : 1.0;
        const correctedMid = Math.round(itemsTotal * cf);
        parsed.pricingMid = correctedMid;
        parsed.pricingLow = Math.round(correctedMid * 0.7 / 100) * 100;
        parsed.pricingHigh = Math.round(correctedMid * 1.35 / 100) * 100;
        if (cf !== 1.0 && deviationFactor) {
          const corrNote = `[AI Auto-correction: ${deviationFactor.note}]`;
          parsed.notes = parsed.notes ? `${parsed.notes} ${corrNote}` : corrNote;
        }
      }
    }

    // Normalize extras + draft readiness (understanding quality gate)
    if (!Array.isArray(parsed.assumptions)) parsed.assumptions = [];
    if (!Array.isArray(parsed.missingFields)) parsed.missingFields = [];
    if (!parsed.quantitySource) {
      const assumedFromItems = (parsed.suggestedItems ?? []).some((it: any) =>
        /assumed|假設/i.test(String(it?.description ?? ""))
      );
      parsed.quantitySource = assumedFromItems ? "assumed" : "unknown";
    }
    parsed.draftReadiness = evaluateInquiryDraftReadiness(parsed);

    return parsed;
  } catch (e) {
    console.error("[EmailInquiry] AI parse failed:", e);
    return null;
  }
}

// ─── Extract Freehunter job link from email HTML ─────────────────
function extractFreehunterJobLink(html: string): string | null {
  // Freehunter 工作頁面連結格式：支援多種 URL 格式
  // https://www.freehunter.com.hk/job/XXXXX
  // https://www.freehunter.com.hk/freelancer/jobs/XXXXX
  // https://freehunter.hk/job/XXXXX
  const match = html.match(/https:\/\/(?:www\.)?freehunter\.(?:com\.hk|hk)\/(?:job|task|work|freelancer\/jobs?)\/[\w\-]+/i);
  return match ? match[0] : null;
}

// ─── Match FH job by email subject / title ─────────────────────────────────
// FH 通知郵件 subject 格式：「📬最新的影片製作工作: [長期合作] 週年慶典晚宴 幫助攝影及錄影在(HK) 預算：$5,000-$10,000」
// 提取工作標題部分（冒號後到「在(」之前）
function extractJobTitleFromFHNotification(subject: string): string | null {
  // 格式1：「📬最新的XXX工作: 工作標題在(HK)...」
  const m1 = subject.match(/[：:]\s*(.+?)(?:\s*在\(|\s*at\s*\(|\s*預算|\s*Budget|$)/i);
  if (m1) return m1[1].trim();
  // 格式2：直接是工作標題
  return subject.trim() || null;
}

// 在 FH 工作板中查找匹配的工作記錄
async function findMatchingFHJob(subject: string, fromEmail: string): Promise<{ id: number; status: string; title: string; firstEmailSentAt: Date | null } | null> {
  // 只處理 FH 通知郵件（from: info@freehunter.hk 或 subject 含 📬）
  const isFHNotification = fromEmail.toLowerCase().includes("freehunter.hk") || subject.includes("📬");
  if (!isFHNotification) return null;

  const jobTitle = extractJobTitleFromFHNotification(subject);
  if (!jobTitle || jobTitle.length < 3) return null;

  const db = await getDb();
  if (!db) return null;

  // 用 LIKE 查詢比對工作標題（FH 工作板的 title 欄位）
  const rows = await db
    .select({ id: freehunterJobs.id, status: freehunterJobs.status, title: freehunterJobs.title, firstEmailSentAt: freehunterJobs.firstEmailSentAt })
    .from(freehunterJobs)
    .where(like(freehunterJobs.title, `%${jobTitle.slice(0, 50)}%`))
    .limit(1);

  return rows[0] ?? null;
}

// ─── Fetch recent emails via IMAP ──────────────────────────────────
async function fetchRecentEmailsViaIMAP(maxResults: number): Promise<Array<{
  messageId: string;
  subject: string;
  fromEmail: string;
  fromName: string;
  bodyText: string;
  htmlBody: string;
  receivedAt: Date;
  /** Text extracted from PDF attachments (empty if none / failed). */
  attachmentText: string;
  attachmentMeta: Array<{
    filename: string;
    pages?: number;
    truncated: boolean;
    error?: string;
    chars: number;
  }>;
}>> {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPassword = process.env.GMAIL_APP_PASSWORD;

  if (!gmailUser || !gmailPassword) {
    throw new Error("Gmail credentials not configured (GMAIL_USER / GMAIL_APP_PASSWORD)");
  }

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: {
      user: gmailUser,
      pass: gmailPassword,
    },
    logger: false,
  });

  const emails: Array<{
    messageId: string;
    subject: string;
    fromEmail: string;
    fromName: string;
    bodyText: string;
    htmlBody: string;
    receivedAt: Date;
    attachmentText: string;
    attachmentMeta: Array<{
      filename: string;
      pages?: number;
      truncated: boolean;
      error?: string;
      chars: number;
    }>;
  }> = [];

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      // Search for emails from the last 7 days, not sent by us
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const uidsRaw = await client.search({ since, not: { from: gmailUser } });
      const uids: number[] = Array.isArray(uidsRaw) ? uidsRaw : [];

      // Take the most recent maxResults
      const recentUids = uids.slice(-maxResults);

      for await (const message of client.fetch(recentUids, { source: true, envelope: true })) {
        try {
          const parsed: any = await simpleParser(message.source as any);
          const fromAddr = parsed.from?.value?.[0];
          const fromEmail: string = fromAddr?.address ?? "";
          const fromName: string = fromAddr?.name ?? "";
          const messageId: string = parsed.messageId ?? `uid-${message.uid}`;
          const subject: string = parsed.subject ?? "";
          const htmlBody: string = parsed.html ? String(parsed.html) : "";
          const bodyText: string = parsed.text ?? (htmlBody ? htmlBody.replace(/<[^>]+>/g, " ") : "");
          const receivedAt: Date = parsed.date ?? new Date();

          const pdfExtract = await extractTextFromPdfAttachments(
            (parsed.attachments ?? []).map((a: any) => ({
              filename: a.filename,
              contentType: a.contentType,
              content: Buffer.isBuffer(a.content)
                ? a.content
                : Buffer.from(a.content ?? []),
            }))
          );
          if (pdfExtract.pdfCount > 0) {
            console.log(
              `[EmailInquiry] PDF attachments: ${pdfExtract.pdfCount} on "${subject.slice(0, 40)}" chars=${pdfExtract.combinedText.length}`
            );
          }

          emails.push({
            messageId,
            subject,
            fromEmail,
            fromName,
            bodyText,
            htmlBody,
            receivedAt,
            attachmentText: pdfExtract.combinedText,
            attachmentMeta: pdfExtract.texts.map((t) => ({
              filename: t.filename,
              pages: t.pages,
              truncated: t.truncated,
              error: t.error,
              chars: t.text.length,
            })),
          });
        } catch (e) {
          console.error("[EmailInquiry] Failed to parse message:", e);
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  return emails;
}

// ─── AI Meeting Email Draft Helper ──────────────────────────────────────────

interface MeetingDraftParams {
  clientName: string;
  serviceType?: string;
  shootingDate?: string;
  shootingLocation?: string;
  eventName?: string;
  notes?: string;
  pricingMid?: number | string;
  subject?: string;
}

const SERVICE_TYPE_LABELS: Record<string, string> = {
  corporate_event: "corporate event photography",
  product: "product photography",
  food_beverage: "food & beverage photography",
  jewelry: "jewelry photography",
  artwork: "artwork photography",
  interior: "interior photography",
  video_production: "video production",
  graphic_design: "graphic design",
  ad_video: "advertising video production",
  web_development: "web development",
  ai_photography: "AI photography",
  menu_design: "menu design",
  portrait: "portrait photography",
  "360_photography": "360\u00b0 photography",
  drone: "drone photography",
  kol_mi: "KOL / media influencer shoot",
  other: "photography / videography services",
};

export async function generateAIMeetingDraft(params: MeetingDraftParams): Promise<string> {
  const { clientName, serviceType, shootingDate, shootingLocation, eventName, notes, subject } = params;
  const serviceLabel = (serviceType && SERVICE_TYPE_LABELS[serviceType]) || serviceType || "photography / videography services";
  // pricingMid is intentionally NOT passed to the LLM — never mention prices in client emails.

  const contextLines: string[] = [];
  if (serviceLabel) contextLines.push(`Service type: ${serviceLabel}`);
  if (shootingDate) contextLines.push(`Requested date: ${shootingDate}`);
  if (shootingLocation) contextLines.push(`Location: ${shootingLocation}`);
  if (eventName) contextLines.push(`Event name: ${eventName}`);
  if (notes) contextLines.push(`Client notes: ${notes}`);
  if (subject) contextLines.push(`Email subject: ${subject}`);

  const prompt = `You are writing a professional meeting request email on behalf of JD STUDIO HK, a Hong Kong-based photography and video production company.

Client name: ${clientName}
${contextLines.join("\n")}

Write a warm, professional email (in English) to this client to arrange a brief 15-30 minute meeting or call. The email should:
1. Thank the client for their inquiry
2. Reference the specific service type, date, and/or location naturally (do NOT just list them mechanically)
3. Explain that a quick meeting will help us better understand their vision and provide the most accurate quotation
4. Invite the client to connect via WhatsApp for a quick call — include this exact line naturally in the email body: "Feel free to reach us on WhatsApp for a quick call: wa.me/85291531976"
5. Politely ask for their availability for a call or meeting
6. Keep it concise (3-4 short paragraphs)
7. End with the standard JD STUDIO HK signature:

Best regards,
Derek
JD STUDIO HK
Tel No: (852) 9153 1976
Web: https://jdstudiohk.com/

CRITICAL: Do NOT mention any price, budget, estimate, quote amount, HK$, or dollar figures anywhere in the email. Pricing is discussed only after the meeting.
Do NOT include a subject line. Start directly with "Dear ${clientName},". Output only the email body text, no markdown formatting.`;

  const llmResponse = await invokeLLM({
    messages: [
      { role: "system", content: "You are a professional email writer for a Hong Kong photography studio. Write concise, warm, and personalised emails in English." },
      { role: "user", content: prompt },
    ],
  });

  const draft = extractLLMText(llmResponse?.choices?.[0]?.message?.content);
  if (!draft) throw new Error("LLM returned empty response");
  return draft;
}

export function buildFallbackMeetingDraft(clientName: string): string {
  return `Dear ${clientName},

Thank you for your inquiry. We have reviewed your requirements and would love to discuss your project in more detail.

Given the scope of your project, we would like to arrange a brief meeting or call to better understand your vision and provide you with the most accurate quotation. Feel free to reach us on WhatsApp for a quick call: wa.me/85291531976

Could you please let us know your availability for a 15-30 minute call or meeting? We are flexible and can accommodate your schedule.

Looking forward to hearing from you.

Best regards,
Derek
JD STUDIO HK
Tel No: (852) 9153 1976
Web: https://jdstudiohk.com/`;
}

/**
 * Build a branded HTML email for high-value meeting request.
 * Converts the plain-text draft into a styled HTML email with WhatsApp CTA button.
 * @param textDraft - The plain-text draft (from LLM or fallback)
 * @param inquiryId - Optional inquiry ID for WhatsApp click tracking
 */
export function buildMeetingEmailHtml(textDraft: string, inquiryId?: number): string {
  const waTrackUrl = buildWaTrackUrl("meeting_email", { inq: inquiryId });
  const trackingPixel = inquiryId
    ? `<img src="${appBaseUrl()}/api/track/email?src=meeting_email&inq=${inquiryId}" width="1" height="1" style="display:none" alt="" />`
    : "";

  // Convert plain text to HTML paragraphs, replacing wa.me links with styled anchor
  const htmlBody = textDraft
    .split("\n\n")
    .map((para) => {
      const escaped = para
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>");
      // Replace wa.me/... plain text with clickable link
      const linked = escaped.replace(
        /wa\.me\/(\d+)/g,
        `<a href="${waTrackUrl}" style="color:#25D366;font-weight:bold">wa.me/$1</a>`
      );
      return `<p style="margin:0 0 16px 0">${linked}</p>`;
    })
    .join("");

  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
<div style="background:#1a1a1a;padding:20px 30px"><h2 style="color:#fff;margin:0;font-size:18px;letter-spacing:2px">JD STUDIO HK</h2></div>
<div style="padding:30px;line-height:1.6;color:#222">
${htmlBody}
<div style="margin:24px 0 8px">
  <a href="${waTrackUrl}" style="display:inline-block;background:#25D366;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:bold;font-size:15px">&#128172; Chat on WhatsApp</a>
</div>
<p style="margin:8px 0 0;font-size:12px;color:#888">Tap the button above or message us at <a href="${waTrackUrl}" style="color:#25D366">wa.me/85291531976</a></p>
</div>
<div style="background:#f5f5f5;padding:15px 30px;font-size:12px;color:#888"><p style="margin:0">JD Studio &middot; Hong Kong &nbsp;|&nbsp; info.exposurehk@gmail.com &nbsp;|&nbsp; www.jdstudiohk.com</p></div>
${trackingPixel}
</div>`;
}

// ─── Router ────────────────────────────────────────────────────────
// ─── Shared scan logic (used by both manual tRPC call and scheduler) ──────────
export async function runEmailScan(maxResults = 20): Promise<{ scanned: number; newInquiries: number; skipped: number }> {
  let emails: Awaited<ReturnType<typeof fetchRecentEmailsViaIMAP>> = [];

  try {
    emails = await fetchRecentEmailsViaIMAP(maxResults);
    console.log(`[EmailInquiry] Fetched ${emails.length} emails via IMAP`);
  } catch (e) {
    console.error("[EmailInquiry] IMAP fetch failed:", e);
    throw new Error(`Gmail 掃描失敗: ${(e as Error).message}`);
  }

  if (!emails.length) return { scanned: 0, newInquiries: 0, skipped: 0 };

  let newInquiries = 0;
  let skipped = 0;

  for (const email of emails) {
    const { subject, fromEmail, fromName, bodyText, htmlBody, receivedAt, attachmentText, attachmentMeta } = email;
    const messageId = email.messageId.slice(0, 500);

    const existing = await getEmailInquiryByMessageId(messageId);
    if (existing) { 
      console.log(`[EmailInquiry] Skip(dup): from=${fromEmail} subj="${subject?.slice(0,40)}"`);
      skipped++; continue; 
    }

    // ─── FH 系統通知郵件：直接跳過，自動發送第一封電郵只由 FH 工作板爬取觸發 ─────
    if (isFHSystemNotification(subject)) {
      console.log(`[EmailInquiry] Skip(FH-sys): "${subject?.slice(0,40)}"`);
      skipped++;
      continue;
    }

    // ─── FH 工作板通知郵件：自動比對 FH 工作板記錄，避免重複 ─────
    const matchedFHJob = await findMatchingFHJob(subject, fromEmail);
    if (matchedFHJob) {
      const fhStatus = matchedFHJob.firstEmailSentAt ? "已發第一封郵件" : "已在 FH 工作板";
      console.log(`[EmailInquiry] FH notification matched job #${matchedFHJob.id} "${matchedFHJob.title}" (${fhStatus}), saving as ignored with fhJobId`);
      await createEmailInquiry({
        gmailMessageId: messageId,
        gmailThreadId: messageId,
        fromEmail: fromEmail || "info@freehunter.hk",
        fromName: "FreelanceHunter",
        subject: subject || "(No Subject)",
        bodyText: bodyText.slice(0, 10000),
        receivedAt,
        aiConfidence: "low",
        status: "ignored",
        processedAt: new Date(),
        externalLink: matchedFHJob ? `https://freehunter.hk/freelancejobs/${matchedFHJob.id}` : undefined,
        fhJobId: matchedFHJob.id,
      });
      skipped++;
      continue;
    }

    if (isExcludedSender(fromEmail)) { 
      console.log(`[EmailInquiry] Skip(excluded-sender): from=${fromEmail}`);
      skipped++; continue; 
    }

    // Keyword + body check (also consider PDF text so attachment-only briefs still match)
    const combinedText = `${subject} ${bodyText} ${attachmentText ?? ""}`;
    if (!containsTriggerKeyword(combinedText)) { 
      console.log(`[EmailInquiry] Skip(no-keyword): from=${fromEmail} subj="${subject?.slice(0,40)}"`);
      skipped++; continue; 
    }

    const parseBody = mergeEmailBodyWithPdfText(bodyText, attachmentText ?? "");
    let aiResult = await parseInquiryWithAI(subject, parseBody.slice(0, 16000), fromEmail);
    aiResult = enrichParsedWithAttachmentGate(aiResult, {
      subject,
      bodyText,
      attachmentText,
      attachmentMeta,
    }) as typeof aiResult;

    // 如果是 Freehunter 郵件，從 HTML 中提取「查看工作」連結
    let externalLink: string | null = null;
    if (isFreehunterEmail(fromEmail, htmlBody) && htmlBody) {
      externalLink = extractFreehunterJobLink(htmlBody);
      if (externalLink) {
        console.log(`[EmailInquiry] Freehunter job link extracted: ${externalLink}`);
      }
    }

    // AI 高信心度（high）且是真正詢價：
    // - 非 FH 來源 → 設為 pending_send（待管理員確認後發送報價）——仍需 draftReadiness
    // - FH 來源 → 維持 pending（FH 有獨立的自動發送流程，不應進入此流程）
    const isFHSource = isFreehunterEmail(fromEmail, htmlBody);
    const isHighConfidence = aiResult?.confidence === "high" && aiResult?.isInquiry === true;
    const draftReadiness = aiResult
      ? evaluateInquiryDraftReadiness({
          ...aiResult,
          learningReady: (
            await getLearningAutoDraftGate(aiResult.serviceType ?? "other")
          ).ready,
        })
      : null;
    if (aiResult && draftReadiness) {
      aiResult.draftReadiness = draftReadiness;
    }
    const readyForAutoDraft = !!draftReadiness?.readyForAutoDraft;
    const HIGH_VALUE_THRESHOLD = 8000;
    const estimatedTotal = aiResult?.pricingMid ? Number(aiResult.pricingMid) : 0;
    const crewSignal = detectCrewHighValue(`${subject}\n${bodyText}\n${attachmentText ?? ""}`);
    // High-value: pricingMid >= HK$8,000, OR video team (2+ photographers alone is not enough)
    const isHighValue =
      !isFHSource &&
      (crewSignal.highValue ||
        (isHighConfidence && estimatedTotal >= HIGH_VALUE_THRESHOLD));
    if (isHighValue && crewSignal.highValue) {
      console.log(
        `[EmailInquiry] Crew high-value override for ${fromEmail}: ${crewSignal.reasons.join(", ")}`
      );
    }
    const inquiryStatus =
      isHighConfidence && !isFHSource && !isHighValue && readyForAutoDraft
        ? "pending_send"
        : "pending";
    // Generate meeting email draft for high-value inquiries using LLM
    let meetingEmailDraft: string | undefined;
    if (isHighValue) {
      const clientNameHV = aiResult?.clientName || fromName || "Sir/Madam";
      try {
        meetingEmailDraft = await generateAIMeetingDraft({
          clientName: clientNameHV,
          serviceType: aiResult?.serviceType,
          shootingDate: aiResult?.shootingDate,
          shootingLocation: aiResult?.shootingLocation,
          eventName: aiResult?.eventName,
          notes: aiResult?.notes,
          pricingMid: aiResult?.pricingMid,
          subject,
        });
      } catch (e) {
        console.warn("[EmailInquiry] LLM meeting draft failed, using fallback template:", e);
        meetingEmailDraft = buildFallbackMeetingDraft(clientNameHV);
      }
    }
    const inquiry = await createEmailInquiry({
      gmailMessageId: messageId,
      gmailThreadId: messageId,
      fromEmail: fromEmail || "unknown@unknown.com",
      fromName: fromName || aiResult?.clientName || "",
      subject: subject || "(No Subject)",
      bodyText: bodyText.slice(0, 10000),
      receivedAt,
      aiParsed: aiResult ? JSON.stringify(aiResult) : null,
      aiConfidence: aiResult?.confidence ?? "low",
      status: inquiryStatus,
      processedAt: inquiryStatus === "pending_send" ? new Date() : undefined,
      externalLink: externalLink ?? undefined,
      meetingStatus: isHighValue ? "pending_meeting" : undefined,
      estimatedTotal: estimatedTotal > 0 ? estimatedTotal : undefined,
      meetingEmailDraft,
    });

    // AI 高信心度 + 非 FH 來源 + 高價值：自動發送預約會議電郵，不發報價
    // 使用 Gmail SMTP 直接發送，確保寄件人是 info.exposurehk@gmail.com（非 Resend onboarding 地址）
    // 防止重複發送：若已曾向此 email 發送過任何郵件，跳過
    const alreadySentHV = fromEmail ? await hasAlreadySentToEmail(fromEmail) : false;
    if (isHighValue && inquiry && meetingEmailDraft && !alreadySentHV) {
      try {
        const htmlMeeting = buildMeetingEmailHtml(meetingEmailDraft, inquiry.id);
        const gmailResult = await sendViaGmail({
          to: fromEmail || "unknown@unknown.com",
          subject: `Re: ${subject || "Your Photography Inquiry"}`,
          html: htmlMeeting,
          text: meetingEmailDraft,
        });
        if (gmailResult.success) {
          await updateEmailInquiry(inquiry.id, {
            meetingStatus: "meeting_scheduled",
            processedAt: new Date(),
          });
          console.log(`[EmailInquiry] High-value inquiry ${inquiry.id} (HK$${estimatedTotal}): auto-sent meeting email to ${fromEmail} (msgId: ${gmailResult.messageId})`);
        } else {
          console.error(`[EmailInquiry] High-value inquiry ${inquiry.id}: Gmail send FAILED, status NOT updated. Error: ${gmailResult.error}`);
          // Keep meetingStatus as pending_meeting so admin can retry manually
        }
      } catch (e) {
        console.error("[EmailInquiry] Failed to auto-send meeting email:", e);
      }
    }
    // AI 高信心度 + 非 FH 來源 + 非高價值 + 需求夠清晰：自動建立草稿報價單，等待管理員確認後發送
    if (isHighConfidence && !isFHSource && !isHighValue && readyForAutoDraft && inquiry) {
      try {
        const clientName = aiResult?.clientName || fromName || fromEmail;
        const items = (aiResult?.suggestedItems ?? []).map((item: any, idx: number) => {
          const qty = Number(item.quantity) || 1;
          const price = Number(item.unitPrice) || 0;
          return {
            description: item.description || "Photography Service",
            quantity: qty,
            unitPrice: price,
            amount: qty * price,
            sortOrder: idx,
          };
        });
        if (items.length === 0) {
          items.push({ description: "Photography Service", quantity: 1, unitPrice: 0, amount: 0, sortOrder: 0 });
        }
        // 自動計算 subtotal 和 total（$0 項目視為免費服務，仍計入項目列表但不計入金額）
        const subtotalNum = items.reduce((sum: number, it: { amount: number }) => sum + it.amount, 0);
        const newQuote = await createQuote({
          clientName,
          clientEmail: aiResult?.clientEmail || fromEmail,
          clientPhone: aiResult?.clientPhone || "",
          clientCompany: aiResult?.clientCompany || "",
          serviceType: (aiResult?.serviceType as any) || "other",
          shootingDate: aiResult?.shootingDate || "",
          shootingLocation: aiResult?.shootingLocation || "",
          notes: formatInquiryDraftNotes({
            fromEmail: fromEmail || "",
            subject: subject || "",
            aiNotes: aiResult?.notes,
            readiness: draftReadiness,
            autoDraft: true,
          }),
          subtotal: subtotalNum.toString(),
          discountAmount: "0",
          total: subtotalNum.toString(),
          currency: "HKD",
          status: "draft",
          emailInquiryId: inquiry.id,
          shootHours:
            aiResult?.shootHours != null && Number(aiResult.shootHours) > 0
              ? String(aiResult.shootHours)
              : undefined,
          shotCount:
            aiResult?.shotCount != null && Number(aiResult.shotCount) > 0
              ? Number(aiResult.shotCount)
              : undefined,
          durationPackage:
            aiResult?.durationPackage === "hours" ||
            aiResult?.durationPackage === "half_day" ||
            aiResult?.durationPackage === "full_day" ||
            aiResult?.durationPackage === "multi_day"
              ? aiResult.durationPackage
              : undefined,
          crewPhotographers:
            aiResult?.crewPhotographers != null
              ? Number(aiResult.crewPhotographers) || 0
              : undefined,
          crewVideographers:
            aiResult?.crewVideographers != null
              ? Number(aiResult.crewVideographers) || 0
              : undefined,
          leadSource: resolveQuoteLeadSource({
            fromEmail,
            htmlBody,
            subject,
            fhJobId: inquiry.fhJobId,
          }),
          items,
        });
        await updateEmailInquiry(inquiry.id, { quoteId: newQuote.id });
        console.log(`[EmailInquiry] AI pending_send inquiry ${inquiry.id}, created draft quote ${newQuote.id} (awaiting admin confirmation)`);
      } catch (e) {
        console.error("[EmailInquiry] Failed to create draft quote for pending_send inquiry:", e);
      }
    } else if (isHighConfidence && !isFHSource && !isHighValue && !readyForAutoDraft) {
      console.log(
        `[EmailInquiry] High-confidence inquiry kept pending (not auto-draft): ${draftReadiness?.summary ?? "readiness unknown"}`
      );
    }

    newInquiries++;
  }

  return { scanned: emails.length, newInquiries, skipped };
}

export const emailInquiriesRouter = router({
  // Manually trigger a Gmail scan
  scanGmail: protectedProcedure
    .input(z.object({ maxResults: z.number().min(1).max(50).default(20) }))
    .mutation(async ({ input }) => {
      let emails: Awaited<ReturnType<typeof fetchRecentEmailsViaIMAP>> = [];

      try {
        emails = await fetchRecentEmailsViaIMAP(input.maxResults);
        console.log(`[EmailInquiry] Fetched ${emails.length} emails via IMAP`);
      } catch (e) {
        console.error("[EmailInquiry] IMAP fetch failed:", e);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Gmail 掃描失敗: ${(e as Error).message}` });
      }

      if (!emails.length) return { scanned: 0, newInquiries: 0, skipped: 0 };

      let newInquiries = 0;
      let skipped = 0;

      for (const email of emails) {
        const { subject, fromEmail, fromName, bodyText, htmlBody, receivedAt, attachmentText, attachmentMeta } = email;
        // Truncate messageId to 500 chars to fit DB column
        const messageId = email.messageId.slice(0, 500);

        // Skip if already processed
        const existing = await getEmailInquiryByMessageId(messageId);
        if (existing) { skipped++; continue; }

        // ─── FH 系統通知郵件：直接跳過 ─────
        if (isFHSystemNotification(subject)) {
          console.log(`[EmailInquiry] scanGmail: Skipping FH system notification: "${subject}"`);
          skipped++;
          continue;
        }

        // ─── FH 工作板通知郵件：自動比對 FH 工作板記錄，避免重複 ─────
        const matchedFHJobScan = await findMatchingFHJob(subject, fromEmail);
        if (matchedFHJobScan) {
          const fhStatusScan = matchedFHJobScan.firstEmailSentAt ? "已發第一封郵件" : "已在 FH 工作板";
          console.log(`[EmailInquiry] scanGmail: FH notification matched job #${matchedFHJobScan.id} "${matchedFHJobScan.title}" (${fhStatusScan}), saving as ignored with fhJobId`);
          await createEmailInquiry({
            gmailMessageId: messageId,
            gmailThreadId: messageId,
            fromEmail: fromEmail || "info@freehunter.hk",
            fromName: "FreelanceHunter",
            subject: subject || "(No Subject)",
            bodyText: bodyText.slice(0, 10000),
            receivedAt,
            aiConfidence: "low",
            status: "ignored",
            processedAt: new Date(),
            externalLink: `https://freehunter.hk/freelancejobs/${matchedFHJobScan.id}`,
            fhJobId: matchedFHJobScan.id,
          });
          skipped++;
          continue;
        }

        // Check excluded senders
        if (isExcludedSender(fromEmail)) { skipped++; continue; }

        // Check trigger keywords (include PDF text)
        const combinedText = `${subject} ${bodyText} ${attachmentText ?? ""}`;
        if (!containsTriggerKeyword(combinedText)) { skipped++; continue; }

        // AI parse (body + PDF attachment text)
        const parseBody = mergeEmailBodyWithPdfText(bodyText, attachmentText ?? "");
        let aiResult = await parseInquiryWithAI(subject, parseBody.slice(0, 16000), fromEmail);
        aiResult = enrichParsedWithAttachmentGate(aiResult, {
          subject,
          bodyText,
          attachmentText,
          attachmentMeta,
        }) as typeof aiResult;

        // 如果是 Freehunter 郵件，從 HTML 中提取「查看工作」連結
        let externalLink: string | null = null;
        if (isFreehunterEmail(fromEmail, htmlBody) && htmlBody) {
          externalLink = extractFreehunterJobLink(htmlBody);
          if (externalLink) {
            console.log(`[EmailInquiry] Freehunter job link extracted: ${externalLink}`);
          }
        }
        // AI 高信心度（high）且是真正詢價：
        // - 非 FH 來源 → 設為 pending_send（待管理員確認後發送報價）——仍需 draftReadiness
        // - FH 來源 → 維持 pending（FH 有獨立的自動發送流程）
        const isFHSrc = isFreehunterEmail(fromEmail, htmlBody);
        const isHighConf = aiResult?.confidence === "high" && aiResult?.isInquiry === true;
        const draftReadinessScan = aiResult
          ? evaluateInquiryDraftReadiness({
              ...aiResult,
              learningReady: (
                await getLearningAutoDraftGate(aiResult.serviceType ?? "other")
              ).ready,
            })
          : null;
        if (aiResult && draftReadinessScan) {
          aiResult.draftReadiness = draftReadinessScan;
        }
        const readyForAutoDraftScan = !!draftReadinessScan?.readyForAutoDraft;
        const HIGH_VALUE_THRESHOLD_SCAN = 8000;
        const estimatedTotalScan = aiResult?.pricingMid ? Number(aiResult.pricingMid) : 0;
        const crewSignalScan = detectCrewHighValue(`${subject}\n${bodyText}\n${attachmentText ?? ""}`);
        // High-value: pricingMid >= HK$8,000, OR video team (2+ photographers alone is not enough)
        const isHighValueScan =
          !isFHSrc &&
          (crewSignalScan.highValue ||
            (isHighConf && estimatedTotalScan >= HIGH_VALUE_THRESHOLD_SCAN));
        if (isHighValueScan && crewSignalScan.highValue) {
          console.log(
            `[EmailInquiry] scanGmail crew high-value override for ${fromEmail}: ${crewSignalScan.reasons.join(", ")}`
          );
        }
        const inqStatus =
          isHighConf && !isFHSrc && !isHighValueScan && readyForAutoDraftScan
            ? "pending_send"
            : "pending";
        let meetingEmailDraftScan: string | undefined;
        if (isHighValueScan) {
          const clientNameScan = aiResult?.clientName || fromName || "Sir/Madam";
          try {
            meetingEmailDraftScan = await generateAIMeetingDraft({
              clientName: clientNameScan,
              serviceType: aiResult?.serviceType,
              shootingDate: aiResult?.shootingDate,
              shootingLocation: aiResult?.shootingLocation,
              eventName: aiResult?.eventName,
              notes: aiResult?.notes,
              pricingMid: aiResult?.pricingMid,
              subject,
            });
          } catch (e) {
            console.warn("[EmailInquiry] scanGmail: LLM meeting draft failed, using fallback:", e);
            meetingEmailDraftScan = buildFallbackMeetingDraft(clientNameScan);
          }
        }
        // Save inquiry
        const savedInquiry = await createEmailInquiry({
          gmailMessageId: messageId,
          gmailThreadId: messageId,
          fromEmail: fromEmail || "unknown@unknown.com",
          fromName: fromName || aiResult?.clientName || "",
          subject: subject || "(No Subject)",
          bodyText: bodyText.slice(0, 10000),
          receivedAt,
          aiParsed: aiResult ? JSON.stringify(aiResult) : null,
          aiConfidence: aiResult?.confidence ?? "low",
          status: inqStatus,
          processedAt: inqStatus === "pending_send" ? new Date() : undefined,
          externalLink: externalLink ?? undefined,
          meetingStatus: isHighValueScan ? "pending_meeting" : undefined,
          estimatedTotal: estimatedTotalScan > 0 ? estimatedTotalScan : undefined,
          meetingEmailDraft: meetingEmailDraftScan,
        });
        // AI 高信心度 + 非 FH 來源 + 高價值：自動發送預約會議電郵，不發報價
        // 使用 Gmail SMTP 直接發送，確保寄件人是 info.exposurehk@gmail.com（非 Resend onboarding 地址）
        // 防止重複發送：若已曾向此 email 發送過任何郵件（包括之前的 meeting email），跳過
        const alreadySentScan = fromEmail ? await hasAlreadySentToEmail(fromEmail) : false;
        if (isHighValueScan && savedInquiry && meetingEmailDraftScan && !alreadySentScan) {
          try {
            const htmlMeetingScan = buildMeetingEmailHtml(meetingEmailDraftScan, savedInquiry.id);
            const gmailResultScan = await sendViaGmail({
              to: fromEmail || "unknown@unknown.com",
              subject: `Re: ${subject || "Your Photography Inquiry"}`,
              html: htmlMeetingScan,
              text: meetingEmailDraftScan,
            });
            if (gmailResultScan.success) {
              await updateEmailInquiry(savedInquiry.id, {
                meetingStatus: "meeting_scheduled",
                processedAt: new Date(),
              });
              console.log(`[EmailInquiry] scanGmail: High-value inquiry ${savedInquiry.id} (HK$${estimatedTotalScan}): auto-sent meeting email to ${fromEmail} (msgId: ${gmailResultScan.messageId})`);
            } else {
              console.error(`[EmailInquiry] scanGmail: High-value inquiry ${savedInquiry.id}: Gmail send FAILED, status NOT updated. Error: ${gmailResultScan.error}`);
              // Keep meetingStatus as pending_meeting so admin can retry manually
            }
          } catch (e) {
            console.error("[EmailInquiry] scanGmail: Failed to auto-send meeting email:", e);
          }
        }
        // AI 高信心度 + 非 FH + 非高價值 + 需求夠清晰：自動建立草稿報價單
        if (isHighConf && !isFHSrc && !isHighValueScan && readyForAutoDraftScan && savedInquiry) {
          try {
            const clientName = aiResult?.clientName || fromName || fromEmail;
            const items = (aiResult?.suggestedItems ?? []).map((item: any, idx: number) => ({
              description: item.description || "Photography Service",
              quantity: Number(item.quantity) || 1,
              unitPrice: Number(item.unitPrice) || 0,
              amount: (Number(item.quantity) || 1) * (Number(item.unitPrice) || 0),
              sortOrder: idx,
            }));
            if (items.length === 0) {
              items.push({ description: "Photography Service", quantity: 1, unitPrice: 0, amount: 0, sortOrder: 0 });
            }
            const subtotalNum = items.reduce(
              (sum: number, it: { amount: number }) => sum + it.amount,
              0
            );
            const newQuote = await createQuote({
              clientName,
              clientEmail: aiResult?.clientEmail || fromEmail,
              clientPhone: aiResult?.clientPhone || "",
              clientCompany: aiResult?.clientCompany || "",
              serviceType: (aiResult?.serviceType as any) || "other",
              shootingDate: aiResult?.shootingDate || "",
              shootingLocation: aiResult?.shootingLocation || "",
              notes: formatInquiryDraftNotes({
                fromEmail: fromEmail || "",
                subject: subject || "",
                aiNotes: aiResult?.notes,
                readiness: draftReadinessScan,
                autoDraft: true,
              }),
              subtotal: subtotalNum.toString(),
              discountAmount: "0",
              total: subtotalNum.toString(),
              currency: "HKD",
              status: "draft",
              emailInquiryId: savedInquiry.id,
              shootHours:
                aiResult?.shootHours != null && Number(aiResult.shootHours) > 0
                  ? String(aiResult.shootHours)
                  : undefined,
              shotCount:
                aiResult?.shotCount != null && Number(aiResult.shotCount) > 0
                  ? Number(aiResult.shotCount)
                  : undefined,
              durationPackage:
                aiResult?.durationPackage === "hours" ||
                aiResult?.durationPackage === "half_day" ||
                aiResult?.durationPackage === "full_day" ||
                aiResult?.durationPackage === "multi_day"
                  ? aiResult.durationPackage
                  : undefined,
              crewPhotographers:
                aiResult?.crewPhotographers != null
                  ? Number(aiResult.crewPhotographers) || 0
                  : undefined,
              crewVideographers:
                aiResult?.crewVideographers != null
                  ? Number(aiResult.crewVideographers) || 0
                  : undefined,
              leadSource: resolveQuoteLeadSource({
                fromEmail,
                htmlBody,
                subject,
                fhJobId: savedInquiry.fhJobId,
              }),
              items,
            });
            await updateEmailInquiry(savedInquiry.id, { quoteId: newQuote.id });
            console.log(`[EmailInquiry] scanGmail: AI pending_send inquiry ${savedInquiry.id}, created draft quote ${newQuote.id} (awaiting admin confirmation)`);
          } catch (e) {
            console.error("[EmailInquiry] scanGmail: Failed to create draft quote for pending_send inquiry:", e);
          }
        } else if (isHighConf && !isFHSrc && !isHighValueScan && !readyForAutoDraftScan) {
          console.log(
            `[EmailInquiry] scanGmail: kept pending (not auto-draft): ${draftReadinessScan?.summary ?? "readiness unknown"}`
          );
        }
        newInquiries++;
      }

      return { scanned: emails.length, newInquiries, skipped };
    }),

  // List inquiries
  list: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      limit: z.number().min(1).max(50).default(15),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      return getEmailInquiries(input);
    }),

  // Approve inquiry (send the linked draft quote)
  approve: protectedProcedure
    .input(z.object({
      id: z.number(),
      clientEmail: z.string().optional(),
      clientPhone: z.string().optional(),
      clientName: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      // Update status and get the full row back
      const existing = await updateEmailInquiry(input.id, { status: "approved", processedAt: new Date() });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Inquiry not found" });

      let quoteId = existing.quoteId;

      // If no draft quote linked yet, create one now
      if (!quoteId) {
        try {
          const aiParsed = existing.aiParsed ? JSON.parse(existing.aiParsed) : null;
          const clientName = aiParsed?.clientName || existing.fromName || existing.fromEmail;
          const items = (aiParsed?.suggestedItems ?? []).map((item: any, idx: number) => ({
            description: item.description || "Photography Service",
            quantity: Number(item.quantity) || 1,
            unitPrice: Number(item.unitPrice) || 0,
            amount: (Number(item.quantity) || 1) * (Number(item.unitPrice) || 0),
            sortOrder: idx,
          }));
          if (items.length === 0) {
            items.push({ description: "Photography Service", quantity: 1, unitPrice: 0, amount: 0, sortOrder: 0 });
          }
          const readiness =
            aiParsed?.draftReadiness ??
            (aiParsed ? evaluateInquiryDraftReadiness(aiParsed) : null);
          const subtotalNum = items.reduce(
            (sum: number, it: { amount: number }) => sum + it.amount,
            0
          );
          const newQuote = await createQuote({
            clientName: input.clientName || clientName,
            clientEmail: input.clientEmail || aiParsed?.clientEmail || existing.fromEmail,
            clientPhone: input.clientPhone || aiParsed?.clientPhone || "",
            clientCompany: aiParsed?.clientCompany || "",
            serviceType: (aiParsed?.serviceType as any) || "other",
            shootingDate: aiParsed?.shootingDate || "",
            shootingLocation: aiParsed?.shootingLocation || "",
            notes: formatInquiryDraftNotes({
              fromEmail: existing.fromEmail,
              subject: existing.subject || "",
              aiNotes: aiParsed?.notes,
              readiness,
              autoDraft: false,
            }),
            subtotal: subtotalNum.toString(),
            discountAmount: "0",
            total: subtotalNum.toString(),
            currency: "HKD",
            status: "draft",
            emailInquiryId: input.id,
            shootHours:
              aiParsed?.shootHours != null && Number(aiParsed.shootHours) > 0
                ? String(aiParsed.shootHours)
                : undefined,
            shotCount:
              aiParsed?.shotCount != null && Number(aiParsed.shotCount) > 0
                ? Number(aiParsed.shotCount)
                : undefined,
            durationPackage:
              aiParsed?.durationPackage === "hours" ||
              aiParsed?.durationPackage === "half_day" ||
              aiParsed?.durationPackage === "full_day" ||
              aiParsed?.durationPackage === "multi_day"
                ? aiParsed.durationPackage
                : undefined,
            crewPhotographers:
              aiParsed?.crewPhotographers != null
                ? Number(aiParsed.crewPhotographers) || 0
                : undefined,
            crewVideographers:
              aiParsed?.crewVideographers != null
                ? Number(aiParsed.crewVideographers) || 0
                : undefined,
            leadSource: resolveQuoteLeadSource({
              fromEmail: existing.fromEmail,
              bodyText: existing.bodyText,
              subject: existing.subject,
              fhJobId: existing.fhJobId,
            }),
            items,
          });
          quoteId = newQuote.id;
          await updateEmailInquiry(input.id, { quoteId });
        } catch (e) {
          console.error("[EmailInquiry] Failed to create draft quote on approve:", e);
        }
      }

      return { ...existing, quoteId };
    }),

  // Confirm and send quote email for pending_send inquiries
  // This is called when admin confirms the AI-auto-created draft quote should be sent
  confirmSendQuote: protectedProcedure
    .input(z.object({
      id: z.number(),
      emailSubject: z.string().optional(),
      emailBody: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      // Get inquiry
      const inquiryRows = await getEmailInquiryById(input.id);
      if (!inquiryRows) throw new TRPCError({ code: "NOT_FOUND", message: "Inquiry not found" });
      if (inquiryRows.status !== "pending_send") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "此詢價不在待確認發送狀態" });
      }
      if (!inquiryRows.quoteId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "尚未建立草稿報價單，請先建立報價單" });
      }

      // Get quote details
      const quote = await getQuoteById(inquiryRows.quoteId);
      if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "報價單不存在" });

      const toEmail = quote.clientEmail || inquiryRows.fromEmail;
      if (!toEmail) throw new TRPCError({ code: "BAD_REQUEST", message: "找不到收件人電郵地址" });

      // Build email content
      const emailSubject = input.emailSubject || `JD Studio HK Quotation - ${quote.quoteNumber}`;
      const emailBody = input.emailBody || `Dear ${quote.clientName || "Sir/Madam"},

Thank you for your inquiry. Please find attached our quotation for your reference.

Should you have any questions, please feel free to contact us.

Best regards,
Derek
JD STUDIO HK
Tel No: (852) 9153 1976
Web: https://jdstudiohk.com/`;

      // Send email
      const gmailUser = process.env.GMAIL_USER;
      const gmailPassword = process.env.GMAIL_APP_PASSWORD;
      if (!gmailUser || !gmailPassword) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "郵件設定未完成，請聯絡管理員" });
      }

      const htmlBody = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
<div style="background:#1a1a1a;padding:20px 30px"><h2 style="color:#fff;margin:0;font-size:18px;letter-spacing:2px">JD STUDIO HK</h2></div>
<div style="padding:30px"><pre style="font-family:Arial,sans-serif;white-space:pre-wrap">${emailBody}</pre></div>
<div style="background:#f5f5f5;padding:15px 30px;font-size:12px;color:#888"><p style="margin:0">JD Studio &middot; Hong Kong &nbsp;|&nbsp; info.exposurehk@gmail.com &nbsp;|&nbsp; www.jdstudiohk.com</p></div>
</div>`;

      const sendResult = await sendEmail({
        to: toEmail,
        subject: emailSubject,
        html: htmlBody,
        text: emailBody,
        tags: [{ name: "type", value: "inquiry_quote" }, { name: "inquiryId", value: String(input.id) }],
      });

      if (!sendResult.success) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `郵件發送失敗：${sendResult.error}` });
      }

      // Update inquiry status to approved (sent)
      await updateEmailInquiry(input.id, {
        status: "approved",
        autoRepliedAt: new Date(),
        processedAt: new Date(),
      });

      // Update quote status to sent if still draft
      if (quote.status === "draft") {
        await updateQuote(inquiryRows.quoteId!, { status: "sent" });
      }

      console.log(`[EmailInquiry] confirmSendQuote: Sent quote email via Resend to ${toEmail} for inquiry ${input.id} (id: ${sendResult.messageId})`);
      return { success: true, sentTo: toEmail };
    }),

  // Reject / ignore inquiry
  reject: protectedProcedure
    .input(z.object({ id: z.number(), reason: z.string().optional() }))
    .mutation(async ({ input }) => {
      const updated = await updateEmailInquiry(input.id, {
        status: "rejected",
        rejectedReason: input.reason ?? "",
        processedAt: new Date(),
      });
      return updated;
    }),

  ignore: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      return updateEmailInquiry(input.id, { status: "ignored", processedAt: new Date() });
    }),

  // Update meeting status for high-value inquiries (HK$5,000+)
  updateMeetingStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      meetingStatus: z.enum(["none", "pending_meeting", "meeting_scheduled", "meeting_done"]),
      meetingScheduledAt: z.date().optional(),
      meetingNotes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      return updateEmailInquiry(input.id, {
        meetingStatus: input.meetingStatus,
        meetingScheduledAt: input.meetingScheduledAt,
        meetingNotes: input.meetingNotes,
      });
    }),

  // Send meeting request email for high-value inquiries
  sendMeetingEmail: protectedProcedure
    .input(z.object({
      id: z.number(),
      emailBody: z.string(),
    }))
    .mutation(async ({ input }) => {
      const { getEmailInquiryById } = await import("../db");
      const inquiry = await getEmailInquiryById(input.id);
      if (!inquiry) throw new TRPCError({ code: "NOT_FOUND", message: "Inquiry not found" });
      // Use Gmail SMTP directly (sendViaGmail) to ensure reliable delivery
      // Build branded HTML email with WhatsApp CTA button
      const htmlBody = buildMeetingEmailHtml(input.emailBody, input.id);
      const result = await sendViaGmail({
        to: inquiry.fromEmail,
        subject: `Re: ${inquiry.subject || "Your Photography Inquiry"}`,
        html: htmlBody,
        text: input.emailBody,
      });
      if (!result.success) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `郵件發送失敗：${result.error ?? "Gmail SMTP error"}`,
        });
      }
      await updateEmailInquiry(input.id, {
        meetingStatus: "meeting_scheduled",
        processedAt: new Date(),
      });
      console.log(`[EmailInquiry] sendMeetingEmail: Sent to ${inquiry.fromEmail} (msgId: ${result.messageId})`);
      return { success: true, messageId: result.messageId };
    }),

  // Generate a personalised meeting email draft using LLM
  generateMeetingEmailDraft: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const inquiry = await getEmailInquiryById(input.id);
      if (!inquiry) throw new TRPCError({ code: "NOT_FOUND", message: "Inquiry not found" });

      let aiParsed: any = null;
      try { aiParsed = inquiry.aiParsed ? JSON.parse(inquiry.aiParsed as string) : null; } catch {}

      const clientName = aiParsed?.clientName || inquiry.fromName || "Sir/Madam";
      const serviceType = aiParsed?.serviceType || "";
      const shootingDate = aiParsed?.shootingDate || "";
      const shootingLocation = aiParsed?.shootingLocation || "";
      const eventName = aiParsed?.eventName || "";
      const notes = aiParsed?.notes || "";
      const subject = inquiry.subject || "";

      const serviceTypeLabels: Record<string, string> = {
        corporate_event: "corporate event photography",
        product: "product photography",
        food_beverage: "food & beverage photography",
        jewelry: "jewelry photography",
        artwork: "artwork photography",
        interior: "interior photography",
        video_production: "video production",
        graphic_design: "graphic design",
        ad_video: "advertising video production",
        web_development: "web development",
        ai_photography: "AI photography",
        menu_design: "menu design",
        portrait: "portrait photography",
        "360_photography": "360° photography",
        drone: "drone photography",
        kol_mi: "KOL / media influencer shoot",
        other: "photography / videography services",
      };
      const serviceLabel = serviceTypeLabels[serviceType] || serviceType || "photography / videography services";

      const contextLines: string[] = [];
      if (serviceLabel) contextLines.push(`Service type: ${serviceLabel}`);
      if (shootingDate) contextLines.push(`Requested date: ${shootingDate}`);
      if (shootingLocation) contextLines.push(`Location: ${shootingLocation}`);
      if (eventName) contextLines.push(`Event name: ${eventName}`);
      if (notes) contextLines.push(`Client notes: ${notes}`);
      if (subject) contextLines.push(`Email subject: ${subject}`);

      const prompt = `You are writing a professional meeting request email on behalf of JD STUDIO HK, a Hong Kong-based photography and video production company.

Client name: ${clientName}
${contextLines.join("\n")}

Write a warm, professional email (in English) to this client to arrange a brief 15-30 minute meeting or call. The email should:
1. Thank the client for their inquiry
2. Reference the specific service type, date, and/or location naturally (do NOT just list them mechanically)
3. Explain that a quick meeting will help us better understand their vision and provide the most accurate quotation
4. Politely ask for their availability
5. Keep it concise (3-4 short paragraphs)
6. End with the standard JD STUDIO HK signature:

Best regards,
Derek
JD STUDIO HK
Tel No: (852) 9153 1976
Web: https://jdstudiohk.com/

CRITICAL: Do NOT mention any price, budget, estimate, quote amount, HK$, or dollar figures anywhere in the email. Pricing is discussed only after the meeting.
Do NOT include a subject line. Start directly with "Dear ${clientName},". Output only the email body text, no markdown formatting.`;

      const llmResponse = await invokeLLM({
        messages: [
          { role: "system", content: "You are a professional email writer for a Hong Kong photography studio. Write concise, warm, and personalised emails in English." },
          { role: "user", content: prompt },
        ],
      });

      const draft = extractLLMText(llmResponse?.choices?.[0]?.message?.content);
      if (!draft) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM returned empty response" });

      // Save the AI-generated draft back to the inquiry record
      await updateEmailInquiry(input.id, { meetingEmailDraft: draft });

      return { draft };
    }),

  // Get scheduler scan status for frontend display
  searchForLinking: protectedProcedure
    .input(z.object({
      query: z.string().default(""),
      limit: z.number().min(1).max(20).default(10),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const { query, limit } = input;
      const rows = await db
        .select({
          id: emailInquiries.id,
          subject: emailInquiries.subject,
          fromName: emailInquiries.fromName,
          fromEmail: emailInquiries.fromEmail,
          receivedAt: emailInquiries.receivedAt,
          estimatedTotal: emailInquiries.estimatedTotal,
          aiParsed: emailInquiries.aiParsed,
        })
        .from(emailInquiries)
        .where(
          query
            ? or(
                like(emailInquiries.subject, `%${query}%`),
                like(emailInquiries.fromName, `%${query}%`),
                like(emailInquiries.fromEmail, `%${query}%`)
              )
            : undefined
        )
        .orderBy(desc(emailInquiries.receivedAt))
        .limit(limit);
      return rows.map((r) => ({
        id: r.id,
        subject: r.subject || "(無主題)",
        fromName: r.fromName || "",
        fromEmail: r.fromEmail || "",
        receivedAt: r.receivedAt,
        estimatedTotal: r.estimatedTotal ? Number(r.estimatedTotal) : null,
        serviceType: (() => {
          try {
            const parsed = typeof r.aiParsed === "string" ? JSON.parse(r.aiParsed) : r.aiParsed;
            return parsed?.serviceType || null;
          } catch { return null; }
        })(),
      }));
    }),

  scanStatus: protectedProcedure
    .query(async () => {
      const { lastGmailScanAt, lastGmailScanResult } = await import("../scheduler");
      const GMAIL_SCAN_INTERVAL_MS = 30 * 60 * 1000;
      const nextScanAt = lastGmailScanAt
        ? new Date(lastGmailScanAt.getTime() + GMAIL_SCAN_INTERVAL_MS)
        : null;
      // Check if within active hours (07:00-21:00 HKT)
      const nowHKT = new Date(Date.now() + 8 * 60 * 60 * 1000);
      const hour = nowHKT.getUTCHours();
      const withinActiveHours = hour >= 7 && hour < 21;
      return {
        lastScanAt: lastGmailScanAt,
        nextScanAt,
        withinActiveHours,
        lastResult: lastGmailScanResult,
      };
    }),

  // ─── Test AI Pricing Parse (for debugging/testing) ─────────────────────────
  testParseInquiry: protectedProcedure
    .input(z.object({
      subject: z.string(),
      body: z.string(),
      fromEmail: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const result = await parseInquiryWithAI(input.subject, input.body, input.fromEmail);
      return result;
    }),
});
