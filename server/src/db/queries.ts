import { Database } from 'bun:sqlite';
import type {
  Feed, FeedId, Entry, EntryId, Tag, TagId, TagPreference, FeedWithStats,
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

export const getEntries = (
  db: Database,
  opts: { limit: number; offset: number; tag?: string; unreadOnly?: boolean },
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

export const markEntryStarred = (db: Database, id: EntryId, starred: boolean): void => {
  db.run('UPDATE entries SET is_starred = ? WHERE id = ?', [starred ? 1 : 0, id]);
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
): Map<EntryId, Array<{ slug: string; label: string; mode: string }>> => {
  if (entryIds.length === 0) return new Map();

  const placeholders = entryIds.map(() => '?').join(', ');
  const rows = db.query<
    { entry_id: EntryId; slug: string; label: string; mode: string },
    unknown[]
  >(
    `SELECT et.entry_id, t.slug, COALESCE(t.label, t.slug) as label, COALESCE(tp.mode, 'none') as mode
     FROM entry_tags et
     JOIN tags t ON et.tag_id = t.id
     LEFT JOIN tag_preferences tp ON t.id = tp.tag_id
     WHERE et.entry_id IN (${placeholders})
     ORDER BY t.slug ASC`
  ).all(...entryIds);

  const map = new Map<EntryId, Array<{ slug: string; label: string; mode: string }>>();
  for (const row of rows) {
    let list = map.get(row.entry_id);
    if (!list) {
      list = [];
      map.set(row.entry_id, list);
    }
    list.push({ slug: row.slug, label: row.label, mode: row.mode });
  }
  return map;
};

export const getEntriesByTag = (db: Database, tagId: TagId, limit: number, offset: number): Entry[] =>
  db.query<Entry, [TagId, number, number]>(
    'SELECT e.* FROM entries e JOIN entry_tags et ON e.id = et.entry_id WHERE et.tag_id = ? ORDER BY e.published_at DESC LIMIT ? OFFSET ?',
  ).all(tagId, limit, offset);

// --- Entry Visibility ---
// An entry is visible if:
//   - It has no tags in entry_tags (untagged or tagged_at IS NULL)
//   - OR at least one of its tags is NOT blacklisted (whitelist, none, or no preference)
// Hidden only if ALL tags are blacklisted.

export const getVisibleEntries = (
  db: Database,
  opts: { limit: number; offset: number; unreadOnly?: boolean },
): Array<Entry & { feed_title: string; feed_site_url: string }> => {
  const conditions: string[] = [
    `(NOT EXISTS (SELECT 1 FROM entry_tags WHERE entry_id = e.id)
     OR EXISTS (
       SELECT 1 FROM entry_tags et
       LEFT JOIN tag_preferences tp ON et.tag_id = tp.tag_id
       WHERE et.entry_id = e.id AND (tp.mode IS NULL OR tp.mode != 'blacklist')
     ))`,
  ];
  const params: unknown[] = [];

  if (opts.unreadOnly) {
    conditions.push('e.is_read = 0');
  }

  params.push(opts.limit, opts.offset);

  return db.query<Entry & { feed_title: string; feed_site_url: string }, unknown[]>(
    `SELECT e.*, f.title as feed_title, f.site_url as feed_site_url
     FROM entries e
     JOIN feeds f ON e.feed_id = f.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY e.published_at DESC
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

// --- Built-in Tag Seeding ---

const BUILTIN_TAGS: ReadonlyArray<{ slug: string; label: string; tag_group: string; sort_order: number }> = [
  { slug: 'politics', label: 'Politics', tag_group: 'news', sort_order: 1 },
  { slug: 'geopolitics', label: 'Geopolitics', tag_group: 'news', sort_order: 2 },
  { slug: 'war-conflict', label: 'War & Conflict', tag_group: 'news', sort_order: 3 },
  { slug: 'economics', label: 'Economics', tag_group: 'news', sort_order: 4 },
  { slug: 'environment', label: 'Environment & Climate', tag_group: 'news', sort_order: 5 },
  { slug: 'health', label: 'Health & Medicine', tag_group: 'news', sort_order: 6 },
  { slug: 'programming', label: 'Programming', tag_group: 'tech', sort_order: 7 },
  { slug: 'technology', label: 'Technology', tag_group: 'tech', sort_order: 8 },
  { slug: 'gadgets', label: 'Gadgets & Hardware', tag_group: 'tech', sort_order: 9 },
  { slug: 'ai-ml', label: 'AI & Machine Learning', tag_group: 'tech', sort_order: 10 },
  { slug: 'cybersecurity', label: 'Cybersecurity', tag_group: 'tech', sort_order: 11 },
  { slug: 'open-source', label: 'Open Source', tag_group: 'tech', sort_order: 12 },
  { slug: 'apple', label: 'Apple / iOS', tag_group: 'tech', sort_order: 13 },
  { slug: 'android', label: 'Android / Mobile', tag_group: 'tech', sort_order: 14 },
  { slug: 'startups', label: 'Startups & VC', tag_group: 'tech', sort_order: 15 },
  { slug: 'crypto', label: 'Crypto & Web3', tag_group: 'tech', sort_order: 16 },
  { slug: 'science', label: 'Science', tag_group: 'science', sort_order: 17 },
  { slug: 'space', label: 'Space & Astronomy', tag_group: 'science', sort_order: 18 },
  { slug: 'sports', label: 'Sports', tag_group: 'sports', sort_order: 19 },
  { slug: 'gaming', label: 'Gaming', tag_group: 'culture', sort_order: 20 },
  { slug: 'movies-tv', label: 'Movies & TV', tag_group: 'culture', sort_order: 21 },
  { slug: 'music', label: 'Music', tag_group: 'culture', sort_order: 22 },
  { slug: 'celebrity', label: 'Celebrity', tag_group: 'culture', sort_order: 23 },
  { slug: 'fashion', label: 'Fashion & Style', tag_group: 'culture', sort_order: 24 },
  { slug: 'food', label: 'Food & Drink', tag_group: 'culture', sort_order: 25 },
  { slug: 'travel', label: 'Travel', tag_group: 'culture', sort_order: 26 },
  { slug: 'opinion', label: 'Opinion & Editorial', tag_group: 'meta', sort_order: 27 },
  { slug: 'tutorial', label: 'Tutorial & How-to', tag_group: 'meta', sort_order: 28 },
  { slug: 'long-read', label: 'Long Read', tag_group: 'meta', sort_order: 29 },
  { slug: 'humor', label: 'Humor', tag_group: 'meta', sort_order: 30 },
  { slug: 'press-release', label: 'Press Release', tag_group: 'meta', sort_order: 31 },
  { slug: 'deals', label: 'Deals & Sales', tag_group: 'meta', sort_order: 32 },
];

export const seedBuiltinTags = (db: Database): number => {
  const count = db.query<{ c: number }, []>('SELECT COUNT(*) as c FROM tags').get()!.c;
  if (count > 0) return 0;

  const stmt = db.prepare(
    'INSERT INTO tags (slug, label, tag_group, is_builtin, use_count, sort_order) VALUES (?, ?, ?, 1, 0, ?)',
  );

  const insertAll = db.transaction(() => {
    for (const tag of BUILTIN_TAGS) {
      stmt.run(tag.slug, tag.label, tag.tag_group, tag.sort_order);
    }
    return BUILTIN_TAGS.length;
  });

  return insertAll();
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
