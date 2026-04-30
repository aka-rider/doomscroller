// Typed API client for the Doomscroller backend.
// No axios. No abstractions. Just fetch with types.

import type { EntryWithMeta, EntryContent, Feed, Stats, Tag, CategoriesResponse, OnboardingStatus, Settings, DashboardData } from './types';

const BASE = '/api';

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

// Build query string from an object, skipping null/undefined/false values.
const toQueryString = (opts: Record<string, string | number | boolean | null | undefined>): string => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(opts)) {
    if (v == null || v === false) continue;
    params.set(k, v === true ? 'true' : String(v));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
};

// --- API ---

export const api = {
  entries: {
    list: (opts?: { limit?: number; offset?: number; tag?: string; category?: string; unread?: boolean; filter?: string; favorites?: boolean; thumb?: number; noise?: boolean; feed?: number }) => {
      const qs = toQueryString({
        limit: opts?.limit,
        offset: opts?.offset,
        tag: opts?.tag,
        category: opts?.category,
        unread: opts?.unread,
        filter: opts?.filter,
        favorites: opts?.favorites,
        thumb: opts?.thumb,
        noise: opts?.noise,
        feed: opts?.feed,
      });
      return get<EntryWithMeta[]>(`/entries${qs}`);
    },
    get: (id: number) => get<EntryWithMeta>(`/entries/${id}`),
    getContent: (id: number) => get<EntryContent>(`/entries/${id}/content`),
    markRead: (id: number) => post<{ ok: boolean }>(`/entries/${id}/read`),
    setRead: (id: number, isRead: boolean) => post<{ ok: boolean }>(`/entries/${id}/read`, { is_read: isRead }),
    thumb: (id: number, thumb: 1 | -1 | null) => post<{ ok: boolean }>(`/entries/${id}/thumb`, { thumb }),
  },

  categories: () => get<CategoriesResponse>('/categories'),

  feeds: {
    list: () => get<Feed[]>('/feeds'),
    add: (url: string) => post<{ id: number }>('/feeds', { url }),
    remove: (id: number) => del<{ ok: boolean }>(`/feeds/${id}`),
    refresh: (id: number) => post<{ ok: boolean; message: string }>(`/feeds/${id}/refresh`),
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
    setPreference: (id: number, mode: string) => put<{ ok: boolean }>(`/tags/${id}/preference`, { mode }),
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

export type { EntryWithMeta, EntryTag, EntryContent, Feed, Stats, Tag, CategoryInfo, OnboardingStatus, Settings, DashboardData, DashboardFeed, DashboardIndexing } from './types';
