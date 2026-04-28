// Domain types for the Doomscroller frontend.
// Single source of truth — imported by api.ts, components, providers.

export type ViewMode = 'feed' | 'everything' | 'favorites' | 'trash' | 'noise';

export interface EntryTag {
  tag_id: number;
  slug: string;
  label: string;
  mode: string;
}

export interface EntryWithMeta {
  id: number;
  feed_id: number;
  guid: string;
  url: string;
  title: string;
  author: string;
  content_html: string;
  summary: string;
  image_url: string | null;
  published_at: number | null;
  fetched_at: number;
  is_read: number;
  is_starred: number;
  tagged_at: number | null;
  thumb: number | null;
  depth_score: number | null;
  extractive_summary: string | null;
  word_count: number | null;
  feed_title: string;
  feed_site_url: string;
  tags: EntryTag[];
}

export interface Feed {
  id: number;
  url: string;
  title: string;
  site_url: string;
  description: string;
  error_count: number;
  last_error: string | null;
  last_fetched_at: number | null;
  is_active: number;
  entry_count: number;
  unread_count: number;
}

export interface Stats {
  total_feeds: number;
  total_entries: number;
  unread_entries: number;
  tagged_entries: number;
  pending_jobs: number;
}

export interface DashboardFeed extends Feed {
  tagged_count: number;
}

export interface DashboardIndexing {
  pending_entries: number;
  running_jobs: number;
  completed_last_hour: number;
  avg_batch_duration_sec: number | null;
  entries_per_minute: number | null;
  embeddings_healthy: boolean;
}

export interface DashboardData {
  feeds: DashboardFeed[];
  indexing: DashboardIndexing;
  queue: Record<string, number>;
}

export interface Tag {
  id: number;
  slug: string;
  label: string;
  tag_group: string;
  is_builtin: number;
  use_count: number;
  sort_order: number;
  mode: string;
}

export interface CategoryInfo {
  slug: string;
  label: string;
  entryCount: number;
}

export interface OnboardingStatus {
  complete: boolean;
  show_noise: boolean;
}

export interface EntryContent {
  content_full: string | null;
  cached: boolean;
  error?: string;
}

export interface Settings {
  reader_cache_days: number;
}
