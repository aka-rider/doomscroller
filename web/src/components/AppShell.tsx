import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { Header } from './Header';
import { TagSidebar } from './TagSidebar';
import type { ViewMode } from './TagSidebar';

interface AppShellProps {
  children: JSX.Element;
  showUnreadOnly: boolean;
  onToggleUnread: () => void;
  onOpenSettings: () => void;
  activeCategory: string | null;
  onSelectCategory: (slug: string | null) => void;
  activeView: ViewMode;
  onSelectView: (view: ViewMode) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onCloseSidebar: () => void;
  categoryRefetchKey?: () => number;
  activeFeedId: number | null;
  onRefreshComplete?: () => void;
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
        activeFeedId={props.activeFeedId}
        onRefreshComplete={props.onRefreshComplete}
      />

      <div class="app-shell">
        {/* Desktop sidebar — always rendered, hidden via CSS on mobile */}
        <div class="app-shell-sidebar">
          <TagSidebar
            activeCategory={props.activeCategory}
            onSelectCategory={props.onSelectCategory}
            activeView={props.activeView}
            onSelectView={props.onSelectView}
            refetchKey={props.categoryRefetchKey}
          />
        </div>

        {/* Mobile drawer overlay */}
        <Show when={props.sidebarOpen}>
          <div
            class="mobile-drawer-overlay"
            onClick={props.onCloseSidebar}
          />
          <div class="mobile-drawer">
            <TagSidebar
              activeCategory={props.activeCategory}
              onSelectCategory={(slug) => {
                props.onSelectCategory(slug);
                props.onCloseSidebar();
              }}
              activeView={props.activeView}
              onSelectView={(view) => {
                props.onSelectView(view);
                props.onCloseSidebar();
              }}
              refetchKey={props.categoryRefetchKey}
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
