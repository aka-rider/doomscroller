// Shared test utilities. One file. No framework magic.
// Creates throwaway in-memory SQLite databases, fixture data, mock servers.

import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  FeedId, EntryId, CategoryId, AppConfig, Entry, Feed, Category,
} from './types';

// --- In-memory database factory ---
// Every test gets its own database. No shared state. No cleanup needed.

export const createTestDb = (): Database => {
  const db = new Database(':memory:');

  // Same pragmas as production
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA busy_timeout = 5000');

  // Apply schema
  const schemaPath = join(import.meta.dir, 'db', 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  db.exec(schema);

  // Seed a Fever API key (required by some tests)
  db.run("INSERT INTO config (key, value) VALUES ('fever_api_key', 'test-api-key-0000')");

  return db;
};

// --- Test config ---

export const TEST_CONFIG: AppConfig = {
  port: 0,
  dataDir: '/tmp/doomscroller-test',
  llmBaseUrl: 'http://localhost:11434',
  llmModel: 'test-model',
  fetchIntervalMin: 30,
  scoreBatchSize: 10,
  maxConcurrentFetches: 2,
};

// --- Fixture factories ---
// These insert real rows and return real IDs. No mocking the database.

export const insertTestFeed = (
  db: Database,
  overrides: Partial<{ url: string; title: string; site_url: string }> = {},
): FeedId => {
  const url = overrides.url ?? `https://example.com/feed-${Date.now()}-${Math.random().toString(36).slice(2)}.xml`;
  const title = overrides.title ?? 'Test Feed';
  const siteUrl = overrides.site_url ?? 'https://example.com';

  const result = db.run(
    'INSERT INTO feeds (url, title, site_url) VALUES (?, ?, ?)',
    [url, title, siteUrl],
  );
  return result.lastInsertRowid as unknown as FeedId;
};

export const insertTestEntry = (
  db: Database,
  feedId: FeedId,
  overrides: Partial<{
    guid: string; url: string; title: string; author: string;
    content_html: string; summary: string; image_url: string | null;
    published_at: number | null; is_read: number; is_starred: number; is_hidden: number;
  }> = {},
): EntryId => {
  const guid = overrides.guid ?? `guid-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const result = db.run(
    `INSERT INTO entries (feed_id, guid, url, title, author, content_html, summary, image_url, published_at, is_read, is_starred, is_hidden)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      feedId,
      guid,
      overrides.url ?? `https://example.com/post/${guid}`,
      overrides.title ?? 'Test Entry',
      overrides.author ?? 'Test Author',
      overrides.content_html ?? '<p>Test content</p>',
      overrides.summary ?? 'Test content',
      overrides.image_url ?? null,
      overrides.published_at ?? Math.floor(Date.now() / 1000),
      overrides.is_read ?? 0,
      overrides.is_starred ?? 0,
      overrides.is_hidden ?? 0,
    ],
  );
  return result.lastInsertRowid as unknown as EntryId;
};

export const insertTestCategory = (
  db: Database,
  overrides: Partial<{ name: string; slug: string; description: string; is_auto: boolean }> = {},
): CategoryId => {
  const name = overrides.name ?? `Category ${Math.random().toString(36).slice(2)}`;
  const slug = overrides.slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  const result = db.run(
    'INSERT INTO categories (name, slug, description, is_auto) VALUES (?, ?, ?, ?)',
    [name, slug, overrides.description ?? '', overrides.is_auto ? 1 : 0],
  );
  return result.lastInsertRowid as unknown as CategoryId;
};

export const insertTestScore = (
  db: Database,
  entryId: EntryId,
  overrides: Partial<{
    relevance: number; depth: number; novelty: number;
    category_id: CategoryId | null; reasoning: string; model: string;
  }> = {},
): void => {
  db.run(
    `INSERT INTO entry_scores (entry_id, relevance, depth, novelty, category_id, reasoning, model)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      entryId,
      overrides.relevance ?? 0.7,
      overrides.depth ?? 0.5,
      overrides.novelty ?? 0.6,
      overrides.category_id ?? null,
      overrides.reasoning ?? 'test reasoning',
      overrides.model ?? 'test-model',
    ],
  );
};

// --- RSS/Atom feed fixtures ---

export const RSS2_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Test Blog</title>
    <link>https://test.blog</link>
    <description>A test blog for testing</description>
    <item>
      <title>First Post</title>
      <link>https://test.blog/first</link>
      <guid>first-post-guid</guid>
      <dc:creator>Alice</dc:creator>
      <pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate>
      <description>Short description</description>
      <content:encoded><![CDATA[<p>Full content of the first post</p>]]></content:encoded>
      <media:content url="https://test.blog/img/first.jpg" medium="image"/>
    </item>
    <item>
      <title>Second Post</title>
      <link>https://test.blog/second</link>
      <guid>second-post-guid</guid>
      <author>bob@test.blog</author>
      <pubDate>Tue, 02 Jan 2024 12:00:00 GMT</pubDate>
      <description>&lt;p&gt;HTML in description&lt;/p&gt;</description>
    </item>
  </channel>
</rss>`;

export const ATOM_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Test Feed</title>
  <link href="https://atom.test" rel="alternate"/>
  <link href="https://atom.test/feed" rel="self"/>
  <subtitle>An Atom feed for testing</subtitle>
  <entry>
    <id>urn:uuid:atom-entry-1</id>
    <title>Atom Entry One</title>
    <link href="https://atom.test/entry-1" rel="alternate"/>
    <author><name>Charlie</name></author>
    <published>2024-01-15T10:00:00Z</published>
    <content type="html"><![CDATA[<p>Atom content here</p><img src="https://atom.test/img.png"/>]]></content>
  </entry>
  <entry>
    <id>urn:uuid:atom-entry-2</id>
    <title type="text">Atom Entry Two</title>
    <link href="https://atom.test/entry-2" rel="alternate"/>
    <updated>2024-01-16T10:00:00Z</updated>
    <summary type="html"><![CDATA[<p>Summary only entry</p>]]></summary>
  </entry>
</feed>`;

export const RDF_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns="http://purl.org/rss/1.0/"
         xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>RDF Test Feed</title>
    <link>https://rdf.test</link>
    <description>An RDF/RSS 1.0 feed</description>
  </channel>
  <item>
    <title>RDF Item One</title>
    <link>https://rdf.test/item-1</link>
    <dc:creator>Dana</dc:creator>
    <dc:date>2024-02-01T08:00:00Z</dc:date>
    <description>RDF item description</description>
  </item>
</rdf:RDF>`;

export const MALFORMED_XML = `<?xml version="1.0"?>
<rss><channel><title>Broken`;

export const EMPTY_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Empty Feed</title>
    <link>https://empty.test</link>
    <description>No items here</description>
  </channel>
</rss>`;

// --- LLM response fixtures ---

export const VALID_LLM_CLASSIFICATION = JSON.stringify({
  category: 'Technology',
  secondary_categories: ['Science'],
  relevance: 0.85,
  depth: 0.6,
  novelty: 0.7,
  reasoning: 'Article discusses cutting-edge tech research',
});

export const LLM_CLASSIFICATION_WITH_FENCES = '```json\n' + VALID_LLM_CLASSIFICATION + '\n```';

export const LLM_CLASSIFICATION_INVALID_RANGE = JSON.stringify({
  category: 'Technology',
  secondary_categories: [],
  relevance: 1.5, // out of range
  depth: 0.5,
  novelty: 0.5,
  reasoning: 'test',
});

export const LLM_GARBAGE = 'I think this article is about technology and it seems very relevant to your interests...';

// --- Mock HTTP server for fetch tests ---

export const createMockServer = (
  handler: (req: Request) => Response | Promise<Response>,
): { url: string; close: () => void } => {
  const server = Bun.serve({
    port: 0, // random available port
    fetch: handler,
  });

  return {
    url: `http://localhost:${server.port}`,
    close: () => server.stop(true),
  };
};
