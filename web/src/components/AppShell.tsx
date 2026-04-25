import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { Header } from './Header';
import { TagSidebar } from './TagSidebar';

interface AppShellProps {
  children: JSX.Element;
  showUnreadOnly: boolean;
  onToggleUnread: () => void;
  onOpenSettings: () => void;
  activeTag: string | null;
  onSelectTag: (slug: string | null) => void;
  onCreateTag: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export const AppShell = (props: AppShellProps) => {
  return (
    <div class="app-layout">
      <Header
        showUnreadOnly={props.showUnreadOnly}
        onToggleUnread={props.onToggleUnread}
        onOpenSettings={props.onOpenSettings}
        onToggleSidebar={props.onToggleSidebar}
        sidebarOpen={props.sidebarOpen}
      />

      <div class="app-shell">
        {/* Desktop sidebar — always rendered, hidden via CSS on mobile */}
        <div class="app-shell-sidebar">
          <TagSidebar
            activeTag={props.activeTag}
            onSelectTag={props.onSelectTag}
            onCreateTag={props.onCreateTag}
          />
        </div>

        {/* Mobile drawer overlay */}
        <Show when={props.sidebarOpen}>
          <div
            class="mobile-drawer-overlay"
            onClick={props.onToggleSidebar}
          />
          <div class="mobile-drawer">
            <TagSidebar
              activeTag={props.activeTag}
              onSelectTag={(slug) => {
                props.onSelectTag(slug);
                props.onToggleSidebar();
              }}
              onCreateTag={() => {
                props.onCreateTag();
                props.onToggleSidebar();
              }}
            />
          </div>
        </Show>

        <main class="app-main">
          {props.children}
        </main>
      </div>
    </div>
  );
};
