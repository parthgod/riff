'use client';

import type { QueueContext, Track } from '@riff/core';
import { Heart } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useMemo } from 'react';
import { LikedCover } from '@/components/media/covers';
import { PageHeader } from '@/components/media/page-header';
import { EmptyState, ErrorState } from '@/components/states/page-state';
import { PlayContextButton } from '@/components/tracks/play-context-button';
import { TrackList, TrackListSkeleton } from '@/components/tracks/track-list';
import { Button } from '@/components/ui/button';
import { useLikedIds, useLikes } from '@/lib/queries/library';

const CONTEXT: QueueContext = { type: 'liked', name: 'Liked Songs' };

export default function LikedPage() {
  const likes = useLikes();
  const count = useLikedIds().size;
  const tracks = useMemo(
    () => likes.data?.pages.flatMap((page) => page.items.map((item) => item.track)) ?? [],
    [likes.data],
  );

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = likes;
  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  /** Every liked track, fetching the remaining pages first, so "play" covers them all. */
  const loadAll = useCallback(async (): Promise<Track[]> => {
    let result: Pick<typeof likes, 'data' | 'error' | 'hasNextPage' | 'fetchNextPage'> = likes;
    while (result.hasNextPage) {
      result = await result.fetchNextPage();
      // A failed page resolves (it doesn't reject) and keeps hasNextPage set: stop here.
      if (result.error) throw result.error;
    }
    return result.data?.pages.flatMap((page) => page.items.map((item) => item.track)) ?? [];
  }, [likes]);

  return (
    <>
      <PageHeader
        kind="Playlist"
        title="Liked Songs"
        cover={<LikedCover className="w-full" />}
        meta={`${count} ${count === 1 ? 'song' : 'songs'}`}
      >
        <PlayContextButton tracks={tracks} context={CONTEXT} loadAll={loadAll} />
      </PageHeader>
      <section className="px-2 md:px-6">
        {likes.isPending ? (
          <TrackListSkeleton />
        ) : likes.isError ? (
          <ErrorState error={likes.error} onRetry={() => likes.refetch()} />
        ) : tracks.length === 0 ? (
          <EmptyState
            icon={Heart}
            title="Songs you like will appear here"
            action={
              <Button asChild variant="primary">
                <Link href="/search">Find something to like</Link>
              </Button>
            }
          >
            Tap the heart on any track to save it.
          </EmptyState>
        ) : (
          <TrackList tracks={tracks} context={CONTEXT} showAlbum onEndReached={onEndReached} />
        )}
      </section>
    </>
  );
}
