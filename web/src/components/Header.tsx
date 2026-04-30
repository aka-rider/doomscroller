import { createSignal, Show } from 'solid-js';
import { Menu, X, Settings, RefreshCw } from 'lucide-solid';
import { api } from '../lib/api';

interface HeaderProps {
  showUnreadOnly: boolean;
  onToggleUnread: () => void;
  onOpenSettings: () => void;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
  activeFeedId: number | null;
  onRefreshComplete?: (() => void) | undefined;
}

export const Header = (props: HeaderProps) => {
  const [refreshing, setRefreshing] = createSignal(false);
  const [cooldown, setCooldown] = createSignal(false);

  const handleRefresh = async () => {
    if (!props.activeFeedId || refreshing() || cooldown()) return;
    setRefreshing(true);
    try {
      await api.feeds.refresh(props.activeFeedId);
      setCooldown(true);
      setTimeout(() => setCooldown(false), 10000);
      // Delay briefly, then trigger a re-fetch of entries
      setTimeout(() => props.onRefreshComplete?.(), 2000);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <header class="app-header">
      <button
        class="btn header-hamburger"
        onClick={props.onToggleSidebar}
        title="Toggle sidebar"
        aria-label="Toggle sidebar"
      >
        <Show when={props.sidebarOpen} fallback={<Menu size={20} />}>
          <X size={20} />
        </Show>
      </button>

      <h1 class="header-wordmark">Doomscroller</h1>

      <div class="header-actions">
        <Show when={props.activeFeedId != null}>
          <button
            class="btn"
            classList={{ 'spin': refreshing() }}
            onClick={handleRefresh}
            disabled={refreshing() || cooldown()}
            title={cooldown() ? 'Refresh cooling down…' : 'Refresh feed'}
            style={{ "font-size": "var(--text-sm)" }}
            data-testid="refresh-feed-btn"
          >
            <RefreshCw size={16} />
          </button>
        </Show>
        <button
          class={`btn ${props.showUnreadOnly ? 'btn-primary' : ''}`}
          onClick={props.onToggleUnread}
          title="Toggle unread filter"
          style={{ "font-size": "var(--text-sm)" }}
        >
          {props.showUnreadOnly ? 'Unread' : 'All'}
        </button>
        <button
          class="btn"
          onClick={props.onOpenSettings}
          style={{ "font-size": "var(--text-sm)" }}
          title="Settings (,)"
        >
          <Settings size={18} />
        </button>
      </div>
    </header>
  );
};
