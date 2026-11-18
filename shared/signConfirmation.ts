/** Public print path for a signed quotation (no staff login required). */
export function buildSignedQuotePrintPath(signToken: string): string {
  const token = String(signToken ?? "").trim();
  if (!token) throw new Error("signToken required");
  return `/print/sign/${encodeURIComponent(token)}`;
}

/** Absolute URL used in the post-sign confirmation email. */
export function buildSignedQuotePrintUrl(
  baseUrl: string,
  signToken: string
): string {
  const base = String(baseUrl ?? "").trim().replace(/\/+$/, "") || "https://jdsys.biz";
  return `${base}${buildSignedQuotePrintPath(signToken)}`;
}
