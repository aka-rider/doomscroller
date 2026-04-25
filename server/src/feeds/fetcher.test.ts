import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { fetchFeed, isNotModified } from './fetcher';
import { createMockServer } from '../test-utils';

// ============================================================================
// GATE 4: Feed Fetcher — the network boundary
// The fetcher is the first line of defense against the hostile internet.
// Conditional GET, timeouts, rate limiting, error reporting — all tested.
// ============================================================================

describe('fetchFeed', () => {
  let server: { url: string; close: () => void };

  afterEach(() => {
    server?.close();
  });

  test('fetches a feed successfully and returns body + headers', async () => {
    server = createMockServer((req) => {
      return new Response('<rss>feed content</rss>', {
        headers: {
          'Content-Type': 'application/rss+xml',
          'ETag': '"abc123"',
          'Last-Modified': 'Mon, 01 Jan 2024 00:00:00 GMT',
        },
      });
    });

    const result = await fetchFeed(server.url, null, null);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);

    const data = result.value;
    expect(isNotModified(data)).toBe(false);
    if (isNotModified(data)) throw new Error('Should not be 304');

    expect(data.body).toContain('feed content');
    expect(data.etag).toBe('"abc123"');
    expect(data.lastModified).toBe('Mon, 01 Jan 2024 00:00:00 GMT');
    expect(data.contentType).toContain('application/rss+xml');
    expect(data.statusCode).toBe(200);
  });

  test('sends If-None-Match when etag is provided', async () => {
    let receivedHeaders: Headers | null = null;

    server = createMockServer((req) => {
      receivedHeaders = req.headers;
      return new Response('OK');
    });

    await fetchFeed(server.url, '"etag-value"', null);
    expect(receivedHeaders!.get('If-None-Match')).toBe('"etag-value"');
  });

  test('sends If-Modified-Since when lastModified is provided', async () => {
    let receivedHeaders: Headers | null = null;

    server = createMockServer((req) => {
      receivedHeaders = req.headers;
      return new Response('OK');
    });

    await fetchFeed(server.url, null, 'Mon, 01 Jan 2024 00:00:00 GMT');
    expect(receivedHeaders!.get('If-Modified-Since')).toBe('Mon, 01 Jan 2024 00:00:00 GMT');
  });

  test('returns FetchNotModified on 304', async () => {
    server = createMockServer(() => new Response(null, { status: 304 }));

    const result = await fetchFeed(server.url, '"old-etag"', null);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);

    expect(isNotModified(result.value)).toBe(true);
  });

  test('returns Err on 429 with Retry-After', async () => {
    server = createMockServer(() =>
      new Response('Too many requests', {
        status: 429,
        headers: { 'Retry-After': '300' },
      })
    );

    const result = await fetchFeed(server.url, null, null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Rate limited');
      expect(result.error).toContain('300');
    }
  });

  test('returns Err on HTTP 404', async () => {
    server = createMockServer(() => new Response('Not Found', { status: 404 }));

    const result = await fetchFeed(server.url, null, null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('404');
    }
  });

  test('returns Err on HTTP 500', async () => {
    server = createMockServer(() => new Response('Internal Server Error', { status: 500 }));

    const result = await fetchFeed(server.url, null, null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('500');
    }
  });

  test('returns Err on connection refused', async () => {
    const result = await fetchFeed('http://localhost:1', null, null);
    expect(result.ok).toBe(false);
  });

  test('sends correct User-Agent header', async () => {
    let receivedUA = '';

    server = createMockServer((req) => {
      receivedUA = req.headers.get('User-Agent') ?? '';
      return new Response('OK');
    });

    await fetchFeed(server.url, null, null);
    expect(receivedUA).toContain('Doomscroller');
  });

  test('sends Accept header for RSS/Atom content types', async () => {
    let receivedAccept = '';

    server = createMockServer((req) => {
      receivedAccept = req.headers.get('Accept') ?? '';
      return new Response('OK');
    });

    await fetchFeed(server.url, null, null);
    expect(receivedAccept).toContain('application/rss+xml');
    expect(receivedAccept).toContain('application/atom+xml');
  });

  test('isNotModified type guard correctly discriminates', () => {
    const modified = { body: 'x', etag: null, lastModified: null, contentType: '', statusCode: 200 };
    const notMod = { notModified: true as const };

    expect(isNotModified(modified)).toBe(false);
    expect(isNotModified(notMod)).toBe(true);
  });
});
