// Shared test utilities. One file. No framework magic.
// Creates throwaway in-memory SQLite databases, fixture data, mock servers.

import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  FeedId, EntryId, AppConfig, Entry, Feed,
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

  return db;
};

// --- Test config ---

export const TEST_CONFIG: AppConfig = {
  port: 0,
  dataDir: '/tmp/doomscroller-test',
  llmBaseUrl: 'http://localhost:11434',
  llmModel: 'test-model',
  fetchIntervalMin: 30,
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
    published_at: number | null; is_read: number; is_starred: number;
    tagged_at: number | null;
  }> = {},
): EntryId => {
  const guid = overrides.guid ?? `guid-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const result = db.run(
    `INSERT INTO entries (feed_id, guid, url, title, author, content_html, summary, image_url, published_at, is_read, is_starred, tagged_at)
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
      overrides.tagged_at ?? null,
    ],
  );
  return result.lastInsertRowid as unknown as EntryId;
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
