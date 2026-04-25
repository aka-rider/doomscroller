import { createSignal, createResource, For, Show, Suspense } from 'solid-js';
import { api } from '../lib/api';
import type { Tag } from '../lib/api';
import { TagPreferenceGrid } from './TagPreferenceGrid';

interface SettingsPanelProps {
  onClose: () => void;
}

export const SettingsPanel = (props: SettingsPanelProps) => {
  const [activeTab, setActiveTab] = createSignal<'feeds' | 'tags'>('feeds');

  return (
    <div class="settings-overlay" onClick={(e) => {
      if (e.target === e.currentTarget) props.onClose();
    }}>
      <div class="settings-panel">
        <header class="settings-header">
          <h2 style={{ "font-family": "var(--font-serif)", "font-size": "var(--text-xl)" }}>
            Settings
          </h2>
          <button onClick={props.onClose} class="settings-close" title="Close (Esc)">
            ✕
          </button>
        </header>

        <nav class="settings-tabs">
          <button
            class={`settings-tab ${activeTab() === 'feeds' ? 'active' : ''}`}
            onClick={() => setActiveTab('feeds')}
          >
            Feeds
          </button>
          <button
            class={`settings-tab ${activeTab() === 'tags' ? 'active' : ''}`}
            onClick={() => setActiveTab('tags')}
          >
            Tags
          </button>
        </nav>

        <div class="settings-body">
          <Show when={activeTab() === 'feeds'}>
            <FeedsTab />
          </Show>
          <Show when={activeTab() === 'tags'}>
            <TagsTab />
          </Show>
        </div>
      </div>
    </div>
  );
};

// --- Feeds Tab (includes OPML section) ---

const FeedsTab = () => {
  const [feeds, { refetch }] = createResource(() => api.feeds.list());
  const [newUrl, setNewUrl] = createSignal('');
  const [adding, setAdding] = createSignal(false);
  const [error, setError] = createSignal('');
  const [importing, setImporting] = createSignal(false);
  const [opmlResult, setOpmlResult] = createSignal('');

  const addFeed = async () => {
    const url = newUrl().trim();
    if (!url) return;
    setAdding(true);
    setError('');
    try {
      await api.feeds.add(url);
      setNewUrl('');
      refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add feed');
    }
    setAdding(false);
  };

  const removeFeed = async (id: number) => {
    await api.feeds.remove(id);
    refetch();
  };

  const handleExport = () => {
    window.open('/api/opml/export', '_blank');
  };

  const handleImport = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    setImporting(true);
    setOpmlResult('');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/opml/import', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json() as { imported: number; skipped: number; errors: string[] };
      setOpmlResult(`Imported ${data.imported} feeds, skipped ${data.skipped}.`);
      refetch();
    } catch {
      setOpmlResult('Failed to import OPML file.');
    }

    setImporting(false);
    input.value = '';
  };

  return (
    <div>
      <h3 style={{
        "font-family": "var(--font-serif)",
        "font-size": "var(--text-lg)",
        "margin-bottom": "var(--space-4)",
      }}>
        Manage Feeds
      </h3>

      <div style={{ display: "flex", gap: "var(--space-2)", "margin-bottom": "var(--space-4)" }}>
        <input
          class="settings-input"
          type="url"
          placeholder="https://example.com/feed.xml"
          value={newUrl()}
          onInput={(e) => setNewUrl(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addFeed(); }}
          style={{ flex: "1" }}
        />
        <button class="btn btn-primary" onClick={addFeed} disabled={adding()}>
          {adding() ? 'Adding...' : 'Add'}
        </button>
      </div>

      <Show when={error()}>
        <p class="meta" style={{ color: "var(--danger)", "margin-bottom": "var(--space-3)" }}>
          {error()}
        </p>
      </Show>

      <Suspense fallback={<p class="meta">Loading...</p>}>
        <div class="feed-list">
          <For each={feeds()} fallback={<p class="meta">No feeds yet.</p>}>
            {(feed) => (
              <div class="feed-row">
                <div style={{ flex: "1", "min-width": "0" }}>
                  <div style={{
                    "font-weight": "500",
                    "font-size": "var(--text-sm)",
                    "margin-bottom": "var(--space-1)",
                  }} class="truncate">
                    {feed.title || feed.url}
                  </div>
                  <div class="meta truncate">{feed.url}</div>
                  <div class="meta">
                    {feed.entry_count} entries · {feed.unread_count} unread
                    <Show when={feed.last_error}>
                      {' · '}<span style={{ color: "var(--danger)" }}>Error</span>
                    </Show>
                  </div>
                </div>
                <button
                  class="btn"
                  style={{ "font-size": "var(--text-xs)", color: "var(--danger)" }}
                  onClick={() => removeFeed(feed.id)}
                  title="Remove feed"
                >
                  Remove
                </button>
              </div>
            )}
          </For>
        </div>
      </Suspense>

      {/* OPML Section */}
      <div style={{
        "margin-top": "var(--space-6)",
        "padding-top": "var(--space-4)",
        "border-top": "1px solid var(--border)",
      }}>
        <h3 style={{
          "font-family": "var(--font-serif)",
          "font-size": "var(--text-lg)",
          "margin-bottom": "var(--space-4)",
        }}>
          OPML Import/Export
        </h3>

        <div style={{ display: "flex", gap: "var(--space-4)", "align-items": "flex-start" }}>
          <div style={{ flex: "1" }}>
            <p class="meta" style={{ "margin-bottom": "var(--space-2)" }}>
              Download all your feeds as an OPML file.
            </p>
            <button class="btn" onClick={handleExport}>Download OPML</button>
          </div>

          <div style={{ flex: "1" }}>
            <p class="meta" style={{ "margin-bottom": "var(--space-2)" }}>
              Import feeds from an OPML file.
            </p>
            <label class="btn" style={{ cursor: "pointer" }}>
              {importing() ? 'Importing...' : 'Choose OPML File'}
              <input
                type="file"
                accept=".opml,.xml"
                onChange={handleImport}
                style={{ display: "none" }}
                disabled={importing()}
              />
            </label>
          </div>
        </div>

        <Show when={opmlResult()}>
          <p class="meta" style={{ color: "var(--relevance-high)", "margin-top": "var(--space-3)" }}>
            {opmlResult()}
          </p>
        </Show>
      </div>
    </div>
  );
};

// --- Tags Tab ---

const TagsTab = () => {
  const [tags, { refetch }] = createResource(() => api.tags.list());
  const [newLabel, setNewLabel] = createSignal('');
  const [creating, setCreating] = createSignal(false);
  const [error, setError] = createSignal('');

  const preferences = (): Map<number, string> => {
    const map = new Map<number, string>();
    const list = tags();
    if (list) {
      for (const tag of list) {
        map.set(tag.id, tag.mode ?? 'none');
      }
    }
    return map;
  };

  const handleToggle = async (tagId: number, mode: string) => {
    await api.tags.setPreference(tagId, mode);
    refetch();
  };

  const slugify = (label: string): string =>
    label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const createTag = async () => {
    const label = newLabel().trim();
    if (!label) return;
    const slug = slugify(label);
    if (!slug) return;
    setCreating(true);
    setError('');
    try {
      await api.tags.create(slug, label);
      setNewLabel('');
      refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create tag');
    }
    setCreating(false);
  };

  const deleteTag = async (id: number) => {
    try {
      await api.tags.delete(id);
      refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete tag');
    }
  };

  const customTags = (): Tag[] => (tags() ?? []).filter(t => !t.is_builtin);
  const proposedTags = (): Tag[] => customTags().filter(t => t.tag_group === 'proposed');
  const userTags = (): Tag[] => customTags().filter(t => t.tag_group !== 'proposed');

  return (
    <div>
      <h3 style={{
        "font-family": "var(--font-serif)",
        "font-size": "var(--text-lg)",
        "margin-bottom": "var(--space-4)",
      }}>
        Tag Preferences
      </h3>

      <Suspense fallback={<p class="meta">Loading tags...</p>}>
        <Show when={tags()}>
          <TagPreferenceGrid
            tags={tags()!}
            preferences={preferences()}
            onToggle={handleToggle}
          />
        </Show>
      </Suspense>

      {/* Custom tag creation */}
      <div style={{
        "margin-top": "var(--space-6)",
        "padding-top": "var(--space-4)",
        "border-top": "1px solid var(--border)",
      }}>
        <h3 style={{
          "font-family": "var(--font-serif)",
          "font-size": "var(--text-lg)",
          "margin-bottom": "var(--space-4)",
        }}>
          Create Custom Tag
        </h3>

        <div style={{ display: "flex", gap: "var(--space-2)", "margin-bottom": "var(--space-3)" }}>
          <input
            class="settings-input"
            type="text"
            placeholder="Tag label, e.g. Machine Learning"
            value={newLabel()}
            onInput={(e) => setNewLabel(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') createTag(); }}
            style={{ flex: "1" }}
          />
          <button class="btn btn-primary" onClick={createTag} disabled={creating()}>
            {creating() ? 'Creating...' : 'Create'}
          </button>
        </div>

        <Show when={error()}>
          <p class="meta" style={{ color: "var(--danger)", "margin-bottom": "var(--space-3)" }}>
            {error()}
          </p>
        </Show>
      </div>

      {/* User custom tags */}
      <Show when={userTags().length > 0}>
        <div style={{
          "margin-top": "var(--space-4)",
          "padding-top": "var(--space-4)",
          "border-top": "1px solid var(--border)",
        }}>
          <h3 style={{
            "font-family": "var(--font-serif)",
            "font-size": "var(--text-lg)",
            "margin-bottom": "var(--space-3)",
          }}>
            Custom Tags
          </h3>
          <div class="feed-list">
            <For each={userTags()}>
              {(tag) => (
                <div class="feed-row">
                  <div style={{ flex: "1" }}>
                    <span style={{ "font-size": "var(--text-sm)", "font-weight": "500" }}>{tag.label}</span>
                    <span class="meta" style={{ "margin-left": "var(--space-2)" }}>
                      {tag.use_count} uses
                    </span>
                  </div>
                  <button
                    class="btn"
                    style={{ "font-size": "var(--text-xs)", color: "var(--danger)" }}
                    onClick={() => deleteTag(tag.id)}
                    title="Delete tag"
                  >
                    Delete
                  </button>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* Proposed tags */}
      <Show when={proposedTags().length > 0}>
        <div style={{
          "margin-top": "var(--space-4)",
          "padding-top": "var(--space-4)",
          "border-top": "1px solid var(--border)",
        }}>
          <h3 style={{
            "font-family": "var(--font-serif)",
            "font-size": "var(--text-lg)",
            "margin-bottom": "var(--space-3)",
          }}>
            Proposed Tags
          </h3>
          <p class="meta" style={{ "margin-bottom": "var(--space-3)" }}>
            Tags suggested by the LLM that aren't built-in. Remove ones you don't want.
          </p>
          <div class="feed-list">
            <For each={proposedTags()}>
              {(tag) => (
                <div class="feed-row">
                  <div style={{ flex: "1" }}>
                    <span style={{ "font-size": "var(--text-sm)", "font-weight": "500" }}>{tag.label}</span>
                    <span class="meta" style={{ "margin-left": "var(--space-2)" }}>
                      {tag.use_count} uses
                    </span>
                  </div>
                  <button
                    class="btn"
                    style={{ "font-size": "var(--text-xs)", color: "var(--danger)" }}
                    onClick={() => deleteTag(tag.id)}
                    title="Delete tag"
                  >
                    Delete
                  </button>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
};
