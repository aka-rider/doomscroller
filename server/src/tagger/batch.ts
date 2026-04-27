import type { Database } from 'bun:sqlite';
import type { AppConfig, TagId, CategoryId } from '../types';
import * as queries from '../db/queries';
import {
  embed, healthCheck, buildEmbeddingInput, float32ToBuffer, bufferToFloat32,
  type EmbeddingConfig,
} from './embeddings';
import { DEPTH_ANCHORS } from '../taxonomy';
import type { DepthAnchorDef } from '../taxonomy';
import { extractiveSummarize, wordCount } from '../feeds/summarizer';

// --- Cosine Similarity ---

// Dot product of two normalized vectors = cosine similarity.
// nomic-embed-text-v1.5 returns L2-normalized vectors, so this is sufficient.
const cosineSimilarity = (a: Float32Array, b: Float32Array): number => {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
  }
  return dot;
};

// --- Hierarchical Embedding Cache ---

interface CategoryEmbeddingEntry {
  readonly id: CategoryId;
  readonly slug: string;
  readonly embedding: Float32Array;
}

interface TagEmbeddingEntry {
  readonly id: TagId;
  readonly slug: string;
  readonly embedding: Float32Array;
}

interface TagEmbeddingCache {
  readonly categories: CategoryEmbeddingEntry[];
  readonly topicsByCategory: Map<string, TagEmbeddingEntry[]>;
  readonly allTopics: TagEmbeddingEntry[];  // flat fallback when no categories matched
}

const loadTagEmbeddings = (db: Database): TagEmbeddingCache => {
  // Load category embeddings
  const catRows = queries.getAllCategoryEmbeddings(db);
  const categories: CategoryEmbeddingEntry[] = catRows.map(row => ({
    id: row.id,
    slug: row.slug,
    embedding: bufferToFloat32(row.embedding),
  }));

  // Load tag embeddings grouped by category
  const tagRows = queries.getAllTagEmbeddings(db);
  const topicsByCategory = new Map<string, TagEmbeddingEntry[]>();
  const allTopics: TagEmbeddingEntry[] = [];
  const signals: TagEmbeddingEntry[] = [];

  for (const row of tagRows) {
    const entry: TagEmbeddingEntry = {
      id: row.id,
      slug: row.slug,
      embedding: bufferToFloat32(row.embedding),
    };
    // Only load topic tags — signal tags are no longer used
    if (row.tag_group !== 'signal') {
      allTopics.push(entry);
      const catSlug = row.category_slug ?? '__uncategorized';
      let bucket = topicsByCategory.get(catSlug);
      if (!bucket) {
        bucket = [];
        topicsByCategory.set(catSlug, bucket);
      }
      bucket.push(entry);
    }
  }

  return { categories, topicsByCategory, allTopics };
};

// --- Two-Pass Hierarchical Tag Assignment ---
//
// Pass 1: Score article against all category embeddings → pick top categories
// Pass 2: Within matched categories, score against their tags → pick top tags
// This prevents cross-domain confusion (e.g. "Rust" in programming vs chemistry)

const CATEGORY_THRESHOLD = 0.45;
const MAX_CATEGORIES = 3;
const TAG_THRESHOLD = 0.5;
const MAX_TOPIC_TAGS = 5;
// Each tag must score within 95% of the top tag to be included.
// Slightly looser than before (was 97%) because within-category tags are more similar.
const MIN_SCORE_RATIO = 0.95;

export const assignTags = (
  entryEmbedding: Float32Array,
  cache: TagEmbeddingCache,
): { topicTagIds: TagId[] } => {
  let topicTagIds: TagId[];

  if (cache.categories.length > 0) {
    // --- Pass 1: Category classification ---
    const catScores = cache.categories
      .map(c => ({ slug: c.slug, score: cosineSimilarity(entryEmbedding, c.embedding) }))
      .filter(c => c.score >= CATEGORY_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_CATEGORIES);

    // --- Pass 2: Tag assignment within matched categories ---
    const candidates: Array<{ id: TagId; score: number }> = [];
    for (const cat of catScores) {
      const tags = cache.topicsByCategory.get(cat.slug) ?? [];
      for (const tag of tags) {
        candidates.push({ id: tag.id, score: cosineSimilarity(entryEmbedding, tag.embedding) });
      }
    }

    const sorted = candidates
      .filter(s => s.score >= TAG_THRESHOLD)
      .sort((a, b) => b.score - a.score);

    const topScore = sorted[0]?.score ?? 0;
    topicTagIds = sorted
      .filter(s => s.score >= topScore * MIN_SCORE_RATIO)
      .slice(0, MAX_TOPIC_TAGS)
      .map(s => s.id);
  } else {
    // Fallback: flat comparison against all topics (pre-category migration)
    const sorted = cache.allTopics
      .map(t => ({ id: t.id, score: cosineSimilarity(entryEmbedding, t.embedding) }))
      .filter(s => s.score >= TAG_THRESHOLD)
      .sort((a, b) => b.score - a.score);

    const topScore = sorted[0]?.score ?? 0;
    topicTagIds = sorted
      .filter(s => s.score >= topScore * MIN_SCORE_RATIO)
      .slice(0, MAX_TOPIC_TAGS)
      .map(s => s.id);
  }

  return { topicTagIds };
};

// --- Depth Score ---

// Depth anchors embedded in memory at startup; reused across all batches.
// Shape: one Float32Array per anchor in DEPTH_ANCHORS order.
let _depthAnchorEmbeddings: Float32Array[] | null = null;

export const setDepthAnchorEmbeddings = (vecs: Float32Array[]): void => {
  _depthAnchorEmbeddings = vecs;
};

export const getDepthAnchorEmbeddings = (): Float32Array[] | null => _depthAnchorEmbeddings;

// Compute content depth score (0.0–1.0) via softmax-weighted anchor similarities.
// Returns null if depth anchors haven't been embedded yet.
export const assignDepth = (entryEmbedding: Float32Array): number | null => {
  if (!_depthAnchorEmbeddings || _depthAnchorEmbeddings.length !== DEPTH_ANCHORS.length) {
    return null;
  }

  // Step 1: cosine similarity against each anchor
  const sims = _depthAnchorEmbeddings.map(anchor =>
    cosineSimilarity(entryEmbedding, anchor)
  );

  // Step 2: softmax over similarities to get probability distribution
  const maxSim = Math.max(...sims);
  const exps = sims.map(s => Math.exp(s - maxSim));  // subtract max for numerical stability
  const sumExp = exps.reduce((a, b) => a + b, 0);
  const probs = exps.map(e => e / sumExp);

  // Step 3: weighted average using fixed anchor weights
  let score = 0;
  for (let i = 0; i < DEPTH_ANCHORS.length; i++) {
    score += probs[i]! * DEPTH_ANCHORS[i]!.weight;
  }

  return score;
};

// --- Embed Depth Anchors on Startup ---

// Embeds all 5 depth anchor descriptions and stores them in memory.
// Called once on startup. Returns true if embeddings are ready.
export const embedDepthAnchors = async (config: AppConfig): Promise<boolean> => {
  const embConfig: EmbeddingConfig = { baseUrl: config.embeddingsUrl };
  const texts = DEPTH_ANCHORS.map(a => a.description);
  const result = await embed(embConfig, texts);
  if (!result.ok) {
    console.error(`[tagger] Failed to embed depth anchors: ${result.error}`);
    return false;
  }
  setDepthAnchorEmbeddings(result.value);
  console.log(`[tagger] Embedded ${DEPTH_ANCHORS.length} depth anchors`);
  return true;
};

// --- Embed Tags on Startup ---

// Embeds all tags that have a description but no embedding yet.
// Called once on startup. Returns the count of newly embedded tags.
export const embedMissingTags = async (db: Database, config: AppConfig): Promise<number> => {
  const embConfig: EmbeddingConfig = { baseUrl: config.embeddingsUrl };

  const tagsToEmbed = queries.getTagsWithoutEmbeddings(db);
  if (tagsToEmbed.length === 0) return 0;

  // Chunk into batches of 64 (embedding sidecar limit)
  const BATCH_SIZE = 64;
  let totalEmbedded = 0;

  for (let i = 0; i < tagsToEmbed.length; i += BATCH_SIZE) {
    const batch = tagsToEmbed.slice(i, i + BATCH_SIZE);
    const texts = batch.map((t) => t.description);
    const result = await embed(embConfig, texts);
    if (!result.ok) {
      console.error(`[tagger] Failed to embed tag batch ${i}..${i + batch.length}: ${result.error}`);
      continue;
    }

    for (let j = 0; j < batch.length; j++) {
      const tag = batch[j]!;
      const vec = result.value[j]!;
      queries.setTagEmbedding(db, tag.id, float32ToBuffer(vec));
    }
    totalEmbedded += batch.length;
  }

  return totalEmbedded;
};

// --- Embed Categories on Startup ---

// Embeds all categories that have a description but no embedding yet.
// Called once on startup after category seeding. Returns count of newly embedded.
export const embedMissingCategories = async (db: Database, config: AppConfig): Promise<number> => {
  const embConfig: EmbeddingConfig = { baseUrl: config.embeddingsUrl };

  const catsToEmbed = queries.getCategoriesWithoutEmbeddings(db);
  if (catsToEmbed.length === 0) return 0;

  // Categories are few (~22), embed in one batch
  const texts = catsToEmbed.map(c => c.description);
  const result = await embed(embConfig, texts);
  if (!result.ok) {
    console.error(`[tagger] Failed to embed categories: ${result.error}`);
    return 0;
  }

  for (let i = 0; i < catsToEmbed.length; i++) {
    const cat = catsToEmbed[i]!;
    const vec = result.value[i]!;
    queries.setCategoryEmbedding(db, cat.id, float32ToBuffer(vec));
  }

  return catsToEmbed.length;
};

// --- Main Batch Tagging ---

// Process a batch of untagged entries using embedding similarity.
// Returns count of successfully tagged entries.
export const tagBatch = async (db: Database, config: AppConfig): Promise<number> => {
  const embConfig: EmbeddingConfig = { baseUrl: config.embeddingsUrl };

  // Health check — skip if embedding sidecar is down
  const healthy = await healthCheck(embConfig);
  if (!healthy) {
    console.log('[tagger] Embedding sidecar unavailable, skipping batch');
    return 0;
  }

  // Load tag embedding cache
  const cache = loadTagEmbeddings(db);
  if (cache.allTopics.length === 0) {
    console.log('[tagger] No tag embeddings loaded, skipping batch');
    return 0;
  }

  // Get untagged entries (up to 64 per batch)
  const entries = queries.getUntaggedEntries(db, 64);
  if (entries.length === 0) return 0;

  // Build embedding inputs
  const texts = entries.map((e) =>
    buildEmbeddingInput({
      title: e.title,
      feed_title: e.feed_title,
      summary: e.summary,
      content_html: e.content_html,
    }),
  );

  // Batch embed
  const result = await embed(embConfig, texts);
  if (!result.ok) {
    console.error(`[tagger] Embedding batch failed: ${result.error}`);
    return 0;
  }

  // Load user preference vector for relevance scoring (Phase 2)
  const prefVecBuf = queries.getConfig(db, 'user_preference_vector');
  const prefVec = prefVecBuf ? bufferToFloat32(Buffer.from(prefVecBuf, 'base64')) : null;

  let tagged = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const embedding = result.value[i]!;

    // Store embedding
    queries.setEntryEmbedding(db, entry.id, float32ToBuffer(embedding));

    // Assign topic tags via two-pass hierarchical cosine similarity
    const { topicTagIds } = assignTags(embedding, cache);

    for (const tagId of topicTagIds) {
      queries.addEntryTag(db, entry.id, tagId, 'embedding');
      queries.incrementTagUseCount(db, tagId);
    }

    // Depth score — continuous quality signal replacing signal tags
    const depth = assignDepth(embedding);
    if (depth !== null) {
      queries.setEntryDepthScore(db, entry.id, depth);
    }

    // Relevance scoring (Phase 2)
    if (prefVec) {
      const score = cosineSimilarity(embedding, prefVec);
      queries.setEntryRelevanceScore(db, entry.id, score);
    }

    // Extractive summarization — TextRank on RSS content (no HTTP fetch)
    if (!entry.extractive_summary && entry.content_html) {
      const plainText = entry.summary || entry.content_html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (plainText.length > 50) {
        const summary = extractiveSummarize(plainText);
        const wc = wordCount(plainText);
        queries.updateEntrySummary(db, entry.id, summary, wc);
      }
    }

    queries.markEntryTagged(db, entry.id);
    tagged++;
  }

  if (tagged > 0) {
    console.log(`[tagger] Tagged ${tagged}/${entries.length} entries`);
  }

  return tagged;
};

// --- Re-tag All Entries ---

// Re-runs tag assignment on all entries that already have embeddings.
// Clears existing embedding-assigned tags and re-assigns with current thresholds.
// Does NOT re-embed — uses stored embeddings. Returns count of re-tagged entries.
export const retagAllEntries = (db: Database): number => {
  const cache = loadTagEmbeddings(db);
  if (cache.allTopics.length === 0) {
    console.log('[tagger] No tag embeddings loaded, cannot retag');
    return 0;
  }

  // Load user preference vector for relevance scoring
  const prefVecBuf = queries.getConfig(db, 'user_preference_vector');
  const prefVec = prefVecBuf ? bufferToFloat32(Buffer.from(prefVecBuf, 'base64')) : null;

  // Process in chunks to avoid loading all embeddings at once
  const CHUNK = 200;
  let offset = 0;
  let total = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = queries.getEntriesWithEmbeddings(db, CHUNK, offset);
    if (rows.length === 0) break;

    for (const row of rows) {
      const embedding = bufferToFloat32(row.embedding);

      // Clear old embedding-assigned tags
      queries.clearEntryEmbeddingTags(db, row.id);

      // Re-assign topic tags
      const { topicTagIds } = assignTags(embedding, cache);
      for (const tagId of topicTagIds) {
        queries.addEntryTag(db, row.id, tagId, 'embedding');
      }

      // Recompute depth score
      const depth = assignDepth(embedding);
      if (depth !== null) {
        queries.setEntryDepthScore(db, row.id, depth);
      }

      // Re-score relevance
      if (prefVec) {
        const score = cosineSimilarity(embedding, prefVec);
        queries.setEntryRelevanceScore(db, row.id, score);
      }

      total++;
    }

    offset += rows.length;
  }

  // Rebuild tag use_counts from scratch
  queries.rebuildTagUseCounts(db);

  console.log(`[tagger] Re-tagged ${total} entries with updated thresholds`);
  return total;
};
