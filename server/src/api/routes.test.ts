import { describe, test, expect, beforeEach } from 'bun:test';
import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { createApiRoutes } from './routes';
import * as queries from '../db/queries';
import {
  createTestDb, insertTestFeed, insertTestEntry, TEST_CONFIG,
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
    test('returns entries', async () => {
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
    test('marks entry as read', async () => {
      const feedId = insertTestFeed(db);
      const entryId = insertTestEntry(db, feedId);

      const res = await req('POST', `/entries/${entryId}/read`);
      expect(res.status).toBe(200);

      const entry = queries.getEntryById(db, entryId)!;
      expect(entry.is_read).toBe(1);
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

    test('returns 400 for missing starred field', async () => {
      const feedId = insertTestFeed(db);
      const entryId = insertTestEntry(db, feedId);

      const res = await req('POST', `/entries/${entryId}/star`, {});
      expect(res.status).toBe(400);
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
      expect(typeof data.tagged_entries).toBe('number');
      expect(typeof data.pending_jobs).toBe('number');
    });
  });

  // --- Tags ---

  describe('GET /tags', () => {
    test('returns tags grouped by tag_group', async () => {
      queries.seedBuiltinTags(db);

      const res = await req('GET', '/tags');
      expect(res.status).toBe(200);
      const data = await res.json() as Record<string, any[]>;

      // Signal tags have been replaced by depth_score \u2014 303 topic tags, 0 signal
      expect(data.topic).toHaveLength(303);
      expect(data.signal).toBeUndefined();
    });

    test('returns empty object when no tags', async () => {
      const res = await req('GET', '/tags');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({});
    });
  });

  describe('POST /tags', () => {
    test('creates a custom tag', async () => {
      const res = await req('POST', '/tags', {
        slug: 'my-tag',
        label: 'My Tag',
        tag_group: 'custom',
      });
      expect(res.status).toBe(201);

      const data = await res.json() as any;
      expect(data.slug).toBe('my-tag');
      expect(data.label).toBe('My Tag');
      expect(data.tag_group).toBe('custom');
      expect(data.is_builtin).toBe(0);
    });

    test('returns 409 for duplicate slug', async () => {
      queries.createTag(db, 'dupe', 'Dupe', '', false);
      const res = await req('POST', '/tags', { slug: 'dupe', label: 'Dupe' });
      expect(res.status).toBe(409);
    });

    test('returns 400 for invalid slug', async () => {
      const res = await req('POST', '/tags', { slug: 'INVALID SLUG!', label: 'Bad' });
      expect(res.status).toBe(400);
    });

    test('returns 400 for missing label', async () => {
      const res = await req('POST', '/tags', { slug: 'ok' });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /tags/:id/preference', () => {
    test('sets tag preference to whitelist', async () => {
      const tagId = queries.createTag(db, 'test', 'Test', '', false);

      const res = await req('PUT', `/tags/${tagId}/preference`, { mode: 'whitelist' });
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.mode).toBe('whitelist');

      const pref = queries.getPreferenceForTag(db, tagId);
      expect(pref!.mode).toBe('whitelist');
    });

    test('cycles preference: none → whitelist → blacklist → none', async () => {
      const tagId = queries.createTag(db, 'cycle', 'Cycle', '', false);

      await req('PUT', `/tags/${tagId}/preference`, { mode: 'none' });
      expect(queries.getPreferenceForTag(db, tagId)!.mode).toBe('none');

      await req('PUT', `/tags/${tagId}/preference`, { mode: 'whitelist' });
      expect(queries.getPreferenceForTag(db, tagId)!.mode).toBe('whitelist');

      await req('PUT', `/tags/${tagId}/preference`, { mode: 'blacklist' });
      expect(queries.getPreferenceForTag(db, tagId)!.mode).toBe('blacklist');

      await req('PUT', `/tags/${tagId}/preference`, { mode: 'none' });
      expect(queries.getPreferenceForTag(db, tagId)!.mode).toBe('none');
    });

    test('returns 404 for non-existent tag', async () => {
      const res = await req('PUT', '/tags/99999/preference', { mode: 'whitelist' });
      expect(res.status).toBe(404);
    });

    test('returns 400 for invalid mode', async () => {
      const tagId = queries.createTag(db, 'test', 'Test', '', false);
      const res = await req('PUT', `/tags/${tagId}/preference`, { mode: 'invalid' });
      expect(res.status).toBe(400);
    });
  });

  // --- Entries with filtering (default = filtered feed) ---

  describe('GET /entries (default filtered feed)', () => {
    test('filters entries using visibility rules', async () => {
      const feedId = insertTestFeed(db);
      const e1 = insertTestEntry(db, feedId, { title: 'Visible', tagged_at: 12345 });
      const e2 = insertTestEntry(db, feedId, { title: 'Hidden', tagged_at: 12345 });
      const e3 = insertTestEntry(db, feedId, { title: 'Untagged' });

      const goodTag = queries.createTag(db, 'good', 'Good', '', false);
      const badTag = queries.createTag(db, 'bad', 'Bad', '', false);

      queries.addEntryTag(db, e1, goodTag, 'llm');
      queries.addEntryTag(db, e2, badTag, 'llm');
      queries.setTagPreference(db, badTag, 'blacklist');

      const res = await req('GET', '/entries');
      expect(res.status).toBe(200);
      const data = await res.json() as any[];

      const titles = data.map((e: any) => e.title);
      expect(titles).toContain('Visible');
      expect(titles).toContain('Untagged');
      expect(titles).not.toContain('Hidden');
    });

    test('returns all entries with filter=all', async () => {
      const feedId = insertTestFeed(db);
      const e1 = insertTestEntry(db, feedId, { title: 'A', tagged_at: 12345 });
      const badTag = queries.createTag(db, 'bad', 'Bad', '', false);
      queries.addEntryTag(db, e1, badTag, 'llm');
      queries.setTagPreference(db, badTag, 'blacklist');

      const res = await req('GET', '/entries?filter=all');
      const data = await res.json() as any[];
      expect(data.map((e: any) => e.title)).toContain('A');
    });
  });

  // --- Onboarding Config ---

  describe('GET /config/onboarding', () => {
    test('returns false when not set', async () => {
      const res = await req('GET', '/config/onboarding');
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.complete).toBe(false);
    });

    test('returns true when set', async () => {
      queries.setConfig(db, 'onboarding_complete', '1');
      const res = await req('GET', '/config/onboarding');
      const data = await res.json() as any;
      expect(data.complete).toBe(true);
    });
  });

  describe('POST /config/onboarding', () => {
    test('sets preferences and marks onboarding complete', async () => {
      const tagId = queries.createTag(db, 'tech', 'Technology', 'topic', false);

      const res = await req('POST', '/config/onboarding', {
        preferences: { [String(tagId)]: 'whitelist' },
      });
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.ok).toBe(true);

      // Verify config was set
      expect(queries.getConfig(db, 'onboarding_complete')).toBe('1');

      // Verify preference was saved
      const pref = queries.getPreferenceForTag(db, tagId);
      expect(pref?.mode).toBe('whitelist');
    });

    test('rejects invalid mode', async () => {
      const res = await req('POST', '/config/onboarding', {
        preferences: { '1': 'invalid' },
      });
      expect(res.status).toBe(400);
    });

    test('handles empty preferences', async () => {
      const res = await req('POST', '/config/onboarding', {
        preferences: {},
      });
      expect(res.status).toBe(200);
      expect(queries.getConfig(db, 'onboarding_complete')).toBe('1');
    });
  });
});
