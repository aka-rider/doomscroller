import { Show, For, createSignal, createEffect, batch } from 'solid-js';
import { ThumbsUp, Star, ExternalLink, Mail, MailOpen, Trash2 } from 'lucide-solid';
import type { EntryWithMeta } from '../lib/api';
import { timeAgo, contentLabel, readTime } from '../lib/api';
import { useSwipe } from '../lib/use-swipe';
import { TagPill } from './TagPill';

interface EntryCardProps {
  entry: EntryWithMeta;
  onOpenArticle: (entry: EntryWithMeta) => void;
  onMarkRead: (id: number) => void;
  onStar: (id: number, starred: boolean) => void;
  onTagClick: (slug: string) => void;
  onThumb?: (id: number, thumb: 1 | -1 | null) => void;
  onCycleTagPreference?: (tagId: number, newMode: 'none' | 'whitelist' | 'blacklist') => void;
  onSwipeRead?: (id: number) => void;
  onSwipeTrash?: (id: number) => void;
}


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

  const handleClick = () => {
    if (!isRead()) {
      props.onMarkRead(props.entry.id);
    }
  };

  const handleOpenArticle = (e: MouseEvent) => {
    e.stopPropagation();
    props.onOpenArticle(props.entry);
  };

  // Summary to display: prefer extractive_summary, fall back to RSS summary
  const displaySummary = () => props.entry.extractive_summary || props.entry.summary;

  // --- Swipe gesture state ---
  let cardRef!: HTMLElement;
  const [swipeX, setSwipeX] = createSignal(0);
  const [springing, setSpringing] = createSignal(false);
  const [activated, setActivated] = createSignal(false);

  // Reset swipe offset when entry changes (recycled DOM)
  createEffect(() => {
    props.entry.id; // track
    batch(() => {
      setSwipeX(0);
      setSpringing(false);
      setActivated(false);
    });
  });

  const THRESHOLD = 80;

  // Icon scale: grows from 1x to 1.4x as swipe approaches threshold
  const iconScale = () => {
    const abs = Math.abs(swipeX());
    if (abs < 10) return 1;
    return 1 + Math.min(abs / THRESHOLD, 1) * 0.4;
  };

  const isPastThreshold = () => Math.abs(swipeX()) >= THRESHOLD;

  useSwipe(() => cardRef, {
    threshold: THRESHOLD,
    onMove: (dx) => {
      setSpringing(false);
      setActivated(false);
      setSwipeX(dx);
    },
    onEnd: (fired) => {
      if (fired) {
        setActivated(true);
        setTimeout(() => {
          batch(() => {
            setSpringing(true);
            setSwipeX(0);
            setActivated(false);
          });
          // Clear springing class after animation completes
          setTimeout(() => setSpringing(false), 600);
        }, 150);
      } else {
        // Spring back to origin with bounce
        batch(() => {
          setSpringing(true);
          setSwipeX(0);
        });
        setTimeout(() => setSpringing(false), 600);
      }
    },
    onSwipeRight: () => {
      props.onSwipeRead?.(props.entry.id);
    },
    onSwipeLeft: () => {
      props.onSwipeTrash?.(props.entry.id);
    },
  });

  // --- Noise: compact single-line card ---
  if (isNoise() && !isFiltered()) {
    return (
      <article
        class="entry-card entry-card--noise"
        classList={{ 'is-read': isRead() }}
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
            Open <ExternalLink size={12} />
          </a>
        </div>
      </article>
    );
  }

  // --- Standard card ---
  return (
    <div class="entry-card-swipe-wrapper">
      {/* Swipe action indicators — minimal, icon + text only */}
      <div
        class="entry-card-swipe-action entry-card-swipe-action--right"
        classList={{ 'is-active': isPastThreshold() && swipeX() > 0, 'is-activated': activated() && swipeX() >= 0 }}
      >
        <div class="entry-card-swipe-action-inner" style={{ transform: `scale(${swipeX() > 0 ? iconScale() : 1})` }}>
          <Show when={isRead()} fallback={<MailOpen size={20} />}>
            <Mail size={20} />
          </Show>
        </div>
        <span class="entry-card-swipe-action-label">
          {isRead() ? 'Mark Unread' : 'Mark Read'}
        </span>
      </div>
      <div
        class="entry-card-swipe-action entry-card-swipe-action--left"
        classList={{ 'is-active': isPastThreshold() && swipeX() < 0, 'is-activated': activated() && swipeX() <= 0 }}
      >
        <span class="entry-card-swipe-action-label">Trash</span>
        <div class="entry-card-swipe-action-inner" style={{ transform: `scale(${swipeX() < 0 ? iconScale() : 1})` }}>
          <Trash2 size={20} />
        </div>
      </div>
      <article
        ref={cardRef}
        class="entry-card"
        classList={{
          'is-read': isRead(),
          'is-filtered': isFiltered(),
          'is-springing': springing(),
        }}
        onClick={handleClick}
        style={{ transform: swipeX() !== 0 ? `translateX(${swipeX()}px)` : undefined }}
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

            {/* Title — click to open article page */}
            <button
              class="article-title entry-card-expand-btn"
              onClick={handleOpenArticle}
              title="Read article (e)"
            >
              {props.entry.title}
            </button>

            {/* Summary */}
            <Show when={displaySummary()}>
              <p class="entry-summary">{displaySummary()}</p>
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
                    onCyclePreference={props.onCycleTagPreference ?? (() => { })}
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
                class="entry-card-thumb"
                classList={{ 'is-active-up': thumbValue() === 1 }}
                title="Thumb up (u)"
              >
                <ThumbsUp size={16} fill={thumbValue() === 1 ? 'currentColor' : 'none'} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (props.onThumb) {
                    props.onThumb(props.entry.id, thumbValue() === -1 ? null : -1);
                  }
                }}
                class="entry-card-thumb"
                classList={{ 'is-active-down': thumbValue() === -1 }}
                title="Trash (d)"
              >
                <Trash2 size={16} />
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
                <Star size={16} fill={isStarred() ? 'currentColor' : 'none'} />
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
    </div>
  );
};
