import { createResource, createEffect, createContext, useContext } from 'solid-js';
import type { Accessor, Resource } from 'solid-js';
import type { JSX } from 'solid-js';
import { api } from '../lib/api';
import type { EntryWithMeta } from '../lib/types';
import { useNavigation } from './NavigationProvider';

export interface EntriesContextValue {
  entries: Resource<EntryWithMeta[]>;
  mutateEntries: (v: EntryWithMeta[] | ((prev: EntryWithMeta[] | undefined) => EntryWithMeta[])) => EntryWithMeta[];
  syncActiveArticle: (updatedList: EntryWithMeta[]) => void;
  prevEntry: Accessor<EntryWithMeta | null>;
  nextEntry: Accessor<EntryWithMeta | null>;
  openArticle: (entry: EntryWithMeta) => void;
  closeArticle: () => void;
  navigateArticle: (direction: 'prev' | 'next') => void;
  /** Set by EntryActionsProvider after mount to break circular dep */
  _markReadRef: { current: ((id: number) => void) | null };
}

const EntriesContext = createContext<EntriesContextValue>();

export const EntriesProvider = (props: { children: JSX.Element }) => {
  const nav = useNavigation();

  // Mutable ref — EntryActionsProvider sets this after it mounts
  const markReadRef: { current: ((id: number) => void) | null } = { current: null };

  const [entries, { mutate: mutateEntries }] = createResource(
    () => ({
      unread: nav.showUnreadOnly(),
      category: nav.activeCategory(),
      view: nav.activeView(),
    }),
    (opts) => {
      switch (opts.view) {
        case 'favorites':
          return api.entries.list({ limit: 50, starred: true });
        case 'trash':
          return api.entries.list({ limit: 50, thumb: -1 });
        case 'noise':
          return api.entries.list({ limit: 50, noise: true });
        case 'everything':
          return api.entries.list({
            limit: 50,
            filter: 'all',
            unread: opts.unread,
            ...(opts.category != null ? { category: opts.category } : {}),
          });
        default:
          return api.entries.list({
            limit: 50,
            unread: opts.unread,
            ...(opts.category != null ? { category: opts.category } : {}),
          });
      }
    },
  );

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

  const navigateArticle = (direction: 'prev' | 'next') => {
    const list = entries() ?? [];
    const current = nav.activeArticle();
    if (!current) return;
    const idx = list.findIndex(e => e.id === current.id);
    if (idx === -1) return;
    const target = direction === 'prev' ? list[idx - 1] : list[idx + 1];
    if (target) {
      if (!target.is_read && markReadRef.current) markReadRef.current(target.id);
      nav.setActiveArticle(target);
    }
  };

  const prevEntry = () => {
    const article = nav.activeArticle();
    if (!article) return null;
    const list = entries() ?? [];
    const idx = list.findIndex(e => e.id === article.id);
    return idx > 0 ? list[idx - 1] ?? null : null;
  };

  const nextEntry = () => {
    const article = nav.activeArticle();
    if (!article) return null;
    const list = entries() ?? [];
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
    mutateEntries,
    syncActiveArticle,
    prevEntry,
    nextEntry,
    openArticle,
    closeArticle,
    navigateArticle,
    _markReadRef: markReadRef,
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
