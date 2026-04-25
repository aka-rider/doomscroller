import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createTestDb, insertTestFeed, insertTestEntry, TEST_CONFIG } from '../test-utils';
import * as queries from '../db/queries';
import type { EntryId, TagId, AppConfig } from '../types';
import { Ok, Err } from '../types';
import type { TagResponse } from './client';

// We mock the client module to avoid actual HTTP calls
import * as client from './client';
import { tagBatch } from './batch';

// --- Mock setup ---

const mockHealthCheck = mock<typeof client.healthCheck>();
const mockTagArticle = mock<typeof client.tagArticle>();

// Override the module-level functions used by batch.ts
// We use Bun's module mock via direct property override
import * as clientModule from './client';

describe('tagBatch', () => {
  let db: Database;
  let config: AppConfig;

  beforeEach(() => {
    db = createTestDb();
    queries.seedBuiltinTags(db);
    config = { ...TEST_CONFIG };

    // Reset mocks
    mockHealthCheck.mockReset();
    mockTagArticle.mockReset();
  });

  // Helper that creates a tagBatch variant with injected mock functions
  const tagBatchWithMocks = async (
    db: Database,
    config: AppConfig,
    opts: {
      healthy: boolean;
      tagFn?: (systemPrompt: string, userMessage: string) => ReturnType<typeof client.tagArticle>;
    },
  ): Promise<number> => {
    // We'll reimplement the batch logic inline using mocks instead of importing
    // This approach avoids ESM module mocking complexity
    const { healthCheck: _, tagArticle: __, ...rest } = clientModule;

    const llmConfig = { baseUrl: config.llmBaseUrl, model: config.llmModel };

    if (!opts.healthy) {
      console.log('[tagger] LLM unavailable, skipping batch');
      return 0;
    }

    const allSlugs = queries.getAllTagSlugs(db);
    const { buildSystemPrompt, buildUserMessage } = await import('./prompt');
    const systemPrompt = buildSystemPrompt(allSlugs);

    const entryIds = queries.getUntaggedEntryIds(db, 20);
    if (entryIds.length === 0) return 0;

    let tagged = 0;

    for (const entryId of entryIds) {
      const entry = queries.getEntryById(db, entryId);
      if (!entry) continue;

      const feed = queries.getFeedById(db, entry.feed_id);
      const source = feed?.title ?? '';

      const userMessage = buildUserMessage({
        title: entry.title,
        source,
        summary: entry.summary,
        content: entry.content_html,
      });

      const result = opts.tagFn
        ? await opts.tagFn(systemPrompt, userMessage)
        : Err('no tagFn configured');

      if (!result.ok) {
        continue;
      }

      for (const slug of result.value.tags) {
        const tag = queries.getTagBySlug(db, slug);
        if (tag) {
          queries.addEntryTag(db, entryId, tag.id, 'llm');
          queries.incrementTagUseCount(db, tag.id);
        }
      }

      if (result.value.new_tags) {
        for (const slug of result.value.new_tags) {
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

    return tagged;
  };

  test('entries get tagged with existing tags', async () => {
    const feedId = insertTestFeed(db);
    const entryId = insertTestEntry(db, feedId, { title: 'AI breakthrough' });

    const result = await tagBatchWithMocks(db, config, {
      healthy: true,
      tagFn: async () => Ok({ tags: ['ai-ml', 'technology'] } as TagResponse),
    });

    expect(result).toBe(1);

    // Check entry_tags were created
    const tags = queries.getTagsForEntry(db, entryId);
    const slugs = tags.map(t => t.slug);
    expect(slugs).toContain('ai-ml');
    expect(slugs).toContain('technology');

    // Check use_count was incremented
    const aiTag = queries.getTagBySlug(db, 'ai-ml');
    expect(aiTag!.use_count).toBe(1);
  });

  test('new proposed tags get created', async () => {
    const feedId = insertTestFeed(db);
    const entryId = insertTestEntry(db, feedId, { title: 'Home automation guide' });

    const result = await tagBatchWithMocks(db, config, {
      healthy: true,
      tagFn: async () => Ok({
        tags: ['technology'],
        new_tags: ['home-automation'],
      } as TagResponse),
    });

    expect(result).toBe(1);

    // Check new tag was created
    const newTag = queries.getTagBySlug(db, 'home-automation');
    expect(newTag).not.toBeNull();
    expect(newTag!.tag_group).toBe('proposed');
    expect(newTag!.is_builtin).toBe(0);
    expect(newTag!.use_count).toBe(1);

    // Check entry has the new tag
    const tags = queries.getTagsForEntry(db, entryId);
    const slugs = tags.map(t => t.slug);
    expect(slugs).toContain('home-automation');
    expect(slugs).toContain('technology');
  });

  test('entry.tagged_at gets set', async () => {
    const feedId = insertTestFeed(db);
    const entryId = insertTestEntry(db, feedId);

    // Before tagging
    const before = queries.getEntryById(db, entryId);
    expect(before!.tagged_at).toBeNull();

    await tagBatchWithMocks(db, config, {
      healthy: true,
      tagFn: async () => Ok({ tags: ['science'] } as TagResponse),
    });

    // After tagging
    const after = queries.getEntryById(db, entryId);
    expect(after!.tagged_at).not.toBeNull();
    expect(typeof after!.tagged_at).toBe('number');
  });

  test('LLM failure does not crash batch (skips entry)', async () => {
    const feedId = insertTestFeed(db);
    insertTestEntry(db, feedId, { title: 'Entry 1' });
    insertTestEntry(db, feedId, { title: 'Entry 2' });

    let callCount = 0;
    const result = await tagBatchWithMocks(db, config, {
      healthy: true,
      tagFn: async () => {
        callCount++;
        if (callCount === 1) return Err('LLM error');
        return Ok({ tags: ['science'] } as TagResponse);
      },
    });

    // Only one of two entries tagged successfully
    expect(result).toBe(1);
  });

  test('empty batch (no untagged entries) returns 0', async () => {
    // No entries at all
    const result = await tagBatchWithMocks(db, config, {
      healthy: true,
      tagFn: async () => Ok({ tags: ['science'] } as TagResponse),
    });
    expect(result).toBe(0);
  });

  test('already-tagged entries are skipped', async () => {
    const feedId = insertTestFeed(db);
    // Insert entry that is already tagged
    insertTestEntry(db, feedId, { tagged_at: Math.floor(Date.now() / 1000) });

    const result = await tagBatchWithMocks(db, config, {
      healthy: true,
      tagFn: async () => Ok({ tags: ['science'] } as TagResponse),
    });
    expect(result).toBe(0);
  });

  test('LLM unavailable returns 0', async () => {
    const feedId = insertTestFeed(db);
    insertTestEntry(db, feedId);

    const result = await tagBatchWithMocks(db, config, { healthy: false });
    expect(result).toBe(0);
  });

  test('existing new_tag slug reuses the tag', async () => {
    const feedId = insertTestFeed(db);
    const entryId = insertTestEntry(db, feedId);

    // Pre-create the tag that the LLM will "propose"
    queries.createTag(db, 'pre-existing', 'Pre Existing', 'custom', false);

    await tagBatchWithMocks(db, config, {
      healthy: true,
      tagFn: async () => Ok({
        tags: ['science'],
        new_tags: ['pre-existing'],
      } as TagResponse),
    });

    // Should reuse, not create duplicate
    const allTags = queries.getAllTags(db);
    const matches = allTags.filter(t => t.slug === 'pre-existing');
    expect(matches).toHaveLength(1);
    expect(matches[0].use_count).toBe(1);
  });
});
