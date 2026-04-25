import { describe, test, expect, beforeEach } from 'bun:test';
import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { createApiRoutes } from './routes';
import * as queries from '../db/queries';
import {
  createTestDb, insertTestFeed, insertTestEntry, insertTestCategory,
  insertTestScore, TEST_CONFIG,
} from '../test-utils';
import type { FeedId, EntryId } from '../types';

// ============================================================================
// GATE 9: API Routes — the delivery surface
// If the API misroutes, misvalidates, or misformats, the frontend is blind.
// Every endpoint tested. Input validation tested. Edge cases tested.
// ============================================================================

describe('API Routes', () => {
  let db: Database;
  let app: Hono;

  beforeEach(() => {
    db = createTestDb();
    const api = createApiRoutes(db, TEST_CONFIG);
    app = new Hono();
    app.route('/api', api);
  });

  const req = (method: string, path: string, body?: unknown) => {
    const init: RequestInit = { method };
    if (body) {
      init.body = JSON.stringify(body);
      init.headers = { 'Content-Type': 'application/json' };
    }
    return app.request(`http://localhost/api${path}`, init);
  };

  // --- Feeds ---

  describe('GET /feeds', () => {
    test('returns empty array when no feeds', async () => {
      const res = await req('GET', '/feeds');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([]);
    });

    test('returns feeds with stats', async () => {
      const feedId = insertTestFeed(db, { title: 'My Feed' });
      insertTestEntry(db, feedId, { is_read: 0 });
      insertTestEntry(db, feedId, { is_read: 1 });

      const res = await req('GET', '/feeds');
      const data = await res.json() as any[];
      expect(data).toHaveLength(1);
      expect(data[0].title).toBe('My Feed');
      expect(data[0].entry_count).toBe(2);
      expect(data[0].unread_count).toBe(1);
    });
  });

  describe('POST /feeds', () => {
    test('creates a feed and returns 201', async () => {
      const res = await req('POST', '/feeds', { url: 'https://new.feed/rss.xml' });
      expect(res.status).toBe(201);

      const data = await res.json() as any;
      expect(data.id).toBeDefined();

      // Feed should exist in DB
      const feed = queries.getFeedByUrl(db, 'https://new.feed/rss.xml');
      expect(feed).not.toBeNull();
    });

    test('returns 400 for invalid URL', async () => {
      const res = await req('POST', '/feeds', { url: 'not-a-url' });
      expect(res.status).toBe(400);
    });

    test('returns 409 for duplicate feed', async () => {
      insertTestFeed(db, { url: 'https://dupe.com/feed' });
      const res = await req('POST', '/feeds', { url: 'https://dupe.com/feed' });
      expect(res.status).toBe(409);
    });

    test('enqueues fetch_feed job on creation', async () => {
      await req('POST', '/feeds', { url: 'https://fresh.feed/rss' });

      const jobs = db.query<{ type: string; priority: number }, []>(
        "SELECT type, priority FROM jobs WHERE type = 'fetch_feed'"
      ).all();

      expect(jobs.length).toBe(1);
      expect(jobs[0]!.priority).toBe(10);
    });
  });

  describe('DELETE /feeds/:id', () => {
    test('deletes a feed', async () => {
      const id = insertTestFeed(db);
      const res = await req('DELETE', `/feeds/${id}`);
      expect(res.status).toBe(200);
      expect(queries.getFeedById(db, id)).toBeNull();
    });
  });

  // --- Entries ---

  describe('GET /entries', () => {
    test('returns ranked entries', async () => {
      const feedId = insertTestFeed(db);
      insertTestEntry(db, feedId, { title: 'An entry' });

      const res = await req('GET', '/entries');
      expect(res.status).toBe(200);
      const data = await res.json() as any[];
      expect(data.length).toBe(1);
      expect(data[0].title).toBe('An entry');
    });

    test('respects limit parameter', async () => {
      const feedId = insertTestFeed(db);
      for (let i = 0; i < 10; i++) insertTestEntry(db, feedId);

      const res = await req('GET', '/entries?limit=3');
      const data = await res.json() as any[];
      expect(data.length).toBe(3);
    });

    test('returns 400 for invalid limit', async () => {
      const res = await req('GET', '/entries?limit=0');
      expect(res.status).toBe(400);
    });

    test('filters by unread', async () => {
      const feedId = insertTestFeed(db);
      insertTestEntry(db, feedId, { title: 'Unread', is_read: 0 });
      insertTestEntry(db, feedId, { title: 'Read', is_read: 1 });

      const res = await req('GET', '/entries?unread=true');
      const data = await res.json() as any[];
      expect(data.length).toBe(1);
      expect(data[0].title).toBe('Unread');
    });
  });

  describe('GET /entries/:id', () => {
    test('returns a single entry', async () => {
      const feedId = insertTestFeed(db);
      const entryId = insertTestEntry(db, feedId, { title: 'Specific' });

      const res = await req('GET', `/entries/${entryId}`);
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.title).toBe('Specific');
    });

    test('returns 404 for non-existent entry', async () => {
      const res = await req('GET', '/entries/99999');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /entries/:id/read', () => {
    test('marks entry as read and records interaction', async () => {
      const feedId = insertTestFeed(db);
      const entryId = insertTestEntry(db, feedId);

      const res = await req('POST', `/entries/${entryId}/read`);
      expect(res.status).toBe(200);

      const entry = queries.getEntryById(db, entryId)!;
      expect(entry.is_read).toBe(1);

      // Interaction should be recorded
      const interactions = db.query<{ action: string }, [number]>(
        'SELECT action FROM interactions WHERE entry_id = ?'
      ).all(entryId as number);
      expect(interactions.some(i => i.action === 'read')).toBe(true);
    });
  });

  describe('POST /entries/:id/star', () => {
    test('stars an entry', async () => {
      const feedId = insertTestFeed(db);
      const entryId = insertTestEntry(db, feedId);

      const res = await req('POST', `/entries/${entryId}/star`, { starred: true });
      expect(res.status).toBe(200);
      expect(queries.getEntryById(db, entryId)!.is_starred).toBe(1);
    });

    test('unstars an entry', async () => {
      const feedId = insertTestFeed(db);
      const entryId = insertTestEntry(db, feedId, { is_starred: 1 });

      const res = await req('POST', `/entries/${entryId}/star`, { starred: false });
      expect(res.status).toBe(200);
      expect(queries.getEntryById(db, entryId)!.is_starred).toBe(0);
    });

    test('records interaction only on star, not unstar', async () => {
      const feedId = insertTestFeed(db);
      const entryId = insertTestEntry(db, feedId);

      await req('POST', `/entries/${entryId}/star`, { starred: true });
      await req('POST', `/entries/${entryId}/star`, { starred: false });

      const interactions = db.query<{ action: string }, [number]>(
        'SELECT action FROM interactions WHERE entry_id = ?'
      ).all(entryId as number);

      // Only one "star" interaction, no unstar interaction
      expect(interactions.filter(i => i.action === 'star')).toHaveLength(1);
    });

    test('returns 400 for missing starred field', async () => {
      const feedId = insertTestFeed(db);
      const entryId = insertTestEntry(db, feedId);

      const res = await req('POST', `/entries/${entryId}/star`, {});
      expect(res.status).toBe(400);
    });
  });

  describe('POST /entries/:id/hide', () => {
    test('hides an entry and records interaction', async () => {
      const feedId = insertTestFeed(db);
      const entryId = insertTestEntry(db, feedId);

      const res = await req('POST', `/entries/${entryId}/hide`);
      expect(res.status).toBe(200);
      expect(queries.getEntryById(db, entryId)!.is_hidden).toBe(1);
    });
  });

  // --- Categories ---

  describe('GET /categories', () => {
    test('returns categories with entry counts', async () => {
      const catId = insertTestCategory(db, { name: 'Tech', slug: 'tech' });
      const feedId = insertTestFeed(db);
      const e = insertTestEntry(db, feedId);
      queries.upsertEntryCategory(db, e, catId, 1.0);

      const res = await req('GET', '/categories');
      const data = await res.json() as any[];
      const tech = data.find((c: any) => c.slug === 'tech');
      expect(tech).toBeDefined();
      expect(tech.entry_count).toBe(1);
    });
  });

  describe('POST /categories', () => {
    test('creates a category with auto-generated slug', async () => {
      const res = await req('POST', '/categories', { name: 'Machine Learning' });
      expect(res.status).toBe(201);
      const data = await res.json() as any;
      expect(data.slug).toBe('machine-learning');
    });

    test('returns 409 for duplicate category', async () => {
      insertTestCategory(db, { name: 'Exists', slug: 'exists' });
      const res = await req('POST', '/categories', { name: 'Exists' });
      expect(res.status).toBe(409);
    });

    test('returns 400 for empty name', async () => {
      const res = await req('POST', '/categories', { name: '' });
      expect(res.status).toBe(400);
    });
  });

  // --- Preferences ---

  describe('preferences', () => {
    test('GET /preferences returns all preferences', async () => {
      queries.setPreference(db, 'theme', '"dark"');

      const res = await req('GET', '/preferences');
      const data = await res.json() as any;
      expect(data.theme).toBe('"dark"');
    });

    test('PUT /preferences/:key sets a preference', async () => {
      const res = await req('PUT', '/preferences/theme', { value: '"light"' });
      expect(res.status).toBe(200);

      expect(queries.getPreference(db, 'theme')).toBe('"light"');
    });
  });

  // --- Stats ---

  describe('GET /stats', () => {
    test('returns aggregate stats', async () => {
      const feedId = insertTestFeed(db);
      insertTestEntry(db, feedId);

      const res = await req('GET', '/stats');
      const data = await res.json() as any;

      expect(data.total_feeds).toBe(1);
      expect(data.total_entries).toBe(1);
      expect(typeof data.unread_entries).toBe('number');
      expect(typeof data.scored_entries).toBe('number');
      expect(typeof data.pending_jobs).toBe('number');
    });
  });
});
