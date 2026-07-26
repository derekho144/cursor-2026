/**
 * Map inbound email / FH signals → quotes.leadSource enum values
 * used by Platform Efficiency (HelloToby / PRO360 / FreelanceHunter / …).
 */
export function resolveQuoteLeadSource(opts: {
  fromEmail?: string | null;
  htmlBody?: string | null;
  bodyText?: string | null;
  subject?: string | null;
  fhJobId?: number | null;
}): string {
  if (opts.fhJobId != null) return "FreelanceHunter";

  const from = (opts.fromEmail || "").toLowerCase();
  const blob = [
    from,
    opts.subject || "",
    opts.htmlBody || "",
    opts.bodyText || "",
  ]
    .join("\n")
    .toLowerCase();

  if (
    from.includes("freehunter.com.hk") ||
    from.includes("freehunter.hk") ||
    blob.includes("freehunter.com.hk") ||
    blob.includes("freehunter.hk")
  ) {
    return "FreelanceHunter";
  }
  if (blob.includes("hellotoby")) return "HelloToby";
  if (blob.includes("pro360") || blob.includes("360pro") || blob.includes("360.pro")) {
    return "PRO360";
  }
  if (blob.includes("jobsdb")) return "Other";
  if (/\bgoogle\b/.test(blob) && (blob.includes("ads") || blob.includes("gclid") || blob.includes("form"))) {
    return "Google";
  }
  if (blob.includes("instagram") || blob.includes("ig.com")) return "Instagram";
  if (blob.includes("facebook") || blob.includes("fb.com") || blob.includes("meta")) return "Facebook";
  if (blob.includes("88db")) return "88DB";

  // Generic inbound enquiry — still a known PLATFORM_DEFS bucket (not "email_inquiry")
  return "Other";
}
