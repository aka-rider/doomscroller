import { createResource, For, Suspense, Show } from 'solid-js';
import { Star } from 'lucide-solid';
import { api } from '../lib/api';
import type { CategoryInfo, ViewMode, Feed } from '../lib/types';
import { useNavigation } from './NavigationProvider';

export type { ViewMode };

interface TagSidebarProps {
  activeCategory: string | null;
  onSelectCategory: (slug: string | null) => void;
  activeView: ViewMode;
  onSelectView: (view: ViewMode) => void;
  refetchKey?: (() => number) | undefined;
}

const getFaviconUrl = (siteUrl: string): string | null => {
  try {
    const domain = new URL(siteUrl).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  } catch {
    return null;
  }
};

export const TagSidebar = (props: TagSidebarProps) => {
  const nav = useNavigation();
  const fetchKey = () => (props.refetchKey?.() ?? 0) + 1;
  const [categoriesData] = createResource(fetchKey, () => api.categories());
  const [feedsData] = createResource(
    () => nav.sidebarMode() === 'feeds' ? 1 : null,
    () => api.feeds.list(),
  );

  const catList = () => categoriesData()?.categories ?? [];
  const globalWhitelistCount = () => categoriesData()?.globalWhitelistCount ?? 0;

  const sortedFeeds = (): Feed[] => {
    const feeds = feedsData() ?? [];
    const withEntries = feeds.filter(f => f.entry_count > 0).sort((a, b) => a.title.localeCompare(b.title));
    const empty = feeds.filter(f => f.entry_count === 0).sort((a, b) => a.title.localeCompare(b.title));
    return [...withEntries, ...empty];
  };

  const handleSelectFixedView = (view: ViewMode) => {
    nav.setActiveFeed(null);
    props.onSelectView(view);
  };

  const handleSelectFeed = (feed: Feed) => {
    nav.setActiveFeed(feed.id);
    nav.setActiveCategory(null);
    nav.setActiveView('feed');
  };

  return (
    <nav class="tag-sidebar">
      {/* Topics / Feeds toggle */}
      <div
        class="sidebar-mode-toggle"
        data-testid="sidebar-mode-toggle"
        style={{ display: "flex", gap: "var(--space-1)", padding: "var(--space-3) var(--space-3) 0" }}
      >
        <button
          class="sidebar-mode-btn"
          classList={{ 'is-active': nav.sidebarMode() === 'categories' }}
          data-testid="sidebar-mode-topics"
          onClick={() => { nav.setSidebarMode('categories'); nav.setActiveFeed(null); }}
        >
          Topics
        </button>
        <button
          class="sidebar-mode-btn"
          classList={{ 'is-active': nav.sidebarMode() === 'feeds' }}
          data-testid="sidebar-mode-feeds"
          onClick={() => nav.setSidebarMode('feeds')}
        >
          Feeds
        </button>
      </div>

      <div class="tag-sidebar-inner">
        {/* Your Feed — filtered */}
        <button
          class="tag-sidebar-item"
          classList={{ 'is-active': props.activeView === 'feed' && props.activeCategory === null && nav.activeFeed() === null }}
          onClick={() => {
            nav.setActiveFeed(null);
            props.onSelectView('feed');
            props.onSelectCategory(null);
          }}
        >
          <span class="tag-sidebar-label">Your Feed</span>
        </button>

        {/* Favorites */}
        <button
          class="tag-sidebar-item"
          classList={{ 'is-active': props.activeView === 'favorites' }}
          onClick={() => handleSelectFixedView('favorites')}
        >
          <span class="tag-sidebar-label"><Star size={14} fill="currentColor" /> Favorites</span>
        </button>

        {/* Topics mode — category list */}
        <Show when={nav.sidebarMode() === 'categories'}>
          <Suspense fallback={<div class="meta" style={{ padding: "var(--space-3)" }}>Loading…</div>}>
            <For each={catList().filter(c => c.entryCount > 0)}>
              {(cat: CategoryInfo) => (
                <button
                  class="tag-sidebar-item"
                  classList={{
                    'is-active': props.activeView === 'feed' && props.activeCategory === cat.slug && nav.activeFeed() === null,
                    'is-dormant': globalWhitelistCount() > 0 && cat.whitelistedTagCount === 0,
                  }}
                  onClick={() => {
                    nav.setActiveFeed(null);
                    props.onSelectView('feed');
                    props.onSelectCategory(cat.slug);
                  }}
                >
                  <span class="tag-sidebar-label">{cat.label}</span>
                  <span class="tag-sidebar-count">{cat.entryCount}</span>
                </button>
              )}
            </For>
          </Suspense>
        </Show>

        {/* Feeds mode — feed list */}
        <Show when={nav.sidebarMode() === 'feeds'}>
          <Suspense fallback={<div class="meta" style={{ padding: "var(--space-3)" }}>Loading…</div>}>
            <For each={sortedFeeds()}>
              {(feed: Feed) => {
                const faviconUrl = getFaviconUrl(feed.site_url);
                return (
                  <button
                    class="tag-sidebar-item sidebar-feed-item"
                    classList={{ 'is-active': nav.activeFeed() === feed.id }}
                    data-testid="sidebar-feed-item"
                    onClick={() => handleSelectFeed(feed)}
                  >
                    <span class="tag-sidebar-label" style={{ display: "flex", "align-items": "center", gap: "var(--space-2)" }}>
                      <Show when={faviconUrl}>
                        <img
                          src={faviconUrl!}
                          width="16"
                          height="16"
                          alt=""
                          style={{ "flex-shrink": "0", "border-radius": "2px" }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      </Show>
                      <span style={{ overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                        {feed.title || feed.url}
                      </span>
                    </span>
                    <span class="tag-sidebar-count">
                      {feed.unread_count > 0 ? `${feed.unread_count}/` : ''}{feed.entry_count}
                    </span>
                  </button>
                );
              }}
            </For>
          </Suspense>
        </Show>

        {/* Separator */}
        <div style={{ "border-top": "1px solid var(--border-subtle)", margin: "var(--space-3) 0" }} />

        {/* Everything — unfiltered */}
        <button
          class="tag-sidebar-item"
          classList={{ 'is-active': props.activeView === 'everything' }}
          onClick={() => handleSelectFixedView('everything')}
        >
          <span class="tag-sidebar-label">Everything</span>
        </button>

        {/* Trash — dismissed */}
        <button
          class="tag-sidebar-item"
          classList={{ 'is-active': props.activeView === 'trash' }}
          onClick={() => handleSelectFixedView('trash')}
        >
          <span class="tag-sidebar-label">Trash</span>
        </button>

        {/* Noise — auto-filtered low-quality */}
        <button
          class="tag-sidebar-item"
          classList={{ 'is-active': props.activeView === 'noise' }}
          onClick={() => handleSelectFixedView('noise')}
        >
          <span class="tag-sidebar-label">Noise</span>
        </button>
      </div>
    </nav>
  );
};
