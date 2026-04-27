import { createSignal, createResource, createEffect, onCleanup, For, Show, Suspense, ErrorBoundary } from 'solid-js';
import { api } from './lib/api';
import { AppShell } from './components/AppShell';
import { EntryCard } from './components/EntryCard';
import { SettingsPanel } from './components/SettingsPanel';
import { Onboarding } from './components/Onboarding';
import type { Tag } from './lib/api';
import type { ViewMode } from './components/TagSidebar';

export const App = () => {
  const [onboardingDone, setOnboardingDone] = createSignal<boolean | null>(null);
  const [onboardingTags, setOnboardingTags] = createSignal<Tag[]>([]);

  // Check onboarding status on mount
  const checkOnboarding = async () => {
    try {
      const { complete } = await api.config.getOnboarding();
      if (!complete) {
        const tags = await api.tags.list();
        setOnboardingTags(tags);
      }
      setOnboardingDone(complete);
    } catch {
      // If endpoint fails, assume onboarding done to not block the app
      setOnboardingDone(true);
    }
  };
  checkOnboarding();

  const handleOnboardingComplete = async (preferences: Map<number, string>, showNoise: boolean) => {
    const prefObj: Record<string, string> = {};
    for (const [id, mode] of preferences) {
      prefObj[String(id)] = mode;
    }
    try {
      await api.config.completeOnboarding(prefObj, showNoise);
    } catch {
      // best-effort
    }
    setOnboardingDone(true);
  };
  const [showUnreadOnly, setShowUnreadOnly] = createSignal(false);
  const [showSettings, setShowSettings] = createSignal(false);
  const [focusIndex, setFocusIndex] = createSignal(-1);
  const [activeCategory, setActiveCategory] = createSignal<string | null>(null);
  const [activeView, setActiveView] = createSignal<ViewMode>('feed');
  const [sidebarOpen, setSidebarOpen] = createSignal(false);

  // Resource fetcher adapts based on active view
  const [entries, { mutate: mutateEntries }] = createResource(
    () => ({
      unread: showUnreadOnly(),
      category: activeCategory(),
      view: activeView(),
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
        default: // 'feed'
          return api.entries.list({
            limit: 50,
            unread: opts.unread,
            ...(opts.category != null ? { category: opts.category } : {}),
          });
      }
    },
  );

  const handleMarkRead = async (id: number) => {
    const prev = entries() ?? [];
    mutateEntries(prev.map(e => e.id === id ? { ...e, is_read: 1 } : e));
    try {
      await api.entries.markRead(id);
    } catch {
      mutateEntries(prev);
    }
  };

  const handleStar = async (id: number, starred: boolean) => {
    const prev = entries() ?? [];
    mutateEntries(prev.map(e => e.id === id ? { ...e, is_starred: starred ? 1 : 0 } : e));
    try {
      await api.entries.star(id, starred);
    } catch {
      mutateEntries(prev);
    }
  };

  const handleThumb = async (id: number, thumb: 1 | -1 | null) => {
    const prev = entries() ?? [];
    if (thumb === -1) {
      // Thumb down: remove from list immediately (optimistic)
      mutateEntries(prev.filter(e => e.id !== id));
    } else {
      mutateEntries(prev.map(e => e.id === id ? { ...e, thumb } : e));
    }
    try {
      await api.entries.thumb(id, thumb);
    } catch {
      mutateEntries(prev);
    }
  };

  // Debounced tag preference cycling
  const prefTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const handleCycleTagPreference = (tagId: number, newMode: 'none' | 'whitelist' | 'blacklist') => {
    // Optimistic update: update all entry tags in the current list
    const prev = entries() ?? [];
    mutateEntries(prev.map(e => ({
      ...e,
      tags: e.tags.map(t => t.tag_id === tagId ? { ...t, mode: newMode } : t),
    })));

    // Debounce the API call
    const existing = prefTimers.get(tagId);
    if (existing) clearTimeout(existing);
    prefTimers.set(tagId, setTimeout(async () => {
      prefTimers.delete(tagId);
      try {
        await api.tags.setPreference(tagId, newMode);
      } catch {
        mutateEntries(prev);
      }
    }, 400));
  };

  const handleSelectCategory = (slug: string | null) => {
    setActiveCategory(slug);
  };

  const handleSelectView = (view: ViewMode) => {
    setActiveView(view);
    if (view !== 'feed') {
      setActiveCategory(null);
    }
  };

  const handleTagClick = (_slug: string) => {
    // When clicking a tag pill on an entry, no-op for now (categories are the nav)
  };

  // --- Keyboard navigation ---
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
    if (showSettings()) {
      if (e.key === 'Escape') setShowSettings(false);
      return;
    }

    const list = entries() ?? [];
    const idx = focusIndex();

    switch (e.key) {
      case 'j': {
        e.preventDefault();
        const next = Math.min(idx + 1, list.length - 1);
        setFocusIndex(next);
        scrollToFocused(next);
        break;
      }
      case 'k': {
        e.preventDefault();
        const prev = Math.max(idx - 1, 0);
        setFocusIndex(prev);
        scrollToFocused(prev);
        break;
      }
      case 'o':
      case 'Enter': {
        if (idx >= 0 && idx < list.length) {
          e.preventDefault();
          const entry = list[idx]!;
          if (!entry.is_read) handleMarkRead(entry.id);
          window.open(entry.url, '_blank', 'noopener,noreferrer');
        }
        break;
      }
      case 's': {
        if (idx >= 0 && idx < list.length) {
          e.preventDefault();
          const entry = list[idx]!;
          handleStar(entry.id, !entry.is_starred);
        }
        break;
      }
      case 'u': {
        if (idx >= 0 && idx < list.length) {
          e.preventDefault();
          const entry = list[idx]!;
          handleThumb(entry.id, entry.thumb === 1 ? null : 1);
        }
        break;
      }
      case 'd': {
        if (idx >= 0 && idx < list.length) {
          e.preventDefault();
          const entry = list[idx]!;
          handleThumb(entry.id, entry.thumb === -1 ? null : -1);
        }
        break;
      }
      case ',': {
        e.preventDefault();
        setShowSettings(true);
        break;
      }
      case 'Escape': {
        if (sidebarOpen()) {
          setSidebarOpen(false);
        } else {
          setFocusIndex(-1);
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

  // Reset focus when entries change
  createEffect(() => {
    entries(); // track
    setFocusIndex(-1);
  });

  return (
    <>
      {/* Onboarding gate */}
      <Show when={onboardingDone() === false}>
        <Onboarding tags={onboardingTags()} onComplete={handleOnboardingComplete} />
      </Show>

      {/* Main app — hidden until onboarding resolved */}
      <Show when={onboardingDone() === true}>
        <AppShell
          showUnreadOnly={showUnreadOnly()}
          onToggleUnread={() => setShowUnreadOnly(!showUnreadOnly())}
          onOpenSettings={() => setShowSettings(true)}
          activeCategory={activeCategory()}
          onSelectCategory={handleSelectCategory}
          activeView={activeView()}
          onSelectView={handleSelectView}
          sidebarOpen={sidebarOpen()}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen())}
        >
          <ErrorBoundary fallback={(err) => (
            <div style={{ padding: "var(--space-8)", "text-align": "center" }}>
              <p class="meta" style={{ color: "var(--danger)" }}>Failed to load entries</p>
              <p class="meta">{String(err)}</p>
            </div>
          )}>
            <Suspense fallback={
              <div style={{ padding: "var(--space-8)", "text-align": "center" }}>
                <p class="meta">Loading...</p>
              </div>
            }>
              <Show
                when={(entries()?.length ?? 0) > 0}
                fallback={
                  <div style={{ padding: "var(--space-16)", "text-align": "center" }}>
                    <p style={{
                      "font-family": "var(--font-serif)",
                      "font-size": "var(--text-2xl)",
                      color: "var(--text-tertiary)",
                      "margin-bottom": "var(--space-4)",
                    }}>
                      Nothing here yet
                    </p>
                    <p class="meta">
                      Add some feeds to get started.
                    </p>
                  </div>
                }
              >
                <For each={entries()}>
                  {(entry) => (
                    <EntryCard
                      entry={entry}
                      onMarkRead={handleMarkRead}
                      onStar={handleStar}
                      onTagClick={handleTagClick}
                      onThumb={handleThumb}
                      onCycleTagPreference={handleCycleTagPreference}
                    />
                  )}
                </For>
              </Show>
            </Suspense>
          </ErrorBoundary>
        </AppShell>

        {/* Settings panel */}
        <Show when={showSettings()}>
          <SettingsPanel onClose={() => setShowSettings(false)} />
        </Show>
      </Show>
    </>
  );
};
