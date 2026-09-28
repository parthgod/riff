'use client';

import { ListMusic, type LucideIcon, MicVocal, PanelRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { type PanelTab, ui, useUi } from '@/lib/ui-store';
import { NowPlayingInfo } from './now-playing-info';
import { SeekBar } from './seek-bar';
import { Transport } from './transport';
import { VolumeControl } from './volume-control';

const PANEL_BUTTONS: { tab: PanelTab; label: string; icon: LucideIcon }[] = [
  { tab: 'nowPlaying', label: 'Now playing', icon: PanelRight },
  { tab: 'lyrics', label: 'Lyrics', icon: MicVocal },
  { tab: 'queue', label: 'Queue', icon: ListMusic },
];

/** The desktop and tablet player bar. */
export function PlayerBar() {
  const panel = useUi((s) => s.panel);
  return (
    <section
      aria-label="Player"
      className="fixed inset-x-0 bottom-0 z-30 hidden h-[var(--player-h)] grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)] items-center gap-4 border-line border-t bg-surface px-4 md:grid"
    >
      <NowPlayingInfo />
      <div className="flex flex-col items-center gap-1">
        <Transport />
        <SeekBar className="max-w-xl" />
      </div>
      <div className="flex items-center justify-end gap-1">
        {PANEL_BUTTONS.map(({ tab, label, icon: Icon }) => (
          <Button
            key={tab}
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-pressed={panel === tab}
            className={cn(panel === tab && 'text-accent hover:text-accent')}
            onClick={() => ui.togglePanel(tab)}
          >
            <Icon />
          </Button>
        ))}
        <div className="hidden lg:block">
          <VolumeControl />
        </div>
      </div>
    </section>
  );
}
