'use client';

import type { QueueContext, Track } from '@riff/core';
import { TrackCard } from '@/components/media/cards';
import { genreHref } from '@/components/media/genre-grid';
import { Shelf, ShelfSkeleton } from '@/components/media/shelf';
import { ErrorState } from '@/components/states/page-state';
import { useHome } from '@/lib/queries/library';

function TrackShelf({
  title,
  tracks,
  context,
  href,
}: {
  title: string;
  tracks: readonly Track[];
  context: QueueContext;
  href?: string;
}) {
  if (tracks.length === 0) return null;
  return (
    <Shelf title={title} href={href}>
      {tracks.map((track, index) => (
        <TrackCard key={`${track.id}-${index}`} tracks={tracks} index={index} context={context} />
      ))}
    </Shelf>
  );
}

export default function HomePage() {
  const home = useHome();
  return (
    <div className="flex flex-col gap-10 pt-4 pb-10">
      <h1 className="sr-only">Home</h1>
      {home.isPending ? (
        <>
          <ShelfSkeleton />
          <ShelfSkeleton />
          <ShelfSkeleton />
        </>
      ) : home.isError ? (
        <ErrorState error={home.error} onRetry={() => home.refetch()} />
      ) : (
        <>
          <TrackShelf
            title="Recently played"
            tracks={home.data.recentlyPlayed}
            context={{ type: 'history', name: 'Recently played' }}
          />
          <TrackShelf
            title="New from artists you follow"
            tracks={home.data.fromFollowed}
            context={{ type: 'artist', name: 'New from artists you follow' }}
          />
          {home.data.topGenres.map(({ genre, tracks }) => (
            <TrackShelf
              key={genre}
              title={`Trending in ${genre}`}
              tracks={tracks}
              href={genreHref(genre)}
              context={{ type: 'trending', id: genre, name: `Trending in ${genre}` }}
            />
          ))}
          <TrackShelf
            title="Trending this week"
            tracks={home.data.trending}
            context={{ type: 'trending', name: 'Trending this week' }}
          />
        </>
      )}
    </div>
  );
}
