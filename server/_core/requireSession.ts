import type { Request, Response } from "express";
import { sdk, type AuthenticatedUser } from "./sdk";

/**
 * Require a real (non-cron) logged-in session for sensitive Express routes
 * such as Google Ads / GSC OAuth that can overwrite stored refresh tokens.
 */
export async function requireLoggedInSession(
  req: Request
): Promise<AuthenticatedUser | null> {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user || user.isCron) return null;
    if (user.role !== "admin" && user.isActive === false) return null;
    return user;
  } catch {
    return null;
  }
}

/** JSON/text 401 helper for auth-url style endpoints. */
export async function requireLoggedInSessionOr401(
  req: Request,
  res: Response
): Promise<AuthenticatedUser | null> {
  const user = await requireLoggedInSession(req);
  if (!user) {
    res.status(401).type("text/plain").send("Login required");
    return null;
  }
  return user;
}
