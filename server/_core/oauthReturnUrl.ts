import { ENV } from "./env";

function normalizeOrigin(raw: string): string | null {
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/** Origins we may bounce the browser back to after Google OAuth. */
export function trustedOAuthOrigins(): string[] {
  const origins = new Set<string>();
  for (const raw of [ENV.appBaseUrl, ENV.publicBaseUrl]) {
    const o = normalizeOrigin(String(raw || "").trim());
    if (o) origins.add(o);
  }
  return [...origins];
}

export type TrustedOAuthReturn = {
  /** Origin used for Google redirect_uri and post-OAuth browser bounce. */
  appOrigin: string;
  /** Path on that origin (e.g. /ad-sync). */
  returnPath: string;
};

/**
 * Parse OAuth `state` / `origin` into a bounce target, falling back to our app
 * when the value is missing or not on an allowlisted origin (open-redirect guard).
 */
export function resolveTrustedOAuthReturn(
  stateOrOrigin: string | undefined | null,
  defaultPath = "/ad-sync"
): TrustedOAuthReturn {
  const fallbackOrigin =
    normalizeOrigin(ENV.appBaseUrl) ||
    normalizeOrigin(ENV.publicBaseUrl) ||
    "https://jdsys.biz";
  const allowed = new Set(trustedOAuthOrigins());
  if (allowed.size === 0) allowed.add(fallbackOrigin);

  const raw = String(stateOrOrigin ?? "").trim();
  if (!raw) {
    return { appOrigin: fallbackOrigin, returnPath: defaultPath };
  }

  try {
    const u = new URL(raw);
    if (!allowed.has(u.origin)) {
      return { appOrigin: fallbackOrigin, returnPath: defaultPath };
    }
    const path = u.pathname && u.pathname !== "/" ? u.pathname : defaultPath;
    return { appOrigin: u.origin, returnPath: path };
  } catch {
    // Non-URL state (legacy bare origin string) — only accept if allowlisted.
    const asOrigin = normalizeOrigin(raw) || normalizeOrigin(`https://${raw.replace(/\/+$/, "")}`);
    if (asOrigin && allowed.has(asOrigin)) {
      return { appOrigin: asOrigin, returnPath: defaultPath };
    }
    return { appOrigin: fallbackOrigin, returnPath: defaultPath };
  }
}
