import { Hono } from 'hono';
import { createHash } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import type { Feed, Entry, FeedId, EntryId, Category } from '../types';
import * as queries from '../db/queries';

// Fever API implementation for native mobile RSS clients.
// Spec: https://feedafever.com/api
//
// Supported clients: Reeder, NetNewsWire, Unread, ReadKit, Fiery Feeds.
// Auth: POST with api_key=md5(username:password). We use a single API key from config.

export const createFeverRoutes = (db: Database): Hono => {
  const fever = new Hono();

  // Fever clients POST to / with URL params like ?api&items&since_id=0
  // Everything is form-encoded or URL-parameterized. It's a 2010s API.

  const authenticate = (apiKeyParam: string): boolean => {
    const stored = queries.getConfig(db, 'fever_api_key');
    if (!stored) return false;

    // Fever auth: client sends md5(username:password)
    // We treat our API key as the password, username is "doomscroller"
    const expected = createHash('md5').update(`doomscroller:${stored}`).digest('hex');
    return apiKeyParam === expected || apiKeyParam === stored;
  };

  // Handle both GET and POST — some clients use GET, some POST
  const handler = async (c: ReturnType<Hono['$typeof']>) => {
    const method = c.req.method;
    let apiKey = '';

    if (method === 'POST') {
      const formData = await c.req.parseBody();
      apiKey = String(formData['api_key'] ?? '');
    } else {
      apiKey = c.req.query('api_key') ?? '';
    }

    const url = new URL(c.req.url);
    const params = url.searchParams;

    // Auth check
    const authed = authenticate(apiKey);

    // Base response — always included
    const response: Record<string, unknown> = {
      api_version: 3,
      auth: authed ? 1 : 0,
    };

    if (!authed) return c.json(response);

    // Fever uses URL params to indicate what data to return.
    // Multiple can be requested at once: ?api&groups&feeds

    if (params.has('groups')) {
      const categories = queries.getAllCategories(db);
      response['groups'] = categories.map(feverGroup);

      // feeds_groups: which feeds belong to which groups
      const feedCats = db.query<{ feed_id: number; category_id: number }, []>(
        'SELECT feed_id, category_id FROM feed_categories'
      ).all();

      const grouped = new Map<number, number[]>();
      for (const fc of feedCats) {
        const arr = grouped.get(fc.category_id) ?? [];
        arr.push(fc.feed_id);
        grouped.set(fc.category_id, arr);
      }

      response['feeds_groups'] = Array.from(grouped.entries()).map(([gid, fids]) => ({
        group_id: gid,
        feed_ids: fids.join(','),
      }));
    }

    if (params.has('feeds')) {
      const feeds = queries.getAllFeeds(db);
      response['feeds'] = feeds.map(feverFeed);

      // Also include feeds_groups if not already
      if (!params.has('groups')) {
        const feedCats = db.query<{ feed_id: number; category_id: number }, []>(
          'SELECT feed_id, category_id FROM feed_categories'
        ).all();

        const grouped = new Map<number, number[]>();
        for (const fc of feedCats) {
          const arr = grouped.get(fc.category_id) ?? [];
          arr.push(fc.feed_id);
          grouped.set(fc.category_id, arr);
        }

        response['feeds_groups'] = Array.from(grouped.entries()).map(([gid, fids]) => ({
          group_id: gid,
          feed_ids: fids.join(','),
        }));
      }
    }

    if (params.has('items')) {
      const sinceId = Number(params.get('since_id') ?? '0');
      const maxId = params.get('max_id');
      const withIds = params.get('with_ids');

      let entries: Entry[];

      if (withIds) {
        const ids = withIds.split(',').map(Number).filter(n => !isNaN(n));
        if (ids.length > 0) {
          const placeholders = ids.map(() => '?').join(',');
          entries = db.query<Entry, number[]>(
            `SELECT * FROM entries WHERE id IN (${placeholders}) ORDER BY id ASC LIMIT 50`
          ).all(...ids);
        } else {
          entries = [];
        }
      } else if (maxId) {
        entries = db.query<Entry, [number]>(
          'SELECT * FROM entries WHERE id < ? ORDER BY id DESC LIMIT 50'
        ).all(Number(maxId));
      } else {
        entries = db.query<Entry, [number]>(
          'SELECT * FROM entries WHERE id > ? ORDER BY id ASC LIMIT 50'
        ).all(sinceId);
      }

      response['items'] = entries.map(feverItem);
      response['total_items'] = db.query<{ c: number }, []>(
        'SELECT COUNT(*) as c FROM entries'
      ).get()!.c;
    }

    if (params.has('unread_item_ids')) {
      const unread = db.query<{ id: number }, []>(
        'SELECT id FROM entries WHERE is_read = 0'
      ).all();
      response['unread_item_ids'] = unread.map(r => r.id).join(',');
    }

    if (params.has('saved_item_ids')) {
      const starred = db.query<{ id: number }, []>(
        'SELECT id FROM entries WHERE is_starred = 1'
      ).all();
      response['saved_item_ids'] = starred.map(r => r.id).join(',');
    }

    // Handle mark actions (POST only)
    if (method === 'POST') {
      const formData = await c.req.parseBody();
      const mark = String(formData['mark'] ?? '');
      const asType = String(formData['as'] ?? '');
      const id = Number(formData['id'] ?? 0);

      if (mark === 'item') {
        if (asType === 'read') {
          queries.markEntryRead(db, id as EntryId);
        } else if (asType === 'saved') {
          queries.markEntryStarred(db, id as EntryId, true);
        } else if (asType === 'unsaved') {
          queries.markEntryStarred(db, id as EntryId, false);
        }
      } else if (mark === 'feed' && asType === 'read') {
        const before = Number(formData['before'] ?? Math.floor(Date.now() / 1000));
        db.run(
          'UPDATE entries SET is_read = 1 WHERE feed_id = ? AND published_at < ?',
          [id, before]
        );
      } else if (mark === 'group' && asType === 'read') {
        const before = Number(formData['before'] ?? Math.floor(Date.now() / 1000));
        db.run(
          `UPDATE entries SET is_read = 1
           WHERE feed_id IN (SELECT feed_id FROM feed_categories WHERE category_id = ?)
           AND published_at < ?`,
          [id, before]
        );
      }
    }

    return c.json(response);
  };

  // Handle both /fever and /fever/ — Fever clients vary
  fever.get('/', handler);
  fever.post('/', handler);
  fever.get('/*', handler);
  fever.post('/*', handler);

  return fever;
};

// --- Fever format mappers ---

const feverGroup = (cat: Category) => ({
  id: cat.id,
  title: cat.name,
});

const feverFeed = (feed: Feed) => ({
  id: feed.id,
  favicon_id: 0,
  title: feed.title,
  url: feed.url,
  site_url: feed.site_url,
  is_spark: 0,
  last_updated_on_time: feed.last_fetched_at ?? 0,
});

const feverItem = (entry: Entry) => ({
  id: entry.id,
  feed_id: entry.feed_id,
  title: entry.title,
  author: entry.author,
  html: entry.content_html,
  url: entry.url,
  is_saved: entry.is_starred,
  is_read: entry.is_read,
  created_on_time: entry.published_at ?? entry.fetched_at,
});
