import { describe, test, expect, beforeEach } from 'bun:test';
import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { createApiRoutes } from './api/routes';
import { createFeverRoutes } from './api/fever';
import * as queries from './db/queries';
import {
  createTestDb, insertTestFeed, insertTestEntry, TEST_CONFIG,
} from './test-utils';
import type { FeedId, EntryId, TagId, AppConfig } from './types';

// ============================================================================
// SMOKE E2E TESTS
//
// These test the full HTTP stack as a black box: request → middleware →
// routing → queries → serialization → response. Each test creates a fresh
// in-memory DB and wires up the real Hono app — no Docker needed.
//
// If these pass, the server will serve correct responses when deployed.
// ============================================================================

describe('Smoke: Boot & Health', () => {
  let db: Database;
  let app: Hono;

  beforeEach(() => {
    db = createTestDb();
    app = new Hono();
    app.route('/api', createApiRoutes(db, TEST_CONFIG));
    app.route('/fever', createFeverRoutes(db));
    app.get('/health', (c) => c.json({ status: 'ok', uptime: 1 }));
  });

  test('health endpoint returns ok', async () => {
    const res = await app.request('http://localhost/health');
    expect(res.status).toBe(200);
    const data = await res.json() as { status: string };
    expect(data.status).toBe('ok');
  });

  test('seeding tags populates builtin tags', () => {
    const seeded = queries.seedBuiltinTags(db);
    expect(seeded).toBe(303);
    const tags = queries.getAllTags(db);
    expect(tags.length).toBe(303);
    expect(tags.every(t => t.is_builtin === 1)).toBe(true);
  });

  test('seeding starter feeds populates curated feeds', () => {
    const seeded = queries.seedStarterFeeds(db);
    expect(seeded).toBeGreaterThan(0);
    const feeds = queries.getAllFeeds(db);
    expect(feeds.length).toBe(seeded);
  });

  test('seeding is idempotent', () => {
    queries.seedBuiltinTags(db);
    queries.seedStarterFeeds(db);
    expect(queries.seedBuiltinTags(db)).toBe(0);
    expect(queries.seedStarterFeeds(db)).toBe(0);
  });
});

describe('Smoke: Feed CRUD', () => {
  let db: Database;
  let app: Hono;

  const req = (app: Hono, method: string, path: string, body?: unknown) => {
    const init: RequestInit = { method };
    if (body) {
      init.body = JSON.stringify(body);
      init.headers = { 'Content-Type': 'application/json' };
    }
    return app.request(`http://localhost/api${path}`, init);
  };

  beforeEach(() => {
    db = createTestDb();
    app = new Hono();
    app.route('/api', createApiRoutes(db, TEST_CONFIG));
  });

  test('full lifecycle: create → list → delete', async () => {
    // Create
    const createRes = await req(app, 'POST', '/feeds', { url: 'https://example.com/rss.xml' });
    expect(createRes.status).toBe(201);
    const created = await createRes.json() as { id: number };
    expect(created.id).toBeDefined();

    // List
    const listRes = await req(app, 'GET', '/feeds');
    expect(listRes.status).toBe(200);
    const feeds = await listRes.json() as any[];
    expect(feeds.length).toBe(1);
    expect(feeds[0].url).toBe('https://example.com/rss.xml');

    // Delete
    const delRes = await req(app, 'DELETE', `/feeds/${created.id}`);
    expect(delRes.status).toBe(200);

    // Verify gone
    const afterDel = await req(app, 'GET', '/feeds');
    const afterFeeds = await afterDel.json() as any[];
    expect(afterFeeds.length).toBe(0);
  });

  test('adding a feed enqueues a fetch job', async () => {
    await req(app, 'POST', '/feeds', { url: 'https://jobtest.com/feed' });
    const jobs = db.query<{ type: string }, []>(
      "SELECT type FROM jobs WHERE type = 'fetch_feed'"
    ).all();
    expect(jobs.length).toBe(1);
  });
});

describe('Smoke: Entry Flow', () => {
  let db: Database;
  let app: Hono;

  const req = (app: Hono, method: string, path: string, body?: unknown) => {
    const init: RequestInit = { method };
    if (body) {
      init.body = JSON.stringify(body);
      init.headers = { 'Content-Type': 'application/json' };
    }
    return app.request(`http://localhost/api${path}`, init);
  };

  beforeEach(() => {
    db = createTestDb();
    app = new Hono();
    app.route('/api', createApiRoutes(db, TEST_CONFIG));
  });

  test('entries include feed_title and tags array', async () => {
    const feedId = insertTestFeed(db, { title: 'My Blog' });
    const entryId = insertTestEntry(db, feedId, { title: 'Hello World' });

    // Tag the entry
    queries.seedBuiltinTags(db);
    const tag = queries.getTagBySlug(db, 'web-dev')!;
    queries.addEntryTag(db, entryId, tag.id, 'llm');

    const res = await req(app, 'GET', '/entries');
    expect(res.status).toBe(200);
    const entries = await res.json() as any[];
    expect(entries.length).toBe(1);
    expect(entries[0].feed_title).toBe('My Blog');
    expect(entries[0].tags).toBeInstanceOf(Array);
    expect(entries[0].tags.length).toBe(1);
    expect(entries[0].tags[0].slug).toBe('web-dev');
  });

  test('marking entry read persists through API', async () => {
    const feedId = insertTestFeed(db);
    const entryId = insertTestEntry(db, feedId);

    await req(app, 'POST', `/entries/${entryId}/read`);

    const res = await req(app, 'GET', `/entries/${entryId}`);
    const entry = await res.json() as any;
    expect(entry.is_read).toBe(1);
  });

  test('starring and unstarring persists through API', async () => {
    const feedId = insertTestFeed(db);
    const entryId = insertTestEntry(db, feedId);

    await req(app, 'POST', `/entries/${entryId}/star`, { starred: true });
    let entry = await (await req(app, 'GET', `/entries/${entryId}`)).json() as any;
    expect(entry.is_starred).toBe(1);

    await req(app, 'POST', `/entries/${entryId}/star`, { starred: false });
    entry = await (await req(app, 'GET', `/entries/${entryId}`)).json() as any;
    expect(entry.is_starred).toBe(0);
  });

  test('unread filter via API query param', async () => {
    const feedId = insertTestFeed(db);
    insertTestEntry(db, feedId, { title: 'Unread', is_read: 0 });
    insertTestEntry(db, feedId, { title: 'Read', is_read: 1 });

    const res = await req(app, 'GET', '/entries?unread=true');
    const entries = await res.json() as any[];
    expect(entries.length).toBe(1);
    expect(entries[0].title).toBe('Unread');
  });
});

describe('Smoke: Tag Preferences & Filtering', () => {
  let db: Database;
  let app: Hono;

  const req = (app: Hono, method: string, path: string, body?: unknown) => {
    const init: RequestInit = { method };
    if (body) {
      init.body = JSON.stringify(body);
      init.headers = { 'Content-Type': 'application/json' };
    }
    return app.request(`http://localhost/api${path}`, init);
  };

  beforeEach(() => {
    db = createTestDb();
    app = new Hono();
    app.route('/api', createApiRoutes(db, TEST_CONFIG));
  });

  test('blacklisted tag hides entries from filtered view', async () => {
    const feedId = insertTestFeed(db);
    const visible = insertTestEntry(db, feedId, { title: 'Visible', tagged_at: 1000 });
    const hidden = insertTestEntry(db, feedId, { title: 'Hidden', tagged_at: 1000 });

    const goodTag = queries.createTag(db, 'good-stuff', 'Good', 'custom', false);
    const badTag = queries.createTag(db, 'bad-stuff', 'Bad', 'custom', false);

    queries.addEntryTag(db, visible, goodTag, 'llm');
    queries.addEntryTag(db, hidden, badTag, 'llm');

    // Blacklist the bad tag
    await req(app, 'PUT', `/tags/${badTag}/preference`, { mode: 'blacklist' });

    // Filtered view (default) should hide the blacklisted entry
    const res = await req(app, 'GET', '/entries');
    const entries = await res.json() as any[];
    const titles = entries.map((e: any) => e.title);
    expect(titles).toContain('Visible');
    expect(titles).not.toContain('Hidden');
  });

  test('unfiltered view shows all entries regardless of blacklist', async () => {
    const feedId = insertTestFeed(db);
    const entry = insertTestEntry(db, feedId, { title: 'Blacklisted', tagged_at: 1000 });
    const tag = queries.createTag(db, 'blocked', 'Blocked', 'custom', false);
    queries.addEntryTag(db, entry, tag, 'llm');
    queries.setTagPreference(db, tag, 'blacklist');

    const res = await req(app, 'GET', '/entries?filter=all');
    const entries = await res.json() as any[];
    expect(entries.map((e: any) => e.title)).toContain('Blacklisted');
  });

  test('GET /tags returns grouped tags with preference modes', async () => {
    queries.seedBuiltinTags(db);

    const res = await req(app, 'GET', '/tags');
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, any[]>;

    // Signal tags have been replaced by depth_score
    expect(data.signal).toBeUndefined();

    // Topic tags should be present
    expect(data.topic).toBeDefined();

    // Each tag should have a mode field
    for (const tag of data.topic) {
      expect(tag.mode).toBeDefined();
    }
  });
});

describe('Smoke: Fever API Compatibility', () => {
  let db: Database;
  let app: Hono;

  beforeEach(() => {
    db = createTestDb();
    app = new Hono();
    app.route('/fever', createFeverRoutes(db));
  });

  test('base request returns api_version and auth', async () => {
    const res = await app.request('http://localhost/fever?api');
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.api_version).toBe(3);
    expect(data.auth).toBe(1);
  });

  test('?feeds returns feeds in Fever format', async () => {
    insertTestFeed(db, { title: 'Fever Feed', url: 'https://fever.test/rss' });

    const res = await app.request('http://localhost/fever?api&feeds');
    const data = await res.json() as any;
    expect(data.feeds).toBeInstanceOf(Array);
    expect(data.feeds.length).toBe(1);
    expect(data.feeds[0].title).toBe('Fever Feed');
    expect(data.feeds[0].url).toBe('https://fever.test/rss');
    expect(data.feeds_groups).toBeDefined();
  });

  test('?items returns entries in Fever item format', async () => {
    const feedId = insertTestFeed(db);
    insertTestEntry(db, feedId, { title: 'Fever Entry' });

    const res = await app.request('http://localhost/fever?api&items');
    const data = await res.json() as any;
    expect(data.items).toBeInstanceOf(Array);
    expect(data.items.length).toBe(1);
    expect(data.items[0].title).toBe('Fever Entry');
    expect(data.items[0].html).toBeDefined();
    expect(data.items[0].is_read).toBeDefined();
    expect(data.items[0].is_saved).toBeDefined();
    expect(data.total_items).toBe(1);
  });

  test('?unread_item_ids returns comma-separated IDs', async () => {
    const feedId = insertTestFeed(db);
    const e1 = insertTestEntry(db, feedId, { is_read: 0 });
    const e2 = insertTestEntry(db, feedId, { is_read: 0 });
    insertTestEntry(db, feedId, { is_read: 1 });

    const res = await app.request('http://localhost/fever?api&unread_item_ids');
    const data = await res.json() as any;
    const ids = data.unread_item_ids.split(',').map(Number);
    expect(ids).toContain(e1 as number);
    expect(ids).toContain(e2 as number);
    expect(ids.length).toBe(2);
  });

  test('?saved_item_ids returns starred entries', async () => {
    const feedId = insertTestFeed(db);
    const starred = insertTestEntry(db, feedId, { is_starred: 1 });
    insertTestEntry(db, feedId, { is_starred: 0 });

    const res = await app.request('http://localhost/fever?api&saved_item_ids');
    const data = await res.json() as any;
    expect(data.saved_item_ids).toBe(String(starred));
  });

  test('POST mark item as read via Fever', async () => {
    const feedId = insertTestFeed(db);
    const entryId = insertTestEntry(db, feedId, { is_read: 0 });

    const body = new URLSearchParams({
      mark: 'item',
      as: 'read',
      id: String(entryId),
    });
    await app.request('http://localhost/fever?api', {
      method: 'POST',
      body: body.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const entry = queries.getEntryById(db, entryId)!;
    expect(entry.is_read).toBe(1);
  });

  test('?groups returns tags as Fever groups', async () => {
    queries.seedBuiltinTags(db);

    const res = await app.request('http://localhost/fever?api&groups');
    const data = await res.json() as any;
    expect(data.groups).toBeInstanceOf(Array);
    expect(data.groups.length).toBe(303);
    expect(data.feeds_groups).toBeDefined();
  });
});

describe('Smoke: Onboarding Flow', () => {
  let db: Database;
  let app: Hono;

  const req = (app: Hono, method: string, path: string, body?: unknown) => {
    const init: RequestInit = { method };
    if (body) {
      init.body = JSON.stringify(body);
      init.headers = { 'Content-Type': 'application/json' };
    }
    return app.request(`http://localhost/api${path}`, init);
  };

  beforeEach(() => {
    db = createTestDb();
    app = new Hono();
    app.route('/api', createApiRoutes(db, TEST_CONFIG));
  });

  test('onboarding starts incomplete', async () => {
    const res = await req(app, 'GET', '/config/onboarding');
    expect(res.status).toBe(200);
    const data = await res.json() as { complete: boolean };
    expect(data.complete).toBe(false);
  });

  test('completing onboarding persists preferences and flag', async () => {
    queries.seedBuiltinTags(db);
    const tags = queries.getAllTags(db);
    const politicsTag = tags.find(t => t.slug === 'us-politics')!;
    const techTag = tags.find(t => t.slug === 'web-dev')!;

    // Submit onboarding with preferences
    const res = await req(app, 'POST', '/config/onboarding', {
      preferences: {
        [String(politicsTag.id)]: 'blacklist',
        [String(techTag.id)]: 'whitelist',
      },
    });
    expect(res.status).toBe(200);

    // Onboarding should now be complete
    const checkRes = await req(app, 'GET', '/config/onboarding');
    const checkData = await checkRes.json() as { complete: boolean };
    expect(checkData.complete).toBe(true);

    // Preferences should be persisted
    const politicsPref = queries.getPreferenceForTag(db, politicsTag.id);
    expect(politicsPref!.mode).toBe('blacklist');
    const techPref = queries.getPreferenceForTag(db, techTag.id);
    expect(techPref!.mode).toBe('whitelist');
  });
});

describe('Smoke: OPML Export', () => {
  let db: Database;
  let app: Hono;

  beforeEach(() => {
    db = createTestDb();
    app = new Hono();
    app.route('/api', createApiRoutes(db, TEST_CONFIG));
  });

  test('exports feeds as valid OPML XML', async () => {
    insertTestFeed(db, { title: 'Export Feed', url: 'https://export.test/rss' });
    insertTestFeed(db, { title: 'Another Feed', url: 'https://another.test/atom' });

    const res = await app.request('http://localhost/api/opml/export');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/xml');
    expect(res.headers.get('Content-Disposition')).toContain('doomscroller-feeds.opml');

    const body = await res.text();
    expect(body).toContain('<?xml');
    expect(body).toContain('<opml');
    expect(body).toContain('xmlUrl="https://export.test/rss"');
    expect(body).toContain('xmlUrl="https://another.test/atom"');
    expect(body).toContain('text="Export Feed"');
  });

  test('empty feeds produces valid OPML with no outlines', async () => {
    const res = await app.request('http://localhost/api/opml/export');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<opml');
    expect(body).not.toContain('xmlUrl=');
  });
});

describe('Smoke: Stats Endpoint', () => {
  let db: Database;
  let app: Hono;

  beforeEach(() => {
    db = createTestDb();
    app = new Hono();
    app.route('/api', createApiRoutes(db, TEST_CONFIG));
  });

  test('stats reflect actual database state', async () => {
    const feedId = insertTestFeed(db);
    insertTestEntry(db, feedId, { is_read: 0 });
    insertTestEntry(db, feedId, { is_read: 1 });
    insertTestEntry(db, feedId, { is_read: 0, tagged_at: 12345 });

    const res = await app.request('http://localhost/api/stats');
    expect(res.status).toBe(200);
    const stats = await res.json() as any;
    expect(stats.total_feeds).toBe(1);
    expect(stats.total_entries).toBe(3);
    expect(stats.unread_entries).toBe(2);
    expect(stats.tagged_entries).toBe(1);
    expect(stats.pending_jobs).toBe(0);
  });
});

describe('Smoke: Cross-cutting Concerns', () => {
  let db: Database;
  let app: Hono;

  const req = (app: Hono, method: string, path: string, body?: unknown) => {
    const init: RequestInit = { method };
    if (body) {
      init.body = JSON.stringify(body);
      init.headers = { 'Content-Type': 'application/json' };
    }
    return app.request(`http://localhost/api${path}`, init);
  };

  beforeEach(() => {
    db = createTestDb();
    app = new Hono();
    app.route('/api', createApiRoutes(db, TEST_CONFIG));
  });

  test('deleting a feed cascades to entries and tags', async () => {
    const feedId = insertTestFeed(db);
    const entryId = insertTestEntry(db, feedId);
    const tagId = queries.createTag(db, 'cascade-test', 'Cascade', '', false);
    queries.addEntryTag(db, entryId, tagId, 'llm');

    // Delete feed via API
    const res = await req(app, 'DELETE', `/feeds/${feedId}`);
    expect(res.status).toBe(200);

    // Entry should be gone (cascade)
    expect(queries.getEntryById(db, entryId)).toBeNull();

    // entry_tags should be gone (cascade)
    const tags = queries.getTagsForEntry(db, entryId);
    expect(tags.length).toBe(0);

    // The tag itself should still exist
    expect(queries.getTagById(db, tagId)).not.toBeNull();
  });

  test('custom tag lifecycle: create → use → delete', async () => {
    // Create tag via API
    const createRes = await req(app, 'POST', '/tags', {
      slug: 'my-custom',
      label: 'My Custom Tag',
      tag_group: 'custom',
    });
    expect(createRes.status).toBe(201);
    const tag = await createRes.json() as any;

    // Set preference
    const prefRes = await req(app, 'PUT', `/tags/${tag.id}/preference`, { mode: 'whitelist' });
    expect(prefRes.status).toBe(200);

    // Delete tag
    const delRes = await req(app, 'DELETE', `/tags/${tag.id}`);
    expect(delRes.status).toBe(200);

    // Should be gone
    expect(queries.getTagBySlug(db, 'my-custom')).toBeNull();
    expect(queries.getPreferenceForTag(db, tag.id)).toBeNull();
  });

  test('builtin tags cannot be deleted via API', async () => {
    queries.seedBuiltinTags(db);
    const rust = queries.getTagBySlug(db, 'rust')!;

    const res = await req(app, 'DELETE', `/tags/${rust.id}`);
    expect(res.status).toBe(400);
    expect(queries.getTagBySlug(db, 'rust')).not.toBeNull();
  });
});
