// Full article extraction via Mozilla Readability.
// Fetches a URL, parses with linkedom, extracts readable content.
// On-demand: called when user expands an entry, cached in SQLite.

import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { z } from 'zod';
import type { Result } from '../types';
import { Ok, Err } from '../types';

const TIMEOUT_MS = 30_000;
const USER_AGENT = 'Doomscroller/1.0 (RSS Reader; +https://github.com/doomscroller)';

export interface ExtractedArticle {
  readonly contentHtml: string;   // Clean HTML for rendering
  readonly textContent: string;   // Plain text
  readonly title: string;
  readonly byline: string | null;
  readonly length: number;        // Character count of text content
}

// Readability output shape — validated with Zod
const readabilitySchema = z.object({
  title: z.string(),
  byline: z.string().nullable(),
  content: z.string(),
  textContent: z.string(),
  length: z.number(),
});

// Strip dangerous elements and attributes from HTML.
// Defense-in-depth: Readability already strips most, but we're explicit.
const sanitizeHtml = (html: string): string => {
  // Remove dangerous tags entirely
  let clean = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<iframe\b[^>]*>.*?<\/iframe>/gi, '')
    .replace(/<object\b[^>]*>.*?<\/object>/gi, '')
    .replace(/<embed\b[^>]*\/?>/gi, '')
    .replace(/<form\b[^>]*>.*?<\/form>/gi, '');

  // Remove event handler attributes (on*)
  clean = clean.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // Remove javascript: URLs
  clean = clean.replace(/\bhref\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"');
  clean = clean.replace(/\bsrc\s*=\s*["']javascript:[^"']*["']/gi, 'src=""');

  return clean;
};

// Fetch and extract a readable article from a URL.
export const extractArticle = async (url: string): Promise<Result<ExtractedArticle, string>> => {
  if (!url) return Err('Empty URL');

  // Fetch the page
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html, application/xhtml+xml, */*;q=0.1',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'follow',
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return Err(`Timeout after ${TIMEOUT_MS}ms`);
    }
    return Err(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!response.ok) {
    return Err(`HTTP ${response.status}: ${response.statusText}`);
  }

  let html: string;
  try {
    html = await response.text();
  } catch {
    return Err('Failed to read response body');
  }

  // Parse with linkedom (lightweight server-side DOM)
  const { document } = parseHTML(html);

  // Set the URL for Readability's relative URL resolution
  // linkedom's document may not support setting documentURI directly,
  // so we create a <base> element
  const base = document.createElement('base');
  base.setAttribute('href', url);
  const head = document.querySelector('head');
  if (head) {
    head.insertBefore(base, head.firstChild);
  }

  // Run Readability
  const reader = new Readability(document);
  const article = reader.parse();

  if (!article) {
    return Err('Readability could not extract article content');
  }

  // Validate output shape
  const parsed = readabilitySchema.safeParse(article);
  if (!parsed.success) {
    return Err(`Readability output validation failed: ${parsed.error.message}`);
  }

  const { title, byline, content, textContent, length } = parsed.data;

  // Sanitize the extracted HTML
  const sanitized = sanitizeHtml(content);

  return Ok({
    contentHtml: sanitized,
    textContent,
    title,
    byline,
    length,
  });
};
