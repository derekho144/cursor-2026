/** Shape of HelloToby JSON API error / envelope fields we care about. */
export type HelloTobyApiEnvelope = {
  success?: boolean;
  message?: string;
  error?: string;
  msg?: string;
  errorMessage?: string;
  errorCode?: string;
};

/**
 * Extract a human-readable detail from HelloToby API JSON.
 * Live API uses `errorMessage` (e.g. 「請登錄后再執行。」) when success=false.
 */
export function hellotobyApiErrorDetail(
  body: HelloTobyApiEnvelope | null | undefined,
  fallback = "success=false"
): string {
  if (!body || typeof body !== "object") return fallback;
  const text = String(body.errorMessage || body.message || body.error || body.msg || "").trim();
  if (text) return text;
  if (body.errorCode) return `errorCode=${body.errorCode}`;
  return fallback;
}
