'use client';

import { X } from 'lucide-react';
import { LyricsPanel } from '@/components/player/lyrics-panel';
import { NowPlayingPanel } from '@/components/player/now-playing';
import { QueuePanel } from '@/components/player/queue-panel';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type PanelTab, ui, useUi } from '@/lib/ui-store';

/**
 * Queue, lyrics and Now Playing. Beside the page on desktop; over it on tablets, where the
 * page has no room to give up.
 */
export function RightPanel() {
  const panel = useUi((s) => s.panel);
  if (!panel) return null;
  return (
    <aside
      aria-label="Player panel"
      className="fixed top-0 right-0 bottom-[var(--player-h)] z-20 hidden w-[21rem] flex-col border-line border-l bg-surface shadow-2xl shadow-black/40 md:flex lg:shadow-none"
    >
      <Tabs
        value={panel}
        onValueChange={(tab) => ui.showPanel(tab as PanelTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex h-14 shrink-0 items-center gap-2 border-line border-b px-3">
          <TabsList aria-label="Panel" className="flex-1">
            <TabsTrigger value="queue">Queue</TabsTrigger>
            <TabsTrigger value="lyrics">Lyrics</TabsTrigger>
            <TabsTrigger value="nowPlaying">Now playing</TabsTrigger>
          </TabsList>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close panel"
            onClick={() => ui.showPanel(null)}
          >
            <X />
          </Button>
        </div>
        <TabsContent value="queue" className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          <QueuePanel />
        </TabsContent>
        <TabsContent value="lyrics" className="min-h-0 flex-1 px-4">
          <LyricsPanel className="h-full" />
        </TabsContent>
        <TabsContent value="nowPlaying" className="min-h-0 flex-1 overflow-y-auto px-4">
          <NowPlayingPanel />
        </TabsContent>
      </Tabs>
    </aside>
  );
}
