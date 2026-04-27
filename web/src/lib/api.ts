// Typed API client for the Doomscroller backend.
// No axios. No abstractions. Just fetch with types.

const BASE = '/api';

interface EntryTag {
  tag_id: number;
  slug: string;
  label: string;
  mode: string;
}

interface EntryWithMeta {
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
  thumb: number | null;  // 1=up, -1=down, null=none
  depth_score: number | null;  // 0.0=noise → 1.0=dense academic
  extractive_summary: string | null;  // TextRank: key sentences
  word_count: number | null;          // article word count
  feed_title: string;
  feed_site_url: string;
  tags: EntryTag[];
}

interface Feed {
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

interface Stats {
  total_feeds: number;
  total_entries: number;
  unread_entries: number;
  tagged_entries: number;
  pending_jobs: number;
}

interface DashboardFeed extends Feed {
  tagged_count: number;
}

interface DashboardIndexing {
  pending_entries: number;
  running_jobs: number;
  completed_last_hour: number;
  avg_batch_duration_sec: number | null;
  entries_per_minute: number | null;
  embeddings_healthy: boolean;
}

interface DashboardData {
  feeds: DashboardFeed[];
  indexing: DashboardIndexing;
  queue: Record<string, number>;
}

interface Tag {
  id: number;
  slug: string;
  label: string;
  tag_group: string;
  is_builtin: number;
  use_count: number;
  sort_order: number;
  mode: string;
}

interface CategoryInfo {
  slug: string;
  label: string;
  entryCount: number;
}

interface OnboardingStatus {
  complete: boolean;
  show_noise: boolean;
}

interface EntryContent {
  content_full: string | null;
  cached: boolean;
  error?: string;
}

interface Settings {
  reader_cache_days: number;
}

// --- Fetcher ---

const get = async <T>(path: string): Promise<T> => {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
  return res.json() as Promise<T>;
};

const post = async <T>(path: string, body?: unknown): Promise<T> => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    ...(body != null
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  if (!res.ok) throw new Error(`POST ${path}: ${res.status}`);
  return res.json() as Promise<T>;
};

const del = async <T>(path: string): Promise<T> => {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE ${path}: ${res.status}`);
  return res.json() as Promise<T>;
};

const put = async <T>(path: string, body?: unknown): Promise<T> => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    ...(body != null
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  if (!res.ok) throw new Error(`PUT ${path}: ${res.status}`);
  return res.json() as Promise<T>;
};

// --- API ---

export const api = {
  entries: {
    list: (opts?: { limit?: number; offset?: number; tag?: string; category?: string; unread?: boolean; filter?: string; starred?: boolean; thumb?: number; noise?: boolean }) => {
      const params = new URLSearchParams();
      if (opts?.limit) params.set('limit', String(opts.limit));
      if (opts?.offset) params.set('offset', String(opts.offset));
      if (opts?.tag) params.set('tag', opts.tag);
      if (opts?.category) params.set('category', opts.category);
      if (opts?.unread) params.set('unread', 'true');
      if (opts?.filter) params.set('filter', opts.filter);
      if (opts?.starred) params.set('starred', 'true');
      if (opts?.thumb != null) params.set('thumb', String(opts.thumb));
      if (opts?.noise) params.set('noise', 'true');
      const qs = params.toString();
      return get<EntryWithMeta[]>(`/entries${qs ? `?${qs}` : ''}`);
    },
    get: (id: number) => get<EntryWithMeta>(`/entries/${id}`),
    getContent: (id: number) => get<EntryContent>(`/entries/${id}/content`),
    markRead: (id: number) => post<{ ok: boolean }>(`/entries/${id}/read`),
    star: (id: number, starred: boolean) => post<{ ok: boolean }>(`/entries/${id}/star`, { starred }),
    thumb: (id: number, thumb: 1 | -1 | null) => post<{ ok: boolean }>(`/entries/${id}/thumb`, { thumb }),
  },

  categories: () => get<CategoryInfo[]>('/categories'),

  feeds: {
    list: () => get<Feed[]>('/feeds'),
    add: (url: string) => post<{ id: number }>('/feeds', { url }),
    remove: (id: number) => del<{ ok: boolean }>(`/feeds/${id}`),
  },

  stats: () => get<Stats>('/stats'),

  dashboard: () => get<DashboardData>('/dashboard'),

  tags: {
    list: async (): Promise<Tag[]> => {
      const grouped = await get<Record<string, Tag[]>>('/tags');
      return Object.values(grouped).flat();
    },
    create: (slug: string, label: string) => post<Tag>('/tags', { slug, label, tag_group: 'custom' }),
    delete: (id: number) => del<{ ok: boolean }>(`/tags/${id}`),
    setPreference: (id: number, mode: string) => {
      return fetch(`${BASE}/tags/${id}/preference`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      }).then(r => {
        if (!r.ok) throw new Error(`PUT /tags/${id}/preference: ${r.status}`);
        return r.json();
      });
    },
  },

  config: {
    getOnboarding: () => get<OnboardingStatus>('/config/onboarding'),
    completeOnboarding: (preferences: Record<string, string>, showNoise?: boolean) =>
      post<{ ok: boolean }>('/config/onboarding', { preferences, show_noise: showNoise ?? false }),
    getSettings: () => get<Settings>('/config/settings'),
    updateSettings: (settings: Partial<Settings>) => put<{ ok: boolean }>('/config/settings', settings),
  },
} as const;

// --- Helpers ---

// Compute a display label from a depth score (not stored in DB — derived on the fly).
export const contentLabel = (depth: number | null): string => {
  if (depth === null) return '';
  if (depth < 0.15) return 'Noise';
  if (depth < 0.35) return 'Shallow';
  if (depth < 0.55) return 'Standard';
  if (depth < 0.75) return 'Substantive';
  return 'Dense';
};

export const timeAgo = (epoch: number | null): string => {
  if (!epoch) return '';
  const seconds = Math.floor(Date.now() / 1000) - epoch;
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(epoch * 1000).toLocaleDateString();
};

export const readTime = (wordCount: number | null): string => {
  if (!wordCount || wordCount < 50) return '';
  const minutes = Math.max(1, Math.round(wordCount / 200));
  return `${minutes} min read`;
};

export type { EntryWithMeta, EntryTag, EntryContent, Feed, Stats, Tag, CategoryInfo, OnboardingStatus, Settings, DashboardData, DashboardFeed, DashboardIndexing };
