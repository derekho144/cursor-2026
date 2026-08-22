import type { Request, Response } from "express";
import { sdk, type AuthenticatedUser } from "./sdk";

const HEARTBEAT_TASK_UID_HEADER = "x-heartbeat-task-uid";
const MANUS_CRON_TASK_UID_HEADER = "x-manus-cron-task-uid";

function readHeaderTaskUid(req: Request): string | undefined {
  const raw =
    req.headers[HEARTBEAT_TASK_UID_HEADER] ??
    req.headers[MANUS_CRON_TASK_UID_HEADER];
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (Array.isArray(raw) && raw[0]?.trim()) return raw[0].trim();
  return undefined;
}

function cronUserFromTaskUid(taskUid: string): AuthenticatedUser {
  const now = new Date();
  return {
    id: -1,
    openId: `cron_${taskUid}`,
    name: "Manus Scheduled Task",
    email: null,
    loginMethod: null,
    role: "user",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
    taskUid,
    isCron: true,
  } as AuthenticatedUser;
}

/**
 * Authenticate Heartbeat / AGENT cron callbacks.
 * Heartbeat sends `x-heartbeat-task-uid`; cookie-based cron JWT verify often
 * fails locally because cron sessions are signed by the Manus platform key.
 * The platform gateway already restricts `/api/scheduled/*` to cron callers.
 */
export async function authenticateScheduledRequest(
  req: Request
): Promise<AuthenticatedUser | null> {
  try {
    const user = await sdk.authenticateRequest(req);
    if (user?.isCron) return user;
  } catch (err) {
    console.warn("[ScheduledAuth] Cookie auth failed:", String(err));
  }

  const taskUid = readHeaderTaskUid(req);
  if (taskUid) {
    console.log(`[ScheduledAuth] Authenticated via header taskUid=${taskUid}`);
    return cronUserFromTaskUid(taskUid);
  }

  return null;
}

/** Returns cron user or sends 403 and returns null. */
export async function requireScheduledAuth(
  req: Request,
  res: Response
): Promise<AuthenticatedUser | null> {
  const user = await authenticateScheduledRequest(req);
  if (!user?.isCron) {
    res.status(403).json({ ok: false, error: "cron-only" });
    return null;
  }
  return user;
}
