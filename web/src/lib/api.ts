// Typed API client for the Doomscroller backend.
// No axios. No abstractions. Just fetch with types.

const BASE = '/api';

interface ScoredEntry {
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
  is_hidden: number;
  relevance: number | null;
  depth: number | null;
  novelty: number | null;
  category_id: number | null;
  reasoning: string | null;
  feed_title: string;
  feed_site_url: string;
  rank_score: number;
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

interface Category {
  id: number;
  name: string;
  slug: string;
  description: string;
  entry_count: number;
  is_auto: number;
}

interface Stats {
  total_feeds: number;
  total_entries: number;
  unread_entries: number;
  scored_entries: number;
  pending_jobs: number;
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
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`POST ${path}: ${res.status}`);
  return res.json() as Promise<T>;
};

const put = async <T>(path: string, body: unknown): Promise<T> => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path}: ${res.status}`);
  return res.json() as Promise<T>;
};

const del = async <T>(path: string): Promise<T> => {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE ${path}: ${res.status}`);
  return res.json() as Promise<T>;
};

// --- API ---

export const api = {
  entries: {
    list: (opts?: { limit?: number; offset?: number; category?: number; unread?: boolean }) => {
      const params = new URLSearchParams();
      if (opts?.limit) params.set('limit', String(opts.limit));
      if (opts?.offset) params.set('offset', String(opts.offset));
      if (opts?.category) params.set('category', String(opts.category));
      if (opts?.unread) params.set('unread', 'true');
      const qs = params.toString();
      return get<ScoredEntry[]>(`/entries${qs ? `?${qs}` : ''}`);
    },
    get: (id: number) => get<ScoredEntry>(`/entries/${id}`),
    markRead: (id: number) => post<{ ok: boolean }>(`/entries/${id}/read`),
    star: (id: number, starred: boolean) => post<{ ok: boolean }>(`/entries/${id}/star`, { starred }),
    hide: (id: number) => post<{ ok: boolean }>(`/entries/${id}/hide`),
  },

  feeds: {
    list: () => get<Feed[]>('/feeds'),
    add: (url: string) => post<{ id: number }>('/feeds', { url }),
    remove: (id: number) => del<{ ok: boolean }>(`/feeds/${id}`),
  },

  categories: {
    list: () => get<Category[]>('/categories'),
    create: (name: string, description?: string) =>
      post<{ id: number; slug: string }>('/categories', { name, description }),
  },

  preferences: {
    getAll: () => get<Record<string, string>>('/preferences'),
    set: (key: string, value: string) => put<{ ok: boolean }>(`/preferences/${key}`, { value }),
  },

  stats: () => get<Stats>('/stats'),
} as const;

// --- Helpers ---

export const timeAgo = (epoch: number | null): string => {
  if (!epoch) return '';
  const seconds = Math.floor(Date.now() / 1000) - epoch;
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(epoch * 1000).toLocaleDateString();
};

export const relevanceLevel = (score: number | null): 'high' | 'mid' | 'low' => {
  if (score === null) return 'mid';
  if (score >= 0.7) return 'high';
  if (score >= 0.4) return 'mid';
  return 'low';
};

export type { ScoredEntry, Feed, Category, Stats };
