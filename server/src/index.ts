import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { existsSync, mkdirSync } from 'node:fs';
import type { AppConfig, FeedId } from './types';
import { DEFAULT_CONFIG } from './types';
import { initDb, closeDb } from './db/index';
import * as queries from './db/queries';
import { createApiRoutes } from './api/routes';
import { createFeverRoutes } from './api/fever';
import { startWorker, enqueue, cleanupJobs } from './jobs/queue';
import { fetchFeed, isNotModified } from './feeds/fetcher';
import { parseFeed } from './feeds/parser';
import { scoreBatch } from './scorer/batch';
import type { JobHandler } from './jobs/queue';

// --- Config from environment ---

const config: AppConfig = {
  ...DEFAULT_CONFIG,
  port: Number(process.env['PORT'] ?? DEFAULT_CONFIG.port),
  dataDir: process.env['DATA_DIR'] ?? DEFAULT_CONFIG.dataDir,
  llmBaseUrl: process.env['LLM_BASE_URL'] ?? DEFAULT_CONFIG.llmBaseUrl,
  llmModel: process.env['LLM_MODEL'] ?? DEFAULT_CONFIG.llmModel,
  embeddingsBaseUrl: process.env['EMBEDDINGS_BASE_URL'] ?? DEFAULT_CONFIG.embeddingsBaseUrl,
};

// Ensure data directory exists
if (!existsSync(config.dataDir)) {
  mkdirSync(config.dataDir, { recursive: true });
}

// --- Init database ---

const db = initDb(config);
console.log(`[init] Database at ${config.dataDir}/doomscroller.db`);

// --- Seed default preferences if empty ---

const existingProfile = queries.getPreference(db, 'interest_profile');
if (!existingProfile) {
  queries.setPreference(db, 'interest_profile', [
    'STRONG INTERESTS: international politics, geopolitics, macroeconomics, financial markets, software engineering (intermediate-to-expert level), systems programming, distributed systems, science (physics, biology, mathematics), art, design, creative technology',
    'BLOCK: sports, fashion, celebrity gossip, tabloid politics, "he said she said" political drama, beginner tutorials, "getting started with" content, listicles, SEO-optimized fluff',
    'DEPTH PREFERENCE: prefer expert-level analysis over surface-level reporting. Minimum depth: 0.4',
    'NOVELTY: prefer unique angles and breaking developments over rehashed takes',
  ].join('\n'));
}

// --- Seed default categories ---

const defaultCategories = [
  { name: 'Geopolitics', slug: 'geopolitics', desc: 'International relations, foreign policy, diplomacy, conflicts, treaties' },
  { name: 'Markets', slug: 'markets', desc: 'Financial markets, economics, trading, monetary policy, fiscal policy' },
  { name: 'Engineering', slug: 'engineering', desc: 'Software engineering, systems programming, distributed systems, databases, infrastructure' },
  { name: 'Science', slug: 'science', desc: 'Physics, biology, chemistry, mathematics, academic research, papers' },
  { name: 'Technology', slug: 'technology', desc: 'Tech industry, products, AI/ML, startups, open source' },
  { name: 'Art & Culture', slug: 'art-culture', desc: 'Visual art, design, architecture, music, literature, creative technology' },
  { name: 'Long Reads', slug: 'long-reads', desc: 'In-depth investigative journalism, essays, analysis pieces' },
];

for (const cat of defaultCategories) {
  const existing = queries.getCategoryBySlug(db, cat.slug);
  if (!existing) {
    queries.insertCategory(db, cat.name, cat.slug, cat.desc, false);
  }
}

// --- Seed starter feeds on first boot ---

const starterFeeds = [
  // Geopolitics & News
  'https://feeds.bbci.co.uk/news/world/rss.xml',
  'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',
  // Technology
  'https://hnrss.org/frontpage',
  'https://lobste.rs/rss',
  'https://www.theverge.com/rss/index.xml',
  // Engineering
  'https://blog.pragmaticengineer.com/rss/',
  // Science
  'https://www.nature.com/nature.rss',
  // Economics / Markets
  'https://feeds.ft.com/rss/home/us',
];

const existingFeedCount = db.query<{ c: number }, []>('SELECT COUNT(*) as c FROM feeds').get()!.c;
if (existingFeedCount === 0) {
  console.log('[init] First boot — seeding starter feeds');
  for (const url of starterFeeds) {
    queries.insertFeed(db, url, '', '');
  }
}

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

const handleScoreBatch: JobHandler = async () => {
  await scoreBatch(db, config);
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

// --- Start job worker ---

const worker = startWorker(db, {
  fetch_feed: handleFetchFeed,
  score_batch: handleScoreBatch,
  cleanup: handleCleanup,
}, { pollIntervalMs: 1000 });

// --- Schedule recurring jobs ---

const scheduleFeedFetches = () => {
  const feedIds = queries.getActiveFeedIds(db);
  for (const feedId of feedIds) {
    enqueue(db, 'fetch_feed', { feed_id: feedId });
  }
  console.log(`[scheduler] Queued ${feedIds.length} feed fetches`);
};

const scheduleScoring = () => {
  enqueue(db, 'score_batch', {});
};

// Initial fetch + score on startup
scheduleFeedFetches();
scheduleScoring();

// Recurring: fetch all feeds every 30 minutes
setInterval(scheduleFeedFetches, config.fetchIntervalMin * 60 * 1000);

// Recurring: score new entries every 5 minutes
setInterval(scheduleScoring, 5 * 60 * 1000);

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
app.use('/*', serveStatic({ root: '../web/dist' }));
// SPA fallback — serve index.html for all non-API routes
app.get('/*', serveStatic({ root: '../web/dist', path: 'index.html' }));

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
