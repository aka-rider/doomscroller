// Branded types and shared interfaces for the entire server.
// No classes. No inheritance. Just shapes.

// --- Branded ID types ---
// Prevents accidentally passing a FeedId where an EntryId is expected.

declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type FeedId = Brand<number, 'FeedId'>;
export type EntryId = Brand<number, 'EntryId'>;
export type TagId = Brand<number, 'TagId'>;
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
  readonly tagged_at: number | null;
}

export interface Tag {
  readonly id: TagId;
  readonly slug: string;
  readonly label: string | null;
  readonly tag_group: string;
  readonly is_builtin: number;
  readonly use_count: number;
  readonly sort_order: number;
}

export interface EntryTag {
  readonly entry_id: EntryId;
  readonly tag_id: TagId;
  readonly source: string;
}

export interface TagPreference {
  readonly tag_id: TagId;
  readonly mode: string;
  readonly updated_at: number;
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

// --- Composite types for API responses ---

export interface FeedWithStats extends Feed {
  readonly entry_count: number;
  readonly unread_count: number;
}

// --- Job payload types ---

export interface FetchFeedPayload {
  readonly feed_id: FeedId;
}

export interface TagBatchPayload {
  readonly entry_ids: readonly EntryId[];
}

export type JobPayload =
  | { type: 'fetch_feed'; data: FetchFeedPayload }
  | { type: 'tag_batch'; data: TagBatchPayload }
  | { type: 'cleanup'; data: Record<string, never> };

// --- Config ---

export interface AppConfig {
  readonly port: number;
  readonly dataDir: string;
  readonly llmBaseUrl: string;
  readonly llmModel: string;
  readonly fetchIntervalMin: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  port: 6767,
  dataDir: './data',
  llmBaseUrl: 'http://llm:8081',
  llmModel: 'gemma-4',
  fetchIntervalMin: 30,
};
