import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { Hono } from 'hono';
import { parseFeed } from './feeds/parser';
import { fetchFeed, isNotModified } from './feeds/fetcher';
import * as queries from './db/queries';
import { enqueue, claimNextJob, completeJob } from './jobs/queue';
import { createApiRoutes } from './api/routes';
import {
  createTestDb, createMockServer, insertTestFeed, insertTestEntry,
  TEST_CONFIG, RSS2_FEED,
} from './test-utils';
import type { FeedId, AppConfig } from './types';

// ============================================================================
// GATE 11: END-TO-END PIPELINE TEST
//
// Proves an RSS entry can travel from a remote feed through:
//   fetch → parse → store → deliver
//
// Scoring removed in D1 — will be replaced by tag pipeline in D4.
// ============================================================================

describe('End-to-end pipeline', () => {
  let db: Database;
  let feedServer: { url: string; close: () => void };
  let config: AppConfig;

  beforeEach(() => {
    db = createTestDb();
    config = { ...TEST_CONFIG };
  });

  afterEach(() => {
    feedServer?.close();
  });

  test('RSS entry travels from fetch → parse → store → API delivery', async () => {
    // ── Step 1: Host an RSS feed ──
    feedServer = createMockServer(() =>
      new Response(RSS2_FEED, {
        headers: {
          'Content-Type': 'application/rss+xml',
          'ETag': '"v1"',
        },
      })
    );

    // ── Step 2: Subscribe to the feed ──
    const feedId = queries.insertFeed(db, feedServer.url, '', '');

    // ── Step 3: FETCH — hit the network ──
    const fetchResult = await fetchFeed(feedServer.url, null, null);
    expect(fetchResult.ok).toBe(true);
    if (!fetchResult.ok) throw new Error(fetchResult.error);
    if (isNotModified(fetchResult.value)) throw new Error('Unexpected 304');

    // ── Step 4: PARSE — XML to structured data ──
    const parseResult = parseFeed(fetchResult.value.body);
    expect(parseResult.ok).toBe(true);
    if (!parseResult.ok) throw new Error(parseResult.error);

    const parsed = parseResult.value;
    expect(parsed.entries.length).toBeGreaterThan(0);

    // ── Step 5: STORE — write to database ──
    const storedIds: number[] = [];
    for (const entry of parsed.entries) {
      const id = queries.insertEntry(db, {
        feed_id: feedId,
        guid: entry.guid,
        url: entry.url,
        title: entry.title,
        author: entry.author,
        content_html: entry.contentHtml,
        summary: entry.summary,
        image_url: entry.imageUrl,
        published_at: entry.publishedAt,
      });
      if (id !== null) storedIds.push(id as number);
    }

    expect(storedIds.length).toBe(2); // RSS2_FEED has 2 items

    // Update feed metadata (as the real handler does)
    queries.updateFeedAfterFetch(
      db, feedId,
      fetchResult.value.etag, fetchResult.value.lastModified,
      parsed.title,
    );

    // Verify feed title was updated
    const updatedFeed = queries.getFeedById(db, feedId)!;
    expect(updatedFeed.title).toBe('Test Blog');
    expect(updatedFeed.etag).toBe('"v1"');
    expect(updatedFeed.error_count).toBe(0);

    // ── Step 6: Verify entries are in the database ──
    const firstEntry = queries.getEntryById(db, storedIds[0] as any)!;
    expect(firstEntry.title).toBe('First Post');
    expect(firstEntry.author).toBe('Alice');
    expect(firstEntry.summary).toContain('Full content of the first post');
    expect(firstEntry.image_url).toBe('https://test.blog/img/first.jpg');
    expect(firstEntry.is_read).toBe(0);

    // ── Step 7: Verify dedup — re-inserting the same entries returns null ──
    for (const entry of parsed.entries) {
      const dupId = queries.insertEntry(db, {
        feed_id: feedId,
        guid: entry.guid,
        url: entry.url,
        title: entry.title,
        author: entry.author,
        content_html: entry.contentHtml,
        summary: entry.summary,
        image_url: entry.imageUrl,
        published_at: entry.publishedAt,
      });
      expect(dupId).toBeNull(); // DEDUP: same (feed_id, guid) = ignored
    }

    // ── Step 8: DELIVER — serve through the API ──
    const api = createApiRoutes(db, config);
    const app = new Hono();
    app.route('/api', api);

    const res = await app.request('http://localhost/api/entries');
    expect(res.status).toBe(200);

    const apiEntries = await res.json() as any[];
    expect(apiEntries.length).toBe(2);
    expect(apiEntries[0].title).toBeTruthy();
    expect(apiEntries[0].feed_title).toBe('Test Blog');

    // ── Step 9: Verify conditional GET (304) on re-fetch ──
    feedServer.close();
    feedServer = createMockServer((req) => {
      if (req.headers.get('If-None-Match') === '"v1"') {
        return new Response(null, { status: 304 });
      }
      return new Response(RSS2_FEED);
    });

    const refetchResult = await fetchFeed(
      feedServer.url,
      updatedFeed.etag,
      updatedFeed.last_modified,
    );
    expect(refetchResult.ok).toBe(true);
    if (refetchResult.ok) {
      expect(isNotModified(refetchResult.value)).toBe(true);
    }

    // ── Step 10: Verify user actions propagate correctly ──
    const entryId = storedIds[0]! as any;

    // Mark as read
    queries.markEntryRead(db, entryId);
    expect(queries.getEntryById(db, entryId)!.is_read).toBe(1);

    // Thumb up (favorite)
    queries.setEntryThumb(db, entryId, 1);
    expect(queries.getEntryById(db, entryId)!.thumb).toBe(1);

    // Verify unread filter
    const unreadRes = await app.request('http://localhost/api/entries?unread=true');
    const unreadEntries = await unreadRes.json() as any[];
    expect(unreadEntries.length).toBe(1); // one of the two is now read

    // ── DONE ──
    // The entry traveled from a remote RSS server through:
    //   fetch → parse → store → dedup → deliver
    // and arrived at the API intact and correctly filtered.
  });

  test('pipeline handles duplicate entries across multiple fetch cycles', async () => {
    feedServer = createMockServer(() =>
      new Response(RSS2_FEED, { headers: { 'Content-Type': 'application/rss+xml' } })
    );

    const feedId = queries.insertFeed(db, feedServer.url, '', '');

    // First fetch cycle
    const r1 = await fetchFeed(feedServer.url, null, null);
    if (!r1.ok || isNotModified(r1.value)) throw new Error('Failed');
    const p1 = parseFeed(r1.value.body);
    if (!p1.ok) throw new Error(p1.error);

    let count1 = 0;
    for (const entry of p1.value.entries) {
      const id = queries.insertEntry(db, {
        feed_id: feedId,
        guid: entry.guid, url: entry.url, title: entry.title,
        author: entry.author, content_html: entry.contentHtml,
        summary: entry.summary, image_url: entry.imageUrl,
        published_at: entry.publishedAt,
      });
      if (id !== null) count1++;
    }
    expect(count1).toBe(2);

    // Second fetch cycle — same entries
    const r2 = await fetchFeed(feedServer.url, null, null);
    if (!r2.ok || isNotModified(r2.value)) throw new Error('Failed');
    const p2 = parseFeed(r2.value.body);
    if (!p2.ok) throw new Error(p2.error);

    let count2 = 0;
    for (const entry of p2.value.entries) {
      const id = queries.insertEntry(db, {
        feed_id: feedId,
        guid: entry.guid, url: entry.url, title: entry.title,
        author: entry.author, content_html: entry.contentHtml,
        summary: entry.summary, image_url: entry.imageUrl,
        published_at: entry.publishedAt,
      });
      if (id !== null) count2++;
    }
    expect(count2).toBe(0); // all duplicates

    // Total entries: still 2
    const stats = queries.getStats(db);
    expect(stats.total_entries).toBe(2);
  });

  test('pipeline handles feed errors without corrupting state', async () => {
    const feedId = queries.insertFeed(db, 'http://localhost:1/broken', '', '');

    // Fetch fails
    const result = await fetchFeed('http://localhost:1/broken', null, null);
    expect(result.ok).toBe(false);

    // Record the error (as the real handler does)
    if (!result.ok) {
      queries.updateFeedError(db, feedId, result.error);
    }

    // Feed should still exist with error recorded
    const feed = queries.getFeedById(db, feedId)!;
    expect(feed.error_count).toBe(1);
    expect(feed.last_error).toBeTruthy();

    // No entries should have been created
    const stats = queries.getStats(db);
    expect(stats.total_entries).toBe(0);
  });
});
