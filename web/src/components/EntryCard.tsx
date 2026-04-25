import { Show, For } from 'solid-js';
import type { EntryWithMeta } from '../lib/api';
import { timeAgo } from '../lib/api';
import { TagPill } from './TagPill';

interface EntryCardProps {
  entry: EntryWithMeta;
  onMarkRead: (id: number) => void;
  onStar: (id: number, starred: boolean) => void;
  onTagClick: (slug: string) => void;
}

export const EntryCard = (props: EntryCardProps) => {
  const isRead = () => props.entry.is_read === 1;
  const isStarred = () => props.entry.is_starred === 1;
  const isUntagged = () => props.entry.tagged_at === null;
  const entryTags = () => props.entry.tags ?? [];

  const handleClick = () => {
    if (!isRead()) {
      props.onMarkRead(props.entry.id);
    }
  };

  return (
    <article
      class={`entry-card ${isRead() ? 'is-read' : ''}`}
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
            <For each={entryTags()}>
              {(tag) => (
                <TagPill
                  slug={tag.slug}
                  label={tag.label}
                  mode={tag.mode as 'none' | 'whitelist' | 'blacklist'}
                  onClick={props.onTagClick}
                />
              )}
            </For>
          </div>

          {/* Star toggle */}
          <div class="entry-card-actions">
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
