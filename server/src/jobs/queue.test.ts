import { describe, test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  enqueue, claimNextJob, completeJob, failJob,
  recoverStaleJobs, cleanupJobs, getQueueStats,
} from './queue';
import { createTestDb } from '../test-utils';
import type { JobId } from '../types';

// ============================================================================
// GATE 5: Job Queue — the heartbeat of async processing
// This is SQLite-as-a-queue. Single writer, atomic claims, exponential backoff.
// If the queue breaks, feeds stop fetching and entries stop getting scored.
// ============================================================================

describe('Job Queue', () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  // --- Enqueue ---

  describe('enqueue', () => {
    test('inserts a job with default priority and immediate run_after', () => {
      const id = enqueue(db, 'fetch_feed', { feed_id: 1 });

      const job = db.query<{ type: string; payload: string; status: string; priority: number }, [JobId]>(
        'SELECT type, payload, status, priority FROM jobs WHERE id = ?'
      ).get(id);

      expect(job).not.toBeNull();
      expect(job!.type).toBe('fetch_feed');
      expect(JSON.parse(job!.payload)).toEqual({ feed_id: 1 });
      expect(job!.status).toBe('pending');
      expect(job!.priority).toBe(0);
    });

    test('respects priority option', () => {
      const id = enqueue(db, 'fetch_feed', { feed_id: 1 }, { priority: 10 });

      const job = db.query<{ priority: number }, [JobId]>(
        'SELECT priority FROM jobs WHERE id = ?'
      ).get(id);

      expect(job!.priority).toBe(10);
    });

    test('respects runAfterSec option', () => {
      const before = Math.floor(Date.now() / 1000);
      const id = enqueue(db, 'cleanup', {}, { runAfterSec: 3600 });

      const job = db.query<{ run_after: number }, [JobId]>(
        'SELECT run_after FROM jobs WHERE id = ?'
      ).get(id);

      // run_after should be approximately now + 3600
      expect(job!.run_after).toBeGreaterThanOrEqual(before + 3600);
      expect(job!.run_after).toBeLessThanOrEqual(before + 3601);
    });

    test('serializes complex payloads to JSON', () => {
      const payload = { entry_ids: [1, 2, 3], nested: { deep: true } };
      const id = enqueue(db, 'score_batch', payload);

      const job = db.query<{ payload: string }, [JobId]>(
        'SELECT payload FROM jobs WHERE id = ?'
      ).get(id);

      expect(JSON.parse(job!.payload)).toEqual(payload);
    });
  });

  // --- Claim ---

  describe('claimNextJob', () => {
    test('claims the highest-priority pending job', () => {
      enqueue(db, 'low', {}, { priority: 1 });
      enqueue(db, 'high', {}, { priority: 10 });
      enqueue(db, 'medium', {}, { priority: 5 });

      const job = claimNextJob(db);
      expect(job).not.toBeNull();
      expect(job!.type).toBe('high');
      expect(job!.status).toBe('running');
    });

    test('returns null when no jobs are pending', () => {
      const job = claimNextJob(db);
      expect(job).toBeNull();
    });

    test('does not claim jobs with run_after in the future', () => {
      enqueue(db, 'future', {}, { runAfterSec: 9999 });

      const job = claimNextJob(db);
      expect(job).toBeNull();
    });

    test('does not double-claim the same job', () => {
      enqueue(db, 'single', {});

      const first = claimNextJob(db);
      const second = claimNextJob(db);

      expect(first).not.toBeNull();
      expect(second).toBeNull();
    });

    test('increments attempts on claim', () => {
      enqueue(db, 'retry', {});

      const job = claimNextJob(db);
      expect(job!.attempts).toBe(1);
    });

    test('sets started_at on claim', () => {
      enqueue(db, 'timed', {});
      const before = Math.floor(Date.now() / 1000);

      const job = claimNextJob(db);
      expect(job!.started_at).not.toBeNull();
      expect(job!.started_at!).toBeGreaterThanOrEqual(before);
    });

    test('claims jobs in priority-then-run_after order', () => {
      // Same priority — should return oldest (earliest run_after) first
      const id1 = enqueue(db, 'first', {}, { priority: 0 });
      const id2 = enqueue(db, 'second', {}, { priority: 0 });

      const job = claimNextJob(db);
      expect(job!.id).toBe(id1);
    });
  });

  // --- Complete ---

  describe('completeJob', () => {
    test('marks job as done with completed_at timestamp', () => {
      const id = enqueue(db, 'task', {});
      claimNextJob(db); // claim it first
      completeJob(db, id);

      const job = db.query<{ status: string; completed_at: number | null }, [JobId]>(
        'SELECT status, completed_at FROM jobs WHERE id = ?'
      ).get(id);

      expect(job!.status).toBe('done');
      expect(job!.completed_at).not.toBeNull();
    });
  });

  // --- Fail ---

  describe('failJob', () => {
    test('retries with exponential backoff when attempts < max_attempts', () => {
      const id = enqueue(db, 'retryable', {});
      claimNextJob(db); // attempts becomes 1

      const before = Math.floor(Date.now() / 1000);
      failJob(db, id, 'Network error');

      const job = db.query<{ status: string; error: string; run_after: number }, [JobId]>(
        'SELECT status, error, run_after FROM jobs WHERE id = ?'
      ).get(id);

      expect(job!.status).toBe('pending'); // back in the queue
      expect(job!.error).toBe('Network error');
      // Backoff: 2^1 * 60 = 120 seconds
      expect(job!.run_after).toBeGreaterThanOrEqual(before + 120);
    });

    test('marks as dead when attempts >= max_attempts', () => {
      const id = enqueue(db, 'doomed', {});

      // Claim and fail 3 times (max_attempts default is 3)
      for (let i = 0; i < 3; i++) {
        // Reset to pending for next claim (simulating what failJob does until max)
        if (i < 2) {
          claimNextJob(db);
          failJob(db, id, `Attempt ${i + 1}`);
          // failJob sets back to pending with backoff — override run_after for test
          db.run('UPDATE jobs SET run_after = 0 WHERE id = ?', [id]);
        } else {
          claimNextJob(db);
          failJob(db, id, 'Final failure');
        }
      }

      const job = db.query<{ status: string; error: string }, [JobId]>(
        'SELECT status, error FROM jobs WHERE id = ?'
      ).get(id);

      expect(job!.status).toBe('dead');
      expect(job!.error).toBe('Final failure');
    });

    test('exponential backoff increases with each attempt', () => {
      const id = enqueue(db, 'backoff', {});

      // First failure: 2^1 * 60 = 120s
      claimNextJob(db);
      const before1 = Math.floor(Date.now() / 1000);
      failJob(db, id, 'err');
      const job1 = db.query<{ run_after: number }, [JobId]>('SELECT run_after FROM jobs WHERE id = ?').get(id);
      const backoff1 = job1!.run_after - before1;

      // Reset for second claim
      db.run('UPDATE jobs SET run_after = 0 WHERE id = ?', [id]);

      // Second failure: 2^2 * 60 = 240s
      claimNextJob(db);
      const before2 = Math.floor(Date.now() / 1000);
      failJob(db, id, 'err');
      const job2 = db.query<{ run_after: number }, [JobId]>('SELECT run_after FROM jobs WHERE id = ?').get(id);
      const backoff2 = job2!.run_after - before2;

      // Second backoff should be larger than first
      expect(backoff2).toBeGreaterThan(backoff1);
    });
  });

  // --- Recovery ---

  describe('recoverStaleJobs', () => {
    test('recovers jobs that have been running too long', () => {
      const id = enqueue(db, 'stuck', {});
      claimNextJob(db);

      // Backdate started_at to simulate a stuck job
      db.run('UPDATE jobs SET started_at = ? WHERE id = ?', [
        Math.floor(Date.now() / 1000) - 7200, // 2 hours ago
        id,
      ]);

      const recovered = recoverStaleJobs(db, 3600); // 1 hour timeout
      expect(recovered).toBe(1);

      const job = db.query<{ status: string; error: string | null }, [JobId]>(
        'SELECT status, error FROM jobs WHERE id = ?'
      ).get(id);

      expect(job!.status).toBe('pending');
      expect(job!.error).toContain('recovered');
    });

    test('does not recover recently started jobs', () => {
      enqueue(db, 'fresh', {});
      claimNextJob(db);

      const recovered = recoverStaleJobs(db, 3600);
      expect(recovered).toBe(0);
    });
  });

  // --- Cleanup ---

  describe('cleanupJobs', () => {
    test('deletes old completed jobs', () => {
      const id = enqueue(db, 'old', {});
      claimNextJob(db);
      completeJob(db, id);

      // Backdate completed_at
      db.run('UPDATE jobs SET completed_at = ? WHERE id = ?', [
        Math.floor(Date.now() / 1000) - 86400 * 8, // 8 days ago
        id,
      ]);

      const cleaned = cleanupJobs(db, 86400 * 7); // 7 day retention
      expect(cleaned).toBe(1);

      const job = db.query('SELECT * FROM jobs WHERE id = ?').get(id);
      expect(job).toBeNull();
    });

    test('does not delete recent completed jobs', () => {
      const id = enqueue(db, 'recent', {});
      claimNextJob(db);
      completeJob(db, id);

      const cleaned = cleanupJobs(db, 86400 * 7);
      expect(cleaned).toBe(0);
    });

    test('does not delete pending jobs regardless of age', () => {
      const id = enqueue(db, 'pending_old', {});

      const cleaned = cleanupJobs(db, 0); // 0 retention = everything qualifies by age
      expect(cleaned).toBe(0); // but pending jobs have no completed_at
    });
  });

  // --- Stats ---

  describe('getQueueStats', () => {
    test('returns counts grouped by status', () => {
      enqueue(db, 'a', {});
      enqueue(db, 'b', {});
      const id3 = enqueue(db, 'c', {});
      claimNextJob(db); // claims 'a' (first inserted, same priority)
      claimNextJob(db); // claims 'b'
      completeJob(db, id3); // but id3 was never claimed... let's fix:

      // More realistic:
      const db2 = createTestDb();
      enqueue(db2, 'p1', {});
      enqueue(db2, 'p2', {});
      const doneId = enqueue(db2, 'done', {});
      claimNextJob(db2);
      claimNextJob(db2);

      // One running, one pending, complete the done one
      // Actually: p1 and p2 are claimed (running). done is still pending.
      const stats = getQueueStats(db2);
      expect(stats['running']).toBe(2);
      expect(stats['pending']).toBe(1);
    });
  });
});
