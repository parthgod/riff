'use client';

import Link from 'next/link';
import { Artwork } from '@/components/media/artwork';
import { LikeButton } from '@/components/tracks/like-button';
import { usePlayer } from '@/lib/player/instance';

/** Artwork, title, linked artists and the like button for the current track. */
export function NowPlayingInfo() {
  const track = usePlayer((s) => s.queue.current?.track ?? null);
  if (!track) {
    return <p className="truncate text-faint text-sm">Pick something to play</p>;
  }
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Artwork artwork={track.artwork} size="sm" className="size-14 shrink-0 rounded-md" />
      <div className="min-w-0">
        <p className="truncate font-medium text-sm">{track.title}</p>
        <p className="truncate text-muted text-xs">
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
      <LikeButton track={track} className="shrink-0" />
    </div>
  );
}
