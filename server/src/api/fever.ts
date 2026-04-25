import { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import type { Feed, Entry, EntryId, Tag } from '../types';
import * as queries from '../db/queries';

// Fever API implementation for native mobile RSS clients.
// Spec: https://feedafever.com/api
//
// Supported clients: Reeder, NetNewsWire, Unread, ReadKit, Fiery Feeds.
// Auth removed — all requests are always authenticated (single-user, local-only).

export const createFeverRoutes = (db: Database): Hono => {
  const fever = new Hono();

  // Fever clients POST to / with URL params like ?api&items&since_id=0
  // Everything is form-encoded or URL-parameterized. It's a 2010s API.

  // Handle both GET and POST — some clients use GET, some POST
  const handler = async (c: ReturnType<Hono['$typeof']>) => {
    const method = c.req.method;
    const url = new URL(c.req.url);
    const params = url.searchParams;

    // Base response — always included, always authed
    const response: Record<string, unknown> = {
      api_version: 3,
      auth: 1,
    };

    // Fever uses URL params to indicate what data to return.
    // Multiple can be requested at once: ?api&groups&feeds

    if (params.has('groups')) {
      const tags = queries.getAllTags(db);
      response['groups'] = tags.map(feverGroup);
      response['feeds_groups'] = getFeedsGroups(db);
    }

    if (params.has('feeds')) {
      const feeds = queries.getAllFeeds(db);
      response['feeds'] = feeds.map(feverFeed);

      // Also include feeds_groups if not already computed
      if (!params.has('groups')) {
        response['feeds_groups'] = getFeedsGroups(db);
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

const feverGroup = (tag: Tag) => ({
  id: tag.id,
  title: tag.label ?? tag.slug,
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

// Build Fever feeds_groups: for each tag, which feeds have entries with that tag.
const getFeedsGroups = (db: Database): Array<{ group_id: number; feed_ids: string }> => {
  const rows = db.query<{ tag_id: number; feed_id: number }, []>(
    `SELECT DISTINCT t.id as tag_id, e.feed_id
     FROM tags t
     JOIN entry_tags et ON t.id = et.tag_id
     JOIN entries e ON et.entry_id = e.id`
  ).all();

  const groupMap = new Map<number, number[]>();
  for (const row of rows) {
    let feeds = groupMap.get(row.tag_id);
    if (!feeds) {
      feeds = [];
      groupMap.set(row.tag_id, feeds);
    }
    feeds.push(row.feed_id);
  }

  return Array.from(groupMap.entries()).map(([tagId, feedIds]) => ({
    group_id: tagId,
    feed_ids: feedIds.join(','),
  }));
};
