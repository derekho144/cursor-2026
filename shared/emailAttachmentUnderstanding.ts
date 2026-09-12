/**
 * Attachment understanding signals for email inquiries.
 *
 * Not every RFQ has attachments — that is normal.
 * Only block auto-draft when requirements appear to live in an attachment
 * we could not read (referenced in body, unsupported format, or empty extract).
 */

export type AttachmentUnderstandingStatus =
  | "none" // no attachment needed / none present — OK
  | "used" // attachment text available for AI
  | "missing" // requirements likely in unread attachment
  | "unsupported"; // files present but format not extractable

export type AttachmentUnderstanding = {
  status: AttachmentUnderstandingStatus;
  /** Body/subject points at an attachment for details */
  mentionsAttachment: boolean;
  /** Non-empty extracted attachment text was available */
  hasExtractedText: boolean;
  /** Readable attachments were present (PDF/image/Word), even if empty text */
  hasPdfFiles: boolean;
  /** Non-inline files we detected but could not extract (e.g. .doc, xlsx, zip) */
  hasUnsupportedFiles: boolean;
  unsupportedFiles: string[];
  blockers: string[];
  missingFields: string[];
  note: string | null;
};

/**
 * Traditional / English cues that details are in an attachment.
 * Intentionally broad — false "none" is worse than a soft missing flag.
 */
const ATTACHMENT_MENTION_RE =
  /詳情請見附件|詳見附件|請見附件|見附件|附件詳情|如附件|如附|請參閱附件|請查收附件|參考附件|附件為準|附上|附檔|附件內|見附|請見附|PFA\b|FYI\s+attach|see\s+(?:the\s+)?attach(?:ed|ment)|please\s+(?:see|find|check)\s+(?:the\s+)?attach(?:ed|ment)|i\s+have\s+attached|i'?ve\s+attached|we\s+(?:have\s+)?attached|find\s+(?:the\s+)?attached|attached\s+(?:is|are|file|document|pdf|brief|word|here|below)|attachment\s+(?:for|with|below)\s*(?:detail|requirement)?|in\s+the\s+attached|as\s+per\s+(?:the\s+)?attach(?:ed|ment)|enclosed\s+(?:pdf|file|document|please)|please\s+find\s+attach(?:ed|ment)/i;

export function mentionsRequirementsAttachment(text: string): boolean {
  return ATTACHMENT_MENTION_RE.test(text ?? "");
}

/**
 * Resolve whether attachment content is required for understanding.
 * - Extracted text present → used
 * - Unsupported files present (and no text) → unsupported
 * - Mentions attachment OR has readable files, but no usable text → missing
 * - Else → none (normal plain-body RFQ)
 */
export function resolveAttachmentUnderstanding(input: {
  subject?: string | null;
  bodyText?: string | null;
  attachmentText?: string | null;
  /** Count of PDF/image/Word attachments we attempted to read */
  pdfFileCount?: number | null;
  /** Alias for pdfFileCount — total readable attachments */
  attachmentFileCount?: number | null;
  /** Non-extractable non-inline attachment filenames */
  unsupportedFiles?: string[] | null;
  unsupportedFileCount?: number | null;
}): AttachmentUnderstanding {
  const blob = `${input.subject ?? ""}\n${input.bodyText ?? ""}`;
  const mentionsAttachment = mentionsRequirementsAttachment(blob);
  const hasExtractedText = Boolean((input.attachmentText ?? "").trim());
  const fileCount = input.attachmentFileCount ?? input.pdfFileCount ?? 0;
  const hasPdfFiles = fileCount > 0;
  const unsupportedFiles = Array.isArray(input.unsupportedFiles)
    ? input.unsupportedFiles.map(String).filter(Boolean)
    : [];
  const unsupportedCount =
    input.unsupportedFileCount ?? unsupportedFiles.length;
  const hasUnsupportedFiles = unsupportedCount > 0;

  if (hasExtractedText) {
    return {
      status: "used",
      mentionsAttachment,
      hasExtractedText: true,
      hasPdfFiles,
      hasUnsupportedFiles,
      unsupportedFiles,
      blockers: [],
      missingFields: [],
      note: null,
    };
  }

  if (hasUnsupportedFiles) {
    const names = unsupportedFiles.slice(0, 5).join("、") || "未知檔名";
    const blockers = [
      `有附件但格式暫不支援抽取（${names}）。請人手打開附件，或改寄 PDF／Word(.docx)／圖片。`,
    ];
    if (mentionsAttachment) {
      blockers.push("正文亦指明詳見附件，但系統未能讀取附件文字。");
    }
    return {
      status: "unsupported",
      mentionsAttachment,
      hasExtractedText: false,
      hasPdfFiles,
      hasUnsupportedFiles: true,
      unsupportedFiles,
      blockers,
      missingFields: ["attachmentText"],
      note: blockers[0] ?? null,
    };
  }

  if (mentionsAttachment || hasPdfFiles) {
    const blockers: string[] = [];
    if (mentionsAttachment && !hasPdfFiles) {
      blockers.push(
        "正文指明詳見附件，但未讀到可用附件文字（可能未夾上／連結雲端檔／不支援格式）"
      );
    } else if (hasPdfFiles) {
      blockers.push(
        "有附件但抽唔到文字（可能係掃描圖 OCR 失敗／無文字層／圖片太模糊）"
      );
    } else {
      blockers.push("附件需求未能讀取");
    }
    return {
      status: "missing",
      mentionsAttachment,
      hasExtractedText: false,
      hasPdfFiles,
      hasUnsupportedFiles: false,
      unsupportedFiles: [],
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
    hasUnsupportedFiles: false,
    unsupportedFiles: [],
    blockers: [],
    missingFields: [],
    note: null,
  };
}

/**
 * Apply attachment gate onto an AI parse object (shallow copy).
 * Downgrades confidence when requirements attachment is missing/unsupported.
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
  unsupportedAttachments?: string[];
} {
  const missingFields = Array.isArray(parsed.missingFields)
    ? [...parsed.missingFields.map(String)]
    : [];
  const assumptions = Array.isArray(parsed.assumptions)
    ? [...parsed.assumptions.map(String)]
    : [];
  let confidence = String(parsed.confidence ?? "low");
  let notes = parsed.notes ?? "";

  if (
    understanding.status === "missing" ||
    understanding.status === "unsupported"
  ) {
    for (const f of understanding.missingFields) {
      if (!missingFields.includes(f)) missingFields.push(f);
    }
    if (understanding.note && !assumptions.includes(understanding.note)) {
      assumptions.push(understanding.note);
    }
    if (confidence === "high") confidence = "medium";
    const tag =
      understanding.status === "unsupported"
        ? "【附件格式不支援】有檔但未能抽取文字；暫勿假設時數／張數開自動草稿。"
        : "【附件未讀到】需求可能喺附件；暫勿假設時數／張數開自動草稿。";
    notes = notes?.trim() ? `${notes.trim()}（${tag}）` : tag;
  }

  return {
    ...parsed,
    confidence,
    missingFields,
    assumptions,
    notes,
    attachmentStatus: understanding.status,
    ...(understanding.unsupportedFiles.length > 0
      ? { unsupportedAttachments: understanding.unsupportedFiles }
      : {}),
  };
}
