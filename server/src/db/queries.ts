import { Database } from 'bun:sqlite';
import type {
  Feed, FeedId, Entry, EntryId, Tag, TagId, Category, CategoryId, TagPreference, FeedWithStats,
} from '../types';
import { BUILTIN_CATEGORIES, BUILTIN_TAGS } from '../taxonomy';
import type { CategoryDef, TagDef } from '../taxonomy';

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

export const getEntries = (
  db: Database,
  opts: { limit: number; offset: number; tag?: string; tagSlugs?: string[]; unreadOnly?: boolean },
): Array<Entry & { feed_title: string; feed_site_url: string }> => {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.unreadOnly) {
    conditions.push('e.is_read = 0');
  }
  if (opts.tag) {
    conditions.push('EXISTS (SELECT 1 FROM entry_tags et JOIN tags t ON et.tag_id = t.id WHERE et.entry_id = e.id AND t.slug = ?)');
    params.push(opts.tag);
  }
  if (opts.tagSlugs && opts.tagSlugs.length > 0) {
    const placeholders = opts.tagSlugs.map(() => '?').join(', ');
    conditions.push(`EXISTS (SELECT 1 FROM entry_tags et JOIN tags t ON et.tag_id = t.id WHERE et.entry_id = e.id AND t.slug IN (${placeholders}))`);
    params.push(...opts.tagSlugs);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(opts.limit, opts.offset);

  return db.query<Entry & { feed_title: string; feed_site_url: string }, unknown[]>(
    `SELECT e.*, f.title as feed_title, f.site_url as feed_site_url
     FROM entries e
     JOIN feeds f ON e.feed_id = f.id
     ${where}
     ORDER BY e.published_at DESC
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

export const setEntryRead = (db: Database, id: EntryId, isRead: boolean): void => {
  db.run('UPDATE entries SET is_read = ? WHERE id = ?', [isRead ? 1 : 0, id]);
};

export const markEntryStarred = (db: Database, id: EntryId, starred: boolean): void => {
  db.run('UPDATE entries SET is_starred = ? WHERE id = ?', [starred ? 1 : 0, id]);
};

export const setEntryThumb = (db: Database, id: EntryId, thumb: 1 | -1 | null): void => {
  db.run('UPDATE entries SET thumb = ? WHERE id = ?', [thumb, id]);
};

// --- Tags ---

export const getAllTags = (db: Database): Tag[] =>
  db.query<Tag, []>('SELECT * FROM tags ORDER BY sort_order ASC, slug ASC').all();

export const getAllTagsWithPreferences = (db: Database): Array<Tag & { mode: string }> =>
  db.query<Tag & { mode: string }, []>(
    `SELECT t.*, COALESCE(tp.mode, 'none') as mode
     FROM tags t
     LEFT JOIN tag_preferences tp ON t.id = tp.tag_id
     ORDER BY t.sort_order ASC, t.slug ASC`
  ).all();

export const getTagById = (db: Database, id: TagId): Tag | null =>
  db.query<Tag, [TagId]>('SELECT * FROM tags WHERE id = ?').get(id);

export const getTagBySlug = (db: Database, slug: string): Tag | null =>
  db.query<Tag, [string]>('SELECT * FROM tags WHERE slug = ?').get(slug);

export const getAllTagSlugs = (db: Database): string[] =>
  db.query<{ slug: string }, []>('SELECT slug FROM tags ORDER BY slug ASC').all().map(r => r.slug);

export const createTag = (
  db: Database,
  slug: string,
  label: string,
  tagGroup: string,
  isBuiltin: boolean,
): TagId => {
  const result = db.run(
    'INSERT INTO tags (slug, label, tag_group, is_builtin) VALUES (?, ?, ?, ?)',
    [slug, label, tagGroup, isBuiltin ? 1 : 0],
  );
  return result.lastInsertRowid as unknown as TagId;
};

export const deleteTag = (db: Database, id: TagId): void => {
  db.run('DELETE FROM tags WHERE id = ?', [id]);
};

export const incrementTagUseCount = (db: Database, tagId: TagId): void => {
  db.run('UPDATE tags SET use_count = use_count + 1 WHERE id = ?', [tagId]);
};

// --- Tag Preferences ---

export const setTagPreference = (db: Database, tagId: TagId, mode: string): void => {
  db.run(
    'INSERT OR REPLACE INTO tag_preferences (tag_id, mode, updated_at) VALUES (?, ?, unixepoch())',
    [tagId, mode],
  );
};

export const getTagPreferences = (db: Database): TagPreference[] =>
  db.query<TagPreference, []>('SELECT * FROM tag_preferences').all();

export const getPreferenceForTag = (db: Database, tagId: TagId): TagPreference | null =>
  db.query<TagPreference, [TagId]>('SELECT * FROM tag_preferences WHERE tag_id = ?').get(tagId);

// --- Entry-Tag Associations ---

export const addEntryTag = (db: Database, entryId: EntryId, tagId: TagId, source: string): void => {
  db.run(
    'INSERT OR IGNORE INTO entry_tags (entry_id, tag_id, source) VALUES (?, ?, ?)',
    [entryId, tagId, source],
  );
};

export const getTagsForEntry = (db: Database, entryId: EntryId): Tag[] =>
  db.query<Tag, [EntryId]>(
    'SELECT t.* FROM tags t JOIN entry_tags et ON t.id = et.tag_id WHERE et.entry_id = ? ORDER BY t.slug ASC',
  ).all(entryId);

export const getTagsForEntries = (
  db: Database,
  entryIds: EntryId[],
): Map<EntryId, Array<{ tag_id: TagId; slug: string; label: string; mode: string }>> => {
  if (entryIds.length === 0) return new Map();

  const placeholders = entryIds.map(() => '?').join(', ');
  const rows = db.query<
    { entry_id: EntryId; tag_id: TagId; slug: string; label: string; mode: string },
    unknown[]
  >(
    `SELECT et.entry_id, t.id as tag_id, t.slug, COALESCE(t.label, t.slug) as label, COALESCE(tp.mode, 'none') as mode
     FROM entry_tags et
     JOIN tags t ON et.tag_id = t.id
     LEFT JOIN tag_preferences tp ON t.id = tp.tag_id
     WHERE et.entry_id IN (${placeholders})
     ORDER BY t.slug ASC`
  ).all(...entryIds);

  const map = new Map<EntryId, Array<{ tag_id: TagId; slug: string; label: string; mode: string }>>();
  for (const row of rows) {
    let list = map.get(row.entry_id);
    if (!list) {
      list = [];
      map.set(row.entry_id, list);
    }
    list.push({ tag_id: row.tag_id, slug: row.slug, label: row.label, mode: row.mode });
  }
  return map;
};

export const getEntriesByTag = (db: Database, tagId: TagId, limit: number, offset: number): Entry[] =>
  db.query<Entry, [TagId, number, number]>(
    'SELECT e.* FROM entries e JOIN entry_tags et ON e.id = et.entry_id WHERE et.tag_id = ? ORDER BY e.published_at DESC LIMIT ? OFFSET ?',
  ).all(tagId, limit, offset);

// --- Starred Entries (Favorites) ---

export const getStarredEntries = (
  db: Database,
  opts: { limit: number; offset: number },
): Array<Entry & { feed_title: string; feed_site_url: string }> =>
  db.query<Entry & { feed_title: string; feed_site_url: string }, [number, number]>(
    `SELECT e.*, f.title as feed_title, f.site_url as feed_site_url
     FROM entries e
     JOIN feeds f ON e.feed_id = f.id
     WHERE e.is_starred = 1
     ORDER BY e.published_at DESC
     LIMIT ? OFFSET ?`,
  ).all(opts.limit, opts.offset);

// --- Dismissed Entries (Trash) ---

export const getDismissedEntries = (
  db: Database,
  opts: { limit: number; offset: number },
): Array<Entry & { feed_title: string; feed_site_url: string }> =>
  db.query<Entry & { feed_title: string; feed_site_url: string }, [number, number]>(
    `SELECT e.*, f.title as feed_title, f.site_url as feed_site_url
     FROM entries e
     JOIN feeds f ON e.feed_id = f.id
     WHERE e.thumb = -1
     ORDER BY e.published_at DESC
     LIMIT ? OFFSET ?`,
  ).all(opts.limit, opts.offset);

// Noise entries: depth_score < 0.15 (auto-filtered from Your Feed unless showNoise is on)
export const getNoiseEntries = (
  db: Database,
  opts: { limit: number; offset: number },
): Array<Entry & { feed_title: string; feed_site_url: string }> =>
  db.query<Entry & { feed_title: string; feed_site_url: string }, [number, number]>(
    `SELECT e.*, f.title as feed_title, f.site_url as feed_site_url
     FROM entries e
     JOIN feeds f ON e.feed_id = f.id
     WHERE e.depth_score IS NOT NULL AND e.depth_score < 0.15
       AND (e.thumb IS NULL OR e.thumb != -1)
     ORDER BY e.published_at DESC
     LIMIT ? OFFSET ?`,
  ).all(opts.limit, opts.offset);

// --- Thumbed Entry Embeddings (for preference vector) ---

export const getThumbedEntryEmbeddings = (
  db: Database,
): Array<{ id: EntryId; embedding: Buffer; thumb: number }> =>
  db.query<{ id: EntryId; embedding: Buffer; thumb: number }, []>(
    'SELECT id, embedding, thumb FROM entries WHERE thumb IS NOT NULL AND embedding IS NOT NULL ORDER BY published_at DESC',
  ).all();

// --- Entry Visibility ---
// An entry is visible if:
//   - It has ≥1 tag with mode='whitelist' (follow always wins)
//   - OR it has zero tags with mode='blacklist' (no muted tags = show)
//   - OR it has no tags at all (untagged = show)
// Hidden if:
//   - It has ≥1 tag with mode='blacklist' AND zero tags with mode='whitelist'
//   - OR it has thumb = -1 (dismissed)

export const getVisibleEntries = (
  db: Database,
  opts: { limit: number; offset: number; unreadOnly?: boolean; showNoise?: boolean; tagSlugs?: string[] },
): Array<Entry & { feed_title: string; feed_site_url: string }> => {
  const NOISE_THRESHOLD = 0.15;

  const conditions: string[] = [
    // Exclude thumb-down entries
    '(e.thumb IS NULL OR e.thumb != -1)',
    // Follow/mute filtering
    `(
      NOT EXISTS (SELECT 1 FROM entry_tags WHERE entry_id = e.id)
      OR EXISTS (
        SELECT 1 FROM entry_tags et
        JOIN tag_preferences tp ON et.tag_id = tp.tag_id
        WHERE et.entry_id = e.id AND tp.mode = 'whitelist'
      )
      OR NOT EXISTS (
        SELECT 1 FROM entry_tags et
        JOIN tag_preferences tp ON et.tag_id = tp.tag_id
        WHERE et.entry_id = e.id AND tp.mode = 'blacklist'
      )
    )`,
  ];
  const params: unknown[] = [];

  if (opts.unreadOnly) {
    conditions.push('e.is_read = 0');
  }

  if (opts.tagSlugs && opts.tagSlugs.length > 0) {
    const placeholders = opts.tagSlugs.map(() => '?').join(', ');
    conditions.push(`EXISTS (SELECT 1 FROM entry_tags et JOIN tags t ON et.tag_id = t.id WHERE et.entry_id = e.id AND t.slug IN (${placeholders}))`);
    params.push(...opts.tagSlugs);
  }

  // Hide noise entries unless explicitly requested
  if (!opts.showNoise) {
    conditions.push(`(e.depth_score IS NULL OR e.depth_score >= ${NOISE_THRESHOLD})`);
  }

  params.push(opts.limit, opts.offset);

  return db.query<Entry & { feed_title: string; feed_site_url: string }, unknown[]>(
    `SELECT e.*, f.title as feed_title, f.site_url as feed_site_url
     FROM entries e
     JOIN feeds f ON e.feed_id = f.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY
       CASE WHEN e.published_at >= unixepoch() - 172800 AND EXISTS (
         SELECT 1 FROM entry_tags et
         JOIN tag_preferences tp ON et.tag_id = tp.tag_id
         WHERE et.entry_id = e.id AND tp.mode = 'whitelist'
       ) THEN 0 ELSE 1 END,
       (COALESCE(e.relevance_score, 0) * 0.85 + COALESCE(e.depth_score, 0.5) * 0.15) DESC,
       e.published_at DESC
     LIMIT ? OFFSET ?`,
  ).all(...params);
};

// --- Untagged Entries ---

export const getUntaggedEntryIds = (db: Database, limit: number): EntryId[] =>
  db.query<{ id: EntryId }, [number]>(
    'SELECT id FROM entries WHERE tagged_at IS NULL ORDER BY published_at DESC LIMIT ?',
  ).all(limit).map(r => r.id);

export const markEntryTagged = (db: Database, id: EntryId): void => {
  db.run('UPDATE entries SET tagged_at = unixepoch() WHERE id = ?', [id]);
};

// --- Config ---

export const getConfig = (db: Database, key: string): string | null => {
  const row = db.query<{ value: string }, [string]>('SELECT value FROM config WHERE key = ?').get(key);
  return row?.value ?? null;
};

export const setConfig = (db: Database, key: string, value: string): void => {
  db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', [key, value]);
};

// --- Stats ---

export const getStats = (db: Database): {
  total_feeds: number;
  total_entries: number;
  unread_entries: number;
  tagged_entries: number;
  pending_jobs: number;
} => {
  const total_feeds = db.query<{ c: number }, []>('SELECT COUNT(*) as c FROM feeds').get()!.c;
  const total_entries = db.query<{ c: number }, []>('SELECT COUNT(*) as c FROM entries').get()!.c;
  const unread_entries = db.query<{ c: number }, []>('SELECT COUNT(*) as c FROM entries WHERE is_read = 0').get()!.c;
  const tagged_entries = db.query<{ c: number }, []>('SELECT COUNT(*) as c FROM entries WHERE tagged_at IS NOT NULL').get()!.c;
  const pending_jobs = db.query<{ c: number }, []>("SELECT COUNT(*) as c FROM jobs WHERE status = 'pending'").get()!.c;
  return { total_feeds, total_entries, unread_entries, tagged_entries, pending_jobs };
};

// --- Feeds with stats (for /api/feeds) ---

export const getFeedsWithStats = (db: Database): FeedWithStats[] =>
  db.query<FeedWithStats, []>(
    `SELECT f.*,
       (SELECT COUNT(*) FROM entries e WHERE e.feed_id = f.id) as entry_count,
       (SELECT COUNT(*) FROM entries e WHERE e.feed_id = f.id AND e.is_read = 0) as unread_count
     FROM feeds f ORDER BY f.title ASC`
  ).all();

// --- Dashboard ---

export interface DashboardFeedRow extends FeedWithStats {
  readonly tagged_count: number;
}

export const getDashboardFeedStats = (db: Database): DashboardFeedRow[] =>
  db.query<DashboardFeedRow, []>(
    `SELECT f.*,
       COUNT(e.id) as entry_count,
       SUM(CASE WHEN e.is_read = 0 THEN 1 ELSE 0 END) as unread_count,
       SUM(CASE WHEN e.tagged_at IS NOT NULL THEN 1 ELSE 0 END) as tagged_count
     FROM feeds f
     LEFT JOIN entries e ON e.feed_id = f.id
     GROUP BY f.id
     ORDER BY f.title ASC`
  ).all();

export interface IndexingStats {
  readonly pending_entries: number;
  readonly running_jobs: number;
  readonly completed_last_hour: number;
  readonly avg_batch_duration_sec: number | null;
  readonly entries_per_minute: number | null;
}

export const getIndexingStats = (db: Database): IndexingStats => {
  const pending_entries = db.query<{ c: number }, []>(
    'SELECT COUNT(*) as c FROM entries WHERE tagged_at IS NULL'
  ).get()!.c;

  const running_jobs = db.query<{ c: number }, []>(
    "SELECT COUNT(*) as c FROM jobs WHERE status = 'running'"
  ).get()!.c;

  const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;

  const recentBatches = db.query<{ c: number; total_dur: number }, [number]>(
    `SELECT COUNT(*) as c, COALESCE(SUM(completed_at - started_at), 0) as total_dur
     FROM jobs
     WHERE type = 'tag_batch' AND status = 'done' AND completed_at > ?`,
  ).get(oneHourAgo)!;

  const completed_last_hour = recentBatches.c;
  const avg_batch_duration_sec = completed_last_hour > 0
    ? Math.round(recentBatches.total_dur / completed_last_hour)
    : null;

  // Each tag_batch processes up to 64 entries. Derive entries/min from batch throughput.
  const entries_per_minute = (avg_batch_duration_sec && avg_batch_duration_sec > 0)
    ? Math.round((64 / avg_batch_duration_sec) * 60 * 10) / 10
    : null;

  return { pending_entries, running_jobs, completed_last_hour, avg_batch_duration_sec, entries_per_minute };
};

// --- Built-in Category & Tag Seeding ---

// Seeds categories first, then tags. Both are defined in taxonomy.ts.
// Two-axis taxonomy:
//   topic (~300+ tags, organized into 22 categories): answer "what is this about?"
//   signal (~14 tags, no category): answer "what kind of content is this?"
// Each tag has a rich description optimized for embedding similarity.
// Categories enable two-pass tagging for disambiguation.

export const seedBuiltinCategories = (db: Database): number => {
  const count = db.query<{ c: number }, []>('SELECT COUNT(*) as c FROM categories').get()!.c;
  if (count > 0) return 0;

  const stmt = db.prepare(
    'INSERT INTO categories (slug, label, description, sort_order) VALUES (?, ?, ?, ?)',
  );

  const insertAll = db.transaction(() => {
    for (const cat of BUILTIN_CATEGORIES) {
      stmt.run(cat.slug, cat.label, cat.description, cat.sort_order);
    }
    return BUILTIN_CATEGORIES.length;
  });

  return insertAll();
};

export const seedBuiltinTags = (db: Database): number => {
  const count = db.query<{ c: number }, []>('SELECT COUNT(*) as c FROM tags').get()!.c;
  if (count > 0) return 0;

  // Ensure categories exist first (tags have a FK to categories)
  seedBuiltinCategories(db);

  const stmt = db.prepare(
    'INSERT INTO tags (slug, label, description, tag_group, category_slug, is_builtin, use_count, sort_order) VALUES (?, ?, ?, ?, ?, 1, 0, ?)',
  );

  const insertAll = db.transaction(() => {
    for (const tag of BUILTIN_TAGS) {
      stmt.run(tag.slug, tag.label, tag.description, tag.tag_group, tag.category_slug, tag.sort_order);
    }
    return BUILTIN_TAGS.length;
  });

  return insertAll();
};

// --- Embedding Queries ---

export const EMBEDDING_DIM = 768;
export const EMBEDDING_BYTES = EMBEDDING_DIM * 4; // Float32 = 4 bytes

export const getTagsWithoutEmbeddings = (db: Database): Array<Tag & { description: string }> =>
  db.query<Tag & { description: string }, []>(
    'SELECT * FROM tags WHERE embedding IS NULL AND description IS NOT NULL ORDER BY sort_order ASC',
  ).all();

export const setTagEmbedding = (db: Database, tagId: TagId, embedding: Buffer): void => {
  if (embedding.byteLength !== EMBEDDING_BYTES) {
    throw new Error(`Tag embedding must be exactly ${EMBEDDING_BYTES} bytes, got ${embedding.byteLength}`);
  }
  db.run('UPDATE tags SET embedding = ? WHERE id = ?', [embedding, tagId]);
};

export const getAllTagEmbeddings = (db: Database): Array<{ id: TagId; slug: string; tag_group: string; category_slug: string | null; embedding: Buffer }> =>
  db.query<{ id: TagId; slug: string; tag_group: string; category_slug: string | null; embedding: Buffer }, []>(
    'SELECT id, slug, tag_group, category_slug, embedding FROM tags WHERE embedding IS NOT NULL',
  ).all();

// --- Category Embedding Queries ---

export const getCategoriesWithoutEmbeddings = (db: Database): Array<Category & { description: string }> =>
  db.query<Category & { description: string }, []>(
    'SELECT * FROM categories WHERE embedding IS NULL AND description IS NOT NULL ORDER BY sort_order ASC',
  ).all();

export const setCategoryEmbedding = (db: Database, categoryId: CategoryId, embedding: Buffer): void => {
  if (embedding.byteLength !== EMBEDDING_BYTES) {
    throw new Error(`Category embedding must be exactly ${EMBEDDING_BYTES} bytes, got ${embedding.byteLength}`);
  }
  db.run('UPDATE categories SET embedding = ? WHERE id = ?', [embedding, categoryId]);
};

export const getAllCategoryEmbeddings = (db: Database): Array<{ id: CategoryId; slug: string; embedding: Buffer }> =>
  db.query<{ id: CategoryId; slug: string; embedding: Buffer }, []>(
    'SELECT id, slug, embedding FROM categories WHERE embedding IS NOT NULL ORDER BY sort_order ASC',
  ).all();

export const getAllCategories = (db: Database): Category[] =>
  db.query<Category, []>('SELECT * FROM categories ORDER BY sort_order ASC').all();

export const setEntryEmbedding = (db: Database, entryId: EntryId, embedding: Buffer): void => {
  if (embedding.byteLength !== EMBEDDING_BYTES) {
    throw new Error(`Entry embedding must be exactly ${EMBEDDING_BYTES} bytes, got ${embedding.byteLength}`);
  }
  db.run('UPDATE entries SET embedding = ? WHERE id = ?', [embedding, entryId]);
};

export const setEntryRelevanceScore = (db: Database, entryId: EntryId, score: number): void => {
  db.run('UPDATE entries SET relevance_score = ? WHERE id = ?', [score, entryId]);
};

export const setEntryDepthScore = (db: Database, id: EntryId, score: number): void => {
  db.run('UPDATE entries SET depth_score = ? WHERE id = ?', [score, id]);
};

export const getUntaggedEntries = (db: Database, limit: number): Array<Entry & { feed_title: string }> =>
  db.query<Entry & { feed_title: string }, [number]>(
    `SELECT e.*, f.title as feed_title
     FROM entries e
     JOIN feeds f ON e.feed_id = f.id
     WHERE e.tagged_at IS NULL
     ORDER BY e.published_at DESC
     LIMIT ?`,
  ).all(limit);

export const getStarredEntryEmbeddings = (db: Database): Array<{ id: EntryId; embedding: Buffer; is_starred: number }> =>
  db.query<{ id: EntryId; embedding: Buffer; is_starred: number }, []>(
    'SELECT id, embedding, is_starred FROM entries WHERE is_starred = 1 AND embedding IS NOT NULL ORDER BY published_at DESC',
  ).all();

export const getEntriesWithEmbeddings = (db: Database, limit: number, offset: number): Array<{ id: EntryId; embedding: Buffer }> =>
  db.query<{ id: EntryId; embedding: Buffer }, [number, number]>(
    'SELECT id, embedding FROM entries WHERE embedding IS NOT NULL ORDER BY published_at DESC LIMIT ? OFFSET ?',
  ).all(limit, offset);

export const bulkUpdateRelevanceScores = (db: Database, scores: Array<{ id: EntryId; score: number }>): void => {
  const stmt = db.prepare('UPDATE entries SET relevance_score = ? WHERE id = ?');
  const updateAll = db.transaction(() => {
    for (const { id, score } of scores) {
      stmt.run(score, id);
    }
  });
  updateAll();
};

export const clearEntryEmbeddingTags = (db: Database, entryId: EntryId): void => {
  db.run("DELETE FROM entry_tags WHERE entry_id = ? AND source = 'embedding'", [entryId]);
};

export const rebuildTagUseCounts = (db: Database): void => {
  db.run(`UPDATE tags SET use_count = (
    SELECT COUNT(*) FROM entry_tags WHERE tag_id = tags.id
  )`);
};

// --- Reader View: Extractive Summarization + Content Extraction ---

export const updateEntrySummary = (
  db: Database,
  id: EntryId,
  extractiveSummary: string,
  wc: number,
): void => {
  db.run(
    'UPDATE entries SET extractive_summary = ?, word_count = ? WHERE id = ?',
    [extractiveSummary, wc, id],
  );
};

export const getEntryContent = (
  db: Database,
  id: EntryId,
): { url: string; content_full: string | null; content_html: string; extracted_at: number | null } | null =>
  db.query<{ url: string; content_full: string | null; content_html: string; extracted_at: number | null }, [EntryId]>(
    'SELECT url, content_full, content_html, extracted_at FROM entries WHERE id = ?',
  ).get(id);

export const updateEntryContent = (
  db: Database,
  id: EntryId,
  contentFull: string,
): void => {
  db.run(
    'UPDATE entries SET content_full = ?, extracted_at = unixepoch() WHERE id = ?',
    [contentFull, id],
  );
};

export const clearExpiredContent = (db: Database, days: number): number => {
  const result = db.run(
    'UPDATE entries SET content_full = NULL, extracted_at = NULL WHERE extracted_at IS NOT NULL AND extracted_at < unixepoch() - (? * 86400)',
    [days],
  );
  return result.changes;
};

// --- Starter Feed Seeding ---

const STARTER_FEEDS: ReadonlyArray<{ url: string; title: string }> = [
  // World News / Geopolitics
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', title: 'BBC World News' },
  { url: 'https://www.aljazeera.com/xml/rss/all.xml', title: 'Al Jazeera' },
  { url: 'https://www.theguardian.com/world/rss', title: 'The Guardian World' },
  { url: 'https://feeds.npr.org/1001/rss.xml', title: 'NPR News' },
  { url: 'https://www.reddit.com/r/worldnews/top/.rss?t=day', title: 'r/worldnews' },
  // Markets / Finance
  { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', title: 'CNBC Top News' },
  { url: 'https://finance.yahoo.com/news/rssindex', title: 'Yahoo Finance' },
  { url: 'https://feeds.bloomberg.com/markets/news.rss', title: 'Bloomberg Markets' },
  { url: 'https://feeds.marketwatch.com/marketwatch/topstories/', title: 'MarketWatch' },
  { url: 'https://www.ft.com/rss/home', title: 'Financial Times' },
  // Engineering / Programming
  { url: 'https://hnrss.org/best', title: 'Hacker News Best' },
  { url: 'https://www.reddit.com/r/programming/top/.rss?t=day', title: 'r/programming' },
  { url: 'https://dev.to/feed', title: 'DEV.to' },
  { url: 'https://lobste.rs/rss', title: 'Lobsters' },
  { url: 'https://blog.pragmaticengineer.com/rss/', title: 'Pragmatic Engineer' },
  // Science
  { url: 'https://www.nature.com/nature.rss', title: 'Nature' },
  { url: 'https://www.reddit.com/r/science/.rss', title: 'r/science' },
  // Technology / Gadgets
  { url: 'https://feeds.arstechnica.com/arstechnica/index', title: 'Ars Technica' },
  { url: 'https://www.theverge.com/rss/index.xml', title: 'The Verge' },
  { url: 'https://techcrunch.com/feed/', title: 'TechCrunch' },
  { url: 'https://www.wired.com/feed/rss', title: 'Wired' },
  { url: 'https://www.tomshardware.com/feeds/all', title: "Tom's Hardware" },
  { url: 'https://www.reddit.com/r/technology/.rss', title: 'r/technology' },
  { url: 'https://feeds.feedburner.com/venturebeat/SZYF', title: 'VentureBeat' },
  // Gaming
  { url: 'https://www.rockpapershotgun.com/feed', title: 'Rock Paper Shotgun' },
  { url: 'https://www.gamespot.com/feeds/mashup/', title: 'GameSpot' },
  { url: 'https://feeds.feedburner.com/ign/all', title: 'IGN' },
  { url: 'https://www.reddit.com/r/gamedeals/.rss', title: 'r/GameDeals' },
  // Space / Astronomy
  { url: 'https://www.nasa.gov/feed/', title: 'NASA' },
  { url: 'https://spacenews.com/feed/', title: 'SpaceNews' },
  { url: 'https://www.space.com/feeds/all', title: 'Space.com' },
  // Culture / Arts
  { url: 'https://hyperallergic.com/feed/', title: 'Hyperallergic' },
  { url: 'https://www.designboom.com/feed/', title: 'Designboom' },
  { url: 'https://www.dezeen.com/feed/', title: 'Dezeen' },
  { url: 'https://www.archdaily.com/feed', title: 'ArchDaily' },
  { url: 'https://www.creativebloq.com/feeds/all', title: 'Creative Bloq' },
  { url: 'https://petapixel.com/feed/', title: 'PetaPixel' },
  // Long Reads / Deep Dives
  { url: 'https://longreads.com/feed/', title: 'Longreads' },
  { url: 'https://www.theatlantic.com/feed/all/', title: 'The Atlantic' },
  // Security / Privacy
  { url: 'https://krebsonsecurity.com/feed/', title: 'Krebs on Security' },
  { url: 'https://www.schneier.com/feed/', title: 'Schneier on Security' },
  // AI / Machine Learning
  { url: 'https://www.reddit.com/r/MachineLearning/.rss', title: 'r/MachineLearning' },
  // Open Source
  { url: 'https://github.blog/feed/', title: 'GitHub Blog' },
  // Apple / iOS
  { url: 'https://9to5mac.com/feed/', title: '9to5Mac' },
  // Android / Mobile
  { url: 'https://www.androidauthority.com/feed/', title: 'Android Authority' },
  // Sports
  { url: 'https://feeds.bbci.co.uk/sport/rss.xml', title: 'BBC Sport' },
  { url: 'https://www.theguardian.com/uk/sport/rss', title: 'The Guardian Sport' },
  { url: 'https://www.espn.com/espn/rss/news', title: 'ESPN' },
  // Music
  { url: 'https://pitchfork.com/feed/feed-news/rss', title: 'Pitchfork' },
  { url: 'https://www.stereogum.com/feed/', title: 'Stereogum' },
  { url: 'https://consequenceofsound.net/feed/', title: 'Consequence of Sound' },
  { url: 'https://www.reddit.com/r/music/.rss', title: 'r/Music' },
  // Movies / Entertainment
  { url: 'https://www.hollywoodreporter.com/feed/', title: 'Hollywood Reporter' },
  { url: 'https://variety.com/feed/', title: 'Variety' },
  { url: 'https://www.indiewire.com/feed/', title: 'IndieWire' },
  { url: 'https://www.slashfilm.com/feed/', title: 'SlashFilm' },
  { url: 'https://collider.com/feed/', title: 'Collider' },
  { url: 'https://www.reddit.com/r/movies/.rss', title: 'r/movies' },
  // Fashion / Style
  { url: 'https://www.vogue.com/feed/rss', title: 'Vogue' },
  { url: 'https://fashionista.com/feed', title: 'Fashionista' },
  { url: 'https://www.highsnobiety.com/feed/', title: 'Highsnobiety' },
  // Environment / Climate
  { url: 'https://grist.org/feed/', title: 'Grist' },
  { url: 'https://insideclimatenews.org/feed/', title: 'Inside Climate News' },
  // Health / Medicine
  { url: 'https://www.statnews.com/feed/', title: 'STAT News' },
];

export const STARTER_FEED_COUNT = STARTER_FEEDS.length;

export const seedStarterFeeds = (db: Database): number => {
  const count = db.query<{ c: number }, []>('SELECT COUNT(*) as c FROM feeds').get()!.c;
  if (count > 0) return 0;

  const stmt = db.prepare(
    'INSERT OR IGNORE INTO feeds (url, title) VALUES (?, ?)',
  );

  const insertAll = db.transaction(() => {
    for (const feed of STARTER_FEEDS) {
      stmt.run(feed.url, feed.title);
    }
    return STARTER_FEEDS.length;
  });

  return insertAll();
};
