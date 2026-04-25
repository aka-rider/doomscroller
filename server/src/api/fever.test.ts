import { describe, test, expect, beforeEach } from 'bun:test';
import { Hono } from 'hono';
import { createHash } from 'node:crypto';
import { Database } from 'bun:sqlite';
import { createFeverRoutes } from './fever';
import * as queries from '../db/queries';
import {
  createTestDb, insertTestFeed, insertTestEntry, insertTestCategory,
} from '../test-utils';
import type { FeedId, EntryId, CategoryId } from '../types';

// ============================================================================
// GATE 10: Fever API — the mobile client contract
// Fever is a decade-old protocol. Every major RSS reader speaks it.
// If this breaks, Reeder/NetNewsWire/Unread are blind.
// Auth, items, groups, mark actions — all tested against the spec.
// ============================================================================

const API_KEY = 'test-api-key-0000';
const API_KEY_MD5 = createHash('md5').update(`doomscroller:${API_KEY}`).digest('hex');

describe('Fever API', () => {
  let db: Database;
  let app: Hono;

  beforeEach(() => {
    db = createTestDb();
    const fever = createFeverRoutes(db);
    app = new Hono();
    app.route('/fever', fever);
  });

  const feverGet = (params: string, apiKey = API_KEY_MD5) =>
    app.request(`http://localhost/fever?api&${params}&api_key=${apiKey}`);

  const feverPost = (params: string, body: Record<string, string> = {}) => {
    const formBody = new URLSearchParams({ api_key: API_KEY_MD5, ...body });
    return app.request(`http://localhost/fever?api&${params}`, {
      method: 'POST',
      body: formBody.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  };

  // --- Auth ---

  describe('Authentication', () => {
    test('authenticates with MD5 of doomscroller:api_key', async () => {
      const res = await feverGet('');
      const data = await res.json() as any;
      expect(data.api_version).toBe(3);
      expect(data.auth).toBe(1);
    });

    test('authenticates with raw API key', async () => {
      const res = await feverGet('', API_KEY);
      const data = await res.json() as any;
      expect(data.auth).toBe(1);
    });

    test('rejects invalid API key', async () => {
      const res = await feverGet('', 'wrong-key');
      const data = await res.json() as any;
      expect(data.auth).toBe(0);
    });

    test('returns only api_version and auth=0 when unauthorized', async () => {
      insertTestFeed(db, { title: 'Should not leak' });
      const res = await feverGet('feeds', 'wrong-key');
      const data = await res.json() as any;
      expect(data.auth).toBe(0);
      expect(data.feeds).toBeUndefined();
    });
  });

  // --- Groups (Categories) ---

  describe('?groups', () => {
    test('returns categories as Fever groups', async () => {
      insertTestCategory(db, { name: 'Tech', slug: 'tech' });

      const res = await feverGet('groups');
      const data = await res.json() as any;

      expect(data.groups).toBeDefined();
      expect(data.groups.length).toBeGreaterThan(0);
      expect(data.groups[0].title).toBe('Tech');
      expect(data.groups[0].id).toBeDefined();
    });

    test('returns feeds_groups mapping', async () => {
      const catId = insertTestCategory(db, { name: 'Tech', slug: 'tech' });
      const feedId = insertTestFeed(db, { title: 'Tech Feed' });
      db.run('INSERT INTO feed_categories (feed_id, category_id) VALUES (?, ?)', [feedId, catId]);

      const res = await feverGet('groups');
      const data = await res.json() as any;

      expect(data.feeds_groups).toBeDefined();
      expect(data.feeds_groups.length).toBeGreaterThan(0);
      expect(data.feeds_groups[0].group_id).toBe(catId as number);
      expect(data.feeds_groups[0].feed_ids).toContain(String(feedId));
    });
  });

  // --- Feeds ---

  describe('?feeds', () => {
    test('returns feeds in Fever format', async () => {
      insertTestFeed(db, { title: 'My Feed', url: 'https://my.feed/rss' });

      const res = await feverGet('feeds');
      const data = await res.json() as any;

      expect(data.feeds).toBeDefined();
      expect(data.feeds.length).toBe(1);
      expect(data.feeds[0].title).toBe('My Feed');
      expect(data.feeds[0].url).toBe('https://my.feed/rss');
      expect(data.feeds[0].is_spark).toBe(0);
    });

    test('also includes feeds_groups', async () => {
      insertTestFeed(db);
      const res = await feverGet('feeds');
      const data = await res.json() as any;
      expect(data.feeds_groups).toBeDefined();
    });
  });

  // --- Items (Entries) ---

  describe('?items', () => {
    test('returns entries with since_id', async () => {
      const feedId = insertTestFeed(db);
      const e1 = insertTestEntry(db, feedId, { title: 'First' });
      const e2 = insertTestEntry(db, feedId, { title: 'Second' });

      const res = await feverGet(`items&since_id=${e1 as number}`);
      const data = await res.json() as any;

      expect(data.items).toBeDefined();
      // since_id is exclusive — should only return entries > since_id
      expect(data.items.length).toBe(1);
      expect(data.items[0].id).toBe(e2 as number);
    });

    test('returns entries with with_ids', async () => {
      const feedId = insertTestFeed(db);
      const e1 = insertTestEntry(db, feedId, { title: 'First' });
      const e2 = insertTestEntry(db, feedId, { title: 'Second' });
      insertTestEntry(db, feedId, { title: 'Third' });

      const res = await feverGet(`items&with_ids=${e1},${e2}`);
      const data = await res.json() as any;

      expect(data.items.length).toBe(2);
    });

    test('returns total_items count', async () => {
      const feedId = insertTestFeed(db);
      insertTestEntry(db, feedId);
      insertTestEntry(db, feedId);
      insertTestEntry(db, feedId);

      const res = await feverGet('items');
      const data = await res.json() as any;

      expect(data.total_items).toBe(3);
    });

    test('items are in Fever format with correct field names', async () => {
      const feedId = insertTestFeed(db);
      const now = Math.floor(Date.now() / 1000);
      insertTestEntry(db, feedId, {
        title: 'Formatted',
        author: 'Alice',
        content_html: '<p>Content</p>',
        url: 'https://t.co/1',
        is_starred: 1,
        is_read: 0,
        published_at: now,
      });

      const res = await feverGet('items');
      const data = await res.json() as any;
      const item = data.items[0];

      expect(item.title).toBe('Formatted');
      expect(item.author).toBe('Alice');
      expect(item.html).toBe('<p>Content</p>');
      expect(item.url).toBe('https://t.co/1');
      expect(item.is_saved).toBe(1);
      expect(item.is_read).toBe(0);
      expect(item.created_on_time).toBe(now);
      expect(item.feed_id).toBe(feedId as number);
    });

    test('limits to 50 items per request', async () => {
      const feedId = insertTestFeed(db);
      for (let i = 0; i < 60; i++) {
        insertTestEntry(db, feedId);
      }

      const res = await feverGet('items');
      const data = await res.json() as any;
      expect(data.items.length).toBeLessThanOrEqual(50);
    });
  });

  // --- Unread / Saved IDs ---

  describe('?unread_item_ids', () => {
    test('returns comma-separated unread entry IDs', async () => {
      const feedId = insertTestFeed(db);
      const e1 = insertTestEntry(db, feedId, { is_read: 0 });
      insertTestEntry(db, feedId, { is_read: 1 });
      const e3 = insertTestEntry(db, feedId, { is_read: 0 });

      const res = await feverGet('unread_item_ids');
      const data = await res.json() as any;

      const ids = data.unread_item_ids.split(',').map(Number);
      expect(ids).toContain(e1 as number);
      expect(ids).toContain(e3 as number);
      expect(ids.length).toBe(2);
    });
  });

  describe('?saved_item_ids', () => {
    test('returns comma-separated starred entry IDs', async () => {
      const feedId = insertTestFeed(db);
      insertTestEntry(db, feedId, { is_starred: 0 });
      const starred = insertTestEntry(db, feedId, { is_starred: 1 });

      const res = await feverGet('saved_item_ids');
      const data = await res.json() as any;

      const ids = data.saved_item_ids.split(',').map(Number);
      expect(ids).toContain(starred as number);
      expect(ids.length).toBe(1);
    });
  });

  // --- Mark Actions ---

  describe('mark actions', () => {
    test('mark item as read', async () => {
      const feedId = insertTestFeed(db);
      const entryId = insertTestEntry(db, feedId, { is_read: 0 });

      await feverPost('', { mark: 'item', as: 'read', id: String(entryId) });

      expect(queries.getEntryById(db, entryId)!.is_read).toBe(1);
    });

    test('mark item as saved (starred)', async () => {
      const feedId = insertTestFeed(db);
      const entryId = insertTestEntry(db, feedId);

      await feverPost('', { mark: 'item', as: 'saved', id: String(entryId) });

      expect(queries.getEntryById(db, entryId)!.is_starred).toBe(1);
    });

    test('mark item as unsaved (unstarred)', async () => {
      const feedId = insertTestFeed(db);
      const entryId = insertTestEntry(db, feedId, { is_starred: 1 });

      await feverPost('', { mark: 'item', as: 'unsaved', id: String(entryId) });

      expect(queries.getEntryById(db, entryId)!.is_starred).toBe(0);
    });

    test('mark feed as read', async () => {
      const feedId = insertTestFeed(db);
      const now = Math.floor(Date.now() / 1000);
      insertTestEntry(db, feedId, { is_read: 0, published_at: now - 100 });
      insertTestEntry(db, feedId, { is_read: 0, published_at: now - 200 });

      await feverPost('', { mark: 'feed', as: 'read', id: String(feedId), before: String(now) });

      const unread = db.query<{ c: number }, [FeedId]>(
        'SELECT COUNT(*) as c FROM entries WHERE feed_id = ? AND is_read = 0'
      ).get(feedId);
      expect(unread!.c).toBe(0);
    });

    test('mark group as read', async () => {
      const catId = insertTestCategory(db);
      const feedId = insertTestFeed(db);
      db.run('INSERT INTO feed_categories (feed_id, category_id) VALUES (?, ?)', [feedId, catId]);

      const now = Math.floor(Date.now() / 1000);
      insertTestEntry(db, feedId, { is_read: 0, published_at: now - 100 });

      await feverPost('', { mark: 'group', as: 'read', id: String(catId), before: String(now) });

      const unread = db.query<{ c: number }, [FeedId]>(
        'SELECT COUNT(*) as c FROM entries WHERE feed_id = ? AND is_read = 0'
      ).get(feedId);
      expect(unread!.c).toBe(0);
    });
  });

  // --- Multiple requests in one ---

  describe('combined requests', () => {
    test('?groups&feeds returns both groups and feeds', async () => {
      insertTestFeed(db, { title: 'F' });
      insertTestCategory(db, { name: 'G', slug: 'g' });

      const res = await feverGet('groups&feeds');
      const data = await res.json() as any;

      expect(data.groups).toBeDefined();
      expect(data.feeds).toBeDefined();
    });
  });
});
