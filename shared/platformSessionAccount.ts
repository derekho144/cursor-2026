/**
 * When renewing cookie sessions, preserve the previously stored account label
 * unless the caller explicitly provides a new one.
 */
export function resolveSessionAccountEmail(
  incoming: string | undefined | null,
  existing: string | undefined | null,
  fallback: string
): string {
  const next = typeof incoming === "string" ? incoming.trim() : "";
  if (next) return next;
  const prev = typeof existing === "string" ? existing.trim() : "";
  if (prev) return prev;
  return fallback;
}
