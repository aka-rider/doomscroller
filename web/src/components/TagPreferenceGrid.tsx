import { For, createSignal, Show } from 'solid-js';
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

const modePrefix = (mode: string): string => {
  if (mode === 'whitelist') return '\u2713 ';
  if (mode === 'blacklist') return '\u2717 ';
  return '';
};

// Pretty-print a category slug into a label: 'ai-ml' → 'AI & ML' etc.
// Falls back to capitalizing the slug if no tag in the group exists.
const formatGroup = (group: string): string => {
  // Map known category slugs to their display labels
  const labels: Record<string, string> = {
    'programming': 'Programming',
    'engineering': 'Software Engineering',
    'ai-ml': 'AI & ML',
    'security': 'Security',
    'hardware': 'Hardware & Electronics',
    'science': 'Science',
    'space': 'Space',
    'energy': 'Energy & Environment',
    'politics': 'Politics',
    'economics': 'Economics & Finance',
    'business': 'Business & Startups',
    'gaming': 'Gaming',
    'film-tv': 'Film & TV',
    'music': 'Music',
    'sports': 'Sports',
    'food': 'Food & Drink',
    'books': 'Books & Literature',
    'design': 'Design & Art',
    'health': 'Health & Fitness',
    'education': 'Education',
    'travel': 'Travel & Transportation',
    'history': 'History & Philosophy',
    'custom': 'Custom Tags',
  };
  return labels[group] ?? group.charAt(0).toUpperCase() + group.slice(1).replace(/-/g, ' ');
};

const CollapsibleGroup = (props: {
  group: string;
  tags: Tag[];
  preferences: Map<number, string>;
  onToggle: (tagId: number, mode: string) => void;
}) => {
  const [open, setOpen] = createSignal(false);

  const allWhitelisted = () => props.tags.every(t => props.preferences.get(t.id) === 'whitelist');

  const handleSelectAll = (e: MouseEvent) => {
    e.stopPropagation();
    const mode = allWhitelisted() ? 'none' : 'whitelist';
    for (const tag of props.tags) {
      props.onToggle(tag.id, mode);
    }
  };

  return (
    <div class="pref-grid-group">
      <div style={{ display: 'flex', 'align-items': 'center', gap: 'var(--space-2)' }}>
        <button
          class="pref-grid-group-title"
          onClick={() => setOpen(v => !v)}
          style={{ cursor: 'pointer', background: 'none', border: 'none', padding: '0', flex: '1', 'text-align': 'left', display: 'flex', 'align-items': 'center', gap: 'var(--space-2)' }}
        >
          <span style={{ 'font-size': '0.65em', opacity: '0.6' }}>{open() ? '\u25BC' : '\u25B6'}</span>
          {formatGroup(props.group)}
          <span style={{ opacity: '0.5', 'font-weight': '400', 'font-size': '0.85em' }}>
            ({props.tags.length})
          </span>
        </button>
        <button
          class={`pref-grid-select-all ${allWhitelisted() ? 'active' : ''}`}
          onClick={handleSelectAll}
          title={allWhitelisted() ? 'Deselect all' : 'Select all'}
        >
          {allWhitelisted() ? '\u2713 All' : 'Select All'}
        </button>
      </div>
      <Show when={open()}>
        <div class="pref-grid">
          <For each={props.tags}>
            {(tag) => {
              const mode = () => props.preferences.get(tag.id) ?? 'none';
              return (
                <button
                  class={`pref-card ${mode() === 'whitelist' ? 'whitelist' : mode() === 'blacklist' ? 'blacklist' : ''}`}
                  onClick={() => props.onToggle(tag.id, nextMode(mode()))}
                >
                  {modePrefix(mode())}{tag.label}
                </button>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
};

export const TagPreferenceGrid = (props: TagPreferenceGridProps) => {
  // Only show topic tags (no signal group — replaced by depth score)
  const topicTags = () => props.tags.filter(t => t.tag_group !== 'signal');

  const grouped = () => {
    const groups = new Map<string, Tag[]>();
    for (const tag of topicTags()) {
      const group = tag.tag_group === 'topic' ? (tag as unknown as { category_slug: string | null }).category_slug ?? 'other' : tag.tag_group || 'other';
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(tag);
    }
    return groups;
  };

  return (
    <div>
      <For each={[...grouped().entries()]}>
        {([group, tags]) => (
          <CollapsibleGroup
            group={group}
            tags={tags}
            preferences={props.preferences}
            onToggle={props.onToggle}
          />
        )}
      </For>
    </div>
  );
};
