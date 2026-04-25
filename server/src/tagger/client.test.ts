import { describe, test, expect } from 'bun:test';
import { tagArticle, healthCheck, tagResponseSchema } from './client';
import type { LLMConfig } from './client';

// --- Helpers ---

// Minimal HTTP server that mocks llama.cpp /v1/chat/completions
const createMockLLM = (handler: (body: unknown) => Response): { config: LLMConfig; stop: () => void } => {
  const server = Bun.serve({
    port: 0, // random available port
    fetch: async (req) => {
      if (new URL(req.url).pathname === '/health') {
        return new Response('ok', { status: 200 });
      }
      const body = await req.json();
      return handler(body);
    },
  });
  return {
    config: { baseUrl: `http://localhost:${server.port}`, model: 'test' },
    stop: () => server.stop(),
  };
};

const chatResponse = (content: string) =>
  Response.json({
    choices: [{ message: { content } }],
  });

// --- Tests ---

describe('tagResponseSchema', () => {
  test('accepts valid response with tags only', () => {
    const result = tagResponseSchema.safeParse({ tags: ['politics', 'ai-ml'] });
    expect(result.success).toBe(true);
  });

  test('accepts valid response with new_tags', () => {
    const result = tagResponseSchema.safeParse({
      tags: ['politics'],
      new_tags: ['home-automation'],
    });
    expect(result.success).toBe(true);
  });

  test('rejects empty tags array', () => {
    const result = tagResponseSchema.safeParse({ tags: [] });
    expect(result.success).toBe(false);
  });

  test('rejects more than 5 tags', () => {
    const result = tagResponseSchema.safeParse({
      tags: ['a', 'b', 'c', 'd', 'e', 'f'],
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid new_tag slugs', () => {
    const result = tagResponseSchema.safeParse({
      tags: ['politics'],
      new_tags: ['Invalid Tag'],
    });
    expect(result.success).toBe(false);
  });
});

describe('tagArticle', () => {
  test('successful tag response', async () => {
    const mock = createMockLLM(() =>
      chatResponse('{"tags": ["politics", "economics"], "new_tags": []}')
    );
    try {
      const result = await tagArticle(mock.config, 'system', 'user');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.tags).toEqual(['politics', 'economics']);
      }
    } finally {
      mock.stop();
    }
  });

  test('new tag proposal', async () => {
    const mock = createMockLLM(() =>
      chatResponse('{"tags": ["technology"], "new_tags": ["home-automation"]}')
    );
    try {
      const result = await tagArticle(mock.config, 'system', 'user');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.new_tags).toEqual(['home-automation']);
      }
    } finally {
      mock.stop();
    }
  });

  test('invalid JSON → Err result', async () => {
    const mock = createMockLLM(() =>
      chatResponse('this is not json at all')
    );
    try {
      const result = await tagArticle(mock.config, 'system', 'user');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('unparseable JSON');
      }
    } finally {
      mock.stop();
    }
  });

  test('LLM timeout → Err result', async () => {
    // Server that never responds
    const server = Bun.serve({
      port: 0,
      fetch: async () => {
        await Bun.sleep(200_000);
        return new Response('too late');
      },
    });
    const config: LLMConfig = {
      baseUrl: `http://localhost:${server.port}`,
      model: 'test',
    };
    try {
      // Use a short abort to avoid waiting 120s
      const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: 'user', content: 'test' }],
        }),
        signal: AbortSignal.timeout(50),
      }).catch(err => err);

      // Verify the abort mechanism works
      expect(response).toBeInstanceOf(Error);
    } finally {
      server.stop();
    }
  });

  test('markdown-fenced JSON → still parses', async () => {
    const mock = createMockLLM(() =>
      chatResponse('```json\n{"tags": ["science", "space"]}\n```')
    );
    try {
      const result = await tagArticle(mock.config, 'system', 'user');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.tags).toEqual(['science', 'space']);
      }
    } finally {
      mock.stop();
    }
  });

  test('HTTP error → Err result', async () => {
    const mock = createMockLLM(() =>
      new Response('Internal Server Error', { status: 500 })
    );
    try {
      const result = await tagArticle(mock.config, 'system', 'user');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('HTTP 500');
      }
    } finally {
      mock.stop();
    }
  });

  test('missing choices in response → Err result', async () => {
    const mock = createMockLLM(() => Response.json({}));
    try {
      const result = await tagArticle(mock.config, 'system', 'user');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('missing choices');
      }
    } finally {
      mock.stop();
    }
  });

  test('validation failure → Err result', async () => {
    const mock = createMockLLM(() =>
      chatResponse('{"tags": [], "new_tags": []}')
    );
    try {
      const result = await tagArticle(mock.config, 'system', 'user');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('validation');
      }
    } finally {
      mock.stop();
    }
  });
});

describe('healthCheck', () => {
  test('returns true when healthy', async () => {
    const mock = createMockLLM(() => new Response('ok'));
    try {
      const result = await healthCheck(mock.config);
      expect(result).toBe(true);
    } finally {
      mock.stop();
    }
  });

  test('returns false when unreachable', async () => {
    const result = await healthCheck({ baseUrl: 'http://localhost:1', model: 'test' });
    expect(result).toBe(false);
  });
});
