'use client';

import type { QueueContext } from '@riff/core';
import { BadgeCheck, Music } from 'lucide-react';
import { Artwork, pickArtwork } from '@/components/media/artwork';
import { ArtistCard } from '@/components/media/cards';
import { PageHeader, PageHeaderSkeleton } from '@/components/media/page-header';
import { Shelf } from '@/components/media/shelf';
import { EmptyState, ErrorState } from '@/components/states/page-state';
import { PlayContextButton } from '@/components/tracks/play-context-button';
import { TrackList, TrackListSkeleton } from '@/components/tracks/track-list';
import { Button } from '@/components/ui/button';
import { formatCount } from '@/lib/format';
import { useArtist, useArtistTracks, useRelatedArtists } from '@/lib/queries/catalog';
import { useFollowing, useToggleFollow } from '@/lib/queries/library';
import { useRouteParam } from '@/lib/route-param';

export default function ArtistPage() {
  const id = useRouteParam('id');
  const artist = useArtist(id);
  const tracks = useArtistTracks(id);
  const related = useRelatedArtists(id);
  const following = useFollowing();
  const toggleFollow = useToggleFollow();

  if (artist.isPending) return <PageHeaderSkeleton />;
  if (artist.isError) return <ErrorState error={artist.error} onRetry={() => artist.refetch()} />;

  const data = artist.data;
  const isFollowing = following.data?.some((a) => a.id === data.id) ?? false;
  const context: QueueContext = { type: 'artist', id: data.id, name: data.name };

  return (
    <div className="flex flex-col gap-8 pb-10">
      <PageHeader
        kind={
          <span className="inline-flex items-center gap-1.5">
            {data.verified && <BadgeCheck className="size-4 text-accent" aria-hidden />}
            {data.verified ? 'Verified artist' : 'Artist'}
          </span>
        }
        title={data.name}
        cover={<Artwork artwork={data.avatar} size="lg" className="w-full rounded-full" />}
        tintFrom={pickArtwork(data.avatar, 'sm')}
        meta={
          data.followerCount !== undefined
            ? `${formatCount(data.followerCount)} followers`
            : undefined
        }
      >
        <PlayContextButton tracks={tracks.data ?? []} context={context} />
        <Button
          variant="outline"
          aria-pressed={isFollowing}
          disabled={following.isPending}
          onClick={() => toggleFollow.mutate({ artist: data, follow: !isFollowing })}
        >
          {isFollowing ? 'Following' : 'Follow'}
        </Button>
      </PageHeader>
      <section className="flex flex-col gap-2 px-2 md:px-6">
        <h2 className="px-2 font-semibold text-xl tracking-tight">Popular</h2>
        {tracks.isPending ? (
          <TrackListSkeleton rows={5} />
        ) : tracks.isError ? (
          <ErrorState error={tracks.error} onRetry={() => tracks.refetch()} />
        ) : tracks.data.length === 0 ? (
          <EmptyState icon={Music} title="No playable tracks yet" />
        ) : (
          <TrackList tracks={tracks.data} context={context} showAlbum />
        )}
      </section>
      {related.data && related.data.length > 0 && (
        <Shelf title="Fans also like">
          {related.data.map((other) => (
            <ArtistCard key={other.id} artist={other} />
          ))}
        </Shelf>
      )}
      {data.bio && (
        <section className="flex max-w-3xl flex-col gap-2 px-4 md:px-8">
          <h2 className="font-semibold text-xl tracking-tight">About</h2>
          <p className="whitespace-pre-line break-words text-muted leading-relaxed">{data.bio}</p>
        </section>
      )}
    </div>
  );
}
