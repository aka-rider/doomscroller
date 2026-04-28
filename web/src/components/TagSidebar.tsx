import { createResource, For, Suspense } from 'solid-js';
import { api } from '../lib/api';
import type { CategoryInfo, ViewMode } from '../lib/types';

export type { ViewMode };

interface TagSidebarProps {
  activeCategory: string | null;
  onSelectCategory: (slug: string | null) => void;
  activeView: ViewMode;
  onSelectView: (view: ViewMode) => void;
}

export const TagSidebar = (props: TagSidebarProps) => {
  const [categories] = createResource(() => api.categories());

  return (
    <nav class="tag-sidebar">
      <div class="tag-sidebar-inner">
        {/* Your Feed — filtered */}
        <button
          class="tag-sidebar-item"
          classList={{ 'is-active': props.activeView === 'feed' && props.activeCategory === null }}
          onClick={() => {
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
          onClick={() => props.onSelectView('favorites')}
        >
          <span class="tag-sidebar-label">{'\u2605'} Favorites</span>
        </button>

        <Suspense fallback={<div class="meta" style={{ padding: "var(--space-3)" }}>Loading…</div>}>
          <For each={(categories() ?? []).filter(c => c.entryCount > 0)}>
            {(cat: CategoryInfo) => (
              <button
                class="tag-sidebar-item"
                classList={{ 'is-active': props.activeView === 'feed' && props.activeCategory === cat.slug }}
                onClick={() => {
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

        {/* Separator */}
        <div style={{ "border-top": "1px solid var(--border-subtle)", margin: "var(--space-3) 0" }} />

        {/* Everything — unfiltered */}
        <button
          class="tag-sidebar-item"
          classList={{ 'is-active': props.activeView === 'everything' }}
          onClick={() => props.onSelectView('everything')}
        >
          <span class="tag-sidebar-label">Everything</span>
        </button>

        {/* Trash — dismissed */}
        <button
          class="tag-sidebar-item"
          classList={{ 'is-active': props.activeView === 'trash' }}
          onClick={() => props.onSelectView('trash')}
        >
          <span class="tag-sidebar-label">Trash</span>
        </button>

        {/* Noise — auto-filtered low-quality */}
        <button
          class="tag-sidebar-item"
          classList={{ 'is-active': props.activeView === 'noise' }}
          onClick={() => props.onSelectView('noise')}
        >
          <span class="tag-sidebar-label">Noise</span>
        </button>
      </div>
    </nav>
  );
};
