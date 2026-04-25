import { Hono } from 'hono';
import { z } from 'zod';
import type { Database } from 'bun:sqlite';
import type { FeedId, EntryId, CategoryId, AppConfig } from '../types';
import * as queries from '../db/queries';
import { enqueue } from '../jobs/queue';

export const createApiRoutes = (db: Database, config: AppConfig): Hono => {
  const api = new Hono();

  // --- Feeds ---

  api.get('/feeds', (c) => {
    const feeds = queries.getFeedsWithStats(db);
    return c.json(feeds);
  });

  const addFeedSchema = z.object({
    url: z.string().url(),
  });

  api.post('/feeds', async (c) => {
    const body = addFeedSchema.safeParse(await c.req.json());
    if (!body.success) return c.json({ error: body.error.message }, 400);

    const existing = queries.getFeedByUrl(db, body.data.url);
    if (existing) return c.json({ error: 'Feed already exists', feed: existing }, 409);

    const feedId = queries.insertFeed(db, body.data.url, '', '');

    // Queue immediate fetch
    enqueue(db, 'fetch_feed', { feed_id: feedId }, { priority: 10 });

    return c.json({ id: feedId, message: 'Feed added, fetching...' }, 201);
  });

  api.delete('/feeds/:id', (c) => {
    const id = Number(c.req.param('id')) as FeedId;
    queries.deleteFeed(db, id);
    return c.json({ ok: true });
  });

  // --- Entries ---

  const entryListSchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    category: z.coerce.number().int().optional(),
    unread: z.enum(['true', 'false']).optional(),
  });

  api.get('/entries', (c) => {
    const params = entryListSchema.safeParse(c.req.query());
    if (!params.success) return c.json({ error: params.error.message }, 400);

    const entries = queries.getRankedEntries(db, {
      limit: params.data.limit,
      offset: params.data.offset,
      categoryId: params.data.category as CategoryId | undefined,
      unreadOnly: params.data.unread === 'true',
    });

    return c.json(entries);
  });

  api.get('/entries/:id', (c) => {
    const id = Number(c.req.param('id')) as EntryId;
    const entry = queries.getEntryById(db, id);
    if (!entry) return c.json({ error: 'Not found' }, 404);
    return c.json(entry);
  });

  api.post('/entries/:id/read', (c) => {
    const id = Number(c.req.param('id')) as EntryId;
    queries.markEntryRead(db, id);
    queries.recordInteraction(db, id, 'read');
    return c.json({ ok: true });
  });

  api.post('/entries/:id/star', async (c) => {
    const id = Number(c.req.param('id')) as EntryId;
    const body = z.object({ starred: z.boolean() }).safeParse(await c.req.json());
    if (!body.success) return c.json({ error: body.error.message }, 400);

    queries.markEntryStarred(db, id, body.data.starred);
    if (body.data.starred) queries.recordInteraction(db, id, 'star');
    return c.json({ ok: true });
  });

  api.post('/entries/:id/hide', (c) => {
    const id = Number(c.req.param('id')) as EntryId;
    queries.markEntryHidden(db, id);
    queries.recordInteraction(db, id, 'hide');
    return c.json({ ok: true });
  });

  // --- Categories ---

  api.get('/categories', (c) => {
    const categories = queries.getCategoriesWithCounts(db);
    return c.json(categories);
  });

  const addCategorySchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).default(''),
  });

  api.post('/categories', async (c) => {
    const body = addCategorySchema.safeParse(await c.req.json());
    if (!body.success) return c.json({ error: body.error.message }, 400);

    const slug = body.data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const existing = queries.getCategoryBySlug(db, slug);
    if (existing) return c.json({ error: 'Category already exists' }, 409);

    const id = queries.insertCategory(db, body.data.name, slug, body.data.description, false);
    return c.json({ id, slug }, 201);
  });

  // --- Preferences ---

  api.get('/preferences', (c) => {
    const prefs = queries.getAllPreferences(db);
    return c.json(prefs);
  });

  api.put('/preferences/:key', async (c) => {
    const key = c.req.param('key');
    const body = z.object({ value: z.string() }).safeParse(await c.req.json());
    if (!body.success) return c.json({ error: body.error.message }, 400);

    queries.setPreference(db, key, body.data.value);
    return c.json({ ok: true });
  });

  // --- Stats ---

  api.get('/stats', (c) => {
    const stats = queries.getStats(db);
    return c.json(stats);
  });

  // --- OPML ---

  api.get('/opml/export', (c) => {
    const feeds = queries.getAllFeeds(db);
    const now = new Date().toISOString();

    const outlines = feeds.map(f => {
      const title = escapeXml(f.title || f.url);
      const xmlUrl = escapeXml(f.url);
      const htmlUrl = escapeXml(f.site_url || '');
      return `      <outline type="rss" text="${title}" title="${title}" xmlUrl="${xmlUrl}" htmlUrl="${htmlUrl}" />`;
    }).join('\n');

    const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>Doomscroller Feeds</title>
    <dateCreated>${now}</dateCreated>
  </head>
  <body>
    <outline text="Feeds" title="Feeds">
${outlines}
    </outline>
  </body>
</opml>`;

    c.header('Content-Type', 'application/xml');
    c.header('Content-Disposition', 'attachment; filename="doomscroller-feeds.opml"');
    return c.body(opml);
  });

  api.post('/opml/import', async (c) => {
    const body = await c.req.parseBody();
    const file = body['file'];

    if (!file || typeof file === 'string') {
      return c.json({ error: 'No file uploaded' }, 400);
    }

    const text = await file.text();

    // Simple OPML parser: extract xmlUrl from <outline> elements
    const urlRegex = /xmlUrl\s*=\s*"([^"]+)"/gi;
    const urls: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = urlRegex.exec(text)) !== null) {
      const url = unescapeXml(match[1]!);
      try {
        new URL(url); // validate
        urls.push(url);
      } catch {
        // skip invalid URLs
      }
    }

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const url of urls) {
      const existing = queries.getFeedByUrl(db, url);
      if (existing) {
        skipped++;
        continue;
      }
      try {
        const feedId = queries.insertFeed(db, url, '', '');
        enqueue(db, 'fetch_feed', { feed_id: feedId }, { priority: 5 });
        imported++;
      } catch (e) {
        errors.push(`${url}: ${e instanceof Error ? e.message : 'unknown error'}`);
      }
    }

    return c.json({ imported, skipped, errors });
  });

  return api;
};

// --- XML helpers ---

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const unescapeXml = (s: string): string =>
  s.replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
