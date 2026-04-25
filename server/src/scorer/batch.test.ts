import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { scoreBatch, autoCategorizeFeed } from './batch';
import * as queries from '../db/queries';
import {
  createTestDb, insertTestFeed, insertTestEntry, insertTestCategory,
  createMockServer, TEST_CONFIG, VALID_LLM_CLASSIFICATION,
} from '../test-utils';
import type { FeedId, AppConfig } from '../types';

// ============================================================================
// GATE 8: Batch Scoring — the orchestration layer
// Proves that: unscored entries are found, sent to LLM, validated, written
// back to the database with correct category associations.
// This is where the pipeline comes together.
// ============================================================================

describe('scoreBatch', () => {
  let db: Database;
  let feedId: FeedId;
  let server: { url: string; close: () => void };
  let config: AppConfig;

  beforeEach(() => {
    db = createTestDb();
    feedId = insertTestFeed(db, { title: 'Test Feed' });
    insertTestCategory(db, { name: 'Technology', slug: 'technology' });
    insertTestCategory(db, { name: 'Science', slug: 'science' });
    queries.setPreference(db, 'interest_profile', 'Interested in tech');
  });

  afterEach(() => {
    server?.close();
  });

  const setupLLM = (responseBody: string = VALID_LLM_CLASSIFICATION) => {
    server = createMockServer((req) => {
      const url = new URL(req.url);
      if (url.pathname === '/health') return new Response('OK');
      return Response.json({
        choices: [{ message: { content: responseBody } }],
      });
    });
    config = { ...TEST_CONFIG, llmBaseUrl: server.url };
  };

  test('scores unscored entries and writes scores to database', async () => {
    setupLLM();

    const e1 = insertTestEntry(db, feedId, { title: 'Entry 1', summary: 'Summary 1' });
    const e2 = insertTestEntry(db, feedId, { title: 'Entry 2', summary: 'Summary 2' });

    const scored = await scoreBatch(db, config);
    expect(scored).toBe(2);

    // Verify scores were written
    const score1 = db.query<{ relevance: number }, [number]>(
      'SELECT relevance FROM entry_scores WHERE entry_id = ?'
    ).get(e1 as number);
    expect(score1).not.toBeNull();
    expect(score1!.relevance).toBe(0.85);

    const score2 = db.query<{ relevance: number }, [number]>(
      'SELECT relevance FROM entry_scores WHERE entry_id = ?'
    ).get(e2 as number);
    expect(score2).not.toBeNull();
  });

  test('writes primary category association with confidence 1.0', async () => {
    setupLLM();
    const e = insertTestEntry(db, feedId, { title: 'Tech article' });

    await scoreBatch(db, config);

    const ec = db.query<{ confidence: number; category_id: number }, [number]>(
      'SELECT confidence, category_id FROM entry_categories WHERE entry_id = ?'
    ).all(e as number);

    // Primary category "Technology" at 1.0
    const primary = ec.find(r => r.confidence === 1.0);
    expect(primary).toBeDefined();

    // Secondary category "Science" at 0.7
    const secondary = ec.find(r => r.confidence === 0.7);
    expect(secondary).toBeDefined();
  });

  test('returns 0 when LLM is unreachable', async () => {
    config = { ...TEST_CONFIG, llmBaseUrl: 'http://localhost:1' };
    insertTestEntry(db, feedId);

    const scored = await scoreBatch(db, config);
    expect(scored).toBe(0);
  });

  test('returns 0 when no unscored entries exist', async () => {
    setupLLM();

    const scored = await scoreBatch(db, config);
    expect(scored).toBe(0);
  });

  test('continues scoring remaining entries when one fails', async () => {
    let callCount = 0;
    server = createMockServer((req) => {
      const url = new URL(req.url);
      if (url.pathname === '/health') return new Response('OK');
      callCount++;
      if (callCount === 1) {
        // First entry fails
        return Response.json({
          choices: [{ message: { content: 'NOT VALID JSON' } }],
        });
      }
      return Response.json({
        choices: [{ message: { content: VALID_LLM_CLASSIFICATION } }],
      });
    });
    config = { ...TEST_CONFIG, llmBaseUrl: server.url };

    insertTestEntry(db, feedId, { title: 'Fails' });
    insertTestEntry(db, feedId, { title: 'Succeeds' });

    const scored = await scoreBatch(db, config);
    // One failed, one succeeded
    expect(scored).toBe(1);
  });

  test('does not re-score already scored entries', async () => {
    setupLLM();

    const e = insertTestEntry(db, feedId);
    db.run(
      `INSERT INTO entry_scores (entry_id, relevance, depth, novelty, reasoning, model)
       VALUES (?, 0.5, 0.5, 0.5, 'already scored', 'old-model')`,
      [e],
    );

    const scored = await scoreBatch(db, config);
    expect(scored).toBe(0);
  });

  test('respects scoreBatchSize config', async () => {
    let llmCallCount = 0;
    server = createMockServer((req) => {
      const url = new URL(req.url);
      if (url.pathname === '/health') return new Response('OK');
      llmCallCount++;
      return Response.json({
        choices: [{ message: { content: VALID_LLM_CLASSIFICATION } }],
      });
    });
    config = { ...TEST_CONFIG, llmBaseUrl: server.url, scoreBatchSize: 2 };

    // Create 5 entries
    for (let i = 0; i < 5; i++) {
      insertTestEntry(db, feedId, { title: `Entry ${i}` });
    }

    const scored = await scoreBatch(db, config);
    expect(scored).toBe(2); // only batch of 2
    expect(llmCallCount).toBe(2);
  });
});

describe('autoCategorizeFeed', () => {
  let db: Database;
  let server: { url: string; close: () => void };
  let config: AppConfig;

  beforeEach(() => {
    db = createTestDb();
    insertTestCategory(db, { name: 'Technology', slug: 'technology' });
  });

  afterEach(() => {
    server?.close();
  });

  test('creates new categories and links them to feed', async () => {
    server = createMockServer((req) => {
      const url = new URL(req.url);
      if (url.pathname === '/health') return new Response('OK');
      return Response.json({
        choices: [{ message: { content: '["Technology", "Space"]' } }],
      });
    });
    config = { ...TEST_CONFIG, llmBaseUrl: server.url };

    const feedId = insertTestFeed(db, { title: 'Space News' }) as number;

    const assigned = await autoCategorizeFeed(
      db, config, feedId, 'Space News',
      ['Mars rover update', 'SpaceX launch'],
    );

    expect(assigned).toContain('Technology');
    expect(assigned).toContain('Space');

    // "Space" category should be created as auto
    const spaceCat = queries.getCategoryByName(db, 'Space');
    expect(spaceCat).not.toBeNull();
    expect(spaceCat!.is_auto).toBe(1);

    // Feed should be linked to both categories
    const links = db.query<{ category_id: number }, [number]>(
      'SELECT category_id FROM feed_categories WHERE feed_id = ?'
    ).all(feedId);
    expect(links.length).toBe(2);
  });

  test('returns empty array when LLM is unreachable', async () => {
    config = { ...TEST_CONFIG, llmBaseUrl: 'http://localhost:1' };
    const feedId = insertTestFeed(db) as number;

    const assigned = await autoCategorizeFeed(db, config, feedId, 'Feed', []);
    expect(assigned).toEqual([]);
  });

  test('reuses existing categories instead of creating duplicates', async () => {
    server = createMockServer((req) => {
      const url = new URL(req.url);
      if (url.pathname === '/health') return new Response('OK');
      return Response.json({
        choices: [{ message: { content: '["Technology"]' } }],
      });
    });
    config = { ...TEST_CONFIG, llmBaseUrl: server.url };

    const feedId = insertTestFeed(db) as number;
    await autoCategorizeFeed(db, config, feedId, 'Tech Feed', ['GPU review']);

    // Should not create a new "Technology" — one already exists
    const cats = queries.getAllCategories(db);
    const techCats = cats.filter(c => c.name === 'Technology');
    expect(techCats).toHaveLength(1);
  });
});
