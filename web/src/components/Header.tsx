import { Show } from 'solid-js';
import { Menu, X, Settings } from 'lucide-solid';

interface HeaderProps {
  showUnreadOnly: boolean;
  onToggleUnread: () => void;
  onOpenSettings: () => void;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
}

export const Header = (props: HeaderProps) => {
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
