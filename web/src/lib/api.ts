// Typed API client for the Doomscroller backend.
// No axios. No abstractions. Just fetch with types.

const BASE = '/api';

interface EntryTag {
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

// --- API ---

export const api = {
  entries: {
    list: (opts?: { limit?: number; offset?: number; tag?: string; unread?: boolean; filter?: string }) => {
      const params = new URLSearchParams();
      if (opts?.limit) params.set('limit', String(opts.limit));
      if (opts?.offset) params.set('offset', String(opts.offset));
      if (opts?.tag) params.set('tag', opts.tag);
      if (opts?.unread) params.set('unread', 'true');
      if (opts?.filter) params.set('filter', opts.filter);
      const qs = params.toString();
      return get<EntryWithMeta[]>(`/entries${qs ? `?${qs}` : ''}`);
    },
    get: (id: number) => get<EntryWithMeta>(`/entries/${id}`),
    markRead: (id: number) => post<{ ok: boolean }>(`/entries/${id}/read`),
    star: (id: number, starred: boolean) => post<{ ok: boolean }>(`/entries/${id}/star`, { starred }),
  },

  feeds: {
    list: () => get<Feed[]>('/feeds'),
    add: (url: string) => post<{ id: number }>('/feeds', { url }),
    remove: (id: number) => del<{ ok: boolean }>(`/feeds/${id}`),
  },

  stats: () => get<Stats>('/stats'),

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
    getOnboarding: () => get<{ complete: boolean }>('/config/onboarding'),
    completeOnboarding: (preferences: Record<string, string>) =>
      post<{ ok: boolean }>('/config/onboarding', { preferences }),
  },
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

export type { EntryWithMeta, EntryTag, Feed, Stats, Tag };
