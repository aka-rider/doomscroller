import { createEffect, onCleanup } from 'solid-js';
import type { EntryWithMeta } from './types';
import type { EntryActions } from '../components/EntryActionsProvider';
import type { NavigationState } from '../components/NavigationProvider';
import type { EntriesContextValue } from '../components/EntriesProvider';

interface UseKeyboardConfig {
  entries: () => EntryWithMeta[];
  entryActions: EntryActions;
  navigation: NavigationState;
  entriesCtx: EntriesContextValue;
}

export const useKeyboard = (config: UseKeyboardConfig) => {
  const { entries, entryActions, navigation: nav, entriesCtx } = config;

  const scrollToFocused = (index: number) => {
    const cards = document.querySelectorAll('.entry-card');
    const card = cards[index] as HTMLElement | undefined;
    if (card) {
      card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      card.classList.add('is-focused');
      cards.forEach((c, i) => { if (i !== index) c.classList.remove('is-focused'); });
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (nav.showSettings()) {
      if (e.key === 'Escape') nav.setShowSettings(false);
      return;
    }

    const list = entries();
    const article = nav.activeArticle();

    // --- Article page shortcuts ---
    if (article) {
      const articleIdx = list.findIndex(e => e.id === article.id);
      switch (e.key) {
        case 'Escape': {
          e.preventDefault();
          entriesCtx.closeArticle();
          return;
        }
        case 'j': {
          e.preventDefault();
          if (articleIdx >= 0 && articleIdx < list.length - 1) entriesCtx.navigateArticle('next');
          return;
        }
        case 'k': {
          e.preventDefault();
          if (articleIdx > 0) entriesCtx.navigateArticle('prev');
          return;
        }
        case 'o': {
          e.preventDefault();
          window.open(article.url, '_blank', 'noopener,noreferrer');
          return;
        }
        case 's': {
          e.preventDefault();
          entryActions.handleStar(article.id, !article.is_starred);
          return;
        }
        case 'u': {
          e.preventDefault();
          entryActions.handleThumb(article.id, article.thumb === 1 ? null : 1);
          return;
        }
        case 'd': {
          e.preventDefault();
          entryActions.handleThumb(article.id, article.thumb === -1 ? null : -1);
          return;
        }
      }
      return;
    }

    // --- Feed list shortcuts ---
    const idx = nav.focusIndex();

    switch (e.key) {
      case 'j': {
        e.preventDefault();
        const next = Math.min(idx + 1, list.length - 1);
        nav.setFocusIndex(next);
        scrollToFocused(next);
        break;
      }
      case 'k': {
        e.preventDefault();
        const prev = Math.max(idx - 1, 0);
        nav.setFocusIndex(prev);
        scrollToFocused(prev);
        break;
      }
      case 'o': {
        if (idx >= 0 && idx < list.length) {
          e.preventDefault();
          const entry = list[idx]!;
          if (!entry.is_read) entryActions.handleMarkRead(entry.id);
          window.open(entry.url, '_blank', 'noopener,noreferrer');
        }
        break;
      }
      case 'Enter':
      case 'e': {
        if (nav.activeArticle()) break;
        if (idx >= 0 && idx < list.length) {
          e.preventDefault();
          const entry = list[idx]!;
          entriesCtx.openArticle(entry);
        }
        break;
      }
      case 's': {
        if (idx >= 0 && idx < list.length) {
          e.preventDefault();
          const entry = list[idx]!;
          entryActions.handleStar(entry.id, !entry.is_starred);
        }
        break;
      }
      case 'u': {
        if (idx >= 0 && idx < list.length) {
          e.preventDefault();
          const entry = list[idx]!;
          entryActions.handleThumb(entry.id, entry.thumb === 1 ? null : 1);
        }
        break;
      }
      case 'd': {
        if (idx >= 0 && idx < list.length) {
          e.preventDefault();
          const entry = list[idx]!;
          entryActions.handleThumb(entry.id, entry.thumb === -1 ? null : -1);
        }
        break;
      }
      case ',': {
        e.preventDefault();
        nav.setShowSettings(true);
        break;
      }
      case 'Escape': {
        if (nav.activeArticle() !== null) {
          entriesCtx.closeArticle();
        } else if (nav.sidebarOpen()) {
          nav.setSidebarOpen(false);
        } else {
          nav.setFocusIndex(-1);
          document.querySelectorAll('.entry-card').forEach(c => c.classList.remove('is-focused'));
        }
        break;
      }
    }
  };

  createEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    onCleanup(() => document.removeEventListener('keydown', handleKeyDown));
  });
};
