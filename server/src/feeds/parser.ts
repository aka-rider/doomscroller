import { XMLParser } from 'fast-xml-parser';
import { htmlToText } from 'html-to-text';
import type { FeedId, Result } from '../types';
import { Ok, Err } from '../types';

// Parses RSS 2.0, Atom, and RSS 1.0 feeds into a normalized shape.
// Uses fast-xml-parser (no regex-based hacks, no eval, SAX-based).

export interface ParsedFeed {
  readonly title: string;
  readonly siteUrl: string;
  readonly description: string;
  readonly entries: readonly ParsedEntry[];
}

export interface ParsedEntry {
  readonly guid: string;
  readonly url: string;
  readonly title: string;
  readonly author: string;
  readonly contentHtml: string;
  readonly summary: string;
  readonly imageUrl: string | null;
  readonly publishedAt: number | null; // unixepoch
  readonly targetUrl: string | null; // actual article URL for link-only entries
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (name) => ['item', 'entry'].includes(name),
  trimValues: true,
});

export const parseFeed = (xml: string): Result<ParsedFeed, string> => {
  try {
    const doc = parser.parse(xml);

    // RSS 2.0
    if (doc.rss?.channel) {
      return Ok(parseRSS2(doc.rss.channel));
    }

    // Atom
    if (doc.feed) {
      return Ok(parseAtom(doc.feed));
    }

    // RSS 1.0 (RDF)
    if (doc['rdf:RDF']) {
      return Ok(parseRDF(doc['rdf:RDF']));
    }

    return Err('Unknown feed format: no rss, feed, or rdf:RDF root element');
  } catch (err) {
    return Err(`XML parse error: ${err instanceof Error ? err.message : String(err)}`);
  }
};

// --- RSS 2.0 ---

const parseRSS2 = (channel: Record<string, unknown>): ParsedFeed => {
  const items = (channel.item as Record<string, unknown>[] | undefined) ?? [];
  const siteUrl = str(channel.link);

  return {
    title: cleanText(str(channel.title)),
    siteUrl,
    description: cleanText(str(channel.description)),
    entries: items.map(item => parseRSS2Item(item, siteUrl)),
  };
};

const parseRSS2Item = (item: Record<string, unknown>, feedSiteUrl: string): ParsedEntry => {
  const contentEncoded = str(item['content:encoded']);
  const description = str(item.description);
  const contentHtml = contentEncoded || description;
  const entryUrl = str(item.link);

  return {
    guid: str(item.guid) || str(item.link),
    url: entryUrl,
    title: cleanText(str(item.title)),
    author: cleanText(str(item['dc:creator'] ?? item.author)),
    contentHtml,
    summary: stripHtml(contentHtml).slice(0, 1000),
    imageUrl: extractImageUrl(item, contentHtml),
    publishedAt: parseDate(str(item.pubDate ?? item['dc:date'])),
    targetUrl: detectTargetUrl(contentHtml, entryUrl, feedSiteUrl),
  };
};

// --- Atom ---

const parseAtom = (feed: Record<string, unknown>): ParsedFeed => {
  const entries = (feed.entry as Record<string, unknown>[] | undefined) ?? [];
  const link = findLink(feed.link, 'alternate') ?? findLink(feed.link);

  return {
    title: cleanText(str(feed.title)),
    siteUrl: link,
    description: cleanText(str(feed.subtitle)),
    entries: entries.map(entry => parseAtomEntry(entry, link)),
  };
};

const parseAtomEntry = (entry: Record<string, unknown>, feedSiteUrl: string): ParsedEntry => {
  const link = findLink(entry.link, 'alternate') ?? findLink(entry.link);
  const content = entry.content;
  const summary = entry.summary;

  const contentHtml = typeof content === 'object' && content !== null
    ? str((content as Record<string, unknown>)['#text'])
    : str(content);

  const summaryText = typeof summary === 'object' && summary !== null
    ? str((summary as Record<string, unknown>)['#text'])
    : str(summary);

  const html = contentHtml || summaryText;

  return {
    guid: str(entry.id ?? link),
    url: link,
    title: cleanText(str(typeof entry.title === 'object' && entry.title !== null
      ? (entry.title as Record<string, unknown>)['#text']
      : entry.title)),
    author: cleanText(extractAtomAuthor(entry)),
    contentHtml: html,
    summary: stripHtml(html).slice(0, 1000),
    imageUrl: extractImageUrl(entry, html),
    publishedAt: parseDate(str(entry.published ?? entry.updated)),
    targetUrl: detectTargetUrl(html, link, feedSiteUrl),
  };
};

// --- RSS 1.0 / RDF ---

const parseRDF = (rdf: Record<string, unknown>): ParsedFeed => {
  const channel = rdf.channel as Record<string, unknown> | undefined ?? {};
  const items = (rdf.item as Record<string, unknown>[] | undefined) ?? [];
  const siteUrl = str(channel.link);

  return {
    title: cleanText(str(channel.title)),
    siteUrl,
    description: cleanText(str(channel.description)),
    entries: items.map(item => parseRSS2Item(item, siteUrl)), // RDF items have the same shape as RSS 2.0
  };
};

// --- Link-Only Entry Detection ---

// RFC 1918 + loopback + link-local patterns for SSRF protection
const PRIVATE_IP_REGEX = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|169\.254\.|0\.|::1|fc|fd|fe80)/i;

// Detect if an entry is "link-only" (e.g., Reddit, HN) and extract the actual article URL.
// Returns the target URL if detected, null otherwise.
export const detectTargetUrl = (
  contentHtml: string,
  entryUrl: string,
  feedSiteUrl: string,
): string | null => {
  const plainText = stripHtml(contentHtml).trim();

  // Only consider entries with very short content (typical of link aggregators)
  if (plainText.length > 200) return null;

  // Extract all href URLs from the content
  const hrefRegex = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi;
  const candidates: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = hrefRegex.exec(contentHtml)) !== null) {
    const href = match[1]!;
    candidates.push(href);
  }

  if (candidates.length === 0) return null;

  // Get domains for comparison
  const entryDomain = safeDomain(entryUrl);
  const feedDomain = safeDomain(feedSiteUrl);

  // Filter to external, valid HTTP(S) URLs that aren't comments/reply links
  for (const candidate of candidates) {
    // Must be absolute http/https URL
    if (!candidate.startsWith('http://') && !candidate.startsWith('https://')) continue;

    // Validate URL structure
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      continue;
    }

    // Protocol validation (strict http/https only)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;

    // SSRF protection: reject private/reserved IP ranges
    if (PRIVATE_IP_REGEX.test(parsed.hostname)) continue;
    if (parsed.hostname === 'localhost') continue;

    const candidateDomain = parsed.hostname.replace(/^www\./, '');

    // Must be on a different domain than the feed/entry (external link)
    if (candidateDomain === entryDomain || candidateDomain === feedDomain) continue;

    // Skip comment/discussion/reply links
    const path = parsed.pathname + parsed.search;
    if (/\/(comments|reply|respond|share)\b/i.test(path)) continue;
    if (parsed.searchParams.has('reply')) continue;

    // This is our target URL — take the first valid external link
    return candidate;
  }

  return null;
};

// Safely extract domain from a URL, stripping www prefix
const safeDomain = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

// --- Helpers ---

const str = (val: unknown): string => {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number') return String(val);
  if (typeof val === 'object' && '#text' in (val as Record<string, unknown>)) {
    return str((val as Record<string, unknown>)['#text']);
  }
  return String(val).trim();
};

const findLink = (link: unknown, rel?: string): string => {
  if (typeof link === 'string') return link;
  if (Array.isArray(link)) {
    if (rel) {
      const found = link.find(l => l?.['@_rel'] === rel);
      if (found) return str(found['@_href']);
    }
    return str(link[0]?.['@_href'] ?? link[0]);
  }
  if (typeof link === 'object' && link !== null) {
    return str((link as Record<string, unknown>)['@_href']);
  }
  return '';
};

const extractAtomAuthor = (entry: Record<string, unknown>): string => {
  const author = entry.author;
  if (typeof author === 'string') return author;
  if (typeof author === 'object' && author !== null) {
    return str((author as Record<string, unknown>).name);
  }
  return '';
};

const parseDate = (dateStr: string): number | null => {
  if (!dateStr) return null;
  const ts = Date.parse(dateStr);
  if (isNaN(ts)) return null;
  return Math.floor(ts / 1000);
};

// Simple HTML stripping for summary generation.
// Not security-critical — we're just extracting text for embedding.
const stripHtml = (html: string): string =>
  htmlToText(html, {
    wordwrap: false,
    selectors: [
      { selector: 'img', format: 'skip' },
      { selector: 'a', options: { ignoreHref: true } }
    ]
  }).trim();

const cleanText = (text: string): string =>
  htmlToText(text, { wordwrap: false }).trim();

// Extract hero image from various RSS conventions
const extractImageUrl = (item: Record<string, unknown>, html: string): string | null => {
  // media:content
  const media = item['media:content'] ?? item['media:thumbnail'];
  if (media) {
    const url = typeof media === 'object' && media !== null
      ? (media as Record<string, unknown>)['@_url']
      : null;
    if (typeof url === 'string') return url;
  }

  // enclosure with image type
  const enclosure = item.enclosure;
  if (typeof enclosure === 'object' && enclosure !== null) {
    const enc = enclosure as Record<string, unknown>;
    if (typeof enc['@_type'] === 'string' && enc['@_type'].startsWith('image/')) {
      return str(enc['@_url']);
    }
  }

  // First <img> in content
  const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch?.[1]) return imgMatch[1];

  return null;
};
