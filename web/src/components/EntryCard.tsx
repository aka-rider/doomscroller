import { Show, For, createSignal } from 'solid-js';
import type { EntryWithMeta } from '../lib/api';
import { api, timeAgo, contentLabel, readTime } from '../lib/api';
import { TagPill } from './TagPill';

interface EntryCardProps {
  entry: EntryWithMeta;
  expanded: boolean;
  onToggleExpand: (id: number) => void;
  onMarkRead: (id: number) => void;
  onStar: (id: number, starred: boolean) => void;
  onTagClick: (slug: string) => void;
  onThumb?: (id: number, thumb: 1 | -1 | null) => void;
  onCycleTagPreference?: (tagId: number, newMode: 'none' | 'whitelist' | 'blacklist') => void;
}

// Client-side HTML sanitization — defense-in-depth (server also sanitizes)
const sanitizeHtml = (html: string): string => {
  let clean = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<iframe\b[^>]*>.*?<\/iframe>/gi, '')
    .replace(/<object\b[^>]*>.*?<\/object>/gi, '')
    .replace(/<embed\b[^>]*\/?>/gi, '');
  clean = clean.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  clean = clean.replace(/\bhref\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"');
  return clean;
};

export const EntryCard = (props: EntryCardProps) => {
  const isRead = () => props.entry.is_read === 1;
  const isStarred = () => props.entry.is_starred === 1;
  const isUntagged = () => props.entry.tagged_at === null;
  const entryTags = () => props.entry.tags ?? [];
  const thumbValue = () => props.entry.thumb;
  const isNoise = () => props.entry.depth_score !== null && props.entry.depth_score < 0.15;
  const depthLabel = () => contentLabel(props.entry.depth_score);
  const readTimeLabel = () => readTime(props.entry.word_count);

  // Entry is "filtered out" when it has tags and ALL tags are blacklisted
  const isFiltered = () => {
    const tags = entryTags();
    if (tags.length === 0) return false;
    return tags.every(t => t.mode === 'blacklist');
  };

  // Reader view content (lazy-loaded on first expand)
  const [readerContent, setReaderContent] = createSignal<string | null>(null);
  const [readerLoading, setReaderLoading] = createSignal(false);
  const [readerError, setReaderError] = createSignal('');

  const handleClick = () => {
    if (!isRead()) {
      props.onMarkRead(props.entry.id);
    }
  };

  const handleExpand = (e: MouseEvent) => {
    e.stopPropagation();
    if (!isRead()) {
      props.onMarkRead(props.entry.id);
    }
    props.onToggleExpand(props.entry.id);

    // Lazy-load reader content on first expand
    if (!props.expanded && readerContent() === null && !readerLoading()) {
      setReaderLoading(true);
      setReaderError('');
      api.entries.getContent(props.entry.id)
        .then(data => {
          setReaderContent(data.content_full ?? props.entry.content_html ?? null);
          if (data.error) setReaderError(data.error);
        })
        .catch(() => {
          setReaderContent(props.entry.content_html ?? null);
          setReaderError('Failed to extract article');
        })
        .finally(() => setReaderLoading(false));
    }
  };

  // Summary to display: prefer extractive_summary, fall back to RSS summary
  const displaySummary = () => props.entry.extractive_summary || props.entry.summary;

  // --- Noise: compact single-line card ---
  if (isNoise() && !isFiltered()) {
    return (
      <article
        class={`entry-card entry-card--noise ${isRead() ? 'is-read' : ''}`}
        onClick={handleClick}
      >
        <div class="entry-card-noise-inner">
          <span class="meta-source">{props.entry.feed_title}</span>
          <a
            href={props.entry.url}
            target="_blank"
            rel="noopener noreferrer"
            class="entry-card-noise-title"
          >
            {props.entry.title}
          </a>
          <Show when={displaySummary()}>
            <span class="entry-card-noise-summary">
              {displaySummary().split(/[.!?]\s/)[0]?.slice(0, 120)}
            </span>
          </Show>
          <a
            href={props.entry.url}
            target="_blank"
            rel="noopener noreferrer"
            class="entry-card-noise-open"
          >
            Open ↗
          </a>
        </div>
      </article>
    );
  }

  // --- Standard card with inline expansion ---
  return (
    <article
      class={`entry-card ${isRead() ? 'is-read' : ''} ${isFiltered() ? 'is-filtered' : ''} ${props.expanded ? 'is-expanded' : ''}`}
      onClick={handleClick}
    >
      <div class="entry-card-inner">
        <div class="entry-card-content">
          {/* Meta line: source · time · author · read time */}
          <div class="meta" style={{ "margin-bottom": "var(--space-1)" }}>
            <span class="meta-source">{props.entry.feed_title}</span>
            {' · '}
            <span>{timeAgo(props.entry.published_at)}</span>
            <Show when={props.entry.author}>
              {' · '}
              <span>{props.entry.author}</span>
            </Show>
            <Show when={readTimeLabel()}>
              {' · '}
              <span>{readTimeLabel()}</span>
            </Show>
          </div>

          {/* Title — click to expand */}
          <button
            class="article-title entry-card-expand-btn"
            onClick={handleExpand}
            title={props.expanded ? 'Collapse (e)' : 'Expand (e)'}
          >
            {props.entry.title}
          </button>

          {/* Summary (collapsed only) */}
          <Show when={!props.expanded && displaySummary()}>
            <p class="entry-summary">{displaySummary()}</p>
          </Show>

          {/* Expanded: Reader view */}
          <Show when={props.expanded}>
            <div class="reader-view">
              {/* Open original — top */}
              <a
                href={props.entry.url}
                target="_blank"
                rel="noopener noreferrer"
                class="reader-view-link"
              >
                Open original ↗
              </a>

              <Show when={readerLoading()}>
                <div class="reader-view-loading">
                  <p class="meta">Loading article...</p>
                </div>
              </Show>

              <Show when={readerError() && !readerLoading()}>
                <p class="meta" style={{ color: "var(--text-tertiary)", "margin-bottom": "var(--space-3)" }}>
                  Showing RSS content (extraction: {readerError()})
                </p>
              </Show>

              <Show when={readerContent() && !readerLoading()}>
                <div
                  class="reader-content"
                  innerHTML={sanitizeHtml(readerContent()!)}
                />
              </Show>

              <Show when={!readerContent() && !readerLoading()}>
                <div
                  class="reader-content"
                  innerHTML={sanitizeHtml(props.entry.content_html || '')}
                />
              </Show>

              {/* Open original — bottom */}
              <a
                href={props.entry.url}
                target="_blank"
                rel="noopener noreferrer"
                class="reader-view-link reader-view-link--bottom"
              >
                Open original ↗
              </a>
            </div>
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

        {/* Thumbnail (collapsed only) */}
        <Show when={!props.expanded && props.entry.image_url}>
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
