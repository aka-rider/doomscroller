import { createContext, useContext } from 'solid-js';
import type { JSX } from 'solid-js';
import { api } from '../lib/api';
import { useEntries } from './EntriesProvider';

export interface EntryActions {
  handleMarkRead: (id: number) => void;
  handleToggleRead: (id: number) => void;
  handleThumb: (id: number, thumb: 1 | -1 | null) => void;
}

const EntryActionsContext = createContext<EntryActions>();

export const EntryActionsProvider = (props: { children: JSX.Element }) => {
  const { entries, mutateEntries, syncActiveArticle, _markReadRef } = useEntries();

  const handleMarkRead = async (id: number) => {
    const prev = entries() ?? [];
    mutateEntries(prev.map(e => e.id === id ? { ...e, is_read: 1 } : e));
    try {
      await api.entries.markRead(id);
    } catch {
      mutateEntries(prev);
    }
  };

  const handleToggleRead = async (id: number) => {
    const prev = entries() ?? [];
    const entry = prev.find(e => e.id === id);
    if (!entry) return;
    const newRead = entry.is_read === 1 ? 0 : 1;
    mutateEntries(prev.map(e => e.id === id ? { ...e, is_read: newRead } : e));
    try {
      await api.entries.setRead(id, newRead === 1);
    } catch {
      mutateEntries(prev);
    }
  };

  const handleThumb = async (id: number, thumb: 1 | -1 | null) => {
    const prev = entries() ?? [];
    if (thumb === -1) {
      mutateEntries(prev.filter(e => e.id !== id));
    } else {
      const updated = prev.map(e => e.id === id ? { ...e, thumb } : e);
      mutateEntries(updated);
      syncActiveArticle(updated);
    }
    try {
      await api.entries.thumb(id, thumb);
    } catch {
      mutateEntries(prev);
      syncActiveArticle(prev);
    }
  };

  const actions: EntryActions = {
    handleMarkRead,
    handleToggleRead,
    handleThumb,
  };

  // Wire the ref so EntriesProvider can call markRead for openArticle/navigateArticle
  _markReadRef.current = handleMarkRead;

  return (
    <EntryActionsContext.Provider value={actions}>
      {props.children}
    </EntryActionsContext.Provider>
  );
};

export const useEntryActions = (): EntryActions => {
  const ctx = useContext(EntryActionsContext);
  if (!ctx) throw new Error('useEntryActions must be used within EntryActionsProvider');
  return ctx;
};
