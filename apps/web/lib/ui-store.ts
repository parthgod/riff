import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

export type PanelTab = 'queue' | 'lyrics' | 'nowPlaying';

export interface UiState {
  /** Desktop sidebar shows icons only. */
  sidebarCollapsed: boolean;
  /** The desktop right panel's tab, or null when it is closed. */
  panel: PanelTab | null;
  /** The phone's full-screen Now Playing sheet. */
  nowPlayingOpen: boolean;
}

export const uiStore = createStore<UiState>()(() => ({
  sidebarCollapsed: false,
  panel: null,
  nowPlayingOpen: false,
}));

export const ui = {
  toggleSidebar: () => uiStore.setState((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  /** Opens the panel on `tab`, or closes it if that tab is already showing. */
  togglePanel: (tab: PanelTab) =>
    uiStore.setState((s) => ({ panel: s.panel === tab ? null : tab })),
  showPanel: (tab: PanelTab | null) => uiStore.setState({ panel: tab }),
  setNowPlayingOpen: (open: boolean) => uiStore.setState({ nowPlayingOpen: open }),
};

export const useUi = <T>(selector: (state: UiState) => T): T => useStore(uiStore, selector);
