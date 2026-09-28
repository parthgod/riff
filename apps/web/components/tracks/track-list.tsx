'use client';

import type { QueueContext, Track } from '@riff/core';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { Clock3, MoreHorizontal, Pause, Play } from 'lucide-react';
import Link from 'next/link';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Artwork } from '@/components/media/artwork';
import { LiveBadge } from '@/components/player/seek-bar';
import { Button } from '@/components/ui/button';
import {
  ContextMenuContent,
  ContextMenuRoot,
  ContextMenuTrigger,
  Menu,
  MenuContent,
  MenuTrigger,
} from '@/components/ui/menu';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import { player, usePlayer } from '@/lib/player/instance';
import { Equalizer } from './equalizer';
import { LikeButton } from './like-button';
import { contextKit, dropdownKit, TrackMenuItems } from './track-menu';

export const ROW_HEIGHT = 56;

/** The playing track's id, and whether audio is (about to be) playing. */
export function useNowPlaying() {
  return usePlayer(
    useShallow((s) => ({
      currentId: s.queue.current?.track.id ?? null,
      playing: s.status === 'playing' || s.status === 'loading',
    })),
  );
}

export interface TrackListProps {
  tracks: readonly Track[];
  /** What the queue plays from when a row is played. */
  context: QueueContext;
  /** Stable row keys, e.g. playlist entry ids (the same track can appear twice). */
  rowKeys?: readonly string[];
  showAlbum?: boolean;
  /** Called with a row index to offer "Remove from this playlist". */
  onRemove?: (index: number) => void;
  /** Called when the last rows come into view (to load the next page). */
  onEndReached?: () => void;
}

export const COLUMNS =
  'grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[2.5rem_minmax(0,1fr)_auto_3.5rem_2.5rem]';
const COLUMNS_WITH_ALBUM =
  'grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[2.5rem_minmax(0,1.4fr)_minmax(0,1fr)_auto_3.5rem_2.5rem]';

/** A virtualised list of tracks that scrolls with the page. */
export function TrackList({
  tracks,
  context,
  rowKeys,
  showAlbum = false,
  onRemove,
  onEndReached,
}: TrackListProps) {
  const listRef = useRef<HTMLOListElement>(null);
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => {
    setOffset(listRef.current ? listRef.current.getBoundingClientRect().top + window.scrollY : 0);
  }, []);

  const virtualizer = useWindowVirtualizer({
    count: tracks.length,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    scrollMargin: offset,
  });
  const items = virtualizer.getVirtualItems();
  const lastIndex = items.at(-1)?.index ?? -1;

  useEffect(() => {
    if (onEndReached && lastIndex >= tracks.length - 5 && tracks.length > 0) onEndReached();
  }, [lastIndex, tracks.length, onEndReached]);

  const { currentId, playing } = useNowPlaying();
  // Most Audius tracks have no album; keep the column only when it has something to show.
  const albumColumn = showAlbum && tracks.some((track) => track.album);
  const columns = albumColumn ? COLUMNS_WITH_ALBUM : COLUMNS;

  return (
    <div>
      <div
        aria-hidden
        className={cn(
          'hidden items-center gap-3 border-line border-b px-3 pb-2 text-faint text-xs md:grid',
          columns,
        )}
      >
        <span className="text-right">#</span>
        <span>Title</span>
        {albumColumn && <span>Album</span>}
        <span />
        <span className="flex justify-end">
          <Clock3 className="size-4" />
        </span>
        <span />
      </div>
      <ol
        ref={listRef}
        aria-label={context.name}
        className="relative mt-2"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {items.map((item) => {
          const track = tracks[item.index] as Track;
          return (
            <li
              key={rowKeys?.[item.index] ?? `${track.id}-${item.index}`}
              aria-posinset={item.index + 1}
              aria-setsize={tracks.length}
              aria-current={track.id === currentId ? 'true' : undefined}
              className="absolute inset-x-0 top-0"
              style={{
                transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
              }}
            >
              <TrackRow
                track={track}
                index={item.index}
                columns={columns}
                showAlbum={albumColumn}
                isCurrent={track.id === currentId}
                playing={playing}
                onPlay={() => {
                  if (track.id === currentId) player.actions.togglePlay();
                  else player.actions.playContext(tracks, item.index, context);
                }}
                onRemove={onRemove ? () => onRemove(item.index) : undefined}
              />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export interface TrackRowProps {
  track: Track;
  index: number;
  columns: string;
  showAlbum: boolean;
  isCurrent: boolean;
  playing: boolean;
  onPlay: () => void;
  onRemove?: () => void;
}

export const TrackRow = memo(function TrackRow({
  track,
  index,
  columns,
  showAlbum,
  isCurrent,
  playing,
  onPlay,
  onRemove,
}: TrackRowProps) {
  const active = isCurrent && playing;
  return (
    <ContextMenuRoot>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            'group relative grid h-14 items-center gap-3 rounded-lg px-3 hover:bg-raised has-focus-visible:bg-raised',
            columns,
          )}
        >
          <span className="relative hidden h-full items-center justify-end md:flex">
            <span
              className={cn(
                'text-faint text-sm tabular-nums group-hover:opacity-0',
                isCurrent && 'opacity-0',
              )}
            >
              {index + 1}
            </span>
            {isCurrent && (
              <Equalizer playing={active} className="absolute right-1 group-hover:opacity-0" />
            )}
            <span
              aria-hidden
              className="absolute right-0 opacity-0 transition-opacity group-hover:opacity-100"
            >
              {active ? (
                <Pause className="size-4 fill-current" />
              ) : (
                <Play className="size-4 fill-current" />
              )}
            </span>
          </span>
          <span className="flex min-w-0 items-center gap-3">
            <Artwork artwork={track.artwork} size="sm" className="size-10 shrink-0 rounded" />
            <span className="min-w-0">
              {/* Stretched button: its ::after covers the row, so a click anywhere plays. */}
              <button
                type="button"
                onClick={onPlay}
                aria-label={active ? `Pause ${track.title}` : `Play ${track.title}`}
                className={cn(
                  'block max-w-full truncate text-left text-sm outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:outline-2 focus-visible:after:outline-accent',
                  isCurrent && 'text-accent',
                )}
              >
                {track.title}
              </button>
              <span className="relative block truncate text-muted text-xs">
                {track.isLive ? (
                  <LiveBadge className="px-1.5 py-0 text-[10px]" />
                ) : (
                  track.artists.map((artist, i) => (
                    <span key={artist.id}>
                      {i > 0 && ', '}
                      <Link href={`/artist/${artist.id}`} className="hover:text-fg hover:underline">
                        {artist.name}
                      </Link>
                    </span>
                  ))
                )}
              </span>
            </span>
          </span>
          {showAlbum && (
            <span className="relative hidden min-w-0 truncate text-muted text-sm md:block">
              {track.album ? (
                <Link
                  href={`/collection/${track.album.id}`}
                  className="hover:text-fg hover:underline"
                >
                  {track.album.title}
                </Link>
              ) : null}
            </span>
          )}
          <span className="relative hidden md:block">
            <LikeButton
              track={track}
              className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 aria-pressed:opacity-100"
            />
          </span>
          <span className="hidden text-right text-faint text-sm tabular-nums md:block">
            {track.isLive ? '' : formatDuration(track.durationSec)}
          </span>
          <span className="relative flex justify-end">
            <Menu>
              <MenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`More options for ${track.title}`}
                  className="md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100 md:data-[state=open]:opacity-100"
                >
                  <MoreHorizontal />
                </Button>
              </MenuTrigger>
              <MenuContent align="end">
                <TrackMenuItems track={track} onRemove={onRemove} kit={dropdownKit} />
              </MenuContent>
            </Menu>
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <TrackMenuItems track={track} onRemove={onRemove} kit={contextKit} />
      </ContextMenuContent>
    </ContextMenuRoot>
  );
});

export function TrackListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading tracks" className="mt-2 flex flex-col">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-14 items-center gap-3 px-3">
          <Skeleton className="size-10 rounded" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-1/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
