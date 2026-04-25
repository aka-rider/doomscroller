import { Database } from 'bun:sqlite';
import type { Job, JobId } from '../types';

// SQLite-backed job queue. Single writer, atomic claim via UPDATE...RETURNING.
// No Redis. No message broker. Just a table and a poll loop.

export type JobHandler = (payload: string) => Promise<void>;

interface QueueOptions {
  readonly pollIntervalMs: number; // how often to check for new jobs
  readonly staleTimeoutSec: number; // mark running jobs as failed after this
}

const DEFAULT_OPTS: QueueOptions = {
  pollIntervalMs: 2000,
  staleTimeoutSec: 600, // 10 minutes — generous for LLM inference
};

export const enqueue = (
  db: Database,
  type: string,
  payload: unknown,
  opts?: { priority?: number; runAfterSec?: number },
): JobId => {
  const runAfter = opts?.runAfterSec
    ? Math.floor(Date.now() / 1000) + opts.runAfterSec
    : Math.floor(Date.now() / 1000);

  const result = db.run(
    `INSERT INTO jobs (type, payload, priority, run_after)
     VALUES (?, ?, ?, ?)`,
    [type, JSON.stringify(payload), opts?.priority ?? 0, runAfter]
  );
  return result.lastInsertRowid as unknown as JobId;
};

export const claimNextJob = (db: Database): Job | null => {
  const now = Math.floor(Date.now() / 1000);

  // Atomic: claim one pending job whose run_after has passed.
  // UPDATE...RETURNING ensures no two workers claim the same job.
  // (We only have one worker, but this is correct even if we ever add more.)
  const row = db.query<Job, [number, number]>(
    `UPDATE jobs SET status = 'running', started_at = ?, attempts = attempts + 1
     WHERE id = (
       SELECT id FROM jobs
       WHERE status = 'pending' AND run_after <= ?
       ORDER BY priority DESC, run_after ASC
       LIMIT 1
     )
     RETURNING *`
  ).get(now, now);

  return row ?? null;
};

export const completeJob = (db: Database, id: JobId): void => {
  db.run(
    "UPDATE jobs SET status = 'done', completed_at = ? WHERE id = ?",
    [Math.floor(Date.now() / 1000), id]
  );
};

export const failJob = (db: Database, id: JobId, error: string): void => {
  const job = db.query<Job, [JobId]>('SELECT * FROM jobs WHERE id = ?').get(id);
  if (!job) return;

  if (job.attempts >= job.max_attempts) {
    // Dead letter — give up
    db.run(
      "UPDATE jobs SET status = 'dead', error = ?, completed_at = ? WHERE id = ?",
      [error, Math.floor(Date.now() / 1000), id]
    );
  } else {
    // Exponential backoff retry
    const backoffSec = Math.pow(2, job.attempts) * 60;
    const runAfter = Math.floor(Date.now() / 1000) + backoffSec;
    db.run(
      "UPDATE jobs SET status = 'pending', error = ?, run_after = ? WHERE id = ?",
      [error, runAfter, id]
    );
  }
};

// Recover jobs that were running when the process died
export const recoverStaleJobs = (db: Database, staleTimeoutSec: number): number => {
  const cutoff = Math.floor(Date.now() / 1000) - staleTimeoutSec;
  const result = db.run(
    "UPDATE jobs SET status = 'pending', error = 'recovered: worker died' WHERE status = 'running' AND started_at < ?",
    [cutoff]
  );
  return result.changes;
};

// Clean up old completed/dead jobs
export const cleanupJobs = (db: Database, olderThanSec: number): number => {
  const cutoff = Math.floor(Date.now() / 1000) - olderThanSec;
  const result = db.run(
    "DELETE FROM jobs WHERE status IN ('done', 'dead') AND completed_at < ?",
    [cutoff]
  );
  return result.changes;
};

// The worker loop: poll for jobs, dispatch to handlers
export const startWorker = (
  db: Database,
  handlers: Record<string, JobHandler>,
  opts: Partial<QueueOptions> = {},
): { stop: () => void } => {
  const config = { ...DEFAULT_OPTS, ...opts };
  let running = true;

  // Recover stale jobs on startup
  const recovered = recoverStaleJobs(db, config.staleTimeoutSec);
  if (recovered > 0) {
    console.log(`[queue] Recovered ${recovered} stale jobs`);
  }

  const poll = async () => {
    while (running) {
      const job = claimNextJob(db);

      if (!job) {
        await Bun.sleep(config.pollIntervalMs);
        continue;
      }

      const handler = handlers[job.type];
      if (!handler) {
        failJob(db, job.id, `No handler registered for job type: ${job.type}`);
        continue;
      }

      try {
        await handler(job.payload);
        completeJob(db, job.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[queue] Job ${job.id} (${job.type}) failed: ${message}`);
        failJob(db, job.id, message);
      }
    }
  };

  // Fire and forget — the loop runs until stop() is called
  poll().catch(err => console.error('[queue] Worker crashed:', err));

  return {
    stop: () => { running = false; },
  };
};

// Get queue stats for the /api/stats endpoint
export const getQueueStats = (db: Database): Record<string, number> => {
  const rows = db.query<{ status: string; count: number }, []>(
    "SELECT status, COUNT(*) as count FROM jobs GROUP BY status"
  ).all();
  const stats: Record<string, number> = {};
  for (const row of rows) {
    stats[row.status] = row.count;
  }
  return stats;
};
