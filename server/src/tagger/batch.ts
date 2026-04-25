import type { Database } from 'bun:sqlite';
import type { AppConfig } from '../types';
import * as queries from '../db/queries';
import { tagArticle, healthCheck } from './client';
import type { LLMConfig } from './client';
import { buildSystemPrompt, buildUserMessage } from './prompt';

// Process a batch of untagged entries. Returns count of successfully tagged entries.
export const tagBatch = async (db: Database, config: AppConfig): Promise<number> => {
  const llmConfig: LLMConfig = {
    baseUrl: config.llmBaseUrl,
    model: config.llmModel,
  };

  // Health check — skip if LLM is down
  const healthy = await healthCheck(llmConfig);
  if (!healthy) {
    console.log('[tagger] LLM unavailable, skipping batch');
    return 0;
  }

  // Get all known tag slugs for the system prompt
  const allSlugs = queries.getAllTagSlugs(db);
  const systemPrompt = buildSystemPrompt(allSlugs);

  // Get untagged entries
  const entryIds = queries.getUntaggedEntryIds(db, 20);
  if (entryIds.length === 0) return 0;

  let tagged = 0;

  for (const entryId of entryIds) {
    const entry = queries.getEntryById(db, entryId);
    if (!entry) continue;

    // Get feed title for "source" field
    const feed = queries.getFeedById(db, entry.feed_id);
    const source = feed?.title ?? '';

    const userMessage = buildUserMessage({
      title: entry.title,
      source,
      summary: entry.summary,
      content: entry.content_html,
    });

    const result = await tagArticle(llmConfig, systemPrompt, userMessage);

    if (!result.ok) {
      console.error(`[tagger] Failed to tag entry ${entryId}: ${result.error}`);
      continue;
    }

    // Apply existing tags
    for (const slug of result.value.tags) {
      const tag = queries.getTagBySlug(db, slug);
      if (tag) {
        queries.addEntryTag(db, entryId, tag.id, 'llm');
        queries.incrementTagUseCount(db, tag.id);
      }
    }

    // Create and apply new proposed tags
    if (result.value.new_tags) {
      for (const slug of result.value.new_tags) {
        // Don't create if it already exists
        const existing = queries.getTagBySlug(db, slug);
        if (existing) {
          queries.addEntryTag(db, entryId, existing.id, 'llm');
          queries.incrementTagUseCount(db, existing.id);
        } else {
          const label = slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          const newTagId = queries.createTag(db, slug, label, 'proposed', false);
          queries.addEntryTag(db, entryId, newTagId, 'llm');
          queries.incrementTagUseCount(db, newTagId);
        }
      }
    }

    queries.markEntryTagged(db, entryId);
    tagged++;
  }

  if (tagged > 0) {
    console.log(`[tagger] Tagged ${tagged}/${entryIds.length} entries`);
  }

  return tagged;
};
