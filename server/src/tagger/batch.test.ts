import { describe, test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createTestDb, insertTestFeed, insertTestEntry, TEST_CONFIG } from '../test-utils';
import * as queries from '../db/queries';
import type { EntryId, TagId, AppConfig } from '../types';
import { float32ToBuffer, bufferToFloat32, buildEmbeddingInput, EMBEDDING_DIM } from './embeddings';
import { assignDepth, setDepthAnchorEmbeddings } from './batch';
import { DEPTH_ANCHORS } from '../taxonomy';

// --- Utility: cosine similarity (same as batch.ts) ---
const cosineSimilarity = (a: Float32Array, b: Float32Array): number => {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
  }
  return dot;
};

// --- Utility: create a normalized random vector ---
const randomVector = (dim: number = EMBEDDING_DIM): Float32Array => {
  const vec = new Float32Array(dim);
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    vec[i] = Math.random() - 0.5;
    norm += vec[i]! * vec[i]!;
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < dim; i++) {
    vec[i]! /= norm;
  }
  return vec;
};

describe('cosineSimilarity', () => {
  test('identical vectors have similarity 1.0', () => {
    const vec = randomVector();
    expect(cosineSimilarity(vec, vec)).toBeCloseTo(1.0, 4);
  });

  test('opposite vectors have similarity -1.0', () => {
    const vec = randomVector();
    const neg = new Float32Array(vec.length);
    for (let i = 0; i < vec.length; i++) {
      neg[i] = -vec[i]!;
    }
    expect(cosineSimilarity(vec, neg)).toBeCloseTo(-1.0, 4);
  });

  test('orthogonal vectors have similarity ~0', () => {
    // Use unit vectors along different axes
    const a = new Float32Array(EMBEDDING_DIM);
    a[0] = 1;
    const b = new Float32Array(EMBEDDING_DIM);
    b[1] = 1;
    expect(cosineSimilarity(a, b)).toBe(0);
  });
});

describe('float32 <-> Buffer conversion', () => {
  test('roundtrips correctly', () => {
    const original = randomVector();
    const buf = float32ToBuffer(original);
    expect(buf.byteLength).toBe(EMBEDDING_DIM * 4);

    const restored = bufferToFloat32(buf);
    expect(restored.length).toBe(EMBEDDING_DIM);
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      expect(restored[i]).toBeCloseTo(original[i]!, 6);
    }
  });
});

describe('buildEmbeddingInput', () => {
  test('builds input from entry fields', () => {
    const input = buildEmbeddingInput({
      title: 'Test Article',
      feed_title: 'Test Feed',
      summary: 'A summary',
      content_html: '<p>Some content here</p>',
    });

    expect(input).toContain('Test Article | Test Feed');
    expect(input).toContain('A summary');
    expect(input).toContain('Some content here');
    expect(input).not.toContain('<p>');
  });

  test('uses content as fallback when summary is empty', () => {
    const input = buildEmbeddingInput({
      title: 'Test',
      feed_title: 'Feed',
      summary: '',
      content_html: '<div>Content as summary fallback</div>',
    });

    expect(input).toContain('Content as summary fallback');
  });

  test('truncates long content', () => {
    const longContent = '<p>' + 'x'.repeat(10000) + '</p>';
    const input = buildEmbeddingInput({
      title: 'Test',
      feed_title: 'Feed',
      summary: 'Summary',
      content_html: longContent,
    });

    // Body portion should be limited to ~4000 chars
    expect(input.length).toBeLessThan(5000);
  });
});

describe('tag embedding storage', () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
    queries.seedBuiltinTags(db);
  });

  test('setTagEmbedding stores and retrieves embedding', () => {
    const tags = queries.getAllTags(db);
    const tag = tags[0]!;
    const vec = randomVector();
    const buf = float32ToBuffer(vec);

    queries.setTagEmbedding(db, tag.id, buf);

    const rows = queries.getAllTagEmbeddings(db);
    const stored = rows.find(r => r.id === tag.id);
    expect(stored).toBeDefined();

    const restored = bufferToFloat32(stored!.embedding);
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      expect(restored[i]).toBeCloseTo(vec[i]!, 6);
    }
  });

  test('setTagEmbedding rejects wrong-sized buffer', () => {
    const tags = queries.getAllTags(db);
    const tag = tags[0]!;
    const badBuf = Buffer.alloc(100); // wrong size

    expect(() => queries.setTagEmbedding(db, tag.id, badBuf)).toThrow();
  });
});

describe('entry embedding storage', () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  test('setEntryEmbedding stores embedding on entry', () => {
    const feedId = insertTestFeed(db);
    const entryId = insertTestEntry(db, feedId);
    const vec = randomVector();

    queries.setEntryEmbedding(db, entryId, float32ToBuffer(vec));

    // Verify via direct query
    const row = db.query<{ embedding: Buffer }, [number]>(
      'SELECT embedding FROM entries WHERE id = ?',
    ).get(entryId as unknown as number);

    expect(row).toBeDefined();
    expect(row!.embedding.byteLength).toBe(EMBEDDING_DIM * 4);
  });

  test('setEntryEmbedding rejects wrong-sized buffer', () => {
    const feedId = insertTestFeed(db);
    const entryId = insertTestEntry(db, feedId);
    const badBuf = Buffer.alloc(100);

    expect(() => queries.setEntryEmbedding(db, entryId, badBuf)).toThrow();
  });
});

describe('getUntaggedEntries', () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  test('returns entries with feed_title', () => {
    const feedId = insertTestFeed(db, { title: 'My Feed' });
    insertTestEntry(db, feedId, { title: 'Article 1' });

    const entries = queries.getUntaggedEntries(db, 10);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.feed_title).toBe('My Feed');
    expect(entries[0]!.title).toBe('Article 1');
  });

  test('excludes already-tagged entries', () => {
    const feedId = insertTestFeed(db);
    insertTestEntry(db, feedId, { tagged_at: Math.floor(Date.now() / 1000) });
    insertTestEntry(db, feedId, { title: 'Untagged' });

    const entries = queries.getUntaggedEntries(db, 10);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.title).toBe('Untagged');
  });
});

describe('assignDepth', () => {
  test('returns null when no depth anchors are set', () => {
    // Reset state by passing empty array
    setDepthAnchorEmbeddings([]);
    const vec = randomVector();
    expect(assignDepth(vec)).toBeNull();
  });

  test('returns a value in [0, 1] when anchors are set', () => {
    // Create 5 random normalized anchor embeddings
    const anchors = DEPTH_ANCHORS.map(() => randomVector());
    setDepthAnchorEmbeddings(anchors);

    const vec = randomVector();
    const score = assignDepth(vec);
    expect(score).not.toBeNull();
    expect(score!).toBeGreaterThanOrEqual(0);
    expect(score!).toBeLessThanOrEqual(1);
  });

  test('score biased toward matching anchor weight', () => {
    // If the article embedding equals the 'dense' anchor exactly,
    // softmax concentrates probability on that anchor (weight=0.9).
    // With 5 anchors and random others, the score is pulled toward ~0.6.
    const denseIndex = DEPTH_ANCHORS.findIndex(a => a.key === 'dense');
    const anchors = DEPTH_ANCHORS.map(() => randomVector());
    const denseVec = anchors[denseIndex]!;

    setDepthAnchorEmbeddings(anchors);

    // Article is exactly the dense anchor
    const score = assignDepth(denseVec);
    expect(score).not.toBeNull();
    // Should be noticeably above the midpoint (0.5)
    expect(score!).toBeGreaterThan(0.55);
  });

  test('score biased toward noise anchor weight', () => {
    const noiseIndex = DEPTH_ANCHORS.findIndex(a => a.key === 'noise');
    const anchors = DEPTH_ANCHORS.map(() => randomVector());
    const noiseVec = anchors[noiseIndex]!;

    setDepthAnchorEmbeddings(anchors);

    const score = assignDepth(noiseVec);
    expect(score).not.toBeNull();
    // Should be noticeably below the midpoint (0.5)
    expect(score!).toBeLessThan(0.45);
  });

  test('softmax weights sum to 1', () => {
    // Verify the math: for identical similarities to all anchors,
    // softmax gives equal probabilities → weighted average = mean of weights
    const meanWeight = DEPTH_ANCHORS.reduce((s, a) => s + a.weight, 0) / DEPTH_ANCHORS.length;

    // Create anchors all equal to each other (maximum similarity = 1.0 to all)
    const sharedVec = randomVector();
    const anchors = DEPTH_ANCHORS.map(() => sharedVec);
    setDepthAnchorEmbeddings(anchors);

    const score = assignDepth(sharedVec);
    expect(score).not.toBeNull();
    expect(score!).toBeCloseTo(meanWeight, 3);
  });
});
