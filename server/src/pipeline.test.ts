import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { Hono } from 'hono';
import { parseFeed } from './feeds/parser';
import { fetchFeed, isNotModified } from './feeds/fetcher';
import * as queries from './db/queries';
import { enqueue, claimNextJob, completeJob } from './jobs/queue';
import { scoreBatch } from './scorer/batch';
import { createApiRoutes } from './api/routes';
import {
  createTestDb, createMockServer, insertTestFeed, insertTestEntry,
  insertTestCategory, TEST_CONFIG, RSS2_FEED, VALID_LLM_CLASSIFICATION,
} from './test-utils';
import type { FeedId, AppConfig } from './types';

// ============================================================================
// GATE 11: END-TO-END PIPELINE TEST
//
// This is the test that matters most.
//
// It proves a single truth: an RSS entry can travel from a remote feed
// all the way through to ranked delivery at the API layer — unmangled,
// properly classified, correctly filtered, faithfully ranked.
//
// A → Fetch → Parse → Store → Score → Rank → Deliver → B
//
// If this test passes, the pipeline works. Period.
// ============================================================================

describe('End-to-end pipeline', () => {
  let db: Database;
  let feedServer: { url: string; close: () => void };
  let llmServer: { url: string; close: () => void };
  let config: AppConfig;

  beforeEach(() => {
    db = createTestDb();

    // Seed categories that match the LLM classification fixture
    insertTestCategory(db, { name: 'Technology', slug: 'technology' });
    insertTestCategory(db, { name: 'Science', slug: 'science' });
    queries.setPreference(db, 'interest_profile', 'Interested in technology and science');
  });

  afterEach(() => {
    feedServer?.close();
    llmServer?.close();
  });

  test('RSS entry travels from fetch → parse → store → score → rank → API delivery', async () => {
    // ── Step 1: Host an RSS feed ──
    feedServer = createMockServer(() =>
      new Response(RSS2_FEED, {
        headers: {
          'Content-Type': 'application/rss+xml',
          'ETag': '"v1"',
        },
      })
    );

    // ── Step 2: Host a mock LLM ──
    llmServer = createMockServer((req) => {
      const url = new URL(req.url);
      if (url.pathname === '/health') return new Response('OK');
      return Response.json({
        choices: [{ message: { content: VALID_LLM_CLASSIFICATION } }],
      });
    });

    config = { ...TEST_CONFIG, llmBaseUrl: llmServer.url };

    // ── Step 3: Subscribe to the feed ──
    const feedId = queries.insertFeed(db, feedServer.url, '', '');

    // ── Step 4: FETCH — hit the network ──
    const fetchResult = await fetchFeed(feedServer.url, null, null);
    expect(fetchResult.ok).toBe(true);
    if (!fetchResult.ok) throw new Error(fetchResult.error);
    if (isNotModified(fetchResult.value)) throw new Error('Unexpected 304');

    // ── Step 5: PARSE — XML to structured data ──
    const parseResult = parseFeed(fetchResult.value.body);
    expect(parseResult.ok).toBe(true);
    if (!parseResult.ok) throw new Error(parseResult.error);

    const parsed = parseResult.value;
    expect(parsed.entries.length).toBeGreaterThan(0);

    // ── Step 6: STORE — write to database ──
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

    // ── Step 7: Verify entries are in the database ──
    const firstEntry = queries.getEntryById(db, storedIds[0] as any)!;
    expect(firstEntry.title).toBe('First Post');
    expect(firstEntry.author).toBe('Alice');
    expect(firstEntry.summary).toContain('Full content of the first post');
    expect(firstEntry.image_url).toBe('https://test.blog/img/first.jpg');
    expect(firstEntry.is_read).toBe(0);
    expect(firstEntry.is_starred).toBe(0);
    expect(firstEntry.is_hidden).toBe(0);

    // ── Step 8: Verify dedup — re-inserting the same entries returns null ──
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

    // ── Step 9: SCORE — run LLM classification ──
    const unscoredBefore = queries.getUnscoredEntryIds(db, 100);
    expect(unscoredBefore.length).toBe(2);

    const scored = await scoreBatch(db, config);
    expect(scored).toBe(2);

    const unscoredAfter = queries.getUnscoredEntryIds(db, 100);
    expect(unscoredAfter.length).toBe(0);

    // Verify score quality
    const score = db.query<{
      relevance: number; depth: number; novelty: number;
      category_id: number | null; reasoning: string; model: string;
    }, [number]>(
      'SELECT * FROM entry_scores WHERE entry_id = ?'
    ).get(storedIds[0]!);

    expect(score).not.toBeNull();
    expect(score!.relevance).toBe(0.85);
    expect(score!.depth).toBe(0.6);
    expect(score!.novelty).toBe(0.7);
    expect(score!.reasoning).toBeTruthy();
    expect(score!.model).toBe(config.llmModel);

    // Verify category association
    const catAssocs = db.query<{ category_id: number; confidence: number }, [number]>(
      'SELECT category_id, confidence FROM entry_categories WHERE entry_id = ? ORDER BY confidence DESC'
    ).all(storedIds[0]!);

    expect(catAssocs.length).toBe(2); // primary + secondary
    expect(catAssocs[0]!.confidence).toBe(1.0); // primary
    expect(catAssocs[1]!.confidence).toBe(0.7); // secondary

    // ── Step 10: RANK — query the ranked entries list ──
    const ranked = queries.getRankedEntries(db, { limit: 50, offset: 0 });
    expect(ranked.length).toBe(2);

    // Ranked entries should have all the data needed for display
    const topEntry = ranked[0]!;
    expect(topEntry.title).toBeTruthy();
    expect(topEntry.feed_title).toBe('Test Blog');
    expect(topEntry.is_hidden).toBe(0);

    // ── Step 11: DELIVER — serve through the API ──
    const api = createApiRoutes(db, config);
    const app = new Hono();
    app.route('/api', api);

    const res = await app.request('http://localhost/api/entries');
    expect(res.status).toBe(200);

    const apiEntries = await res.json() as any[];
    expect(apiEntries.length).toBe(2);
    expect(apiEntries[0].title).toBeTruthy();
    expect(apiEntries[0].feed_title).toBe('Test Blog');

    // ── Step 12: Verify conditional GET (304) on re-fetch ──
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

    // ── Step 13: Verify user actions propagate correctly ──
    const entryId = storedIds[0]! as any;

    // Mark as read
    queries.markEntryRead(db, entryId);
    expect(queries.getEntryById(db, entryId)!.is_read).toBe(1);
    queries.recordInteraction(db, entryId, 'read');

    // Star
    queries.markEntryStarred(db, entryId, true);
    expect(queries.getEntryById(db, entryId)!.is_starred).toBe(1);
    queries.recordInteraction(db, entryId, 'star');

    // Verify unread filter
    const unreadRes = await app.request('http://localhost/api/entries?unread=true');
    const unreadEntries = await unreadRes.json() as any[];
    expect(unreadEntries.length).toBe(1); // one of the two is now read

    // Verify category filter
    const techCat = queries.getCategoryByName(db, 'Technology')!;
    const catFilterRes = await app.request(`http://localhost/api/entries?category=${techCat.id}`);
    const catEntries = await catFilterRes.json() as any[];
    expect(catEntries.length).toBeGreaterThanOrEqual(1);

    // ── Step 14: Hide and verify exclusion ──
    queries.markEntryHidden(db, storedIds[1]! as any);
    const afterHide = queries.getRankedEntries(db, { limit: 50, offset: 0 });
    expect(afterHide.length).toBe(1); // hidden entry excluded
    expect(afterHide[0]!.id).toBe(storedIds[0]! as any);

    // ── DONE ──
    // The entry traveled from a remote RSS server through:
    //   fetch → parse → store → dedup → score → categorize → rank → deliver
    // and arrived at the API intact, properly classified, and correctly filtered.
  });

  test('pipeline handles LLM failure gracefully — entries still appear unscored', async () => {
    // Feed server
    feedServer = createMockServer(() =>
      new Response(RSS2_FEED, { headers: { 'Content-Type': 'application/rss+xml' } })
    );

    // LLM is DOWN
    config = { ...TEST_CONFIG, llmBaseUrl: 'http://localhost:1' };

    // Fetch + parse + store
    const feedId = queries.insertFeed(db, feedServer.url, '', '');
    const fetchResult = await fetchFeed(feedServer.url, null, null);
    if (!fetchResult.ok) throw new Error(fetchResult.error);
    if (isNotModified(fetchResult.value)) throw new Error('304');

    const parseResult = parseFeed(fetchResult.value.body);
    if (!parseResult.ok) throw new Error(parseResult.error);

    for (const entry of parseResult.value.entries) {
      queries.insertEntry(db, {
        feed_id: feedId,
        guid: entry.guid, url: entry.url, title: entry.title,
        author: entry.author, content_html: entry.contentHtml,
        summary: entry.summary, image_url: entry.imageUrl,
        published_at: entry.publishedAt,
      });
    }

    // Score attempt — should return 0 (LLM unreachable)
    const scored = await scoreBatch(db, config);
    expect(scored).toBe(0);

    // But entries STILL APPEAR in the ranked list with default relevance
    const ranked = queries.getRankedEntries(db, { limit: 50, offset: 0 });
    expect(ranked.length).toBe(2);
    // Unscored entries get 0.5 default relevance (from COALESCE in query)
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
