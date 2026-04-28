import { createSignal, onMount, For, Show, Suspense, ErrorBoundary } from 'solid-js';
import { api } from './lib/api';
import type { Tag } from './lib/types';
import type { ViewMode } from './lib/types';
import { useKeyboard } from './lib/use-keyboard';
import { AppShell } from './components/AppShell';
import { EntryCard } from './components/EntryCard';
import { ArticlePage } from './components/ArticlePage';
import { SettingsPanel } from './components/SettingsPanel';
import { Onboarding } from './components/Onboarding';
import { NavigationProvider, useNavigation } from './components/NavigationProvider';
import { EntriesProvider, useEntries } from './components/EntriesProvider';
import { EntryActionsProvider, useEntryActions } from './components/EntryActionsProvider';
import { TagActionsProvider, useTagActions } from './components/TagActionsProvider';

const AppInner = () => {
  const nav = useNavigation();
  const entriesCtx = useEntries();
  const entryActions = useEntryActions();
  const tagActions = useTagActions();

  const handleSelectCategory = (slug: string | null) => {
    nav.setActiveCategory(slug);
  };

  const handleSelectView = (view: ViewMode) => {
    nav.setActiveView(view);
    if (view !== 'feed') {
      nav.setActiveCategory(null);
    }
  };

  const handleTagClick = (_slug: string) => {
    // When clicking a tag pill on an entry, no-op for now (categories are the nav)
  };

  useKeyboard({
    entries: () => entriesCtx.entries() ?? [],
    entryActions,
    navigation: nav,
    entriesCtx,
  });

  return (
    <>
      {/* Article page — replaces the feed when an article is open */}
      <Show when={nav.activeArticle()} fallback={
        <AppShell
          showUnreadOnly={nav.showUnreadOnly()}
          onToggleUnread={() => nav.setShowUnreadOnly(!nav.showUnreadOnly())}
          onOpenSettings={() => nav.setShowSettings(true)}
          activeCategory={nav.activeCategory()}
          onSelectCategory={handleSelectCategory}
          activeView={nav.activeView()}
          onSelectView={handleSelectView}
          sidebarOpen={nav.sidebarOpen()}
          onToggleSidebar={() => nav.setSidebarOpen(!nav.sidebarOpen())}
          onCloseSidebar={() => nav.setSidebarOpen(false)}
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
                when={(entriesCtx.entries()?.length ?? 0) > 0}
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
                <For each={entriesCtx.entries()}>
                  {(entry) => (
                    <EntryCard
                      entry={entry}
                      onOpenArticle={entriesCtx.openArticle}
                      onMarkRead={entryActions.handleMarkRead}
                      onStar={entryActions.handleStar}
                      onTagClick={handleTagClick}
                      onThumb={entryActions.handleThumb}
                      onCycleTagPreference={tagActions.handleCycleTagPreference}
                    />
                  )}
                </For>
              </Show>
            </Suspense>
          </ErrorBoundary>
        </AppShell>
      }>
        {(article) => (
          <ArticlePage
            entry={article()}
            onBack={entriesCtx.closeArticle}
            prevTitle={entriesCtx.prevEntry()?.title ?? null}
            nextTitle={entriesCtx.nextEntry()?.title ?? null}
            onPrev={() => entriesCtx.navigateArticle('prev')}
            onNext={() => entriesCtx.navigateArticle('next')}
            onStar={entryActions.handleStar}
            onThumb={entryActions.handleThumb}
            onCycleTagPreference={tagActions.handleCycleTagPreference}
          />
        )}
      </Show>

      {/* Settings panel */}
      <Show when={nav.showSettings()}>
        <SettingsPanel onClose={() => nav.setShowSettings(false)} />
      </Show>
    </>
  );
};

export const App = () => {
  const [onboardingDone, setOnboardingDone] = createSignal<boolean | null>(null);
  const [onboardingTags, setOnboardingTags] = createSignal<Tag[]>([]);

  const checkOnboarding = async () => {
    try {
      const { complete } = await api.config.getOnboarding();
      if (!complete) {
        const tags = await api.tags.list();
        setOnboardingTags(tags);
      }
      setOnboardingDone(complete);
    } catch {
      setOnboardingDone(true);
    }
  };
  onMount(() => checkOnboarding());

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

  return (
    <>
      <Show when={onboardingDone() === false}>
        <Onboarding tags={onboardingTags()} onComplete={handleOnboardingComplete} />
      </Show>

      <Show when={onboardingDone() === true}>
        <NavigationProvider>
          <EntriesProvider>
            <EntryActionsProvider>
              <TagActionsProvider>
                <AppInner />
              </TagActionsProvider>
            </EntryActionsProvider>
          </EntriesProvider>
        </NavigationProvider>
      </Show>
    </>
  );
};
