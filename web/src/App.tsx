import { createSignal, createResource, createEffect, onCleanup, For, Show, Suspense, ErrorBoundary } from 'solid-js';
import { api } from './lib/api';
import { AppShell } from './components/AppShell';
import { EntryCard } from './components/EntryCard';
import { SettingsPanel } from './components/SettingsPanel';
import { Onboarding } from './components/Onboarding';
import type { Tag } from './lib/api';

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

  const handleOnboardingComplete = async (preferences: Map<number, string>) => {
    const prefObj: Record<string, string> = {};
    for (const [id, mode] of preferences) {
      prefObj[String(id)] = mode;
    }
    try {
      await api.config.completeOnboarding(prefObj);
    } catch {
      // best-effort
    }
    setOnboardingDone(true);
  };
  const [showUnreadOnly, setShowUnreadOnly] = createSignal(false);
  const [showSettings, setShowSettings] = createSignal(false);
  const [focusIndex, setFocusIndex] = createSignal(-1);
  const [activeTag, setActiveTag] = createSignal<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = createSignal(false);

  const [entries, { mutate: mutateEntries }] = createResource(
    () => ({
      unread: showUnreadOnly(),
      tag: activeTag(),
    }),
    (opts) => api.entries.list({
      limit: 50,
      unread: opts.unread,
      ...(opts.tag != null ? { tag: opts.tag } : { filter: 'preferences' }),
    }),
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

  const handleSelectTag = (slug: string | null) => {
    setActiveTag(slug);
  };

  const handleCreateTag = () => {
    // Tag creation is handled inside TagSidebar
  };

  const handleTagClick = (slug: string) => {
    setActiveTag(slug);
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
          activeTag={activeTag()}
          onSelectTag={handleSelectTag}
          onCreateTag={handleCreateTag}
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
