/**
 * Background FH client-email fetch queue.
 *
 * Manual "取得電郵" used to await Playwright (30–90s) inside the tRPC mutation.
 * Safari / reverse proxies often abort that long request and surface
 * "The string did not match the expected pattern" even when the server succeeds.
 *
 * Pattern matches startManualGmailScan: return immediately, work in background,
 * client polls status.
 */

import { fetchEmailForJob } from "./scrapers/freehunterBoard";

export type FhEmailFetchJobStatus = {
  jobId: string;
  status: "running" | "ok" | "error";
  email?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
};

const jobs = new Map<string, FhEmailFetchJobStatus>();
/** Serialize Playwright sessions — concurrent fetches wedge the shared browser. */
let chain: Promise<void> = Promise.resolve();

const MAX_TRACKED = 50;
const STALE_MS = 15 * 60 * 1000;

function prune(): void {
  const now = Date.now();
  for (const [id, j] of jobs) {
    if (j.status !== "running" && j.finishedAt && now - j.finishedAt > STALE_MS) {
      jobs.delete(id);
    }
  }
  if (jobs.size <= MAX_TRACKED) return;
  const finished = [...jobs.entries()]
    .filter(([, j]) => j.status !== "running")
    .sort((a, b) => (a[1].finishedAt ?? 0) - (b[1].finishedAt ?? 0));
  while (jobs.size > MAX_TRACKED && finished.length) {
    const [id] = finished.shift()!;
    jobs.delete(id);
  }
}

export function getFhEmailFetchStatus(jobId: string): FhEmailFetchJobStatus | null {
  return jobs.get(jobId) ?? null;
}

export function listRunningFhEmailFetches(): string[] {
  return [...jobs.values()].filter((j) => j.status === "running").map((j) => j.jobId);
}

/**
 * Kick a background email fetch. Returns immediately.
 */
export function startFhEmailFetch(jobId: string): {
  started: boolean;
  alreadyRunning: boolean;
} {
  const id = String(jobId || "").trim();
  if (!id) {
    return { started: false, alreadyRunning: false };
  }

  const existing = jobs.get(id);
  if (existing?.status === "running") {
    return { started: false, alreadyRunning: true };
  }

  prune();
  const startedAt = Date.now();
  jobs.set(id, { jobId: id, status: "running", startedAt });

  chain = chain
    .then(async () => {
      const current = jobs.get(id);
      if (!current || current.status !== "running") return;
      try {
        console.log(`[FH EmailFetch] Starting background fetch for job ${id}`);
        const result = await fetchEmailForJob(id);
        if (result.email) {
          jobs.set(id, {
            jobId: id,
            status: "ok",
            email: result.email,
            startedAt,
            finishedAt: Date.now(),
          });
          console.log(`[FH EmailFetch] OK job ${id} in ${Date.now() - startedAt}ms`);
        } else {
          jobs.set(id, {
            jobId: id,
            status: "error",
            error:
              result.error ||
              "無法取得客戶電郵，可能需要 Premium 帳號或工作已過期",
            startedAt,
            finishedAt: Date.now(),
          });
          console.warn(`[FH EmailFetch] No email for job ${id}: ${result.error}`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        jobs.set(id, {
          jobId: id,
          status: "error",
          error: msg,
          startedAt,
          finishedAt: Date.now(),
        });
        console.error(`[FH EmailFetch] Error job ${id}:`, e);
      }
    })
    .catch((e) => {
      console.error("[FH EmailFetch] Queue chain error:", e);
    });

  return { started: true, alreadyRunning: false };
}

/** Test helper — clear in-memory state. */
export function _resetFhEmailFetchQueueForTests(): void {
  jobs.clear();
  chain = Promise.resolve();
}
