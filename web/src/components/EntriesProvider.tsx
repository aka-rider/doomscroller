import { createSignal, createEffect, createContext, useContext, batch, on } from 'solid-js';
import type { Accessor } from 'solid-js';
import type { JSX } from 'solid-js';
import { api } from '../lib/api';
import type { EntryWithMeta } from '../lib/types';
import { useNavigation } from './NavigationProvider';

const PAGE_SIZE = 50;

export interface EntriesContextValue {
  entries: Accessor<EntryWithMeta[]>;
  loading: Accessor<boolean>;
  mutateEntries: (v: EntryWithMeta[] | ((prev: EntryWithMeta[]) => EntryWithMeta[])) => void;
  syncActiveArticle: (updatedList: EntryWithMeta[]) => void;
  prevEntry: Accessor<EntryWithMeta | null>;
  nextEntry: Accessor<EntryWithMeta | null>;
  openArticle: (entry: EntryWithMeta) => void;
  closeArticle: () => void;
  navigateArticle: (direction: 'prev' | 'next') => void;
  /** Set by EntryActionsProvider after mount to break circular dep */
  _markReadRef: { current: ((id: number) => void) | null };
  loadMore: () => Promise<void>;
  hasMore: Accessor<boolean>;
  isLoadingMore: Accessor<boolean>;
  refetchEntries: () => Promise<void>;
}

const EntriesContext = createContext<EntriesContextValue>();

export const EntriesProvider = (props: { children: JSX.Element }) => {
  const nav = useNavigation();

  // Mutable ref — EntryActionsProvider sets this after it mounts
  const markReadRef: { current: ((id: number) => void) | null } = { current: null };

  // Pagination state
  const [entries, setEntries] = createSignal<EntryWithMeta[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [hasMore, setHasMore] = createSignal(true);
  const [isLoadingMore, setIsLoadingMore] = createSignal(false);
  const [offset, setOffset] = createSignal(0);

  // Build fetch params from current nav state
  const buildParams = (off: number) => {
    const base: Parameters<typeof api.entries.list>[0] = { limit: PAGE_SIZE, offset: off };
    const feed = nav.activeFeed();
    if (feed != null) {
      return { ...base, feed, unread: nav.showUnreadOnly() };
    }
    const view = nav.activeView();
    switch (view) {
      case 'favorites':
        return { ...base, favorites: true };
      case 'trash':
        return { ...base, thumb: -1 as const };
      case 'noise':
        return { ...base, noise: true };
      case 'everything':
        return {
          ...base,
          filter: 'all' as const,
          unread: nav.showUnreadOnly(),
          ...(nav.activeCategory() != null ? { category: nav.activeCategory()! } : {}),
        };
      default:
        return {
          ...base,
          unread: nav.showUnreadOnly(),
          ...(nav.activeCategory() != null ? { category: nav.activeCategory()! } : {}),
        };
    }
  };

  const fetchInitial = async () => {
    setLoading(true);
    try {
      const data = await api.entries.list(buildParams(0));
      batch(() => {
        setEntries(data);
        setOffset(data.length);
        setHasMore(data.length === PAGE_SIZE);
      });
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (!hasMore() || isLoadingMore()) return;
    setIsLoadingMore(true);
    try {
      const data = await api.entries.list(buildParams(offset()));
      batch(() => {
        setEntries(prev => [...prev, ...data]);
        setOffset(prev => prev + data.length);
        setHasMore(data.length === PAGE_SIZE);
      });
    } finally {
      setIsLoadingMore(false);
    }
  };

  const refetchEntries = async () => {
    await fetchInitial();
  };

  // Refetch when navigation state changes
  createEffect(on(
    () => ({
      unread: nav.showUnreadOnly(),
      category: nav.activeCategory(),
      view: nav.activeView(),
      activeFeed: nav.activeFeed(),
    }),
    () => { fetchInitial(); },
  ));

  const mutateEntries = (v: EntryWithMeta[] | ((prev: EntryWithMeta[]) => EntryWithMeta[])) => {
    if (typeof v === 'function') {
      setEntries(prev => v(prev));
    } else {
      setEntries(v);
    }
  };

  const syncActiveArticle = (updatedList: EntryWithMeta[]) => {
    const current = nav.activeArticle();
    if (current) {
      const updated = updatedList.find(e => e.id === current.id);
      if (updated) nav.setActiveArticle(updated);
    }
  };

  const openArticle = (entry: EntryWithMeta) => {
    if (!entry.is_read && markReadRef.current) markReadRef.current(entry.id);
    nav.setActiveArticle(entry);
  };

  const closeArticle = () => {
    nav.setActiveArticle(null);
  };

  const navigateArticle = async (direction: 'prev' | 'next') => {
    const list = entries();
    const current = nav.activeArticle();
    if (!current) return;
    const idx = list.findIndex(e => e.id === current.id);
    if (idx === -1) return;

    if (direction === 'next' && idx === list.length - 1 && hasMore()) {
      await loadMore();
      const newList = entries();
      const target = newList[idx + 1];
      if (target) {
        if (!target.is_read && markReadRef.current) markReadRef.current(target.id);
        nav.setActiveArticle(target);
      }
      return;
    }

    const target = direction === 'prev' ? list[idx - 1] : list[idx + 1];
    if (target) {
      if (!target.is_read && markReadRef.current) markReadRef.current(target.id);
      nav.setActiveArticle(target);
    }
  };

  const prevEntry = () => {
    const article = nav.activeArticle();
    if (!article) return null;
    const list = entries();
    const idx = list.findIndex(e => e.id === article.id);
    return idx > 0 ? list[idx - 1] ?? null : null;
  };

  const nextEntry = () => {
    const article = nav.activeArticle();
    if (!article) return null;
    const list = entries();
    const idx = list.findIndex(e => e.id === article.id);
    return idx >= 0 && idx < list.length - 1 ? list[idx + 1] ?? null : null;
  };

  // Reset focus when entries change
  createEffect(() => {
    entries(); // track
    nav.setFocusIndex(-1);
  });

  const value: EntriesContextValue = {
    entries,
    loading,
    mutateEntries,
    syncActiveArticle,
    prevEntry,
    nextEntry,
    openArticle,
    closeArticle,
    navigateArticle,
    _markReadRef: markReadRef,
    loadMore,
    hasMore,
    isLoadingMore,
    refetchEntries,
  };

  return (
    <EntriesContext.Provider value={value}>
      {props.children}
    </EntriesContext.Provider>
  );
};

export const useEntries = (): EntriesContextValue => {
  const ctx = useContext(EntriesContext);
  if (!ctx) throw new Error('useEntries must be used within EntriesProvider');
  return ctx;
};
