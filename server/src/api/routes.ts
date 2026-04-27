import { Hono } from 'hono';
import { z } from 'zod';
import type { Database } from 'bun:sqlite';
import type { FeedId, EntryId, TagId, Tag, AppConfig } from '../types';
import * as queries from '../db/queries';
import { enqueue, getQueueStats } from '../jobs/queue';
import { healthCheck } from '../tagger/embeddings';
import type { EmbeddingConfig } from '../tagger/embeddings';
import { updatePreferenceVector, rescoreAllEntries } from '../scorer/preference';
import { retagAllEntries } from '../tagger/batch';

import { CATEGORIES, CATEGORY_MAP } from '../categories';
import type { CategoryView } from '../categories';

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
    category: z.string().optional(),
    unread: z.enum(['true', 'false']).optional(),
    filter: z.enum(['all']).optional(),
    starred: z.enum(['true']).optional(),
    thumb: z.enum(['-1']).optional(),
    noise: z.enum(['true']).optional(),  // Show noise-only view
  });

  api.get('/entries', (c) => {
    const params = entryListSchema.safeParse(c.req.query());
    if (!params.success) return c.json({ error: params.error.message }, 400);

    const { limit, offset } = params.data;

    // Starred (favorites) view
    if (params.data.starred === 'true') {
      const entries = queries.getStarredEntries(db, { limit, offset });
      const entryIds = entries.map(e => e.id);
      const tagMap = queries.getTagsForEntries(db, entryIds);
      return c.json(entries.map(e => ({ ...e, tags: tagMap.get(e.id) ?? [] })));
    }

    // Trash (dismissed) view
    if (params.data.thumb === '-1') {
      const entries = queries.getDismissedEntries(db, { limit, offset });
      const entryIds = entries.map(e => e.id);
      const tagMap = queries.getTagsForEntries(db, entryIds);
      return c.json(entries.map(e => ({ ...e, tags: tagMap.get(e.id) ?? [] })));
    }

    // Noise view
    if (params.data.noise === 'true') {
      const entries = queries.getNoiseEntries(db, { limit, offset });
      const entryIds = entries.map(e => e.id);
      const tagMap = queries.getTagsForEntries(db, entryIds);
      return c.json(entries.map(e => ({ ...e, tags: tagMap.get(e.id) ?? [] })));
    }

    // Resolve category to tag slugs
    let tagSlugs: string[] | undefined;
    if (params.data.category) {
      const cat = CATEGORY_MAP.get(params.data.category);
      if (!cat) return c.json({ error: `Unknown category: ${params.data.category}` }, 400);
      tagSlugs = [...cat.tagSlugs];
    }

    let entries;
    if (params.data.filter === 'all') {
      // "Everything" view — unfiltered chronological
      entries = queries.getEntries(db, {
        limit,
        offset,
        ...(params.data.tag != null ? { tag: params.data.tag } : {}),
        ...(tagSlugs != null ? { tagSlugs } : {}),
        unreadOnly: params.data.unread === 'true',
      });
    } else {
      // Default: filtered feed (Your Feed)
      // Pass showNoise from config — stored per-user in the config table
      const showNoiseVal = queries.getConfig(db, 'show_noise');
      entries = queries.getVisibleEntries(db, {
        limit,
        offset,
        unreadOnly: params.data.unread === 'true',
        showNoise: showNoiseVal === '1',
        ...(tagSlugs != null ? { tagSlugs } : {}),
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

    // Star is now just a bookmark — no preference vector update
    return c.json({ ok: true });
  });

  const thumbSchema = z.object({
    thumb: z.union([z.literal(1), z.literal(-1), z.null()]),
  });

  api.post('/entries/:id/thumb', async (c) => {
    const id = Number(c.req.param('id')) as EntryId;
    const body = thumbSchema.safeParse(await c.req.json());
    if (!body.success) return c.json({ error: body.error.message }, 400);

    queries.setEntryThumb(db, id, body.data.thumb);

    // Recompute preference vector on thumb change
    const hasPreference = updatePreferenceVector(db);
    if (hasPreference) {
      rescoreAllEntries(db);
    }

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
    // Exclude signal tags — replaced by depth_score
    const topicTags = tags.filter(t => t.tag_group !== 'signal');
    const grouped: Record<string, Array<Tag & { mode: string }>> = {};
    for (const tag of topicTags) {
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

  // --- Categories ---

  api.get('/categories', (c) => {
    // Return categories with entry counts
    const result = CATEGORIES.map(cat => {
      const placeholders = cat.tagSlugs.map(() => '?').join(', ');
      const row = db.query<{ count: number }, unknown[]>(
        `SELECT COUNT(DISTINCT e.id) as count
         FROM entries e
         JOIN entry_tags et ON e.id = et.entry_id
         JOIN tags t ON et.tag_id = t.id
         WHERE t.slug IN (${placeholders})`,
      ).get(...cat.tagSlugs) ?? { count: 0 };
      return {
        slug: cat.slug,
        label: cat.label,
        entryCount: row.count,
      };
    });
    return c.json(result);
  });

  // --- Dashboard ---

  api.get('/dashboard', async (c) => {
    const feeds = queries.getDashboardFeedStats(db);
    const indexing = queries.getIndexingStats(db);
    const queue = getQueueStats(db);

    const embConfig: EmbeddingConfig = { baseUrl: config.embeddingsUrl };
    const embeddings_healthy = await healthCheck(embConfig);

    return c.json({
      feeds,
      indexing: { ...indexing, embeddings_healthy },
      queue,
    });
  });

  // --- Onboarding Config ---

  api.get('/config/onboarding', (c) => {
    const val = queries.getConfig(db, 'onboarding_complete');
    const showNoise = queries.getConfig(db, 'show_noise');
    return c.json({ complete: val === '1', show_noise: showNoise === '1' });
  });

  const onboardingSchema = z.object({
    preferences: z.record(z.string(), z.enum(['whitelist', 'blacklist', 'none'])),
    show_noise: z.boolean().optional(),
  });

  api.post('/config/onboarding', async (c) => {
    const body = onboardingSchema.safeParse(await c.req.json());
    if (!body.success) return c.json({ error: body.error.message }, 400);

    for (const [tagIdStr, mode] of Object.entries(body.data.preferences)) {
      const tagId = Number(tagIdStr) as TagId;
      queries.setTagPreference(db, tagId, mode);
    }
    if (body.data.show_noise !== undefined) {
      queries.setConfig(db, 'show_noise', body.data.show_noise ? '1' : '0');
    }
    queries.setConfig(db, 'onboarding_complete', '1');
    return c.json({ ok: true });
  });

  // --- Re-tag ---

  api.post('/retag', (c) => {
    const count = retagAllEntries(db);
    return c.json({ ok: true, retagged: count });
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
