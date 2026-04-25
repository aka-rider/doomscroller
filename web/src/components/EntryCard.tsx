import { Show } from 'solid-js';
import type { ScoredEntry } from '../lib/api';
import { timeAgo, relevanceLevel } from '../lib/api';

interface EntryCardProps {
  entry: ScoredEntry;
  onMarkRead: (id: number) => void;
  onStar: (id: number, starred: boolean) => void;
}

export const EntryCard = (props: EntryCardProps) => {
  const level = () => relevanceLevel(props.entry.relevance);
  const isRead = () => props.entry.is_read === 1;
  const isStarred = () => props.entry.is_starred === 1;

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
        {/* Relevance indicator */}
        <div class={`relevance-bar relevance-${level()}`} />

        <div class="entry-card-content">
          {/* Meta line: source + time */}
          <div class="meta" style={{ "margin-bottom": "var(--space-1)" }}>
            <span class="meta-source">{props.entry.feed_title}</span>
            {' '}
            <span>{timeAgo(props.entry.published_at)}</span>
            <Show when={props.entry.author}>
              {' '}
              <span>by {props.entry.author}</span>
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

          {/* Bottom row: score + actions */}
          <div style={{
            display: "flex",
            "align-items": "center",
            gap: "var(--space-3)",
            "margin-top": "var(--space-2)",
          }}>
            <Show when={props.entry.relevance !== null}>
              <span
                class="score"
                style={{ color: `var(--relevance-${level()})` }}
                title={props.entry.reasoning ?? ''}
              >
                {(props.entry.relevance! * 100).toFixed(0)}%
              </span>
            </Show>

            <button
              onClick={(e) => {
                e.stopPropagation();
                props.onStar(props.entry.id, !isStarred());
              }}
              style={{
                color: isStarred() ? 'var(--star)' : 'var(--text-tertiary)',
                "font-size": "var(--text-sm)",
              }}
              title={isStarred() ? 'Unstar' : 'Star'}
            >
              {isStarred() ? '\u2605' : '\u2606'}
            </button>
          </div>
        </div>

        {/* Hero image */}
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
