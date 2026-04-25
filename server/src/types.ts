// Branded types and shared interfaces for the entire server.
// No classes. No inheritance. Just shapes.

// --- Branded ID types ---
// Prevents accidentally passing a FeedId where an EntryId is expected.

declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type FeedId = Brand<number, 'FeedId'>;
export type EntryId = Brand<number, 'EntryId'>;
export type CategoryId = Brand<number, 'CategoryId'>;
export type JobId = Brand<number, 'JobId'>;

// --- Result type ---
// Operations that can fail return this instead of throwing.

export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });

// --- Database row types ---
// These mirror the SQLite schema exactly. No ORM, no transformation layer.

export interface Feed {
  readonly id: FeedId;
  readonly url: string;
  readonly title: string;
  readonly site_url: string;
  readonly description: string;
  readonly etag: string | null;
  readonly last_modified: string | null;
  readonly last_fetched_at: number | null;
  readonly fetch_interval_min: number;
  readonly error_count: number;
  readonly last_error: string | null;
  readonly is_active: number; // 0 | 1
  readonly created_at: number;
}

export interface Category {
  readonly id: CategoryId;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly sort_order: number;
  readonly is_auto: number;
  readonly created_at: number;
}

export interface Entry {
  readonly id: EntryId;
  readonly feed_id: FeedId;
  readonly guid: string;
  readonly url: string;
  readonly title: string;
  readonly author: string;
  readonly content_html: string;
  readonly summary: string;
  readonly image_url: string | null;
  readonly published_at: number | null;
  readonly fetched_at: number;
  readonly is_read: number;
  readonly is_starred: number;
  readonly is_hidden: number;
}

export interface EntryScore {
  readonly entry_id: EntryId;
  readonly relevance: number;
  readonly depth: number;
  readonly novelty: number;
  readonly category_id: CategoryId | null;
  readonly reasoning: string;
  readonly model: string;
  readonly scored_at: number;
}

export interface EntryCategory {
  readonly entry_id: EntryId;
  readonly category_id: CategoryId;
  readonly confidence: number;
}

export interface Job {
  readonly id: JobId;
  readonly type: string;
  readonly payload: string; // JSON string
  readonly status: 'pending' | 'running' | 'done' | 'failed' | 'dead';
  readonly priority: number;
  readonly run_after: number;
  readonly started_at: number | null;
  readonly completed_at: number | null;
  readonly attempts: number;
  readonly max_attempts: number;
  readonly error: string | null;
  readonly created_at: number;
}

export interface Interaction {
  readonly id: number;
  readonly entry_id: EntryId;
  readonly action: 'read' | 'star' | 'hide' | 'click' | 'skip';
  readonly duration_sec: number | null;
  readonly created_at: number;
}

// --- Composite types for API responses ---

export interface ScoredEntry extends Entry {
  readonly score: EntryScore | null;
  readonly feed_title: string;
  readonly feed_site_url: string;
  readonly categories: ReadonlyArray<{ name: string; confidence: number }>;
}

export interface FeedWithStats extends Feed {
  readonly entry_count: number;
  readonly unread_count: number;
  readonly categories: readonly Category[];
}

// --- Job payload types ---

export interface FetchFeedPayload {
  readonly feed_id: FeedId;
}

export interface ScoreBatchPayload {
  readonly entry_ids: readonly EntryId[];
}

export interface ScoreEntryPayload {
  readonly entry_id: EntryId;
}

export type JobPayload =
  | { type: 'fetch_feed'; data: FetchFeedPayload }
  | { type: 'score_batch'; data: ScoreBatchPayload }
  | { type: 'score_entry'; data: ScoreEntryPayload }
  | { type: 'update_preferences'; data: Record<string, never> }
  | { type: 'cleanup'; data: Record<string, never> };

// --- LLM response types ---

export interface LLMClassification {
  readonly category: string;
  readonly secondary_categories: readonly string[];
  readonly relevance: number;
  readonly depth: number;
  readonly novelty: number;
  readonly reasoning: string;
}

// --- Config ---

export interface AppConfig {
  readonly port: number;
  readonly dataDir: string;
  readonly llmBaseUrl: string;
  readonly llmModel: string;
  readonly embeddingsBaseUrl: string;
  readonly fetchIntervalMin: number;
  readonly scoreBatchSize: number;
  readonly maxConcurrentFetches: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  port: 6767,
  dataDir: './data',
  llmBaseUrl: 'http://llm:8081',
  llmModel: 'gemma-4',
  embeddingsBaseUrl: 'http://embeddings:8082',
  fetchIntervalMin: 30,
  scoreBatchSize: 15,
  maxConcurrentFetches: 5,
};
