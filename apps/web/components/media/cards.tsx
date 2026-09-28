'use client';

import type { Artist, Collection, QueueContext, Track } from '@riff/core';
import { BadgeCheck, Pause, Play } from 'lucide-react';
import Link from 'next/link';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/cn';
import { artistNames } from '@/lib/format';
import { player, usePlayer } from '@/lib/player/instance';
import { Artwork } from './artwork';

const CARD =
  'group relative flex shrink-0 snap-start flex-col gap-2 rounded-xl p-2 hover:bg-raised';
/** Shelf cards have a fixed width; grid cards fill their cell. */
const WIDTH = { shelf: 'w-36 md:w-44', grid: 'w-full min-w-0' } as const;

/** A track in a shelf. The whole card plays `tracks` from this one (a stretched button). */
export function TrackCard({
  tracks,
  index,
  context,
  layout = 'shelf',
}: {
  tracks: readonly Track[];
  index: number;
  context: QueueContext;
  layout?: keyof typeof WIDTH;
}) {
  const track = tracks[index] as Track;
  const { isCurrent, active } = usePlayer(
    useShallow((s) => ({
      isCurrent: s.queue.current?.track.id === track.id,
      active: s.status === 'playing' || s.status === 'loading',
    })),
  );
  const pausing = isCurrent && active;
  return (
    <li className={cn(CARD, WIDTH[layout])}>
      <div className="relative">
        <Artwork
          artwork={track.artwork}
          size="md"
          // Station logos are small favicons: fit them inside the tile rather than crop.
          className={cn('w-full rounded-md', track.isLive && 'object-contain p-5')}
        />
        <span
          aria-hidden
          className={cn(
            'absolute right-2 bottom-2 grid size-11 place-items-center rounded-full bg-accent text-on-accent shadow-black/40 shadow-lg transition-[opacity,transform] motion-safe:translate-y-1 group-hover:translate-y-0 group-hover:opacity-100',
            pausing ? 'translate-y-0 opacity-100' : 'opacity-0',
          )}
        >
          {pausing ? (
            <Pause className="size-5 fill-current" />
          ) : (
            <Play className="size-5 translate-x-px fill-current" />
          )}
        </span>
      </div>
      <button
        type="button"
        onClick={() =>
          isCurrent
            ? player.actions.togglePlay()
            : player.actions.playContext(tracks, index, context)
        }
        aria-label={pausing ? `Pause ${track.title}` : `Play ${track.title}`}
        className={cn(
          'truncate text-left font-medium text-sm outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:outline-2 focus-visible:after:outline-accent',
          isCurrent && 'text-accent',
        )}
      >
        {track.title}
      </button>
      <p className="-mt-1.5 truncate text-muted text-xs">
        {track.isLive ? (track.genre ?? 'Live radio') : artistNames(track.artists)}
      </p>
    </li>
  );
}

export function ArtistCard({ artist }: { artist: Artist }) {
  return (
    <li className={cn(CARD, WIDTH.shelf)}>
      <Artwork artwork={artist.avatar} size="md" className="w-full rounded-full" />
      <Link
        href={`/artist/${artist.id}`}
        className="flex items-center gap-1 truncate font-medium text-sm outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:outline-2 focus-visible:after:outline-accent"
      >
        <span className="truncate">{artist.name}</span>
        {artist.verified && (
          <BadgeCheck className="size-4 shrink-0 text-accent" aria-label="Verified" />
        )}
      </Link>
      <p className="-mt-1.5 text-muted text-xs">Artist</p>
    </li>
  );
}

export function CollectionCard({ collection }: { collection: Collection }) {
  return (
    <li className={cn(CARD, WIDTH.shelf)}>
      <Artwork artwork={collection.artwork} size="md" className="w-full rounded-md" />
      <Link
        href={`/collection/${collection.id}`}
        className="truncate font-medium text-sm outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:outline-2 focus-visible:after:outline-accent"
      >
        {collection.title}
      </Link>
      <p className="-mt-1.5 truncate text-muted text-xs">
        {collection.kind === 'album' ? 'Album' : 'Playlist'} · {collection.owner.name}
      </p>
    </li>
  );
}
