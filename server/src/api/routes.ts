import { Hono } from 'hono';
import { z } from 'zod';
import type { Database } from 'bun:sqlite';
import type { FeedId, EntryId, TagId, Tag, AppConfig } from '../types';
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
    tag: z.string().optional(),
    unread: z.enum(['true', 'false']).optional(),
    filter: z.enum(['preferences']).optional(),
  });

  api.get('/entries', (c) => {
    const params = entryListSchema.safeParse(c.req.query());
    if (!params.success) return c.json({ error: params.error.message }, 400);

    let entries;
    if (params.data.filter === 'preferences') {
      entries = queries.getVisibleEntries(db, {
        limit: params.data.limit,
        offset: params.data.offset,
        unreadOnly: params.data.unread === 'true',
      });
    } else {
      entries = queries.getEntries(db, {
        limit: params.data.limit,
        offset: params.data.offset,
        tag: params.data.tag,
        unreadOnly: params.data.unread === 'true',
      });
    }

    const entryIds = entries.map(e => e.id);
    const tagMap = queries.getTagsForEntries(db, entryIds);
    const result = entries.map(e => ({
      ...e,
      tags: tagMap.get(e.id) ?? [],
    }));

    return c.json(result);
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
    return c.json({ ok: true });
  });

  api.post('/entries/:id/star', async (c) => {
    const id = Number(c.req.param('id')) as EntryId;
    const body = z.object({ starred: z.boolean() }).safeParse(await c.req.json());
    if (!body.success) return c.json({ error: body.error.message }, 400);

    queries.markEntryStarred(db, id, body.data.starred);
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

  // --- Tags ---

  api.get('/tags', (c) => {
    const tags = queries.getAllTagsWithPreferences(db);
    const grouped: Record<string, Array<Tag & { mode: string }>> = {};
    for (const tag of tags) {
      const group = tag.tag_group || 'other';
      if (!grouped[group]) grouped[group] = [];
      grouped[group].push(tag);
    }
    return c.json(grouped);
  });

  const createTagSchema = z.object({
    slug: z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    label: z.string().min(1).max(200),
    tag_group: z.string().max(100).default(''),
  });

  api.post('/tags', async (c) => {
    const body = createTagSchema.safeParse(await c.req.json());
    if (!body.success) return c.json({ error: body.error.message }, 400);

    const existing = queries.getTagBySlug(db, body.data.slug);
    if (existing) return c.json({ error: 'Tag already exists', tag: existing }, 409);

    const id = queries.createTag(db, body.data.slug, body.data.label, body.data.tag_group, false);
    const tag = queries.getTagById(db, id);
    return c.json(tag, 201);
  });

  const setPreferenceSchema = z.object({
    mode: z.enum(['whitelist', 'blacklist', 'none']),
  });

  api.delete('/tags/:id', (c) => {
    const id = Number(c.req.param('id')) as TagId;
    const tag = queries.getTagById(db, id);
    if (!tag) return c.json({ error: 'Tag not found' }, 404);
    if (tag.is_builtin) return c.json({ error: 'Cannot delete builtin tags' }, 400);
    queries.deleteTag(db, id);
    return c.json({ ok: true });
  });

  api.put('/tags/:id/preference', async (c) => {
    const id = Number(c.req.param('id')) as TagId;
    const tag = queries.getTagById(db, id);
    if (!tag) return c.json({ error: 'Tag not found' }, 404);

    const body = setPreferenceSchema.safeParse(await c.req.json());
    if (!body.success) return c.json({ error: body.error.message }, 400);

    queries.setTagPreference(db, id, body.data.mode);
    return c.json({ ok: true, tag_id: id, mode: body.data.mode });
  });

  // --- Onboarding Config ---

  api.get('/config/onboarding', (c) => {
    const val = queries.getConfig(db, 'onboarding_complete');
    return c.json({ complete: val === '1' });
  });

  const onboardingSchema = z.object({
    preferences: z.record(z.string(), z.enum(['whitelist', 'blacklist', 'none'])),
  });

  api.post('/config/onboarding', async (c) => {
    const body = onboardingSchema.safeParse(await c.req.json());
    if (!body.success) return c.json({ error: body.error.message }, 400);

    for (const [tagIdStr, mode] of Object.entries(body.data.preferences)) {
      const tagId = Number(tagIdStr) as TagId;
      queries.setTagPreference(db, tagId, mode);
    }
    queries.setConfig(db, 'onboarding_complete', '1');
    return c.json({ ok: true });
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
