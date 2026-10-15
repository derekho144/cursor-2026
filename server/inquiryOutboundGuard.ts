/**
 * Guard: do not treat supplier / vendor replies to OUR outbound RFQ
 * as inbound customer inquiries (no auto meeting email / auto quote).
 */

/** Names that belong to JD STUDIO HK — never use as the client's greeting name. */
const STUDIO_SELF_NAME_RE =
  /^(derek|jd\s*studio(\s*hk)?|jdstudiohk|studio\s*exposureonehk|exposure\s*one|exposurehk)$/i;

export function isStudioSelfName(name: string | null | undefined): boolean {
  const t = String(name ?? "").trim();
  if (!t) return false;
  return STUDIO_SELF_NAME_RE.test(t);
}

/**
 * Resolve a safe display name for client-facing emails.
 * Prefer the sender's fromName when AI/clientName is our own name (e.g. "Derek").
 */
export function resolveInquiryClientName(
  aiOrParsedName: string | null | undefined,
  fromName: string | null | undefined
): string {
  const ai = String(aiOrParsedName ?? "").trim();
  const from = String(fromName ?? "").trim();
  if (ai && !isStudioSelfName(ai)) return ai;
  if (from && !isStudioSelfName(from)) return from;
  return "Sir/Madam";
}

/**
 * True when this inbox mail is almost certainly a supplier/vendor responding
 * to outreach we initiated — not a customer asking JD STUDIO for services.
 */
export function isLikelySupplierOrOutboundReply(
  subject: string,
  bodyText: string
): boolean {
  const subjectL = String(subject ?? "");
  const body = String(bodyText ?? "");
  if (!body.trim()) return false;

  const head = body.slice(0, 1200);
  const full = `${subjectL}\n${body}`;

  // Supplier thanks us for contacting them (we were the initiator).
  const thanksForOutreach =
    /thank(?:s| you) for reaching out/i.test(head) ||
    /感謝你[的]?聯絡|謝謝你[的]?查詢|多謝你[的]?聯絡/i.test(head);

  // They greet Derek / JD Studio as the recipient (writing TO us).
  const greetsUs =
    /^(?:hi|hello|dear|您好|你好)\s*,?\s*(derek|jd\s*studio)\b/im.test(head) ||
    /^(?:hi|hello|dear)\s+derek\b/im.test(head);

  // Quoted copy of our outbound RFQ: we ask THEM for their fees for our client.
  const quotedOurRfq =
    /(我們有個客戶|我哋有個客戶|we have a client|有個客戶想搵|想請問(?:一下)?(?:你們|你哋)?(?:的)?收費|looking for.{0,40}(?:fee|pricing|報價|收費))/i.test(
      full
    ) &&
    /(cheers!\s*derek|jd studio hk|jdstudiohk\.com|info\.exposurehk@gmail\.com)/i.test(
      full
    );

  // Vendor-style reply: they will quote after we provide scope.
  const vendorQuoteProcess =
    /\bwe quote based\b/i.test(head) ||
    /share (?:an )?estimated (?:price|quote|range)/i.test(head) ||
    /視乎(?:項目)?範圍.*報價|按.*範圍.*報價/i.test(head);

  if (quotedOurRfq) return true;
  if (thanksForOutreach && (greetsUs || vendorQuoteProcess)) return true;
  if (greetsUs && vendorQuoteProcess) return true;

  return false;
}
