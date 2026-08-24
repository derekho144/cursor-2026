/**
 * Audit / repair quotes.leadSource across all statuses.
 *
 * Cross-checks:
 *  1. Linked email_inquiries (+ fhJobId / Freehunter body signals)
 *  2. Name / email / company match to FH inquiries & freehunter_jobs
 *  3. WhatsApp tracked clicks (fh_* → FreelanceHunter)
 *  4. Walk-in (no email trail, not Referral/Repeat) → Google (Ads → site → WA)
 *
 *   npx tsx scripts/audit-quote-lead-sources.ts --dry-run
 *   npx tsx scripts/audit-quote-lead-sources.ts --apply
 */
import { eq, isNotNull, or } from "drizzle-orm";
import { resolveQuoteLeadSource } from "./_core/leadSource";
import { getDb } from "./db";
import { clients, emailInquiries, freehunterJobs, quotes, whatsappClickEvents } from "../drizzle/schema";

export type LeadSourceAuditRow = {
  quoteId: number;
  quoteNumber: string;
  status: string;
  clientName: string;
  clientEmail: string | null;
  current: string;
  suggested: string;
  confidence: "high" | "medium";
  reason: string;
  linkInquiryId?: number;
};

export type LeadSourceAuditResult = {
  scanned: number;
  wouldChange: number;
  applied: number;
  bySuggested: Record<string, number>;
  protectedSkipped: number;
  rows: LeadSourceAuditRow[];
};

const PROTECTED = new Set(["Referral", "Repeat"]);

function normName(s: string | null | undefined): string {
  return (s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    // Avoid Unicode property escapes for older TS targets.
    // Keeps: latin letters/numbers, common CJK ranges, whitespace, and basic email punctuation.
    .replace(/[^0-9a-zA-Z\s\u4E00-\u9FFF\u3400-\u4DBF\u3000-\u303F\u3040-\u30FF\uAC00-\uD7AF@.+-]/g, "")
    .trim();
}

function normEmail(s: string | null | undefined): string {
  return (s || "").toLowerCase().trim();
}

function namesLooselyMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))) return true;
  const ta = a.split(" ").filter((t) => t.length > 1);
  const tb = b.split(" ").filter((t) => t.length > 1);
  if (ta.length && tb.length) {
    const overlap = ta.filter((t) => tb.some((u) => u.includes(t) || t.includes(u)));
    if (overlap.length >= Math.min(2, ta.length, tb.length)) return true;
  }
  return false;
}

function isFhInquiry(inq: {
  fhJobId?: number | null;
  fromEmail?: string | null;
  subject?: string | null;
  bodyText?: string | null;
  externalLink?: string | null;
}): boolean {
  if (inq.fhJobId != null) return true;
  const blob = `${inq.fromEmail || ""} ${inq.subject || ""} ${inq.bodyText || ""} ${inq.externalLink || ""}`.toLowerCase();
  return blob.includes("freehunter");
}

export async function auditQuoteLeadSources(opts?: {
  apply?: boolean;
  /** Also overwrite Referral/Repeat when FH evidence is high */
  overrideProtected?: boolean;
}): Promise<LeadSourceAuditResult> {
  const apply = opts?.apply === true;
  const overrideProtected = opts?.overrideProtected === true;
  const db = await getDb();
  if (!db) {
    return {
      scanned: 0,
      wouldChange: 0,
      applied: 0,
      bySuggested: {},
      protectedSkipped: 0,
      rows: [],
    };
  }

  const allQuotes = await db.select().from(quotes);
  const allInquiries = await db.select().from(emailInquiries);
  const fhJobs = await db
    .select({
      id: freehunterJobs.id,
      clientName: freehunterJobs.clientName,
      clientEmail: freehunterJobs.clientEmail,
      title: freehunterJobs.title,
    })
    .from(freehunterJobs);
  const allClients = await db.select().from(clients);
  const waClicks = await db
    .select()
    .from(whatsappClickEvents)
    .where(
      or(
        eq(whatsappClickEvents.source, "fh_first_email"),
        eq(whatsappClickEvents.source, "fh_follow_up"),
        isNotNull(whatsappClickEvents.fhJobId),
        isNotNull(whatsappClickEvents.inquiryId)
      )
    );

  const clientById = new Map(allClients.map((c) => [c.id, c]));
  const inqById = new Map(allInquiries.map((i) => [i.id, i]));
  const inqByQuoteId = new Map<number, (typeof allInquiries)[0]>();
  for (const i of allInquiries) {
    if (i.quoteId != null) inqByQuoteId.set(i.quoteId, i);
  }

  const fhInquiries = allInquiries.filter(isFhInquiry);

  const rows: LeadSourceAuditRow[] = [];
  let protectedSkipped = 0;
  let applied = 0;

  for (const q of allQuotes) {
    const current = (q.leadSource || "").trim() || "(empty)";
    let suggested = current === "(empty)" ? "" : current;
    let reason = "";
    let confidence: "high" | "medium" = "high";
    let linkInquiryId: number | undefined;

    const client = q.clientId != null ? clientById.get(q.clientId) : undefined;
    const qName = normName(q.clientName);
    const qEmail = normEmail(q.clientEmail || client?.email);
    const qCompany = normName(q.clientCompany || client?.company);

    // ── 1) Linked inquiry ─────────────────────────────────────────────
    let inquiry =
      q.emailInquiryId != null ? inqById.get(q.emailInquiryId) : undefined;
    if (!inquiry) inquiry = inqByQuoteId.get(q.id);

    if (inquiry) {
      linkInquiryId = inquiry.id;
      suggested = resolveQuoteLeadSource({
        fromEmail: inquiry.fromEmail,
        bodyText: inquiry.bodyText,
        subject: inquiry.subject,
        fhJobId: inquiry.fhJobId,
      });
      if (isFhInquiry(inquiry)) suggested = "FreelanceHunter";
      reason = `linked inquiry #${inquiry.id}` + (inquiry.fhJobId ? ` (fhJob ${inquiry.fhJobId})` : "");
      confidence = "high";
    }

    // ── 2) Name / email match to FH inquiry ────────────────────────────
    if (!inquiry || suggested === "Other") {
      const matchInq = fhInquiries.find((i) => {
        const iEmail = normEmail(i.fromEmail);
        const iName = normName(i.fromName);
        if (qEmail && iEmail && qEmail === iEmail) return true;
        if (namesLooselyMatch(qName, iName)) return true;
        if (qCompany && namesLooselyMatch(qCompany, iName)) return true;
        // AI parsed name in body
        try {
          const parsed = i.aiParsed ? JSON.parse(i.aiParsed) : null;
          const pn = normName(parsed?.clientName);
          const pe = normEmail(parsed?.clientEmail);
          if (pe && qEmail && pe === qEmail) return true;
          if (pn && namesLooselyMatch(qName, pn)) return true;
        } catch {
          /* ignore */
        }
        return false;
      });
      if (matchInq) {
        suggested = "FreelanceHunter";
        reason = `name/email match FH inquiry #${matchInq.id} (${matchInq.fromName || matchInq.fromEmail})`;
        confidence = qEmail && normEmail(matchInq.fromEmail) === qEmail ? "high" : "medium";
        linkInquiryId = matchInq.id;
      }
    }

    // ── 3) Match freehunter_jobs client ────────────────────────────────
    if (suggested !== "FreelanceHunter") {
      const job = fhJobs.find((j) => {
        const je = normEmail(j.clientEmail);
        const jn = normName(j.clientName);
        if (qEmail && je && qEmail === je) return true;
        if (namesLooselyMatch(qName, jn)) return true;
        return false;
      });
      if (job) {
        suggested = "FreelanceHunter";
        reason = `match freehunter_jobs #${job.id} (${job.clientName || job.clientEmail})`;
        confidence = qEmail && normEmail(job.clientEmail) === qEmail ? "high" : "medium";
      }
    }

    // ── 4) WhatsApp fh_* click near quote / same inquiry ───────────────
    if (suggested !== "FreelanceHunter") {
      const waHit = waClicks.find((c) => {
        if (c.quoteId === q.id) return true;
        if (linkInquiryId && c.inquiryId === linkInquiryId) return true;
        if (q.emailInquiryId && c.inquiryId === q.emailInquiryId) return true;
        return false;
      });
      if (waHit) {
        suggested = "FreelanceHunter";
        reason = `whatsapp click src=${waHit.source}` + (waHit.inquiryId ? ` inq=${waHit.inquiryId}` : "");
        confidence = "high";
      }
    }

    // ── 5) Walk-in / no email trail → Google Ads ───────────────────────
    // User rule: street clients who DM WhatsApp without email inquiry = Google Ads
    // (Ads → site → WA). Do not override Referral / Repeat / known platforms.
    const knownPlatform = new Set([
      "FreelanceHunter",
      "HelloToby",
      "PRO360",
      "88DB",
      "Instagram",
      "Facebook",
      "LinkedIn",
      "Referral",
      "Repeat",
      "Google",
    ]);
    if (
      !linkInquiryId &&
      !q.emailInquiryId &&
      suggested !== "FreelanceHunter" &&
      !PROTECTED.has(current) &&
      (!suggested || suggested === "Other" || suggested === "Website" || suggested === "email_inquiry" || suggested === "(empty)" || !knownPlatform.has(suggested))
    ) {
      // Only if we still have no FH evidence
      const stillNoFh = suggested !== "FreelanceHunter";
      if (stillNoFh) {
        suggested = "Google";
        reason =
          reason ||
          "no email/FH trail — treat walk-in WhatsApp as Google Ads (site button path)";
        confidence = current === "Website" || current === "Other" || current === "(empty)" || !q.leadSource
          ? "high"
          : "medium";
      }
    }

    if (!suggested) suggested = "Other";

    // Normalize legacy labels
    if (suggested === "Google Ads" || suggested === "google_ads") suggested = "Google";
    if (suggested === "Freelance Hunter") suggested = "FreelanceHunter";

    if (suggested === current || (current === "(empty)" && !q.leadSource && suggested === "Other" && !reason)) {
      continue;
    }
    if (suggested === current) continue;

    if (PROTECTED.has(current) && !overrideProtected && suggested !== current) {
      // Allow FH override on protected only with high confidence FH
      if (!(suggested === "FreelanceHunter" && confidence === "high")) {
        protectedSkipped++;
        continue;
      }
      reason += " (override protected with high-confidence FH)";
    }

    // Skip no-op after normalize
    if (suggested === (q.leadSource || "")) continue;

    const row: LeadSourceAuditRow = {
      quoteId: q.id,
      quoteNumber: q.quoteNumber,
      status: q.status,
      clientName: q.clientName,
      clientEmail: q.clientEmail,
      current,
      suggested,
      confidence,
      reason: reason || "resolved",
      linkInquiryId,
    };
    rows.push(row);

    if (apply && confidence === "high") {
      await db
        .update(quotes)
        .set({
          leadSource: suggested,
          ...(linkInquiryId && !q.emailInquiryId ? { emailInquiryId: linkInquiryId } : {}),
        })
        .where(eq(quotes.id, q.id));
      applied++;
    }
  }

  const bySuggested: Record<string, number> = {};
  for (const r of rows) {
    bySuggested[r.suggested] = (bySuggested[r.suggested] || 0) + 1;
  }

  return {
    scanned: allQuotes.length,
    wouldChange: rows.length,
    applied,
    bySuggested,
    protectedSkipped,
    rows,
  };
}
