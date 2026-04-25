import { createSignal, createResource, For, Show, Suspense, batch } from 'solid-js';
import { api } from '../lib/api';
import type { Feed } from '../lib/api';

interface SettingsPanelProps {
  onClose: () => void;
}

export const SettingsPanel = (props: SettingsPanelProps) => {
  const [activeTab, setActiveTab] = createSignal<'preferences' | 'feeds' | 'opml'>('preferences');

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
            class={`settings-tab ${activeTab() === 'preferences' ? 'active' : ''}`}
            onClick={() => setActiveTab('preferences')}
          >
            Preferences
          </button>
          <button
            class={`settings-tab ${activeTab() === 'feeds' ? 'active' : ''}`}
            onClick={() => setActiveTab('feeds')}
          >
            Feeds
          </button>
          <button
            class={`settings-tab ${activeTab() === 'opml' ? 'active' : ''}`}
            onClick={() => setActiveTab('opml')}
          >
            OPML
          </button>
        </nav>

        <div class="settings-body">
          <Show when={activeTab() === 'preferences'}>
            <PreferencesTab />
          </Show>
          <Show when={activeTab() === 'feeds'}>
            <FeedsTab />
          </Show>
          <Show when={activeTab() === 'opml'}>
            <OpmlTab />
          </Show>
        </div>
      </div>
    </div>
  );
};

// --- Preferences Tab ---

const PreferencesTab = () => {
  const [prefs, { refetch }] = createResource(() => api.preferences.getAll());
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const [saving, setSaving] = createSignal(false);

  const startEditing = () => {
    const current = prefs();
    setDraft(current?.['interest_profile'] ?? '');
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    await api.preferences.set('interest_profile', draft());
    setSaving(false);
    setEditing(false);
    refetch();
  };

  const cancel = () => {
    setEditing(false);
  };

  return (
    <div>
      <h3 style={{
        "font-family": "var(--font-serif)",
        "font-size": "var(--text-lg)",
        "margin-bottom": "var(--space-2)",
      }}>
        Interest Profile
      </h3>
      <p class="meta" style={{ "margin-bottom": "var(--space-4)" }}>
        Tell the LLM what you care about. This is sent with every scoring prompt.
      </p>

      <Suspense fallback={<p class="meta">Loading...</p>}>
        <Show when={!editing()} fallback={
          <div>
            <textarea
              class="pref-textarea"
              value={draft()}
              onInput={(e) => setDraft(e.currentTarget.value)}
              rows={10}
              spellcheck={false}
            />
            <div style={{ display: "flex", gap: "var(--space-2)", "margin-top": "var(--space-3)" }}>
              <button class="btn btn-primary" onClick={save} disabled={saving()}>
                {saving() ? 'Saving...' : 'Save'}
              </button>
              <button class="btn" onClick={cancel}>Cancel</button>
            </div>
          </div>
        }>
          <div class="pref-display" onClick={startEditing}>
            <pre style={{
              "font-family": "var(--font-sans)",
              "font-size": "var(--text-sm)",
              "white-space": "pre-wrap",
              "word-break": "break-word",
              "line-height": "1.6",
              color: "var(--text-secondary)",
            }}>
              {prefs()?.['interest_profile'] ?? 'No preferences set yet. Click to edit.'}
            </pre>
            <p class="meta" style={{ "margin-top": "var(--space-3)" }}>Click to edit</p>
          </div>
        </Show>
      </Suspense>
    </div>
  );
};

// --- Feeds Tab ---

const FeedsTab = () => {
  const [feeds, { refetch }] = createResource(() => api.feeds.list());
  const [newUrl, setNewUrl] = createSignal('');
  const [adding, setAdding] = createSignal(false);
  const [error, setError] = createSignal('');

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
    </div>
  );
};

// --- OPML Tab ---

const OpmlTab = () => {
  const [importing, setImporting] = createSignal(false);
  const [result, setResult] = createSignal('');

  const handleExport = () => {
    window.open('/api/opml/export', '_blank');
  };

  const handleImport = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    setImporting(true);
    setResult('');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/opml/import', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json() as { imported: number; skipped: number; errors: string[] };
      setResult(`Imported ${data.imported} feeds, skipped ${data.skipped}.`);
    } catch {
      setResult('Failed to import OPML file.');
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
        OPML Import/Export
      </h3>

      <div style={{ display: "flex", "flex-direction": "column", gap: "var(--space-4)" }}>
        <div>
          <h4 style={{ "font-size": "var(--text-sm)", "font-weight": "500", "margin-bottom": "var(--space-2)" }}>
            Export
          </h4>
          <p class="meta" style={{ "margin-bottom": "var(--space-2)" }}>
            Download all your feeds as an OPML file.
          </p>
          <button class="btn" onClick={handleExport}>Download OPML</button>
        </div>

        <div>
          <h4 style={{ "font-size": "var(--text-sm)", "font-weight": "500", "margin-bottom": "var(--space-2)" }}>
            Import
          </h4>
          <p class="meta" style={{ "margin-bottom": "var(--space-2)" }}>
            Import feeds from an OPML file (from Feedly, Reeder, etc.)
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

        <Show when={result()}>
          <p class="meta" style={{ color: "var(--relevance-high)" }}>{result()}</p>
        </Show>
      </div>
    </div>
  );
};
