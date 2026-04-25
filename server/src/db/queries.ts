import { Database } from 'bun:sqlite';
import type {
  Feed, FeedId, Entry, EntryId, Category, CategoryId,
  EntryScore, ScoredEntry, FeedWithStats, Interaction,
} from '../types';

// All query functions take db as first arg — no hidden global state.
// Every function uses prepared statements via db.query().

// --- Feeds ---

export const getAllFeeds = (db: Database): Feed[] =>
  db.query<Feed, []>('SELECT * FROM feeds ORDER BY title ASC').all();

export const getActiveFeedIds = (db: Database): FeedId[] =>
  db.query<{ id: FeedId }, []>(
    'SELECT id FROM feeds WHERE is_active = 1'
  ).all().map(r => r.id);

export const getFeedById = (db: Database, id: FeedId): Feed | null =>
  db.query<Feed, [FeedId]>('SELECT * FROM feeds WHERE id = ?').get(id);

export const getFeedByUrl = (db: Database, url: string): Feed | null =>
  db.query<Feed, [string]>('SELECT * FROM feeds WHERE url = ?').get(url);

export const insertFeed = (db: Database, url: string, title: string, siteUrl: string): FeedId => {
  const result = db.run(
    'INSERT INTO feeds (url, title, site_url) VALUES (?, ?, ?)',
    [url, title, siteUrl]
  );
  return result.lastInsertRowid as unknown as FeedId;
};

export const updateFeedAfterFetch = (
  db: Database,
  id: FeedId,
  etag: string | null,
  lastModified: string | null,
  title: string,
): void => {
  db.run(
    `UPDATE feeds SET
      etag = ?, last_modified = ?, title = CASE WHEN ? != '' THEN ? ELSE title END,
      last_fetched_at = unixepoch(), error_count = 0, last_error = NULL
    WHERE id = ?`,
    [etag, lastModified, title, title, id]
  );
};

export const updateFeedError = (db: Database, id: FeedId, error: string): void => {
  db.run(
    'UPDATE feeds SET error_count = error_count + 1, last_error = ?, last_fetched_at = unixepoch() WHERE id = ?',
    [error, id]
  );
};

export const deleteFeed = (db: Database, id: FeedId): void => {
  db.run('DELETE FROM feeds WHERE id = ?', [id]);
};

// --- Entries ---

export const insertEntry = (
  db: Database,
  entry: {
    feed_id: FeedId;
    guid: string;
    url: string;
    title: string;
    author: string;
    content_html: string;
    summary: string;
    image_url: string | null;
    published_at: number | null;
  },
): EntryId | null => {
  try {
    const result = db.run(
      `INSERT OR IGNORE INTO entries
        (feed_id, guid, url, title, author, content_html, summary, image_url, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.feed_id, entry.guid, entry.url, entry.title, entry.author,
        entry.content_html, entry.summary, entry.image_url, entry.published_at,
      ]
    );
    if (result.changes === 0) return null; // duplicate guid
    return result.lastInsertRowid as unknown as EntryId;
  } catch {
    return null;
  }
};

export const getUnscoredEntryIds = (db: Database, limit: number): EntryId[] =>
  db.query<{ id: EntryId }, [number]>(
    `SELECT e.id FROM entries e
     LEFT JOIN entry_scores s ON e.id = s.entry_id
     WHERE s.entry_id IS NULL
     ORDER BY e.published_at DESC
     LIMIT ?`
  ).all(limit).map(r => r.id);

export const getEntriesForScoring = (db: Database, ids: readonly EntryId[]): Array<Pick<Entry, 'id' | 'title' | 'summary' | 'url'> & { feed_title: string }> => {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return db.query<
    Pick<Entry, 'id' | 'title' | 'summary' | 'url'> & { feed_title: string },
    EntryId[]
  >(
    `SELECT e.id, e.title, e.summary, e.url, f.title as feed_title
     FROM entries e JOIN feeds f ON e.feed_id = f.id
     WHERE e.id IN (${placeholders})`
  ).all(...ids);
};

export const getRankedEntries = (
  db: Database,
  opts: { limit: number; offset: number; categoryId?: CategoryId; unreadOnly?: boolean },
): ScoredEntry[] => {
  const conditions: string[] = ['e.is_hidden = 0'];
  const params: unknown[] = [];

  if (opts.unreadOnly) {
    conditions.push('e.is_read = 0');
  }
  if (opts.categoryId !== undefined) {
    conditions.push('s.category_id = ?');
    params.push(opts.categoryId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(opts.limit, opts.offset);

  // Rank = relevance * recency_decay.
  // Recency: entries from last 6h get full weight, decays over 72h to 0.2 floor.
  return db.query<ScoredEntry, unknown[]>(
    `SELECT
      e.*,
      s.relevance, s.depth, s.novelty, s.category_id, s.reasoning, s.model, s.scored_at,
      f.title as feed_title, f.site_url as feed_site_url,
      COALESCE(s.relevance, 0.5) *
        MAX(0.2, 1.0 - (unixepoch() - COALESCE(e.published_at, e.fetched_at)) / 259200.0)
        AS rank_score
     FROM entries e
     LEFT JOIN entry_scores s ON e.id = s.entry_id
     JOIN feeds f ON e.feed_id = f.id
     ${where}
     ORDER BY rank_score DESC
     LIMIT ? OFFSET ?`
  ).all(...params);
};

export const getEntriesByFeed = (
  db: Database,
  feedId: FeedId,
  limit: number,
  offset: number,
): Entry[] =>
  db.query<Entry, [FeedId, number, number]>(
    'SELECT * FROM entries WHERE feed_id = ? ORDER BY published_at DESC LIMIT ? OFFSET ?'
  ).all(feedId, limit, offset);

export const getEntryById = (db: Database, id: EntryId): Entry | null =>
  db.query<Entry, [EntryId]>('SELECT * FROM entries WHERE id = ?').get(id);

export const markEntryRead = (db: Database, id: EntryId): void => {
  db.run('UPDATE entries SET is_read = 1 WHERE id = ?', [id]);
};

export const markEntryStarred = (db: Database, id: EntryId, starred: boolean): void => {
  db.run('UPDATE entries SET is_starred = ? WHERE id = ?', [starred ? 1 : 0, id]);
};

export const markEntryHidden = (db: Database, id: EntryId): void => {
  db.run('UPDATE entries SET is_hidden = 1 WHERE id = ?', [id]);
};

// --- Scores ---

export const upsertEntryScore = (db: Database, score: Omit<EntryScore, 'scored_at'>): void => {
  db.run(
    `INSERT INTO entry_scores (entry_id, relevance, depth, novelty, category_id, reasoning, model)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(entry_id) DO UPDATE SET
       relevance=excluded.relevance, depth=excluded.depth, novelty=excluded.novelty,
       category_id=excluded.category_id, reasoning=excluded.reasoning, model=excluded.model,
       scored_at=unixepoch()`,
    [score.entry_id, score.relevance, score.depth, score.novelty, score.category_id, score.reasoning, score.model]
  );
};

export const upsertEntryCategory = (db: Database, entryId: EntryId, categoryId: CategoryId, confidence: number): void => {
  db.run(
    `INSERT INTO entry_categories (entry_id, category_id, confidence) VALUES (?, ?, ?)
     ON CONFLICT(entry_id, category_id) DO UPDATE SET confidence=excluded.confidence`,
    [entryId, categoryId, confidence]
  );
};

// --- Categories ---

export const getAllCategories = (db: Database): Category[] =>
  db.query<Category, []>('SELECT * FROM categories ORDER BY sort_order ASC, name ASC').all();

export const getCategoryBySlug = (db: Database, slug: string): Category | null =>
  db.query<Category, [string]>('SELECT * FROM categories WHERE slug = ?').get(slug);

export const getCategoryByName = (db: Database, name: string): Category | null =>
  db.query<Category, [string]>('SELECT * FROM categories WHERE name = ?').get(name);

export const insertCategory = (db: Database, name: string, slug: string, description: string, isAuto: boolean): CategoryId => {
  const result = db.run(
    'INSERT INTO categories (name, slug, description, is_auto) VALUES (?, ?, ?, ?)',
    [name, slug, description, isAuto ? 1 : 0]
  );
  return result.lastInsertRowid as unknown as CategoryId;
};

export const getCategoriesWithCounts = (db: Database): Array<Category & { entry_count: number }> =>
  db.query<Category & { entry_count: number }, []>(
    `SELECT c.*, COUNT(ec.entry_id) as entry_count
     FROM categories c
     LEFT JOIN entry_categories ec ON c.id = ec.category_id
     GROUP BY c.id
     ORDER BY c.sort_order ASC, c.name ASC`
  ).all();

// --- Interactions ---

export const recordInteraction = (db: Database, entryId: EntryId, action: Interaction['action'], durationSec?: number): void => {
  db.run(
    'INSERT INTO interactions (entry_id, action, duration_sec) VALUES (?, ?, ?)',
    [entryId, action, durationSec ?? null]
  );
};

// --- Preferences ---

export const getPreference = (db: Database, key: string): string | null => {
  const row = db.query<{ value: string }, [string]>('SELECT value FROM preferences WHERE key = ?').get(key);
  return row?.value ?? null;
};

export const setPreference = (db: Database, key: string, value: string): void => {
  db.run(
    `INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, unixepoch())
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=unixepoch()`,
    [key, value]
  );
};

export const getAllPreferences = (db: Database): Record<string, string> => {
  const rows = db.query<{ key: string; value: string }, []>('SELECT key, value FROM preferences').all();
  const prefs: Record<string, string> = {};
  for (const row of rows) {
    prefs[row.key] = row.value;
  }
  return prefs;
};

// --- Config ---

export const getConfig = (db: Database, key: string): string | null => {
  const row = db.query<{ value: string }, [string]>('SELECT value FROM config WHERE key = ?').get(key);
  return row?.value ?? null;
};

// --- Stats ---

export const getStats = (db: Database): {
  total_feeds: number;
  total_entries: number;
  unread_entries: number;
  scored_entries: number;
  pending_jobs: number;
} => {
  const total_feeds = db.query<{ c: number }, []>('SELECT COUNT(*) as c FROM feeds').get()!.c;
  const total_entries = db.query<{ c: number }, []>('SELECT COUNT(*) as c FROM entries').get()!.c;
  const unread_entries = db.query<{ c: number }, []>('SELECT COUNT(*) as c FROM entries WHERE is_read = 0').get()!.c;
  const scored_entries = db.query<{ c: number }, []>('SELECT COUNT(*) as c FROM entry_scores').get()!.c;
  const pending_jobs = db.query<{ c: number }, []>("SELECT COUNT(*) as c FROM jobs WHERE status = 'pending'").get()!.c;
  return { total_feeds, total_entries, unread_entries, scored_entries, pending_jobs };
};

// --- Feeds with stats (for /api/feeds) ---

export const getFeedsWithStats = (db: Database): FeedWithStats[] => {
  const feeds = db.query<Feed & { entry_count: number; unread_count: number }, []>(
    `SELECT f.*,
       (SELECT COUNT(*) FROM entries e WHERE e.feed_id = f.id) as entry_count,
       (SELECT COUNT(*) FROM entries e WHERE e.feed_id = f.id AND e.is_read = 0) as unread_count
     FROM feeds f ORDER BY f.title ASC`
  ).all();

  // Attach categories per feed
  const fcRows = db.query<{ feed_id: FeedId; category_id: CategoryId }, []>(
    'SELECT feed_id, category_id FROM feed_categories'
  ).all();

  const cats = getAllCategories(db);
  const catMap = new Map(cats.map(c => [c.id, c]));
  const feedCats = new Map<FeedId, Category[]>();
  for (const fc of fcRows) {
    const cat = catMap.get(fc.category_id);
    if (cat) {
      const arr = feedCats.get(fc.feed_id) ?? [];
      arr.push(cat);
      feedCats.set(fc.feed_id, arr);
    }
  }

  return feeds.map(f => ({
    ...f,
    categories: feedCats.get(f.id) ?? [],
  }));
};
