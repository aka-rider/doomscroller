import { Database } from 'bun:sqlite';
import type { EntryId, AppConfig, CategoryId } from '../types';
import * as queries from '../db/queries';
import { classifyEntry, suggestCategories, healthCheck } from './client';

// Batch scorer: pulls unscored entries, classifies them via LLM, writes scores back.
// Designed for 1-5 tok/sec throughput. Patient. Resilient. No rush.

export const scoreBatch = async (db: Database, config: AppConfig): Promise<number> => {
  // Check LLM health first — don't waste time if it's down
  const llmConfig = { baseUrl: config.llmBaseUrl, model: config.llmModel };
  const healthy = await healthCheck(llmConfig);
  if (!healthy) {
    console.log('[scorer] LLM not reachable, skipping batch');
    return 0;
  }

  // Get unscored entries
  const unscoredIds = queries.getUnscoredEntryIds(db, config.scoreBatchSize);
  if (unscoredIds.length === 0) return 0;

  const entries = queries.getEntriesForScoring(db, unscoredIds);
  const categories = queries.getAllCategories(db);
  const categoryNames = categories.map(c => c.name);

  // Build user profile from preferences
  const prefs = queries.getAllPreferences(db);
  const userProfile = prefs['interest_profile'] ?? 'No preferences set yet. Score everything as 0.5 relevance.';

  let scored = 0;

  // Process one-by-one. LLM is slow — parallelism doesn't help with a single model.
  for (const entry of entries) {
    const result = await classifyEntry(
      llmConfig,
      { title: entry.title, summary: entry.summary, feedTitle: entry.feed_title },
      categoryNames,
      userProfile,
    );

    if (!result.ok) {
      console.error(`[scorer] Failed to score entry ${entry.id}: ${result.error}`);
      continue;
    }

    const classification = result.value;

    // Resolve primary category
    const primaryCat = categories.find(
      c => c.name.toLowerCase() === classification.category.toLowerCase()
    );

    queries.upsertEntryScore(db, {
      entry_id: entry.id,
      relevance: classification.relevance,
      depth: classification.depth,
      novelty: classification.novelty,
      category_id: (primaryCat?.id ?? null) as CategoryId | null,
      reasoning: classification.reasoning,
      model: config.llmModel,
    });

    // Write secondary categories
    if (primaryCat) {
      queries.upsertEntryCategory(db, entry.id, primaryCat.id, 1.0);
    }

    for (const secName of classification.secondary_categories) {
      const secCat = categories.find(
        c => c.name.toLowerCase() === secName.toLowerCase()
      );
      if (secCat) {
        queries.upsertEntryCategory(db, entry.id, secCat.id, 0.7);
      }
    }

    scored++;
  }

  if (scored > 0) {
    console.log(`[scorer] Scored ${scored}/${entries.length} entries`);
  }

  return scored;
};

// Auto-categorize a new feed based on sample entries
export const autoCategorizeFeed = async (
  db: Database,
  config: AppConfig,
  feedId: number,
  feedTitle: string,
  sampleTitles: readonly string[],
): Promise<string[]> => {
  const llmConfig = { baseUrl: config.llmBaseUrl, model: config.llmModel };
  const healthy = await healthCheck(llmConfig);
  if (!healthy) return [];

  const existingCategories = queries.getAllCategories(db).map(c => c.name);

  const result = await suggestCategories(llmConfig, feedTitle, sampleTitles, existingCategories);
  if (!result.ok) {
    console.error(`[scorer] Auto-categorize failed for feed ${feedId}: ${result.error}`);
    return [];
  }

  const suggested = result.value;
  const assignedCategories: string[] = [];

  for (const name of suggested) {
    let cat = queries.getCategoryByName(db, name);
    if (!cat) {
      // Create new auto-category
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const id = queries.insertCategory(db, name, slug, `Auto-generated for feed: ${feedTitle}`, true);
      cat = { id, name, slug, description: '', sort_order: 0, is_auto: 1, created_at: 0 };
    }
    assignedCategories.push(cat.name);

    // Link feed to category
    db.run(
      'INSERT OR IGNORE INTO feed_categories (feed_id, category_id) VALUES (?, ?)',
      [feedId, cat.id]
    );
  }

  return assignedCategories;
};
