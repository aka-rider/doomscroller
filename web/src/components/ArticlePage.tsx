import { Show, For, createSignal, createEffect } from 'solid-js';
import type { EntryWithMeta } from '../lib/api';
import { api, timeAgo, contentLabel, readTime } from '../lib/api';
import { TagPill } from './TagPill';

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

interface ArticlePageProps {
  entry: EntryWithMeta;
  onBack: () => void;
  prevTitle: string | null;
  nextTitle: string | null;
  onPrev: () => void;
  onNext: () => void;
  onStar: (id: number, starred: boolean) => void;
  onThumb: (id: number, thumb: 1 | -1 | null) => void;
  onCycleTagPreference?: (tagId: number, newMode: 'none' | 'whitelist' | 'blacklist') => void;
}

export const ArticlePage = (props: ArticlePageProps) => {
  const [readerContent, setReaderContent] = createSignal<string | null>(null);
  const [readerLoading, setReaderLoading] = createSignal(false);
  const [readerError, setReaderError] = createSignal('');

  const isStarred = () => props.entry.is_starred === 1;
  const thumbValue = () => props.entry.thumb;
  const entryTags = () => props.entry.tags ?? [];
  const depthLbl = () => contentLabel(props.entry.depth_score);
  const readTimeLbl = () => readTime(props.entry.word_count);

  // Re-run when entry changes (prev/next navigation)
  createEffect(() => {
    const id = props.entry.id; // track
    window.scrollTo(0, 0);

    setReaderContent(null);
    setReaderLoading(true);
    setReaderError('');
    api.entries.getContent(id)
      .then(data => {
        setReaderContent(data.content_full ?? props.entry.content_html ?? null);
        if (data.error) setReaderError(data.error);
      })
      .catch(() => {
        setReaderContent(props.entry.content_html ?? null);
        setReaderError('Failed to extract article');
      })
      .finally(() => setReaderLoading(false));
  });

  return (
    <div class="article-page">
      {/* Top bar */}
      <div class="article-page-topbar">
        <button class="article-page-back" onClick={props.onBack}>
          ← Back to feed
        </button>
        <div class="article-page-actions">
          <button
            onClick={() => {
              if (props.onThumb) props.onThumb(props.entry.id, thumbValue() === 1 ? null : 1);
            }}
            class="entry-card-thumb"
            classList={{ 'is-active-up': thumbValue() === 1 }}
            title="Thumb up (u)"
          >
            {'\u{1F44D}'}
          </button>
          <button
            onClick={() => {
              if (props.onThumb) props.onThumb(props.entry.id, thumbValue() === -1 ? null : -1);
            }}
            class="entry-card-thumb"
            classList={{ 'is-active-down': thumbValue() === -1 }}
            title="Thumb down (d)"
          >
            {'\u{1F44E}'}
          </button>
          <button
            onClick={() => props.onStar(props.entry.id, !isStarred())}
            class="entry-card-star"
            style={{ color: isStarred() ? 'var(--star)' : 'var(--text-tertiary)' }}
            title={isStarred() ? 'Unstar (s)' : 'Star (s)'}
          >
            {isStarred() ? '\u2605' : '\u2606'}
          </button>
        </div>
      </div>

      {/* Article header */}
      <header class="article-page-header">
        <h1 class="article-page-title">{props.entry.title}</h1>
        <div class="meta" style={{ "margin-top": "var(--space-3)" }}>
          <span class="meta-source">{props.entry.feed_title}</span>
          {' · '}
          <span>{timeAgo(props.entry.published_at)}</span>
          <Show when={props.entry.author}>
            {' · '}
            <span>{props.entry.author}</span>
          </Show>
          <Show when={readTimeLbl()}>
            {' · '}
            <span>{readTimeLbl()}</span>
          </Show>
        </div>
        <a
          href={props.entry.url}
          target="_blank"
          rel="noopener noreferrer"
          class="reader-view-link"
          style={{ "margin-top": "var(--space-3)", display: "inline-block" }}
        >
          Open original ↗
        </a>
      </header>

      {/* Article body */}
      <div class="article-page-body">
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
      </div>

      {/* Tags */}
      <div class="article-page-tags">
        <Show when={props.entry.depth_score !== null}>
          <span class={`tag-pill tag-pill--depth tag-pill--depth-${depthLbl().toLowerCase()}`}>
            {depthLbl()}
          </span>
        </Show>
        <For each={entryTags()}>
          {(tag) => (
            <TagPill
              slug={tag.slug}
              label={tag.label}
              tagId={tag.tag_id}
              mode={tag.mode as 'none' | 'whitelist' | 'blacklist'}
              onClick={() => { }}
              onCyclePreference={props.onCycleTagPreference ?? (() => { })}
            />
          )}
        </For>
      </div>

      {/* Open original — bottom */}
      <a
        href={props.entry.url}
        target="_blank"
        rel="noopener noreferrer"
        class="reader-view-link reader-view-link--bottom"
        style={{ "margin-top": "var(--space-6)", display: "inline-block" }}
      >
        Open original ↗
      </a>

      {/* Prev / Next navigation */}
      <nav class="article-page-nav">
        <Show when={props.prevTitle} fallback={<span />}>
          <button class="article-page-nav-btn article-page-nav-btn--prev" onClick={props.onPrev}>
            <span class="article-page-nav-label">← Previous</span>
            <span class="article-page-nav-title">{props.prevTitle}</span>
          </button>
        </Show>
        <Show when={props.nextTitle} fallback={<span />}>
          <button class="article-page-nav-btn article-page-nav-btn--next" onClick={props.onNext}>
            <span class="article-page-nav-label">Next →</span>
            <span class="article-page-nav-title">{props.nextTitle}</span>
          </button>
        </Show>
      </nav>
    </div>
  );
};
