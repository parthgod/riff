import type { PlaylistSummary } from '@riff/api';
import { Heart, ListMusic } from 'lucide-react';
import { cn } from '@/lib/cn';

/** The Liked Songs tile. */
export function LikedCover({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'grid aspect-square place-items-center rounded-md bg-linear-to-br from-accent to-[oklch(0.45_0.14_25)]',
        className,
      )}
    >
      <Heart className="size-2/5 fill-on-accent text-on-accent" aria-hidden />
    </div>
  );
}

/** A playlist's cover: its own image, else a 2×2 mosaic of its first artworks. */
export function PlaylistCover({
  playlist,
  className,
}: {
  playlist: Pick<PlaylistSummary, 'coverUrl' | 'covers'>;
  className?: string;
}) {
  const base = cn('aspect-square overflow-hidden rounded-md bg-raised', className);
  const images = playlist.coverUrl ? [playlist.coverUrl] : playlist.covers;
  if (images.length === 0) {
    return (
      <div className={cn(base, 'grid place-items-center text-faint')}>
        <ListMusic className="size-2/5" aria-hidden />
      </div>
    );
  }
  const tiles = images.length >= 4 ? images.slice(0, 4) : images.slice(0, 1);
  return (
    <div className={cn(base, tiles.length === 4 && 'grid grid-cols-2')}>
      {tiles.map((src, index) => (
        <img
          // Covers can repeat when a playlist holds the same track twice.
          key={index}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
      ))}
    </div>
  );
}
