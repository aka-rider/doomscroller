import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { AppConfig, FeedId } from './types';
import { DEFAULT_CONFIG } from './types';
import { initDb, closeDb } from './db/index';
import * as queries from './db/queries';
import { createApiRoutes } from './api/routes';
import { createFeverRoutes } from './api/fever';
import { startWorker, enqueue, cleanupJobs } from './jobs/queue';
import { fetchFeed, isNotModified } from './feeds/fetcher';
import { parseFeed } from './feeds/parser';
import { tagBatch, embedMissingTags, embedMissingCategories, embedDepthAnchors } from './tagger/batch';
import type { JobHandler } from './jobs/queue';

// --- Config from environment ---

const config: AppConfig = {
  ...DEFAULT_CONFIG,
  port: Number(process.env['PORT'] ?? DEFAULT_CONFIG.port),
  dataDir: process.env['DATA_DIR'] ?? DEFAULT_CONFIG.dataDir,
  embeddingsUrl: process.env['EMBEDDINGS_URL'] ?? DEFAULT_CONFIG.embeddingsUrl,
};

// Ensure data directory exists
if (!existsSync(config.dataDir)) {
  mkdirSync(config.dataDir, { recursive: true });
}

// --- Init database ---

const db = initDb(config);
console.log(`[init] Database at ${config.dataDir}/doomscroller.db`);

// --- Seed built-in categories and tags on first boot ---

const seededCats = queries.seedBuiltinCategories(db);
if (seededCats > 0) {
  console.log(`[init] Seeded ${seededCats} built-in categories`);
}

const seeded = queries.seedBuiltinTags(db);
if (seeded > 0) {
  console.log(`[init] Seeded ${seeded} built-in tags`);
}

// --- Seed starter feeds on first boot ---

const seededFeeds = queries.seedStarterFeeds(db);
if (seededFeeds > 0) {
  console.log(`[init] Seeded ${seededFeeds} starter feeds`);
}

// --- Embed tag descriptions, category descriptions, and depth anchors on startup ---

const initTagEmbeddings = async (retries = 5, delaySec = 5): Promise<void> => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    // Embed categories
    const embeddedCats = await embedMissingCategories(db, config);
    if (embeddedCats > 0) {
      console.log(`[init] Embedded ${embeddedCats} category descriptions`);
    }

    // Embed depth anchors (always re-embed on startup since they live in memory)
    const anchorsOk = await embedDepthAnchors(config);
    if (!anchorsOk) {
      if (attempt < retries) {
        console.log(`[init] Embedding sidecar not ready, retry ${attempt}/${retries} in ${delaySec}s...`);
        await new Promise((r) => setTimeout(r, delaySec * 1000));
        continue;
      }
      console.error('[init] Could not embed depth anchors after retries — depth scoring will be skipped');
      return;
    }

    // Embed tags
    const embedded = await embedMissingTags(db, config);
    if (embedded > 0) {
      console.log(`[init] Embedded ${embedded} tag descriptions`);
    }

    // Check if there are still tags without embeddings:
    const remaining = queries.getTagsWithoutEmbeddings(db);
    if (remaining.length === 0) return; // all done

    if (attempt < retries) {
      console.log(`[init] Tags not fully embedded, retry ${attempt}/${retries} in ${delaySec}s...`);
      await new Promise((r) => setTimeout(r, delaySec * 1000));
    }
  }
  console.error('[init] Could not embed tags after retries — tagging will use fallback on next interval');
};

// Fire and forget — don't block startup. Tagging will skip until embeddings are ready.
initTagEmbeddings().catch((err) => {
  console.error('[init] Failed to embed tags:', err);
});

// --- Job handlers ---

const handleFetchFeed: JobHandler = async (payloadStr) => {
  const payload = JSON.parse(payloadStr) as { feed_id: FeedId };
  const feed = queries.getFeedById(db, payload.feed_id);
  if (!feed) return;

  const result = await fetchFeed(feed.url, feed.etag, feed.last_modified);

  if (!result.ok) {
    queries.updateFeedError(db, feed.id, result.error);
    throw new Error(result.error);
  }

  if (isNotModified(result.value)) {
    // Touch last_fetched_at but don't re-parse
    db.run('UPDATE feeds SET last_fetched_at = unixepoch() WHERE id = ?', [feed.id]);
    return;
  }

  const parsed = parseFeed(result.value.body);
  if (!parsed.ok) {
    queries.updateFeedError(db, feed.id, parsed.error);
    throw new Error(parsed.error);
  }

  queries.updateFeedAfterFetch(
    db,
    feed.id,
    result.value.etag,
    result.value.lastModified,
    parsed.value.title,
  );

  // Update feed metadata if this is the first fetch
  if (!feed.site_url && parsed.value.siteUrl) {
    db.run('UPDATE feeds SET site_url = ?, description = ? WHERE id = ?', [
      parsed.value.siteUrl, parsed.value.description, feed.id,
    ]);
  }

  let newEntries = 0;
  for (const entry of parsed.value.entries) {
    const id = queries.insertEntry(db, {
      feed_id: feed.id,
      guid: entry.guid,
      url: entry.url,
      title: entry.title,
      author: entry.author,
      content_html: entry.contentHtml,
      summary: entry.summary,
      image_url: entry.imageUrl,
      published_at: entry.publishedAt,
    });
    if (id !== null) newEntries++;
  }

  if (newEntries > 0) {
    console.log(`[fetch] ${feed.title || feed.url}: ${newEntries} new entries`);
  }
};

const handleCleanup: JobHandler = async () => {
  const cleaned = cleanupJobs(db, 86400 * 7); // 7 days
  if (cleaned > 0) console.log(`[cleanup] Removed ${cleaned} old jobs`);

  // Also clean old entries (keep 30 days of read entries, keep all unread/starred)
  const cutoff = Math.floor(Date.now() / 1000) - 86400 * 30;
  const result = db.run(
    'DELETE FROM entries WHERE is_read = 1 AND is_starred = 0 AND published_at < ?',
    [cutoff]
  );
  if (result.changes > 0) console.log(`[cleanup] Removed ${result.changes} old read entries`);
};

const handleTagBatch: JobHandler = async () => {
  await tagBatch(db, config);
};

// --- Start job worker ---

const worker = startWorker(db, {
  fetch_feed: handleFetchFeed,
  cleanup: handleCleanup,
  tag_batch: handleTagBatch,
}, { pollIntervalMs: 1000 });

// --- Schedule recurring jobs ---

const scheduleFeedFetches = () => {
  const feedIds = queries.getActiveFeedIds(db);
  for (const feedId of feedIds) {
    enqueue(db, 'fetch_feed', { feed_id: feedId });
  }
  console.log(`[scheduler] Queued ${feedIds.length} feed fetches`);
};

// Initial fetch on startup
scheduleFeedFetches();

// Recurring: fetch all feeds every 30 minutes
setInterval(scheduleFeedFetches, config.fetchIntervalMin * 60 * 1000);

// Initial tagging on startup
enqueue(db, 'tag_batch', {});

// Recurring: tag untagged entries every 1 minute (embedding is fast)
setInterval(() => enqueue(db, 'tag_batch', {}), 1 * 60 * 1000);

// Recurring: cleanup daily
setInterval(() => enqueue(db, 'cleanup', {}), 86400 * 1000);

// --- HTTP Server ---

const app = new Hono();

// Security headers
app.use('*', secureHeaders());

// CORS for local development (Vite dev server on different port)
app.use('/api/*', cors({ origin: ['http://localhost:5173', 'http://localhost:6767'] }));
app.use('/fever/*', cors({ origin: '*' })); // Fever clients need this

// API routes
app.route('/api', createApiRoutes(db, config));
app.route('/fever', createFeverRoutes(db));

// Health check
app.get('/health', (c) => c.json({ status: 'ok', uptime: process.uptime() }));

// Static files (SolidJS build output)
// Resolve relative to this source file so it works regardless of cwd
const webDist = resolve(join(import.meta.dir, '..', '..', 'web', 'dist'));
app.use('/*', serveStatic({ root: webDist }));
// SPA fallback — serve index.html for all non-API routes
app.get('/*', serveStatic({ root: webDist, path: 'index.html' }));

// --- Start ---

const server = Bun.serve({
  port: config.port,
  hostname: '0.0.0.0',
  fetch: app.fetch,
});

console.log(`[server] Doomscroller running on http://localhost:${config.port}`);

// Graceful shutdown
const shutdown = () => {
  console.log('[server] Shutting down...');
  worker.stop();
  server.stop();
  closeDb();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
