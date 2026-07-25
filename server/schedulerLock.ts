/**
 * schedulerLock.ts — DB-based distributed mutex for scheduled jobs
 *
 * Problem: Both the internal Node.js scheduler (setInterval) and external
 * Heartbeat HTTP endpoints trigger the same job functions. When they fire
 * within the same second, both read "no lock" and execute concurrently,
 * causing duplicate emails or double-processing.
 *
 * Solution: Use MySQL's atomic INSERT + ON DUPLICATE KEY UPDATE with a
 * "locked_until" TTL. Only the first caller acquires the lock; subsequent
 * callers within the TTL window are skipped.
 *
 * Usage:
 *   import { withSchedulerLock } from "./schedulerLock";
 *
 *   await withSchedulerLock("fh-followup", 10 * 60 * 1000, async () => {
 *     await runFHFollowUpEmails();
 *   });
 */

import { getDb } from "./db";
import { schedulerLocks } from "../drizzle/schema";
import { sql } from "drizzle-orm";

/**
 * Acquire a distributed lock and run `fn` if successful.
 *
 * @param lockKey   Unique identifier for the job (e.g. "fh-followup")
 * @param ttlMs     Lock TTL in milliseconds. The lock is held for this long.
 *                  Set it slightly longer than the expected job duration.
 * @param fn        The async function to run if the lock is acquired.
 * @returns         true if the lock was acquired and fn was executed,
 *                  false if another instance already holds the lock.
 */
export async function withSchedulerLock(
  lockKey: string,
  ttlMs: number,
  fn: () => Promise<void>
): Promise<boolean> {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + ttlMs);
  const lockedBy = process.env.HOSTNAME ?? "scheduler";

  try {
    // Atomic upsert:
    // - INSERT a new lock row if none exists
    // - UPDATE only if the existing lock has already expired (locked_until < NOW())
    // - If the existing lock is still valid, the UPDATE is a no-op (0 rows affected)
    const db = await getDb();
    if (!db) {
      // DB unavailable — run without lock (fail-open)
      await fn();
      return true;
    }

    const result = await db.execute(sql`
      INSERT INTO scheduler_locks (lock_key, locked_at, locked_until, locked_by)
      VALUES (${lockKey}, ${now}, ${lockedUntil}, ${lockedBy})
      ON DUPLICATE KEY UPDATE
        locked_at    = IF(locked_until < NOW(), VALUES(locked_at),    locked_at),
        locked_until = IF(locked_until < NOW(), VALUES(locked_until), locked_until),
        locked_by    = IF(locked_until < NOW(), VALUES(locked_by),    locked_by)
    `);

    // MySQL returns affectedRows=1 for INSERT, affectedRows=2 for UPDATE (changed row)
    // affectedRows=0 means the lock is still held by another instance
    const affectedRows = (result as any)?.[0]?.affectedRows ?? 0;

    if (affectedRows === 0) {
      console.log(`[SchedulerLock] "${lockKey}" is locked by another instance, skipping.`);
      return false;
    }

    // We acquired the lock — run the job
    try {
      await fn();
    } catch (err) {
      console.error(`[SchedulerLock] "${lockKey}" job threw an error:`, err);
      // Release the lock early on failure so the next run can retry sooner
      await releaseLock(lockKey);
    }

    return true;
  } catch (dbErr) {
    // If the lock table itself has an issue, fall through and run the job
    // (fail-open: better to risk a duplicate than to silently skip the job)
    console.error(`[SchedulerLock] DB error acquiring lock "${lockKey}", running without lock:`, dbErr);
    try { await fn(); } catch (_) {}
    return true;
  }
}

/**
 * Manually release a lock before its TTL expires.
 * Useful when a job fails and you want the next run to retry immediately.
 */
export async function releaseLock(lockKey: string): Promise<void> {
  try {
    // Set locked_until to the past so the next INSERT ... ON DUPLICATE KEY UPDATE
    // will treat it as expired and overwrite it.
    const db = await getDb();
    if (!db) return;
    await db.execute(sql`
      UPDATE scheduler_locks
      SET locked_until = DATE_SUB(NOW(), INTERVAL 1 SECOND)
      WHERE lock_key = ${lockKey}
    `);
  } catch (err) {
    console.error(`[SchedulerLock] Failed to release lock "${lockKey}":`, err);
  }
}
