'use client';

import { useShallow } from 'zustand/react/shallow';
import { Artwork } from '@/components/media/artwork';
import { LikeButton } from '@/components/tracks/like-button';
import { artistNames } from '@/lib/format';
import { usePlayer } from '@/lib/player/instance';
import { ui } from '@/lib/ui-store';
import { PlayButton } from './transport';

/** The phone's compact player above the tab bar; tapping it opens Now Playing. */
export function MiniPlayer() {
  const { track, progress } = usePlayer(
    useShallow((s) => ({
      track: s.queue.current?.track ?? null,
      progress: s.duration ? Math.min(s.position / s.duration, 1) : 0,
    })),
  );
  if (!track) return null;
  return (
    <div className="fixed inset-x-2 bottom-[calc(var(--tabbar-h)+var(--safe-b)+0.375rem)] z-30 flex h-[calc(var(--mini-h)-0.75rem)] items-center gap-2 overflow-hidden rounded-xl bg-raised pr-2 shadow-black/50 shadow-lg md:hidden">
      <button
        type="button"
        onClick={() => ui.setNowPlayingOpen(true)}
        aria-label={`Open Now Playing: ${track.title}`}
        className="flex min-w-0 flex-1 items-center gap-3 self-stretch pl-2 text-left"
      >
        <Artwork artwork={track.artwork} size="sm" className="size-10 shrink-0 rounded" />
        <span className="min-w-0">
          <span className="block truncate font-medium text-sm">{track.title}</span>
          <span className="block truncate text-muted text-xs">
            {artistNames(track.artists) || 'Live radio'}
          </span>
        </span>
      </button>
      <LikeButton track={track} />
      <PlayButton className="size-9" />
      <div aria-hidden className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-line">
        <div className="h-full rounded-full bg-fg" style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  );
}
