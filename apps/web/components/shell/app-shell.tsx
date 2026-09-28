'use client';

import type { ReactNode } from 'react';
import { MiniPlayer } from '@/components/player/mini-player';
import { NowPlayingSheet } from '@/components/player/now-playing';
import { PlayerBar } from '@/components/player/player-bar';
import { cn } from '@/lib/cn';
import { usePlayer } from '@/lib/player/instance';
import { useUi } from '@/lib/ui-store';
import { MobileTabBar } from './mobile-tab-bar';
import { RightPanel } from './right-panel';
import { Sidebar } from './sidebar';
import { TopBar } from './top-bar';

/**
 * Layout: sidebar | page | optional panel, over the player bar (desktop and tablet); page over
 * mini-player and tab bar (phone). The page scrolls with the window; the rest is fixed.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const panelOpen = useUi((s) => s.panel !== null);
  const hasTrack = usePlayer((s) => s.queue.current !== null);
  return (
    <div
      data-collapsed={collapsed || undefined}
      data-panel={panelOpen || undefined}
      className="min-h-dvh [--panel-w:0px] [--sidebar-w:0px] md:[--sidebar-w:5rem] lg:[--sidebar-w:18rem] lg:data-collapsed:[--sidebar-w:5rem] lg:data-panel:[--panel-w:21rem]"
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-full focus:bg-fg focus:px-4 focus:py-2 focus:text-bg"
      >
        Skip to content
      </a>
      <Sidebar />
      <main
        id="main"
        className={cn(
          'min-h-dvh pr-[var(--panel-w)] pl-[var(--sidebar-w)] md:pb-[var(--player-h)]',
          hasTrack
            ? 'pb-[calc(var(--tabbar-h)+var(--mini-h)+var(--safe-b))]'
            : 'pb-[calc(var(--tabbar-h)+var(--safe-b))]',
        )}
      >
        <TopBar />
        {children}
      </main>
      <RightPanel />
      <PlayerBar />
      <MiniPlayer />
      <MobileTabBar />
      <NowPlayingSheet />
    </div>
  );
}
