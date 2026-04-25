import { describe, test, expect, beforeEach } from 'bun:test';
import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { createFeverRoutes } from './fever';
import * as queries from '../db/queries';
import {
  createTestDb, insertTestFeed, insertTestEntry,
} from '../test-utils';
import type { FeedId, EntryId, TagId } from '../types';

// ============================================================================
// GATE 10: Fever API — the mobile client contract
// Fever is a decade-old protocol. Every major RSS reader speaks it.
// If this breaks, Reeder/NetNewsWire/Unread are blind.
// Auth removed (single-user, local-only) — always auth=1.
// ============================================================================

describe('Fever API', () => {
  let db: Database;
  let app: Hono;

  beforeEach(() => {
    db = createTestDb();
    const fever = createFeverRoutes(db);
    app = new Hono();
    app.route('/fever', fever);
  });

  const feverGet = (params: string) =>
    app.request(`http://localhost/fever?api&${params}`);

  const feverPost = (params: string, body: Record<string, string> = {}) => {
    const formBody = new URLSearchParams(body);
    return app.request(`http://localhost/fever?api&${params}`, {
      method: 'POST',
      body: formBody.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  };

  // --- Auth ---

  describe('Authentication', () => {
    test('always returns auth=1 (no auth in D1)', async () => {
      const res = await feverGet('');
      const data = await res.json() as any;
      expect(data.api_version).toBe(3);
      expect(data.auth).toBe(1);
    });
  });

  // --- Groups (tags mapped to Fever groups) ---

  describe('?groups', () => {
    test('returns tags as Fever groups', async () => {
      const tagId = queries.createTag(db, 'politics', 'Politics', 'topic', true);

      const res = await feverGet('groups');
      const data = await res.json() as any;

      expect(data.groups.length).toBeGreaterThanOrEqual(1);
      const group = data.groups.find((g: any) => g.id === tagId);
      expect(group).toBeDefined();
      expect(group.title).toBe('Politics');
    });

    test('uses slug as title when label is null', async () => {
      db.run("INSERT INTO tags (slug, label, tag_group, is_builtin) VALUES ('misc', NULL, 'topic', 0)");
      const tagRow = db.query<{ id: number }, [string]>('SELECT id FROM tags WHERE slug = ?').get('misc')!;

      const res = await feverGet('groups');
      const data = await res.json() as any;

      const group = data.groups.find((g: any) => g.id === tagRow.id);
      expect(group).toBeDefined();
      expect(group.title).toBe('misc');
    });

    test('returns empty feeds_groups when no entries are tagged', async () => {
      queries.createTag(db, 'empty-tag', 'Empty', 'topic', true);

      const res = await feverGet('groups');
      const data = await res.json() as any;

      expect(data.feeds_groups).toEqual([]);
    });

    test('returns feeds_groups mapping tags to feeds via entries', async () => {
      const feedId1 = insertTestFeed(db, { title: 'Feed A' });
      const feedId2 = insertTestFeed(db, { title: 'Feed B' });
      const tagId = queries.createTag(db, 'tech', 'Tech', 'topic', true);

      const e1 = insertTestEntry(db, feedId1, { title: 'Entry 1' });
      const e2 = insertTestEntry(db, feedId2, { title: 'Entry 2' });

      queries.addEntryTag(db, e1, tagId, 'llm');
      queries.addEntryTag(db, e2, tagId, 'llm');

      const res = await feverGet('groups');
      const data = await res.json() as any;

      const fg = data.feeds_groups.find((fg: any) => fg.group_id === tagId);
      expect(fg).toBeDefined();
      const feedIds = fg.feed_ids.split(',').map(Number);
      expect(feedIds).toContain(feedId1 as number);
      expect(feedIds).toContain(feedId2 as number);
    });

    test('feeds_groups deduplicates feeds with multiple tagged entries', async () => {
      const feedId = insertTestFeed(db);
      const tagId = queries.createTag(db, 'science', 'Science', 'topic', true);

      const e1 = insertTestEntry(db, feedId, { title: 'Entry 1' });
      const e2 = insertTestEntry(db, feedId, { title: 'Entry 2' });

      queries.addEntryTag(db, e1, tagId, 'llm');
      queries.addEntryTag(db, e2, tagId, 'llm');

      const res = await feverGet('groups');
      const data = await res.json() as any;

      const fg = data.feeds_groups.find((fg: any) => fg.group_id === tagId);
      expect(fg).toBeDefined();
      const feedIds = fg.feed_ids.split(',').map(Number);
      // Should only appear once despite two entries
      expect(feedIds.length).toBe(1);
      expect(feedIds[0]).toBe(feedId as number);
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
      const feedId = insertTestFeed(db);
      const tagId = queries.createTag(db, 'news', 'News', 'topic', true);
      const entryId = insertTestEntry(db, feedId);
      queries.addEntryTag(db, entryId, tagId, 'llm');

      const res = await feverGet('feeds');
      const data = await res.json() as any;
      expect(data.feeds_groups).toBeDefined();
      expect(data.feeds_groups.length).toBeGreaterThanOrEqual(1);
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
  });

  // --- Multiple requests in one ---

  describe('combined requests', () => {
    test('?groups&feeds returns both groups and feeds', async () => {
      insertTestFeed(db, { title: 'F' });

      const res = await feverGet('groups&feeds');
      const data = await res.json() as any;

      expect(data.groups).toBeDefined();
      expect(data.feeds).toBeDefined();
    });
  });
});
