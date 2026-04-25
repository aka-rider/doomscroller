import { describe, test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import * as q from '../db/queries';
import {
  createTestDb, insertTestFeed, insertTestEntry, insertTestCategory, insertTestScore,
} from '../test-utils';
import type { FeedId, EntryId, CategoryId } from '../types';

// ============================================================================
// GATE 6: Database Queries — the source of truth
// Every query here touches SQLite directly. We test with real databases,
// real schemas, real data. No mocking. If these pass, the database layer works.
// ============================================================================

describe('Feed queries', () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  test('insertFeed + getFeedById round-trips', () => {
    const id = q.insertFeed(db, 'https://example.com/feed.xml', 'Example', 'https://example.com');
    const feed = q.getFeedById(db, id);

    expect(feed).not.toBeNull();
    expect(feed!.url).toBe('https://example.com/feed.xml');
    expect(feed!.title).toBe('Example');
    expect(feed!.site_url).toBe('https://example.com');
    expect(feed!.is_active).toBe(1);
    expect(feed!.error_count).toBe(0);
  });

  test('getFeedByUrl finds feed by URL', () => {
    q.insertFeed(db, 'https://unique.com/feed', 'Unique', '');
    const feed = q.getFeedByUrl(db, 'https://unique.com/feed');
    expect(feed).not.toBeNull();
    expect(feed!.title).toBe('Unique');
  });

  test('getFeedByUrl returns null for unknown URL', () => {
    expect(q.getFeedByUrl(db, 'https://nope.com')).toBeNull();
  });

  test('getAllFeeds returns feeds sorted by title', () => {
    q.insertFeed(db, 'https://z.com/feed', 'Zebra', '');
    q.insertFeed(db, 'https://a.com/feed', 'Alpha', '');

    const feeds = q.getAllFeeds(db);
    expect(feeds.length).toBe(2);
    expect(feeds[0]!.title).toBe('Alpha');
    expect(feeds[1]!.title).toBe('Zebra');
  });

  test('getActiveFeedIds returns only active feeds', () => {
    const active = insertTestFeed(db);
    const inactive = insertTestFeed(db);
    db.run('UPDATE feeds SET is_active = 0 WHERE id = ?', [inactive]);

    const ids = q.getActiveFeedIds(db);
    expect(ids).toContain(active);
    expect(ids).not.toContain(inactive);
  });

  test('updateFeedAfterFetch clears errors and sets timestamp', () => {
    const id = insertTestFeed(db);
    q.updateFeedError(db, id, 'previous error');

    q.updateFeedAfterFetch(db, id, '"new-etag"', 'Mon, 01 Jan 2024', 'New Title');

    const feed = q.getFeedById(db, id)!;
    expect(feed.etag).toBe('"new-etag"');
    expect(feed.last_modified).toBe('Mon, 01 Jan 2024');
    expect(feed.title).toBe('New Title');
    expect(feed.error_count).toBe(0);
    expect(feed.last_error).toBeNull();
    expect(feed.last_fetched_at).not.toBeNull();
  });

  test('updateFeedAfterFetch does not overwrite title with empty string', () => {
    const id = q.insertFeed(db, 'https://t.co/feed', 'Original Title', '');
    q.updateFeedAfterFetch(db, id, null, null, '');

    const feed = q.getFeedById(db, id)!;
    expect(feed.title).toBe('Original Title');
  });

  test('updateFeedError increments error_count', () => {
    const id = insertTestFeed(db);
    q.updateFeedError(db, id, 'first');
    q.updateFeedError(db, id, 'second');

    const feed = q.getFeedById(db, id)!;
    expect(feed.error_count).toBe(2);
    expect(feed.last_error).toBe('second');
  });

  test('deleteFeed cascades to entries', () => {
    const feedId = insertTestFeed(db);
    insertTestEntry(db, feedId);
    insertTestEntry(db, feedId);

    q.deleteFeed(db, feedId);

    expect(q.getFeedById(db, feedId)).toBeNull();
    const entries = db.query('SELECT * FROM entries WHERE feed_id = ?').all(feedId);
    expect(entries).toHaveLength(0);
  });
});

describe('Entry queries', () => {
  let db: Database;
  let feedId: FeedId;

  beforeEach(() => {
    db = createTestDb();
    feedId = insertTestFeed(db);
  });

  test('insertEntry returns EntryId on success', () => {
    const id = q.insertEntry(db, {
      feed_id: feedId,
      guid: 'unique-guid',
      url: 'https://t.co/1',
      title: 'Test',
      author: 'Me',
      content_html: '<p>Hello</p>',
      summary: 'Hello',
      image_url: null,
      published_at: 1704110400,
    });

    expect(id).not.toBeNull();
    expect(typeof id).toBe('number');
  });

  test('insertEntry returns null on duplicate guid (dedup)', () => {
    const entry = {
      feed_id: feedId,
      guid: 'dupe-guid',
      url: 'https://t.co/1',
      title: 'First',
      author: '',
      content_html: '',
      summary: '',
      image_url: null,
      published_at: null,
    };

    const first = q.insertEntry(db, entry);
    const second = q.insertEntry(db, { ...entry, title: 'Second attempt' });

    expect(first).not.toBeNull();
    expect(second).toBeNull(); // dedup by (feed_id, guid)
  });

  test('dedup is per-feed — same guid in different feeds is allowed', () => {
    const feed2 = insertTestFeed(db);

    const e1 = q.insertEntry(db, {
      feed_id: feedId,
      guid: 'shared-guid',
      url: '', title: '', author: '', content_html: '', summary: '',
      image_url: null, published_at: null,
    });

    const e2 = q.insertEntry(db, {
      feed_id: feed2,
      guid: 'shared-guid',
      url: '', title: '', author: '', content_html: '', summary: '',
      image_url: null, published_at: null,
    });

    expect(e1).not.toBeNull();
    expect(e2).not.toBeNull();
    expect(e1).not.toBe(e2);
  });

  test('getEntryById returns the entry', () => {
    const id = insertTestEntry(db, feedId, { title: 'Find Me' });
    const entry = q.getEntryById(db, id);

    expect(entry).not.toBeNull();
    expect(entry!.title).toBe('Find Me');
    expect(entry!.feed_id).toBe(feedId);
  });

  test('markEntryRead sets is_read to 1', () => {
    const id = insertTestEntry(db, feedId);
    expect(q.getEntryById(db, id)!.is_read).toBe(0);

    q.markEntryRead(db, id);
    expect(q.getEntryById(db, id)!.is_read).toBe(1);
  });

  test('markEntryStarred toggles is_starred', () => {
    const id = insertTestEntry(db, feedId);

    q.markEntryStarred(db, id, true);
    expect(q.getEntryById(db, id)!.is_starred).toBe(1);

    q.markEntryStarred(db, id, false);
    expect(q.getEntryById(db, id)!.is_starred).toBe(0);
  });

  test('markEntryHidden sets is_hidden to 1', () => {
    const id = insertTestEntry(db, feedId);

    q.markEntryHidden(db, id);
    expect(q.getEntryById(db, id)!.is_hidden).toBe(1);
  });

  test('getEntriesByFeed returns entries in published_at DESC order', () => {
    insertTestEntry(db, feedId, { title: 'Old', published_at: 1000 });
    insertTestEntry(db, feedId, { title: 'New', published_at: 2000 });

    const entries = q.getEntriesByFeed(db, feedId, 10, 0);
    expect(entries.length).toBe(2);
    expect(entries[0]!.title).toBe('New');
    expect(entries[1]!.title).toBe('Old');
  });

  test('getEntriesByFeed respects limit and offset', () => {
    for (let i = 0; i < 10; i++) {
      insertTestEntry(db, feedId, { published_at: 1000 + i });
    }

    const page1 = q.getEntriesByFeed(db, feedId, 3, 0);
    const page2 = q.getEntriesByFeed(db, feedId, 3, 3);

    expect(page1).toHaveLength(3);
    expect(page2).toHaveLength(3);
    // No overlap
    const ids1 = page1.map(e => e.id);
    const ids2 = page2.map(e => e.id);
    expect(ids1.filter(id => ids2.includes(id))).toHaveLength(0);
  });
});

describe('Unscored entries query', () => {
  let db: Database;
  let feedId: FeedId;

  beforeEach(() => {
    db = createTestDb();
    feedId = insertTestFeed(db);
  });

  test('getUnscoredEntryIds returns entries without scores', () => {
    const scored = insertTestEntry(db, feedId, { title: 'Scored' });
    const unscored = insertTestEntry(db, feedId, { title: 'Unscored' });
    insertTestScore(db, scored);

    const ids = q.getUnscoredEntryIds(db, 100);
    expect(ids).toContain(unscored);
    expect(ids).not.toContain(scored);
  });

  test('getUnscoredEntryIds respects limit', () => {
    for (let i = 0; i < 10; i++) {
      insertTestEntry(db, feedId);
    }

    const ids = q.getUnscoredEntryIds(db, 3);
    expect(ids).toHaveLength(3);
  });

  test('getEntriesForScoring returns entries with feed_title', () => {
    const fid = q.insertFeed(db, 'https://named.com/feed', 'Named Feed', '');
    const eid = insertTestEntry(db, fid as FeedId, { title: 'An Article' });

    const entries = q.getEntriesForScoring(db, [eid]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.title).toBe('An Article');
    expect(entries[0]!.feed_title).toBe('Named Feed');
  });

  test('getEntriesForScoring returns empty array for empty ids', () => {
    expect(q.getEntriesForScoring(db, [])).toHaveLength(0);
  });
});

describe('Ranking query (getRankedEntries)', () => {
  let db: Database;
  let feedId: FeedId;

  beforeEach(() => {
    db = createTestDb();
    feedId = insertTestFeed(db);
  });

  test('returns entries ranked by relevance * recency', () => {
    const now = Math.floor(Date.now() / 1000);

    // High relevance, old
    const old = insertTestEntry(db, feedId, { title: 'Old but relevant', published_at: now - 200000 });
    insertTestScore(db, old, { relevance: 0.95 });

    // Low relevance, new
    const fresh = insertTestEntry(db, feedId, { title: 'New but meh', published_at: now - 100 });
    insertTestScore(db, fresh, { relevance: 0.3 });

    // High relevance, new — should rank first
    const best = insertTestEntry(db, feedId, { title: 'Best of both', published_at: now - 100 });
    insertTestScore(db, best, { relevance: 0.9 });

    const ranked = q.getRankedEntries(db, { limit: 10, offset: 0 });
    expect(ranked.length).toBe(3);
    expect(ranked[0]!.title).toBe('Best of both');
  });

  test('unscored entries get default 0.5 relevance', () => {
    const now = Math.floor(Date.now() / 1000);
    const unscored = insertTestEntry(db, feedId, { title: 'Unscored', published_at: now });

    const ranked = q.getRankedEntries(db, { limit: 10, offset: 0 });
    expect(ranked).toHaveLength(1);
    // Unscored entries still appear — they just get mid-range treatment
    expect(ranked[0]!.title).toBe('Unscored');
  });

  test('hidden entries are excluded', () => {
    insertTestEntry(db, feedId, { title: 'Visible' });
    insertTestEntry(db, feedId, { title: 'Hidden', is_hidden: 1 });

    const ranked = q.getRankedEntries(db, { limit: 10, offset: 0 });
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.title).toBe('Visible');
  });

  test('unreadOnly filter works', () => {
    insertTestEntry(db, feedId, { title: 'Unread', is_read: 0 });
    insertTestEntry(db, feedId, { title: 'Read', is_read: 1 });

    const unread = q.getRankedEntries(db, { limit: 10, offset: 0, unreadOnly: true });
    expect(unread).toHaveLength(1);
    expect(unread[0]!.title).toBe('Unread');
  });

  test('category filter works', () => {
    const catId = insertTestCategory(db, { name: 'Tech', slug: 'tech' });
    const catEntry = insertTestEntry(db, feedId, { title: 'Tech article' });
    insertTestScore(db, catEntry, { category_id: catId });

    const otherEntry = insertTestEntry(db, feedId, { title: 'Other' });
    insertTestScore(db, otherEntry, { category_id: null });

    const filtered = q.getRankedEntries(db, { limit: 10, offset: 0, categoryId: catId });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.title).toBe('Tech article');
  });

  test('includes feed_title in results', () => {
    const fid = q.insertFeed(db, 'https://named.com/feed', 'Named Feed', 'https://named.com');
    insertTestEntry(db, fid as FeedId, { title: 'Entry' });

    const ranked = q.getRankedEntries(db, { limit: 10, offset: 0 });
    const entry = ranked.find(e => e.title === 'Entry');
    expect(entry).toBeDefined();
    expect(entry!.feed_title).toBe('Named Feed');
  });
});

describe('Score queries', () => {
  let db: Database;
  let feedId: FeedId;

  beforeEach(() => {
    db = createTestDb();
    feedId = insertTestFeed(db);
  });

  test('upsertEntryScore inserts a new score', () => {
    const entryId = insertTestEntry(db, feedId);
    const catId = insertTestCategory(db);

    q.upsertEntryScore(db, {
      entry_id: entryId,
      relevance: 0.8,
      depth: 0.5,
      novelty: 0.9,
      category_id: catId,
      reasoning: 'Very relevant',
      model: 'gemma-4',
    });

    const score = db.query<{ relevance: number; reasoning: string }, [EntryId]>(
      'SELECT relevance, reasoning FROM entry_scores WHERE entry_id = ?'
    ).get(entryId);

    expect(score).not.toBeNull();
    expect(score!.relevance).toBe(0.8);
    expect(score!.reasoning).toBe('Very relevant');
  });

  test('upsertEntryScore updates on conflict (re-scoring)', () => {
    const entryId = insertTestEntry(db, feedId);
    insertTestScore(db, entryId, { relevance: 0.3, reasoning: 'first pass' });

    q.upsertEntryScore(db, {
      entry_id: entryId,
      relevance: 0.9,
      depth: 0.7,
      novelty: 0.8,
      category_id: null,
      reasoning: 'second pass',
      model: 'gemma-4',
    });

    const score = db.query<{ relevance: number; reasoning: string }, [EntryId]>(
      'SELECT relevance, reasoning FROM entry_scores WHERE entry_id = ?'
    ).get(entryId);

    expect(score!.relevance).toBe(0.9);
    expect(score!.reasoning).toBe('second pass');
  });

  test('upsertEntryCategory inserts category association', () => {
    const entryId = insertTestEntry(db, feedId);
    const catId = insertTestCategory(db);

    q.upsertEntryCategory(db, entryId, catId, 0.85);

    const ec = db.query<{ confidence: number }, [EntryId, CategoryId]>(
      'SELECT confidence FROM entry_categories WHERE entry_id = ? AND category_id = ?'
    ).get(entryId, catId);

    expect(ec).not.toBeNull();
    expect(ec!.confidence).toBe(0.85);
  });

  test('upsertEntryCategory updates confidence on conflict', () => {
    const entryId = insertTestEntry(db, feedId);
    const catId = insertTestCategory(db);

    q.upsertEntryCategory(db, entryId, catId, 0.5);
    q.upsertEntryCategory(db, entryId, catId, 0.95);

    const ec = db.query<{ confidence: number }, [EntryId, CategoryId]>(
      'SELECT confidence FROM entry_categories WHERE entry_id = ? AND category_id = ?'
    ).get(entryId, catId);

    expect(ec!.confidence).toBe(0.95);
  });
});

describe('Category queries', () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  test('insertCategory + getCategoryBySlug round-trips', () => {
    q.insertCategory(db, 'Technology', 'technology', 'Tech stuff', false);
    const cat = q.getCategoryBySlug(db, 'technology');

    expect(cat).not.toBeNull();
    expect(cat!.name).toBe('Technology');
    expect(cat!.is_auto).toBe(0);
  });

  test('getCategoryByName finds category case-sensitively', () => {
    q.insertCategory(db, 'Science', 'science', '', false);

    expect(q.getCategoryByName(db, 'Science')).not.toBeNull();
    expect(q.getCategoryByName(db, 'science')).toBeNull(); // case-sensitive
  });

  test('getCategoriesWithCounts includes entry_count', () => {
    const catId = q.insertCategory(db, 'Tech', 'tech', '', false);
    const feedId = insertTestFeed(db);
    const e1 = insertTestEntry(db, feedId);
    const e2 = insertTestEntry(db, feedId);

    q.upsertEntryCategory(db, e1, catId, 1.0);
    q.upsertEntryCategory(db, e2, catId, 0.7);

    const cats = q.getCategoriesWithCounts(db);
    const tech = cats.find(c => c.slug === 'tech');
    expect(tech).toBeDefined();
    expect(tech!.entry_count).toBe(2);
  });

  test('getAllCategories returns sorted by sort_order then name', () => {
    q.insertCategory(db, 'Zebra', 'zebra', '', false);
    q.insertCategory(db, 'Alpha', 'alpha', '', false);

    const cats = q.getAllCategories(db);
    // Same sort_order (0), so alphabetical
    expect(cats[0]!.name).toBe('Alpha');
    expect(cats[1]!.name).toBe('Zebra');
  });
});

describe('Preferences queries', () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  test('setPreference + getPreference round-trips', () => {
    q.setPreference(db, 'theme', '"dark"');
    expect(q.getPreference(db, 'theme')).toBe('"dark"');
  });

  test('setPreference upserts on conflict', () => {
    q.setPreference(db, 'lang', '"en"');
    q.setPreference(db, 'lang', '"nl"');
    expect(q.getPreference(db, 'lang')).toBe('"nl"');
  });

  test('getPreference returns null for missing key', () => {
    expect(q.getPreference(db, 'nonexistent')).toBeNull();
  });

  test('getAllPreferences returns all key-value pairs', () => {
    q.setPreference(db, 'a', '1');
    q.setPreference(db, 'b', '2');

    const prefs = q.getAllPreferences(db);
    expect(prefs['a']).toBe('1');
    expect(prefs['b']).toBe('2');
  });
});

describe('Stats queries', () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  test('getStats returns correct counts', () => {
    const f1 = insertTestFeed(db);
    const f2 = insertTestFeed(db);
    const e1 = insertTestEntry(db, f1, { is_read: 0 });
    const e2 = insertTestEntry(db, f1, { is_read: 1 });
    const e3 = insertTestEntry(db, f2, { is_read: 0 });
    insertTestScore(db, e1);

    const stats = q.getStats(db);
    expect(stats.total_feeds).toBe(2);
    expect(stats.total_entries).toBe(3);
    expect(stats.unread_entries).toBe(2);
    expect(stats.scored_entries).toBe(1);
    expect(stats.pending_jobs).toBe(0);
  });
});

describe('Interaction queries', () => {
  let db: Database;
  let feedId: FeedId;

  beforeEach(() => {
    db = createTestDb();
    feedId = insertTestFeed(db);
  });

  test('recordInteraction stores action and optional duration', () => {
    const entryId = insertTestEntry(db, feedId);
    q.recordInteraction(db, entryId, 'read', 45);

    const row = db.query<{ action: string; duration_sec: number | null }, [EntryId]>(
      'SELECT action, duration_sec FROM interactions WHERE entry_id = ?'
    ).get(entryId);

    expect(row!.action).toBe('read');
    expect(row!.duration_sec).toBe(45);
  });

  test('recordInteraction allows null duration', () => {
    const entryId = insertTestEntry(db, feedId);
    q.recordInteraction(db, entryId, 'star');

    const row = db.query<{ duration_sec: number | null }, [EntryId]>(
      'SELECT duration_sec FROM interactions WHERE entry_id = ?'
    ).get(entryId);

    expect(row!.duration_sec).toBeNull();
  });
});

describe('Config queries', () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  test('getConfig retrieves fever_api_key', () => {
    const key = q.getConfig(db, 'fever_api_key');
    expect(key).toBe('test-api-key-0000'); // set by createTestDb
  });

  test('getConfig returns null for missing key', () => {
    expect(q.getConfig(db, 'nonexistent')).toBeNull();
  });
});
