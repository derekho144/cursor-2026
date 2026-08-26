/**
 * Attachment understanding signals for email inquiries.
 *
 * Not every RFQ has attachments — that is normal.
 * Only block auto-draft when requirements appear to live in an attachment
 * we could not read (referenced in body, or PDF with no extractable text).
 */

export type AttachmentUnderstandingStatus =
  | "none" // no attachment needed / none present — OK
  | "used" // PDF text available for AI
  | "missing"; // requirements likely in unread attachment

export type AttachmentUnderstanding = {
  status: AttachmentUnderstandingStatus;
  /** Body/subject points at an attachment for details */
  mentionsAttachment: boolean;
  /** Non-empty extracted PDF text was available */
  hasExtractedText: boolean;
  /** PDF files were present on the message (even if empty text) */
  hasPdfFiles: boolean;
  blockers: string[];
  missingFields: string[];
  note: string | null;
};

/** Traditional / English cues that details are in an attachment. */
const ATTACHMENT_MENTION_RE =
  /詳情請見附件|詳見附件|請見附件|見附件|附件詳情|如附件|如附|請參閱附件|參考附件|附件為準|see\s+attach(?:ed|ment)|please\s+find\s+attach(?:ed|ment)|find\s+the\s+attached|attached\s+(?:file|document|pdf|brief|word)|attachment\s+(?:for|with)\s+(?:detail|requirement)|in\s+the\s+attached|as\s+per\s+(?:the\s+)?attach(?:ed|ment)|enclosed\s+(?:pdf|file|document)/i;

export function mentionsRequirementsAttachment(text: string): boolean {
  return ATTACHMENT_MENTION_RE.test(text ?? "");
}

/**
 * Resolve whether attachment content is required for understanding.
 * - No mention + no PDF → none (normal plain-body RFQ)
 * - Extracted text present → used
 * - Mentions attachment OR has PDF files, but no usable text → missing
 */
export function resolveAttachmentUnderstanding(input: {
  subject?: string | null;
  bodyText?: string | null;
  attachmentText?: string | null;
  /** Count of PDF attachments on the message (0 if unknown/none) */
  pdfFileCount?: number | null;
}): AttachmentUnderstanding {
  const blob = `${input.subject ?? ""}\n${input.bodyText ?? ""}`;
  const mentionsAttachment = mentionsRequirementsAttachment(blob);
  const hasExtractedText = Boolean((input.attachmentText ?? "").trim());
  const hasPdfFiles = (input.pdfFileCount ?? 0) > 0;

  if (hasExtractedText) {
    return {
      status: "used",
      mentionsAttachment,
      hasExtractedText: true,
      hasPdfFiles,
      blockers: [],
      missingFields: [],
      note: null,
    };
  }

  if (mentionsAttachment || hasPdfFiles) {
    const blockers: string[] = [];
    if (mentionsAttachment && !hasPdfFiles) {
      blockers.push("正文指明詳見附件，但未讀到可用附件文字（可能係 Word／掃描圖／未夾上）");
    } else if (hasPdfFiles) {
      blockers.push("有 PDF 附件但抽唔到文字（可能係掃描圖／無文字層）");
    } else {
      blockers.push("附件需求未能讀取");
    }
    return {
      status: "missing",
      mentionsAttachment,
      hasExtractedText: false,
      hasPdfFiles,
      blockers,
      missingFields: ["attachmentText"],
      note: blockers[0] ?? null,
    };
  }

  return {
    status: "none",
    mentionsAttachment: false,
    hasExtractedText: false,
    hasPdfFiles: false,
    blockers: [],
    missingFields: [],
    note: null,
  };
}

/**
 * Apply attachment gate onto an AI parse object (mutates a shallow copy).
 * Downgrades confidence when requirements attachment is missing.
 */
export function applyAttachmentUnderstandingToParsed<
  T extends {
    confidence?: string | null;
    missingFields?: string[] | null;
    assumptions?: string[] | null;
    notes?: string | null;
    attachmentStatus?: string | null;
  },
>(
  parsed: T,
  understanding: AttachmentUnderstanding
): T & {
  attachmentStatus: AttachmentUnderstandingStatus;
  missingFields: string[];
  assumptions: string[];
  confidence: string;
} {
  const missingFields = Array.isArray(parsed.missingFields)
    ? [...parsed.missingFields.map(String)]
    : [];
  const assumptions = Array.isArray(parsed.assumptions)
    ? [...parsed.assumptions.map(String)]
    : [];
  let confidence = String(parsed.confidence ?? "low");
  let notes = parsed.notes ?? "";

  if (understanding.status === "missing") {
    for (const f of understanding.missingFields) {
      if (!missingFields.includes(f)) missingFields.push(f);
    }
    if (understanding.note && !assumptions.includes(understanding.note)) {
      assumptions.push(understanding.note);
    }
    if (confidence === "high") confidence = "medium";
    const tag = "【附件未讀到】需求可能喺附件；暫勿假設時數／張數開自動草稿。";
    notes = notes?.trim() ? `${notes.trim()}（${tag}）` : tag;
  }

  return {
    ...parsed,
    confidence,
    missingFields,
    assumptions,
    notes,
    attachmentStatus: understanding.status,
  };
}
