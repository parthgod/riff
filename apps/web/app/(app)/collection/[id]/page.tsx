'use client';

import { Music } from 'lucide-react';
import Link from 'next/link';
import { Artwork, pickArtwork } from '@/components/media/artwork';
import { PageHeader, PageHeaderSkeleton } from '@/components/media/page-header';
import { EmptyState, ErrorState } from '@/components/states/page-state';
import { PlayContextButton } from '@/components/tracks/play-context-button';
import { TrackList } from '@/components/tracks/track-list';
import { formatDuration } from '@/lib/format';
import { useCollection } from '@/lib/queries/catalog';
import { useRouteParam } from '@/lib/route-param';

export default function CollectionPage() {
  const id = useRouteParam('id');
  const collection = useCollection(id);

  if (collection.isPending) return <PageHeaderSkeleton />;
  if (collection.isError) {
    return <ErrorState error={collection.error} onRetry={() => collection.refetch()} />;
  }

  const data = collection.data;
  const tracks = data.tracks ?? [];
  const total = tracks.reduce((sum, track) => sum + (track.durationSec ?? 0), 0);
  const context = { type: 'collection' as const, id: data.id, name: data.title };

  return (
    <div className="flex flex-col gap-6 pb-10">
      <PageHeader
        kind={data.kind === 'album' ? 'Album' : 'Playlist'}
        title={data.title}
        cover={<Artwork artwork={data.artwork} size="lg" className="w-full rounded-md" />}
        tintFrom={pickArtwork(data.artwork, 'sm')}
        meta={
          <>
            <Link href={`/artist/${data.owner.id}`} className="font-medium text-fg hover:underline">
              {data.owner.name}
            </Link>
            {` · ${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'}, ${formatDuration(total)}`}
          </>
        }
      >
        <PlayContextButton tracks={tracks} context={context} />
      </PageHeader>
      {data.description && (
        <p className="max-w-3xl whitespace-pre-line break-words px-4 text-muted text-sm md:px-8">
          {data.description}
        </p>
      )}
      <section className="px-2 md:px-6">
        {tracks.length === 0 ? (
          <EmptyState icon={Music} title="Nothing playable here">
            The tracks in this {data.kind} can’t be streamed.
          </EmptyState>
        ) : (
          <TrackList tracks={tracks} context={context} />
        )}
      </section>
    </div>
  );
}
