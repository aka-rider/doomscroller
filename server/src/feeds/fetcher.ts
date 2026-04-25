import type { Result } from '../types';
import { Ok, Err } from '../types';

// Fetches a URL with conditional GET support (ETag / If-Modified-Since).
// Returns raw text body and cache headers. No parsing here — that's parser.ts's job.

export interface FetchResult {
  readonly body: string;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly contentType: string;
  readonly statusCode: number;
}

export interface FetchNotModified {
  readonly notModified: true;
}

export type FeedFetchResult = FetchResult | FetchNotModified;

const TIMEOUT_MS = 30_000;
const USER_AGENT = 'Doomscroller/1.0 (RSS Reader; +https://github.com/doomscroller)';

export const fetchFeed = async (
  url: string,
  etag: string | null,
  lastModified: string | null,
): Promise<Result<FeedFetchResult, string>> => {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.1',
  };

  if (etag) headers['If-None-Match'] = etag;
  if (lastModified) headers['If-Modified-Since'] = lastModified;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(url, {
      headers,
      signal: controller.signal,
      redirect: 'follow',
    });

    clearTimeout(timeout);

    if (response.status === 304) {
      return Ok({ notModified: true });
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      return Err(`Rate limited. Retry-After: ${retryAfter ?? 'unknown'}`);
    }

    if (!response.ok) {
      return Err(`HTTP ${response.status}: ${response.statusText}`);
    }

    const body = await response.text();

    return Ok({
      body,
      etag: response.headers.get('ETag'),
      lastModified: response.headers.get('Last-Modified'),
      contentType: response.headers.get('Content-Type') ?? '',
      statusCode: response.status,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return Err(`Timeout after ${TIMEOUT_MS}ms`);
    }
    return Err(err instanceof Error ? err.message : String(err));
  }
};

export const isNotModified = (result: FeedFetchResult): result is FetchNotModified =>
  'notModified' in result;
