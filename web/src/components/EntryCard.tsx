import { Show, For } from 'solid-js';
import type { EntryWithMeta } from '../lib/api';
import { timeAgo, contentLabel } from '../lib/api';
import { TagPill } from './TagPill';

interface EntryCardProps {
  entry: EntryWithMeta;
  onMarkRead: (id: number) => void;
  onStar: (id: number, starred: boolean) => void;
  onTagClick: (slug: string) => void;
  onThumb?: (id: number, thumb: 1 | -1 | null) => void;
  onCycleTagPreference?: (tagId: number, newMode: 'none' | 'whitelist' | 'blacklist') => void;
}

export const EntryCard = (props: EntryCardProps) => {
  const isRead = () => props.entry.is_read === 1;
  const isStarred = () => props.entry.is_starred === 1;
  const isUntagged = () => props.entry.tagged_at === null;
  const entryTags = () => props.entry.tags ?? [];
  const thumbValue = () => props.entry.thumb;
  const isNoise = () => props.entry.depth_score !== null && props.entry.depth_score < 0.15;
  const depthLabel = () => contentLabel(props.entry.depth_score);

  // Entry is "filtered out" when it has tags and ALL tags are blacklisted
  const isFiltered = () => {
    const tags = entryTags();
    if (tags.length === 0) return false;
    return tags.every(t => t.mode === 'blacklist');
  };

  const handleClick = () => {
    if (!isRead()) {
      props.onMarkRead(props.entry.id);
    }
  };

  return (
    <article
      class={`entry-card ${isRead() ? 'is-read' : ''} ${isFiltered() ? 'is-filtered' : ''} ${isNoise() ? 'is-noise' : ''}`}
      onClick={handleClick}
    >
      <div class="entry-card-inner">
        <div class="entry-card-content">
          {/* Meta line: source · time · author */}
          <div class="meta" style={{ "margin-bottom": "var(--space-1)" }}>
            <span class="meta-source">{props.entry.feed_title}</span>
            {' · '}
            <span>{timeAgo(props.entry.published_at)}</span>
            <Show when={props.entry.author}>
              {' · '}
              <span>{props.entry.author}</span>
            </Show>
          </div>

          {/* Title */}
          <a
            href={props.entry.url}
            target="_blank"
            rel="noopener noreferrer"
            class="article-title"
            style={{ display: "block", "text-decoration": "none" }}
          >
            {props.entry.title}
          </a>

          {/* Summary */}
          <Show when={props.entry.summary}>
            <p class="entry-summary">{props.entry.summary.slice(0, 200)}</p>
          </Show>

          {/* Tag pills row */}
          <div class="entry-card-tags">
            <Show when={isUntagged()}>
              <span class="tag-pill tag-pill--pending">Pending</span>
            </Show>
            <Show when={props.entry.depth_score !== null}>
              <span class={`tag-pill tag-pill--depth tag-pill--depth-${depthLabel().toLowerCase()}`}>
                {depthLabel()}
              </span>
            </Show>
            <For each={entryTags()}>
              {(tag) => (
                <TagPill
                  slug={tag.slug}
                  label={tag.label}
                  tagId={tag.tag_id}
                  mode={tag.mode as 'none' | 'whitelist' | 'blacklist'}
                  onClick={props.onTagClick}
                  onCyclePreference={props.onCycleTagPreference}
                />
              )}
            </For>
          </div>

          {/* Star and thumb buttons */}
          <div class="entry-card-actions">
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (props.onThumb) {
                  props.onThumb(props.entry.id, thumbValue() === 1 ? null : 1);
                }
              }}
              class={`entry-card-thumb ${thumbValue() === 1 ? 'is-active-up' : ''}`}
              title="Thumb up (u)"
            >
              {'\u{1F44D}'}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (props.onThumb) {
                  props.onThumb(props.entry.id, thumbValue() === -1 ? null : -1);
                }
              }}
              class={`entry-card-thumb ${thumbValue() === -1 ? 'is-active-down' : ''}`}
              title="Thumb down (d)"
            >
              {'\u{1F44E}'}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                props.onStar(props.entry.id, !isStarred());
              }}
              class="entry-card-star"
              style={{
                color: isStarred() ? 'var(--star)' : 'var(--text-tertiary)',
              }}
              title={isStarred() ? 'Unstar (s)' : 'Star (s)'}
            >
              {isStarred() ? '\u2605' : '\u2606'}
            </button>
          </div>
        </div>

        {/* Thumbnail */}
        <Show when={props.entry.image_url}>
          <img
            src={props.entry.image_url!}
            alt=""
            class="entry-card-image"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        </Show>
      </div>
    </article>
  );
};
