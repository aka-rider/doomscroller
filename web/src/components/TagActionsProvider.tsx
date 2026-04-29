import { createContext, createSignal, useContext, onCleanup } from 'solid-js';
import type { JSX } from 'solid-js';
import { api } from '../lib/api';
import { useEntries } from './EntriesProvider';

export interface TagActions {
  handleCycleTagPreference: (tagId: number, newMode: 'none' | 'whitelist' | 'blacklist') => void;
  categoryRefetchKey: () => number;
}

const TagActionsContext = createContext<TagActions>();

export const TagActionsProvider = (props: { children: JSX.Element }) => {
  const { entries, mutateEntries } = useEntries();
  const [categoryRefetchKey, setCategoryRefetchKey] = createSignal(0);

  const prefTimers = new Map<number, ReturnType<typeof setTimeout>>();

  // Clean up all pending timers on unmount
  onCleanup(() => {
    for (const timer of prefTimers.values()) clearTimeout(timer);
    prefTimers.clear();
  });

  const handleCycleTagPreference = (tagId: number, newMode: 'none' | 'whitelist' | 'blacklist') => {
    const prev = entries() ?? [];
    mutateEntries(prev.map(e => ({
      ...e,
      tags: e.tags.map(t => t.tag_id === tagId ? { ...t, mode: newMode } : t),
    })));

    const existing = prefTimers.get(tagId);
    if (existing) clearTimeout(existing);
    prefTimers.set(tagId, setTimeout(async () => {
      prefTimers.delete(tagId);
      try {
        await api.tags.setPreference(tagId, newMode);
        // Bump refetch key to refresh sidebar category whitelist counts
        setCategoryRefetchKey(k => k + 1);
      } catch {
        mutateEntries(prev);
      }
    }, 400));
  };

  const actions: TagActions = {
    handleCycleTagPreference,
    categoryRefetchKey,
  };

  return (
    <TagActionsContext.Provider value={actions}>
      {props.children}
    </TagActionsContext.Provider>
  );
};

export const useTagActions = (): TagActions => {
  const ctx = useContext(TagActionsContext);
  if (!ctx) throw new Error('useTagActions must be used within TagActionsProvider');
  return ctx;
};
