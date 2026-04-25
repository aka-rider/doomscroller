import { createResource, For, Suspense } from 'solid-js';
import { api } from '../lib/api';
import type { Tag } from '../lib/api';

interface TagSidebarProps {
  activeTag: string | null;
  onSelectTag: (slug: string | null) => void;
  onCreateTag: () => void;
}

const GROUP_ORDER = ['news', 'tech', 'science', 'sports', 'culture', 'meta', 'proposed', 'custom'] as const;

const GROUP_LABELS: Record<string, string> = {
  news: 'News',
  tech: 'Tech',
  science: 'Science',
  sports: 'Sports',
  culture: 'Culture',
  meta: 'Meta',
  proposed: 'Proposed',
  custom: 'Custom',
};

const nextMode = (current: string): string =>
  current === 'none' ? 'whitelist'
    : current === 'whitelist' ? 'blacklist'
      : 'none';

const prefSymbol = (mode: string): string =>
  mode === 'whitelist' ? '✓'
    : mode === 'blacklist' ? '✕'
      : '●';

const prefClass = (mode: string): string =>
  mode === 'whitelist' ? 'pref-whitelist'
    : mode === 'blacklist' ? 'pref-blacklist'
      : 'pref-none';

export const TagSidebar = (props: TagSidebarProps) => {
  const [tags, { mutate, refetch }] = createResource(() => api.tags.list());

  const groupedTags = () => {
    const list = tags() ?? [];
    const groups: Record<string, Tag[]> = {};
    for (const tag of list) {
      const g = tag.tag_group || 'custom';
      if (!groups[g]) groups[g] = [];
      groups[g]!.push(tag);
    }
    return groups;
  };

  const cyclePreference = async (tag: Tag) => {
    const next = nextMode(tag.mode);
    const prev = tags() ?? [];
    mutate(prev.map(t => t.id === tag.id ? { ...t, mode: next } : t));
    try {
      await api.tags.setPreference(tag.id, next);
    } catch {
      mutate(prev);
    }
  };

  const handleCreateTag = async () => {
    const label = prompt('Enter tag name:');
    if (!label?.trim()) return;
    const slug = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!slug) return;
    try {
      await api.tags.create(slug, label.trim());
      refetch();
    } catch {
      // tag may already exist
    }
    props.onCreateTag();
  };

  return (
    <nav class="tag-sidebar">
      <div class="tag-sidebar-inner">
        {/* All Entries */}
        <button
          class={`tag-sidebar-item ${props.activeTag === null ? 'is-active' : ''}`}
          onClick={() => props.onSelectTag(null)}
        >
          <span class="tag-sidebar-label">All Entries</span>
        </button>

        <Suspense fallback={<div class="meta" style={{ padding: "var(--space-3)" }}>Loading tags...</div>}>
          <For each={GROUP_ORDER.filter(g => groupedTags()[g]?.length)}>
            {(group) => (
              <div class="tag-sidebar-group">
                <div class="tag-sidebar-group-label">{GROUP_LABELS[group] ?? group}</div>
                <For each={groupedTags()[group]}>
                  {(tag) => (
                    <button
                      class={`tag-sidebar-item ${props.activeTag === tag.slug ? 'is-active' : ''}`}
                      onClick={() => props.onSelectTag(tag.slug)}
                    >
                      <span class="tag-sidebar-label">{tag.label}</span>
                      <span
                        class={`tag-sidebar-indicator ${prefClass(tag.mode)}`}
                        onClick={(e) => { e.stopPropagation(); cyclePreference(tag); }}
                        title={`Preference: ${tag.mode} (click to cycle)`}
                      >
                        {prefSymbol(tag.mode)}
                      </span>
                    </button>
                  )}
                </For>
              </div>
            )}
          </For>
        </Suspense>

        <button class="tag-sidebar-item tag-sidebar-add" onClick={handleCreateTag}>
          + New Tag
        </button>
      </div>
    </nav>
  );
};
