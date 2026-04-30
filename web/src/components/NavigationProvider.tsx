import { createSignal, createContext, useContext } from 'solid-js';
import type { Accessor, Setter } from 'solid-js';
import type { JSX } from 'solid-js';
import type { EntryWithMeta, ViewMode } from '../lib/types';

export interface NavigationState {
  activeView: Accessor<ViewMode>;
  setActiveView: Setter<ViewMode>;
  activeCategory: Accessor<string | null>;
  setActiveCategory: Setter<string | null>;
  activeArticle: Accessor<EntryWithMeta | null>;
  setActiveArticle: Setter<EntryWithMeta | null>;
  focusIndex: Accessor<number>;
  setFocusIndex: Setter<number>;
  sidebarOpen: Accessor<boolean>;
  setSidebarOpen: Setter<boolean>;
  showUnreadOnly: Accessor<boolean>;
  setShowUnreadOnly: Setter<boolean>;
  showSettings: Accessor<boolean>;
  setShowSettings: Setter<boolean>;
  sidebarMode: Accessor<'categories' | 'feeds'>;
  setSidebarMode: Setter<'categories' | 'feeds'>;
  activeFeed: Accessor<number | null>;
  setActiveFeed: Setter<number | null>;
}

const NavigationContext = createContext<NavigationState>();

export const NavigationProvider = (props: { children: JSX.Element }) => {
  const [activeView, setActiveView] = createSignal<ViewMode>('feed');
  const [activeCategory, setActiveCategory] = createSignal<string | null>(null);
  const [activeArticle, setActiveArticle] = createSignal<EntryWithMeta | null>(null);
  const [focusIndex, setFocusIndex] = createSignal(-1);
  const [sidebarOpen, setSidebarOpen] = createSignal(false);
  const [showUnreadOnly, setShowUnreadOnly] = createSignal(false);
  const [showSettings, setShowSettings] = createSignal(false);
  const [sidebarMode, setSidebarMode] = createSignal<'categories' | 'feeds'>('categories');
  const [activeFeed, setActiveFeed] = createSignal<number | null>(null);

  const state: NavigationState = {
    activeView,
    setActiveView,
    activeCategory,
    setActiveCategory,
    activeArticle,
    setActiveArticle,
    focusIndex,
    setFocusIndex,
    sidebarOpen,
    setSidebarOpen,
    showUnreadOnly,
    setShowUnreadOnly,
    showSettings,
    setShowSettings,
    sidebarMode,
    setSidebarMode,
    activeFeed,
    setActiveFeed,
  };

  return (
    <NavigationContext.Provider value={state}>
      {props.children}
    </NavigationContext.Provider>
  );
};

export const useNavigation = (): NavigationState => {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error('useNavigation must be used within NavigationProvider');
  return ctx;
};
