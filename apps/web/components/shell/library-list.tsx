'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Artwork } from '@/components/media/artwork';
import { LikedCover, PlaylistCover } from '@/components/media/covers';
import { cn } from '@/lib/cn';
import { useFollowing, useLikedIds } from '@/lib/queries/library';
import { usePlaylists } from '@/lib/queries/playlists';

function LibraryLink({
  href,
  cover,
  title,
  subtitle,
  compact,
}: {
  href: string;
  cover: ReactNode;
  title: string;
  subtitle: string;
  compact: boolean;
}) {
  const active = usePathname() === href;
  return (
    <li>
      <Link
        href={href}
        title={compact ? title : undefined}
        aria-label={compact ? title : undefined}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex items-center gap-3 rounded-lg p-1.5 hover:bg-raised',
          active && 'bg-raised',
          compact && 'justify-center',
        )}
      >
        <span className="size-11 shrink-0">{cover}</span>
        {!compact && (
          <span className="min-w-0">
            <span className={cn('block truncate text-sm', active && 'text-accent')}>{title}</span>
            <span className="block truncate text-muted text-xs">{subtitle}</span>
          </span>
        )}
      </Link>
    </li>
  );
}

/** Liked Songs, the user's playlists and followed artists. */
export function LibraryList({ compact = false }: { compact?: boolean }) {
  const liked = useLikedIds();
  const playlists = usePlaylists();
  const following = useFollowing();
  return (
    <ul aria-label="Your library" className="flex flex-col gap-0.5">
      <LibraryLink
        href="/liked"
        cover={<LikedCover className="size-11" />}
        title="Liked Songs"
        subtitle={`Playlist · ${liked.size} ${liked.size === 1 ? 'song' : 'songs'}`}
        compact={compact}
      />
      {playlists.data?.map((playlist) => (
        <LibraryLink
          key={playlist.id}
          href={`/playlist/${playlist.id}`}
          cover={<PlaylistCover playlist={playlist} className="size-11" />}
          title={playlist.name}
          subtitle={`Playlist · ${playlist.trackCount} ${playlist.trackCount === 1 ? 'track' : 'tracks'}`}
          compact={compact}
        />
      ))}
      {following.data?.map((artist) => (
        <LibraryLink
          key={artist.id}
          href={`/artist/${artist.id}`}
          cover={<Artwork artwork={artist.avatar} size="sm" className="size-11 rounded-full" />}
          title={artist.name}
          subtitle="Artist"
          compact={compact}
        />
      ))}
    </ul>
  );
}
