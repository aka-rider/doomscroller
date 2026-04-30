import { describe, test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import * as q from '../db/queries';
import {
  createTestDb, insertTestFeed, insertTestEntry,
} from '../test-utils';
import type { FeedId, EntryId, TagId } from '../types';

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

  test('setEntryThumb toggles thumb value', () => {
    const id = insertTestEntry(db, feedId);

    q.setEntryThumb(db, id, 1);
    expect(q.getEntryById(db, id)!.thumb).toBe(1);

    q.setEntryThumb(db, id, null);
    expect(q.getEntryById(db, id)!.thumb).toBeNull();

    q.setEntryThumb(db, id, -1);
    expect(q.getEntryById(db, id)!.thumb).toBe(-1);
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

describe('getEntries query', () => {
  let db: Database;
  let feedId: FeedId;

  beforeEach(() => {
    db = createTestDb();
    feedId = insertTestFeed(db);
  });

  test('returns entries ordered by published_at DESC', () => {
    insertTestEntry(db, feedId, { title: 'Old', published_at: 1000 });
    insertTestEntry(db, feedId, { title: 'New', published_at: 2000 });

    const entries = q.getEntries(db, { limit: 10, offset: 0 });
    expect(entries.length).toBe(2);
    expect(entries[0]!.title).toBe('New');
    expect(entries[1]!.title).toBe('Old');
  });

  test('includes feed_title in results', () => {
    const fid = q.insertFeed(db, 'https://named.com/feed', 'Named Feed', 'https://named.com');
    insertTestEntry(db, fid as FeedId, { title: 'Entry' });

    const entries = q.getEntries(db, { limit: 10, offset: 0 });
    const entry = entries.find(e => e.title === 'Entry');
    expect(entry).toBeDefined();
    expect(entry!.feed_title).toBe('Named Feed');
  });

  test('unreadOnly filter works', () => {
    insertTestEntry(db, feedId, { title: 'Unread', is_read: 0 });
    insertTestEntry(db, feedId, { title: 'Read', is_read: 1 });

    const unread = q.getEntries(db, { limit: 10, offset: 0, unreadOnly: true });
    expect(unread).toHaveLength(1);
    expect(unread[0]!.title).toBe('Unread');
  });
});

describe('Tag queries (stubs)', () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  test('getAllTags returns empty when no tags', () => {
    expect(q.getAllTags(db)).toHaveLength(0);
  });

  test('getTagBySlug returns null for missing slug', () => {
    expect(q.getTagBySlug(db, 'nonexistent')).toBeNull();
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
    insertTestEntry(db, f1, { is_read: 0 });
    insertTestEntry(db, f1, { is_read: 1 });
    insertTestEntry(db, f2, { is_read: 0 });

    const stats = q.getStats(db);
    expect(stats.total_feeds).toBe(2);
    expect(stats.total_entries).toBe(3);
    expect(stats.unread_entries).toBe(2);
    expect(stats.tagged_entries).toBe(0);
    expect(stats.pending_jobs).toBe(0);
  });
});

describe('Config queries', () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  test('getConfig returns null for missing key', () => {
    expect(q.getConfig(db, 'nonexistent')).toBeNull();
  });

  test('getConfig retrieves stored config', () => {
    db.run("INSERT INTO config (key, value) VALUES ('test_key', 'test_val')");
    expect(q.getConfig(db, 'test_key')).toBe('test_val');
  });

  test('setConfig inserts a new key', () => {
    q.setConfig(db, 'new_key', 'new_val');
    expect(q.getConfig(db, 'new_key')).toBe('new_val');
  });

  test('setConfig upserts existing key', () => {
    q.setConfig(db, 'k', 'v1');
    q.setConfig(db, 'k', 'v2');
    expect(q.getConfig(db, 'k')).toBe('v2');
  });
});

// ============================================================================
// Tag CRUD
// ============================================================================

describe('Tag queries', () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  test('createTag + getTagBySlug round-trips', () => {
    const id = q.createTag(db, 'tech', 'Technology', 'topic', true);
    const tag = q.getTagBySlug(db, 'tech');

    expect(tag).not.toBeNull();
    expect(tag!.id).toBe(id);
    expect(tag!.slug).toBe('tech');
    expect(tag!.label).toBe('Technology');
    expect(tag!.tag_group).toBe('topic');
    expect(tag!.is_builtin).toBe(1);
    expect(tag!.use_count).toBe(0);
  });

  test('createTag with is_builtin false sets 0', () => {
    q.createTag(db, 'custom', 'Custom', '', false);
    const tag = q.getTagBySlug(db, 'custom');
    expect(tag!.is_builtin).toBe(0);
  });

  test('getAllTags returns tags sorted by sort_order then slug', () => {
    q.createTag(db, 'zebra', 'Zebra', '', false);
    q.createTag(db, 'alpha', 'Alpha', '', false);

    const tags = q.getAllTags(db);
    expect(tags).toHaveLength(2);
    expect(tags[0]!.slug).toBe('alpha');
    expect(tags[1]!.slug).toBe('zebra');
  });

  test('getAllTagSlugs returns just slugs', () => {
    q.createTag(db, 'a', 'A', '', false);
    q.createTag(db, 'b', 'B', '', false);

    const slugs = q.getAllTagSlugs(db);
    expect(slugs).toEqual(['a', 'b']);
  });

  test('getTagBySlug returns null for missing slug', () => {
    expect(q.getTagBySlug(db, 'nope')).toBeNull();
  });

  test('deleteTag removes the tag', () => {
    const id = q.createTag(db, 'gone', 'Gone', '', false);
    q.deleteTag(db, id);
    expect(q.getTagBySlug(db, 'gone')).toBeNull();
  });

  test('deleteTag cascades to entry_tags', () => {
    const feedId = insertTestFeed(db);
    const entryId = insertTestEntry(db, feedId);
    const tagId = q.createTag(db, 'temp', 'Temp', '', false);

    q.addEntryTag(db, entryId, tagId, 'llm');
    expect(q.getTagsForEntry(db, entryId)).toHaveLength(1);

    q.deleteTag(db, tagId);
    expect(q.getTagsForEntry(db, entryId)).toHaveLength(0);
  });

  test('deleteTag cascades to tag_preferences', () => {
    const tagId = q.createTag(db, 'pref', 'Pref', '', false);
    q.setTagPreference(db, tagId, 'whitelist');
    expect(q.getPreferenceForTag(db, tagId)).not.toBeNull();

    q.deleteTag(db, tagId);
    expect(q.getPreferenceForTag(db, tagId)).toBeNull();
  });

  test('incrementTagUseCount increments by 1', () => {
    const id = q.createTag(db, 'popular', 'Popular', '', false);
    expect(q.getTagBySlug(db, 'popular')!.use_count).toBe(0);

    q.incrementTagUseCount(db, id);
    q.incrementTagUseCount(db, id);
    expect(q.getTagBySlug(db, 'popular')!.use_count).toBe(2);
  });
});

// ============================================================================
// Tag Preferences
// ============================================================================

describe('Tag preference queries', () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  test('setTagPreference + getPreferenceForTag round-trips', () => {
    const tagId = q.createTag(db, 'tag1', 'Tag 1', '', false);
    q.setTagPreference(db, tagId, 'whitelist');

    const pref = q.getPreferenceForTag(db, tagId);
    expect(pref).not.toBeNull();
    expect(pref!.tag_id).toBe(tagId);
    expect(pref!.mode).toBe('whitelist');
  });

  test('setTagPreference upserts existing preference', () => {
    const tagId = q.createTag(db, 'tag1', 'Tag 1', '', false);
    q.setTagPreference(db, tagId, 'whitelist');
    q.setTagPreference(db, tagId, 'blacklist');

    const pref = q.getPreferenceForTag(db, tagId);
    expect(pref!.mode).toBe('blacklist');
  });

  test('getTagPreferences returns all preferences', () => {
    const t1 = q.createTag(db, 'a', 'A', '', false);
    const t2 = q.createTag(db, 'b', 'B', '', false);
    q.setTagPreference(db, t1, 'whitelist');
    q.setTagPreference(db, t2, 'blacklist');

    const prefs = q.getTagPreferences(db);
    expect(prefs).toHaveLength(2);
  });

  test('getPreferenceForTag returns null for no preference', () => {
    const tagId = q.createTag(db, 'nopref', 'No Pref', '', false);
    expect(q.getPreferenceForTag(db, tagId)).toBeNull();
  });
});

// ============================================================================
// Entry-Tag Associations
// ============================================================================

describe('Entry-tag queries', () => {
  let db: Database;
  let feedId: FeedId;

  beforeEach(() => {
    db = createTestDb();
    feedId = insertTestFeed(db);
  });

  test('addEntryTag + getTagsForEntry round-trips', () => {
    const entryId = insertTestEntry(db, feedId);
    const tagId = q.createTag(db, 'tech', 'Tech', '', false);

    q.addEntryTag(db, entryId, tagId, 'llm');

    const tags = q.getTagsForEntry(db, entryId);
    expect(tags).toHaveLength(1);
    expect(tags[0]!.slug).toBe('tech');
  });

  test('addEntryTag is idempotent (OR IGNORE)', () => {
    const entryId = insertTestEntry(db, feedId);
    const tagId = q.createTag(db, 'tech', 'Tech', '', false);

    q.addEntryTag(db, entryId, tagId, 'llm');
    q.addEntryTag(db, entryId, tagId, 'llm');

    expect(q.getTagsForEntry(db, entryId)).toHaveLength(1);
  });

  test('getTagsForEntry returns empty for untagged entry', () => {
    const entryId = insertTestEntry(db, feedId);
    expect(q.getTagsForEntry(db, entryId)).toHaveLength(0);
  });

  test('getEntriesByTag returns entries with that tag', () => {
    const e1 = insertTestEntry(db, feedId, { title: 'Tagged' });
    const e2 = insertTestEntry(db, feedId, { title: 'Not Tagged' });
    const tagId = q.createTag(db, 'news', 'News', '', false);

    q.addEntryTag(db, e1, tagId, 'llm');

    const entries = q.getEntriesByTag(db, tagId, 10, 0);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.title).toBe('Tagged');
  });

  test('getEntriesByTag respects limit and offset', () => {
    const tagId = q.createTag(db, 'all', 'All', '', false);
    for (let i = 0; i < 5; i++) {
      const eid = insertTestEntry(db, feedId, { published_at: 1000 + i });
      q.addEntryTag(db, eid, tagId, 'llm');
    }

    const page1 = q.getEntriesByTag(db, tagId, 2, 0);
    const page2 = q.getEntriesByTag(db, tagId, 2, 2);

    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page1[0]!.id).not.toBe(page2[0]!.id);
  });
});

// ============================================================================
// Untagged Entries
// ============================================================================

describe('Untagged entry queries', () => {
  let db: Database;
  let feedId: FeedId;

  beforeEach(() => {
    db = createTestDb();
    feedId = insertTestFeed(db);
  });

  test('getUntaggedEntryIds returns entries with tagged_at IS NULL', () => {
    insertTestEntry(db, feedId, { tagged_at: null });
    insertTestEntry(db, feedId, { tagged_at: null });
    insertTestEntry(db, feedId, { tagged_at: 12345 });

    const ids = q.getUntaggedEntryIds(db, 10);
    expect(ids).toHaveLength(2);
  });

  test('getUntaggedEntryIds respects limit', () => {
    for (let i = 0; i < 10; i++) {
      insertTestEntry(db, feedId, { tagged_at: null });
    }

    const ids = q.getUntaggedEntryIds(db, 3);
    expect(ids).toHaveLength(3);
  });

  test('markEntryTagged sets tagged_at', () => {
    const id = insertTestEntry(db, feedId, { tagged_at: null });
    expect(q.getEntryById(db, id)!.tagged_at).toBeNull();

    q.markEntryTagged(db, id);
    expect(q.getEntryById(db, id)!.tagged_at).not.toBeNull();
  });

  test('markEntryTagged removes entry from untagged list', () => {
    const id = insertTestEntry(db, feedId, { tagged_at: null });
    expect(q.getUntaggedEntryIds(db, 10)).toHaveLength(1);

    q.markEntryTagged(db, id);
    expect(q.getUntaggedEntryIds(db, 10)).toHaveLength(0);
  });
});

// ============================================================================
// Entry Visibility (whitelist/blacklist filtering)
// ============================================================================

describe('getVisibleEntries', () => {
  let db: Database;
  let feedId: FeedId;

  beforeEach(() => {
    db = createTestDb();
    feedId = insertTestFeed(db, { title: 'Test Feed', site_url: 'https://test.com' });
  });

  test('untagged entries are always visible', () => {
    insertTestEntry(db, feedId, { title: 'Untagged', tagged_at: null });

    const visible = q.getVisibleEntries(db, { limit: 10, offset: 0 });
    expect(visible).toHaveLength(1);
    expect(visible[0]!.title).toBe('Untagged');
    expect(visible[0]!.feed_title).toBe('Test Feed');
  });

  test('entries with no tag preference (neutral) are visible', () => {
    const entryId = insertTestEntry(db, feedId, { tagged_at: 12345 });
    const tagId = q.createTag(db, 'neutral', 'Neutral', '', false);
    q.addEntryTag(db, entryId, tagId, 'llm');
    // No preference set — should be visible

    const visible = q.getVisibleEntries(db, { limit: 10, offset: 0 });
    expect(visible).toHaveLength(1);
  });

  test('entries with whitelisted tag are visible', () => {
    const entryId = insertTestEntry(db, feedId, { tagged_at: 12345 });
    const tagId = q.createTag(db, 'good', 'Good', '', false);
    q.addEntryTag(db, entryId, tagId, 'llm');
    q.setTagPreference(db, tagId, 'whitelist');

    const visible = q.getVisibleEntries(db, { limit: 10, offset: 0 });
    expect(visible).toHaveLength(1);
  });

  test('entries with ALL blacklisted tags are hidden', () => {
    const entryId = insertTestEntry(db, feedId, { tagged_at: 12345 });
    const t1 = q.createTag(db, 'spam', 'Spam', '', false);
    const t2 = q.createTag(db, 'junk', 'Junk', '', false);
    q.addEntryTag(db, entryId, t1, 'llm');
    q.addEntryTag(db, entryId, t2, 'llm');
    q.setTagPreference(db, t1, 'blacklist');
    q.setTagPreference(db, t2, 'blacklist');

    const visible = q.getVisibleEntries(db, { limit: 10, offset: 0 });
    expect(visible).toHaveLength(0);
  });

  test('entry with one blacklisted and one neutral tag is hidden', () => {
    const entryId = insertTestEntry(db, feedId, { tagged_at: 12345 });
    const bad = q.createTag(db, 'spam', 'Spam', '', false);
    const ok = q.createTag(db, 'news', 'News', '', false);
    q.addEntryTag(db, entryId, bad, 'llm');
    q.addEntryTag(db, entryId, ok, 'llm');
    q.setTagPreference(db, bad, 'blacklist');
    // 'news' has no preference — neutral
    // An entry is hidden if it has ANY blacklisted tag and no whitelisted tags

    const visible = q.getVisibleEntries(db, { limit: 10, offset: 0 });
    expect(visible).toHaveLength(0);
  });

  test('entry with one blacklisted and one whitelisted tag is visible', () => {
    const entryId = insertTestEntry(db, feedId, { tagged_at: 12345 });
    const bad = q.createTag(db, 'spam', 'Spam', '', false);
    const good = q.createTag(db, 'fave', 'Fave', '', false);
    q.addEntryTag(db, entryId, bad, 'llm');
    q.addEntryTag(db, entryId, good, 'llm');
    q.setTagPreference(db, bad, 'blacklist');
    q.setTagPreference(db, good, 'whitelist');

    const visible = q.getVisibleEntries(db, { limit: 10, offset: 0 });
    expect(visible).toHaveLength(1);
  });

  test('unreadOnly filter works with visibility', () => {
    const e1 = insertTestEntry(db, feedId, { title: 'Unread', is_read: 0, tagged_at: null });
    const e2 = insertTestEntry(db, feedId, { title: 'Read', is_read: 1, tagged_at: null });

    const all = q.getVisibleEntries(db, { limit: 10, offset: 0 });
    expect(all).toHaveLength(2);

    const unread = q.getVisibleEntries(db, { limit: 10, offset: 0, unreadOnly: true });
    expect(unread).toHaveLength(1);
    expect(unread[0]!.title).toBe('Unread');
  });

  test('limit and offset work', () => {
    for (let i = 0; i < 10; i++) {
      insertTestEntry(db, feedId, { published_at: 1000 + i, tagged_at: null });
    }

    const page1 = q.getVisibleEntries(db, { limit: 3, offset: 0 });
    const page2 = q.getVisibleEntries(db, { limit: 3, offset: 3 });

    expect(page1).toHaveLength(3);
    expect(page2).toHaveLength(3);
    const ids1 = page1.map(e => e.id);
    const ids2 = page2.map(e => e.id);
    expect(ids1.filter(id => ids2.includes(id))).toHaveLength(0);
  });

  test('tagged entry with no entry_tags rows is visible', () => {
    // Edge case: tagged_at set but no tags assigned
    insertTestEntry(db, feedId, { tagged_at: 12345 });

    const visible = q.getVisibleEntries(db, { limit: 10, offset: 0 });
    expect(visible).toHaveLength(1);
  });
});

// ============================================================================
// Tag Seeding
// ============================================================================

describe('seedBuiltinTags', () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  test('seeds 303 tags on empty table', () => {
    const count = q.seedBuiltinTags(db);
    expect(count).toBe(303);

    const tags = q.getAllTags(db);
    expect(tags).toHaveLength(303);
  });

  test('all seeded tags have is_builtin=1', () => {
    q.seedBuiltinTags(db);
    const tags = q.getAllTags(db);
    for (const tag of tags) {
      expect(tag.is_builtin).toBe(1);
    }
  });

  test('all seeded tags have use_count=0', () => {
    q.seedBuiltinTags(db);
    const tags = q.getAllTags(db);
    for (const tag of tags) {
      expect(tag.use_count).toBe(0);
    }
  });

  test('tags are sorted by sort_order', () => {
    q.seedBuiltinTags(db);
    const tags = q.getAllTags(db);
    expect(tags[0]!.slug).toBe('rust');
    expect(tags[0]!.sort_order).toBe(1);
    // Last tag is 'religion' (history category, sort_order 303)
    const lastTag = tags[tags.length - 1]!;
    expect(lastTag.slug).toBe('religion');
    expect(lastTag.sort_order).toBe(303);
  });

  test('correct tag groups assigned', () => {
    q.seedBuiltinTags(db);
    const tags = q.getAllTags(db);

    const topicCount = tags.filter(t => t.tag_group === 'topic').length;
    const signalCount = tags.filter(t => t.tag_group === 'signal').length;

    expect(topicCount).toBe(303);
    expect(signalCount).toBe(0);
  });

  test('does not re-seed when tags already exist', () => {
    q.seedBuiltinTags(db);
    const count = q.seedBuiltinTags(db);
    expect(count).toBe(0);

    const tags = q.getAllTags(db);
    expect(tags).toHaveLength(303);
  });

  test('does not seed when any tags exist (including custom)', () => {
    q.createTag(db, 'custom', 'Custom', '', false);
    const count = q.seedBuiltinTags(db);
    expect(count).toBe(0);
  });
});

// ============================================================================
// getTagById
// ============================================================================

describe('getTagById', () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  test('returns tag by id', () => {
    const id = q.createTag(db, 'find-me', 'Find Me', 'test', false);
    const tag = q.getTagById(db, id);
    expect(tag).not.toBeNull();
    expect(tag!.slug).toBe('find-me');
  });

  test('returns null for non-existent id', () => {
    expect(q.getTagById(db, 99999 as TagId)).toBeNull();
  });
});

// ============================================================================
// GATE: Starter Feed Seeding
// Verifies the curated feed list seeds correctly and idempotently.
// ============================================================================

describe('seedStarterFeeds', () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  test('seeds exactly STARTER_FEED_COUNT feeds on empty database', () => {
    const count = q.seedStarterFeeds(db);
    expect(count).toBe(q.STARTER_FEED_COUNT);

    const feeds = q.getAllFeeds(db);
    expect(feeds.length).toBe(q.STARTER_FEED_COUNT);
  });

  test('seeds all curated feeds', () => {
    expect(q.STARTER_FEED_COUNT).toBe(64);
    q.seedStarterFeeds(db);
    const feeds = q.getAllFeeds(db);
    expect(feeds.length).toBe(64);
  });

  test('is idempotent — running twice does not double-seed', () => {
    q.seedStarterFeeds(db);
    const secondRun = q.seedStarterFeeds(db);
    expect(secondRun).toBe(0);

    const feeds = q.getAllFeeds(db);
    expect(feeds.length).toBe(q.STARTER_FEED_COUNT);
  });

  test('does not seed if feeds already exist', () => {
    insertTestFeed(db);
    const count = q.seedStarterFeeds(db);
    expect(count).toBe(0);

    const feeds = q.getAllFeeds(db);
    expect(feeds.length).toBe(1);
  });

  test('includes expected feeds (BBC, HN, Lobsters)', () => {
    q.seedStarterFeeds(db);
    const feeds = q.getAllFeeds(db);
    const urls = feeds.map(f => f.url);

    expect(urls).toContain('https://feeds.bbci.co.uk/news/world/rss.xml');
    expect(urls).toContain('https://hnrss.org/best');
    expect(urls).toContain('https://lobste.rs/rss');
  });

  test('all seeded feeds are active by default', () => {
    q.seedStarterFeeds(db);
    const feeds = q.getAllFeeds(db);
    for (const feed of feeds) {
      expect(feed.is_active).toBe(1);
    }
  });

  test('seeded feeds have titles set', () => {
    q.seedStarterFeeds(db);
    const feeds = q.getAllFeeds(db);
    for (const feed of feeds) {
      expect(feed.title.length).toBeGreaterThan(0);
    }
  });

  test('add feed after seeding works', () => {
    q.seedStarterFeeds(db);
    const id = q.insertFeed(db, 'https://custom.example.com/feed', 'Custom Feed', 'https://custom.example.com');
    const feed = q.getFeedById(db, id);
    expect(feed).not.toBeNull();
    expect(feed!.title).toBe('Custom Feed');

    const feeds = q.getAllFeeds(db);
    expect(feeds.length).toBe(q.STARTER_FEED_COUNT + 1);
  });

  test('delete feed after seeding works', () => {
    q.seedStarterFeeds(db);
    const feeds = q.getAllFeeds(db);
    const firstFeed = feeds[0]!;

    q.deleteFeed(db, firstFeed.id);
    const remaining = q.getAllFeeds(db);
    expect(remaining.length).toBe(q.STARTER_FEED_COUNT - 1);
  });

  test('all feed URLs are unique', () => {
    q.seedStarterFeeds(db);
    const feeds = q.getAllFeeds(db);
    const urls = feeds.map(f => f.url);
    const unique = new Set(urls);
    expect(unique.size).toBe(urls.length);
  });
});
