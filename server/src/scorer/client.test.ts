import { describe, test, expect, afterEach } from 'bun:test';
import { classifyEntry, suggestCategories, healthCheck } from './client';
import {
  createMockServer,
  VALID_LLM_CLASSIFICATION,
  LLM_CLASSIFICATION_WITH_FENCES,
  LLM_CLASSIFICATION_INVALID_RANGE,
  LLM_GARBAGE,
} from '../test-utils';

// ============================================================================
// GATE 7: LLM Scorer Client — the intelligence boundary
// The LLM is a hostile external system. It returns garbage, times out,
// wraps JSON in markdown fences, and hallucinates field names.
// Every failure mode is tested. Zod validation is non-negotiable.
// ============================================================================

describe('classifyEntry', () => {
  let server: { url: string; close: () => void };

  afterEach(() => {
    server?.close();
  });

  const entry = { title: 'Test Article', summary: 'A test summary', feedTitle: 'Test Feed' };
  const categories = ['Technology', 'Science', 'Politics'];
  const userProfile = 'Interested in tech and science';

  test('classifies entry with valid LLM response', async () => {
    server = createMockServer(() =>
      Response.json({
        choices: [{ message: { content: VALID_LLM_CLASSIFICATION } }],
      })
    );

    const result = await classifyEntry(
      { baseUrl: server.url, model: 'test' },
      entry, categories, userProfile,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);

    expect(result.value.category).toBe('Technology');
    expect(result.value.relevance).toBe(0.85);
    expect(result.value.depth).toBe(0.6);
    expect(result.value.novelty).toBe(0.7);
    expect(result.value.secondary_categories).toEqual(['Science']);
    expect(result.value.reasoning).toBeTruthy();
  });

  test('strips markdown fences from LLM response', async () => {
    server = createMockServer(() =>
      Response.json({
        choices: [{ message: { content: LLM_CLASSIFICATION_WITH_FENCES } }],
      })
    );

    const result = await classifyEntry(
      { baseUrl: server.url, model: 'test' },
      entry, categories, userProfile,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.category).toBe('Technology');
  });

  test('returns Err when LLM output fails Zod validation (out of range)', async () => {
    server = createMockServer(() =>
      Response.json({
        choices: [{ message: { content: LLM_CLASSIFICATION_INVALID_RANGE } }],
      })
    );

    const result = await classifyEntry(
      { baseUrl: server.url, model: 'test' },
      entry, categories, userProfile,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('validation failed');
    }
  });

  test('returns Err when LLM returns non-JSON garbage', async () => {
    server = createMockServer(() =>
      Response.json({
        choices: [{ message: { content: LLM_GARBAGE } }],
      })
    );

    const result = await classifyEntry(
      { baseUrl: server.url, model: 'test' },
      entry, categories, userProfile,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('invalid JSON');
    }
  });

  test('returns Err when LLM API returns HTTP error', async () => {
    server = createMockServer(() => new Response('Internal Server Error', { status: 500 }));

    const result = await classifyEntry(
      { baseUrl: server.url, model: 'test' },
      entry, categories, userProfile,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('500');
    }
  });

  test('returns Err when LLM response missing choices', async () => {
    server = createMockServer(() => Response.json({}));

    const result = await classifyEntry(
      { baseUrl: server.url, model: 'test' },
      entry, categories, userProfile,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('missing');
    }
  });

  test('returns Err on connection refused (LLM down)', async () => {
    const result = await classifyEntry(
      { baseUrl: 'http://localhost:1', model: 'test' },
      entry, categories, userProfile,
    );

    expect(result.ok).toBe(false);
  });

  test('handles LLM returning empty secondary_categories', async () => {
    const classification = JSON.stringify({
      category: 'Science',
      relevance: 0.5,
      depth: 0.5,
      novelty: 0.5,
      reasoning: 'test',
      // no secondary_categories — Zod default should kick in
    });

    server = createMockServer(() =>
      Response.json({
        choices: [{ message: { content: classification } }],
      })
    );

    const result = await classifyEntry(
      { baseUrl: server.url, model: 'test' },
      entry, categories, userProfile,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.secondary_categories).toEqual([]);
  });

  test('validates relevance is between 0 and 1', async () => {
    const tooLow = JSON.stringify({
      category: 'Test',
      secondary_categories: [],
      relevance: -0.1,
      depth: 0.5,
      novelty: 0.5,
      reasoning: 'test',
    });

    server = createMockServer(() =>
      Response.json({ choices: [{ message: { content: tooLow } }] })
    );

    const result = await classifyEntry(
      { baseUrl: server.url, model: 'test' },
      entry, categories, userProfile,
    );

    expect(result.ok).toBe(false);
  });
});

describe('suggestCategories', () => {
  let server: { url: string; close: () => void };

  afterEach(() => {
    server?.close();
  });

  test('returns suggested category names', async () => {
    server = createMockServer(() =>
      Response.json({
        choices: [{ message: { content: '["Technology", "Science"]' } }],
      })
    );

    const result = await suggestCategories(
      { baseUrl: server.url, model: 'test' },
      'Ars Technica',
      ['GPU benchmarks', 'Climate study'],
      ['Technology'],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value).toEqual(['Technology', 'Science']);
  });

  test('returns Err when LLM returns non-array', async () => {
    server = createMockServer(() =>
      Response.json({
        choices: [{ message: { content: '"just a string"' } }],
      })
    );

    const result = await suggestCategories(
      { baseUrl: server.url, model: 'test' },
      'Feed', [], [],
    );

    expect(result.ok).toBe(false);
  });

  test('returns Err when LLM returns array of non-strings', async () => {
    server = createMockServer(() =>
      Response.json({
        choices: [{ message: { content: '[1, 2, 3]' } }],
      })
    );

    const result = await suggestCategories(
      { baseUrl: server.url, model: 'test' },
      'Feed', [], [],
    );

    expect(result.ok).toBe(false);
  });

  test('strips markdown fences from category response', async () => {
    server = createMockServer(() =>
      Response.json({
        choices: [{ message: { content: '```json\n["Tech"]\n```' } }],
      })
    );

    const result = await suggestCategories(
      { baseUrl: server.url, model: 'test' },
      'Feed', [], [],
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(['Tech']);
  });
});

describe('healthCheck', () => {
  let server: { url: string; close: () => void };

  afterEach(() => {
    server?.close();
  });

  test('returns true when /health responds 200', async () => {
    server = createMockServer((req) => {
      if (new URL(req.url).pathname === '/health') {
        return new Response('OK');
      }
      return new Response('Not Found', { status: 404 });
    });

    const healthy = await healthCheck({ baseUrl: server.url, model: 'test' });
    expect(healthy).toBe(true);
  });

  test('returns false when /health responds 500', async () => {
    server = createMockServer(() => new Response('Error', { status: 500 }));

    const healthy = await healthCheck({ baseUrl: server.url, model: 'test' });
    expect(healthy).toBe(false);
  });

  test('returns false when server is unreachable', async () => {
    const healthy = await healthCheck({ baseUrl: 'http://localhost:1', model: 'test' });
    expect(healthy).toBe(false);
  });
});
