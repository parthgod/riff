'use client';

import type { SourceId, Track } from '@riff/core';
import { ChevronDown, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { Artwork, pickArtwork } from '@/components/media/artwork';
import { LikeButton } from '@/components/tracks/like-button';
import { Button } from '@/components/ui/button';
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Rgb } from '@/lib/color';
import { usePlayer } from '@/lib/player/instance';
import { ui, useUi } from '@/lib/ui-store';
import { useDominantColor } from '@/lib/use-dominant-color';
import { LyricsPanel } from './lyrics-panel';
import { QueuePanel } from './queue-panel';
import { SeekBar } from './seek-bar';
import { Transport } from './transport';

export const SOURCE_NAMES: Record<SourceId, string> = {
  audius: 'Audius',
  jamendo: 'Jamendo',
  radio: 'Radio Browser',
};

/** A top-down wash of the artwork's colour, fading into the page. */
export const backdrop = (color: Rgb | null) =>
  color
    ? { backgroundImage: `linear-gradient(to bottom, rgb(${color.join(' ')}) 0%, transparent 75%)` }
    : undefined;

function Credits({ track }: { track: Track }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-semibold text-xl tracking-tight">{track.title}</p>
      <p className="truncate text-muted">
        {track.artists.length === 0
          ? 'Live radio'
          : track.artists.map((artist, index) => (
              <span key={artist.id}>
                {index > 0 && ', '}
                <Link href={`/artist/${artist.id}`} className="hover:text-fg hover:underline">
                  {artist.name}
                </Link>
              </span>
            ))}
      </p>
    </div>
  );
}

function Attribution({ track }: { track: Track }) {
  return (
    <div className="flex flex-col gap-2 text-muted text-sm">
      {track.album && (
        <p className="truncate">
          From{' '}
          <Link href={`/collection/${track.album.id}`} className="text-fg hover:underline">
            {track.album.title}
          </Link>
        </p>
      )}
      {track.permalink && (
        <a
          href={track.permalink}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 hover:text-fg"
        >
          Open on {SOURCE_NAMES[track.source]} <ExternalLink className="size-3.5" />
        </a>
      )}
    </div>
  );
}

/** The right panel's Now Playing tab. */
export function NowPlayingPanel() {
  const track = usePlayer((s) => s.queue.current?.track ?? null);
  const color = useDominantColor(track ? pickArtwork(track.artwork, 'sm') : undefined);
  if (!track) {
    return <p className="py-8 text-center text-muted text-sm">Nothing is playing.</p>;
  }
  return (
    <div className="-mx-4 flex flex-col gap-5 px-4 pt-4 pb-6" style={backdrop(color)}>
      <Artwork
        artwork={track.artwork}
        size="lg"
        className="w-full rounded-xl shadow-2xl shadow-black/50"
      />
      <div className="flex items-start justify-between gap-3">
        <Credits track={track} />
        <LikeButton track={track} className="mt-1 shrink-0" />
      </div>
      <Attribution track={track} />
    </div>
  );
}

/** The phone's full-screen player: artwork, controls, lyrics and the queue. */
export function NowPlayingSheet() {
  const open = useUi((s) => s.nowPlayingOpen);
  const track = usePlayer((s) => s.queue.current?.track ?? null);
  const contextName = usePlayer((s) => s.queue.context?.name ?? null);
  const color = useDominantColor(track ? pickArtwork(track.artwork, 'sm') : undefined);
  return (
    <Sheet open={open && track !== null} onOpenChange={ui.setNowPlayingOpen}>
      <SheetContent aria-describedby={undefined} style={backdrop(color)}>
        <header className="flex items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <SheetClose asChild>
            <Button variant="ghost" size="icon" aria-label="Close Now Playing">
              <ChevronDown />
            </Button>
          </SheetClose>
          <SheetTitle className="flex-1 truncate text-center font-medium text-muted text-sm">
            {contextName ?? 'Now playing'}
          </SheetTitle>
          <span className="size-10" aria-hidden />
        </header>
        {track && (
          <div className="flex flex-col gap-6 px-6 pt-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
            <Artwork
              artwork={track.artwork}
              size="lg"
              className="mx-auto w-full max-w-sm rounded-xl shadow-2xl shadow-black/50"
            />
            <div className="flex items-center justify-between gap-3">
              <Credits track={track} />
              <LikeButton track={track} className="shrink-0" />
            </div>
            <SeekBar />
            <Transport large />
            <Tabs defaultValue="lyrics" className="flex flex-col gap-2 rounded-2xl bg-black/20 p-3">
              <TabsList aria-label="More about this track">
                <TabsTrigger value="lyrics">Lyrics</TabsTrigger>
                <TabsTrigger value="queue">Queue</TabsTrigger>
              </TabsList>
              <TabsContent value="lyrics">
                <LyricsPanel className="h-[55dvh] px-1" />
              </TabsContent>
              <TabsContent value="queue" className="max-h-[55dvh] overflow-y-auto">
                <QueuePanel />
              </TabsContent>
            </Tabs>
            <Attribution track={track} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
