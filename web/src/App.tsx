import { createSignal, createResource, createEffect, onCleanup, For, Show, Suspense, ErrorBoundary } from 'solid-js';
import { api, timeAgo, relevanceLevel } from './lib/api';
import type { ScoredEntry, Category } from './lib/api';
import { EntryCard } from './components/EntryCard';
import { SettingsPanel } from './components/SettingsPanel';

export const App = () => {
  const [activeCategory, setActiveCategory] = createSignal<number | undefined>(undefined);
  const [showUnreadOnly, setShowUnreadOnly] = createSignal(false);
  const [showSettings, setShowSettings] = createSignal(false);
  const [focusIndex, setFocusIndex] = createSignal(-1);

  const [categories] = createResource(() => api.categories.list());
  const [entries, { refetch: refetchEntries }] = createResource(
    () => ({
      category: activeCategory(),
      unread: showUnreadOnly(),
    }),
    (opts) => api.entries.list({
      limit: 50,
      category: opts.category,
      unread: opts.unread,
    }),
  );

  const handleMarkRead = async (id: number) => {
    await api.entries.markRead(id);
    refetchEntries();
  };

  const handleStar = async (id: number, starred: boolean) => {
    await api.entries.star(id, starred);
    refetchEntries();
  };

  // --- Keyboard navigation ---
  const scrollToFocused = (index: number) => {
    const cards = document.querySelectorAll('.entry-card');
    const card = cards[index] as HTMLElement | undefined;
    if (card) {
      card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      card.classList.add('is-focused');
      // Remove focus from siblings
      cards.forEach((c, i) => { if (i !== index) c.classList.remove('is-focused'); });
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    // Don't handle keys when typing in inputs/textareas or settings open
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
        setFocusIndex(-1);
        document.querySelectorAll('.entry-card').forEach(c => c.classList.remove('is-focused'));
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
    <div class="app-layout">
      <header class="app-header">
        <h1 style={{
          "font-family": "var(--font-serif)",
          "font-size": "var(--text-lg)",
          "font-weight": "600",
          "letter-spacing": "-0.02em",
          flex: "1",
        }}>
          Doomscroller
        </h1>
        <button
          class="btn"
          onClick={() => setShowUnreadOnly(!showUnreadOnly())}
          style={{ "font-size": "var(--text-sm)" }}
        >
          {showUnreadOnly() ? 'All' : 'Unread'}
        </button>
        <button
          class="btn"
          onClick={() => setShowSettings(true)}
          style={{ "font-size": "var(--text-sm)", "margin-left": "var(--space-2)" }}
          title="Settings (,)"
        >
          ⚙
        </button>
      </header>

      {/* Category bar */}
      <nav style={{
        display: "flex",
        gap: "var(--space-2)",
        padding: "var(--space-3) var(--space-4)",
        "overflow-x": "auto",
        "border-bottom": "1px solid var(--border)",
        background: "var(--bg-secondary)",
        "-webkit-overflow-scrolling": "touch",
      }}>
        <button
          class={`category-pill ${activeCategory() === undefined ? 'active' : ''}`}
          onClick={() => setActiveCategory(undefined)}
        >
          All
        </button>
        <ErrorBoundary fallback={<span class="meta">Failed to load categories</span>}>
          <Suspense fallback={<span class="meta">...</span>}>
            <For each={categories()}>
              {(cat) => (
                <button
                  class={`category-pill ${activeCategory() === cat.id ? 'active' : ''}`}
                  onClick={() => setActiveCategory(
                    activeCategory() === cat.id ? undefined : cat.id
                  )}
                >
                  {cat.name}
                  <Show when={cat.entry_count > 0}>
                    <span style={{ "margin-left": "var(--space-1)", opacity: "0.6" }}>
                      {cat.entry_count}
                    </span>
                  </Show>
                </button>
              )}
            </For>
          </Suspense>
        </ErrorBoundary>
      </nav>

      {/* Main feed */}
      <main class="app-main">
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
                  />
                )}
              </For>
            </Show>
          </Suspense>
        </ErrorBoundary>
      </main>

      {/* Settings panel */}
      <Show when={showSettings()}>
        <SettingsPanel onClose={() => setShowSettings(false)} />
      </Show>
    </div>
  );
};
