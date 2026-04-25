import { For } from 'solid-js';
import type { Tag } from '../lib/api';

interface TagPreferenceGridProps {
  tags: Tag[];
  preferences: Map<number, string>;
  onToggle: (tagId: number, mode: string) => void;
}

const nextMode = (current: string | undefined): string => {
  if (!current || current === 'none') return 'whitelist';
  if (current === 'whitelist') return 'blacklist';
  return 'none';
};

const capitalize = (s: string): string =>
  s.charAt(0).toUpperCase() + s.slice(1);

export const TagPreferenceGrid = (props: TagPreferenceGridProps) => {
  const grouped = () => {
    const groups = new Map<string, Tag[]>();
    for (const tag of props.tags) {
      const group = tag.tag_group || 'other';
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(tag);
    }
    return groups;
  };

  return (
    <div>
      <For each={[...grouped().entries()]}>
        {([group, tags]) => (
          <div class="pref-grid-group">
            <div class="pref-grid-group-title">{capitalize(group)}</div>
            <div class="pref-grid">
              <For each={tags}>
                {(tag) => {
                  const mode = () => props.preferences.get(tag.id) ?? 'none';
                  return (
                    <button
                      class={`pref-card ${mode() === 'whitelist' ? 'whitelist' : mode() === 'blacklist' ? 'blacklist' : ''}`}
                      onClick={() => props.onToggle(tag.id, nextMode(mode()))}
                    >
                      {mode() === 'whitelist' ? '★ ' : ''}{tag.label}
                    </button>
                  );
                }}
              </For>
            </div>
          </div>
        )}
      </For>
    </div>
  );
};
