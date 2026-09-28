'use client';

import { SearchX } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ArtistCard, CollectionCard, TrackCard } from '@/components/media/cards';
import { GenreGrid } from '@/components/media/genre-grid';
import { Shelf } from '@/components/media/shelf';
import { SourceNotice } from '@/components/media/source-notice';
import { SearchField } from '@/components/shell/search-field';
import { EmptyState, ErrorState } from '@/components/states/page-state';
import { TrackList, TrackListSkeleton } from '@/components/tracks/track-list';
import { searchText, useSearch } from '@/lib/queries/catalog';

function Results({ q }: { q: string }) {
  const search = useSearch(q);
  if (search.isPending) return <TrackListSkeleton />;
  if (search.isError) return <ErrorState error={search.error} onRetry={() => search.refetch()} />;
  const { tracks, artists, collections, stations, sources } = search.data;
  if (tracks.length + artists.length + collections.length + stations.length === 0) {
    return (
      <>
        <SourceNotice sources={sources} />
        <EmptyState icon={SearchX} title={`No results for “${q}”`}>
          Check the spelling, or try an artist, a genre or a station name.
        </EmptyState>
      </>
    );
  }
  return (
    <div className="flex flex-col gap-10">
      <SourceNotice sources={sources} />
      {tracks.length > 0 && (
        <section className="flex flex-col gap-2 px-2 md:px-6">
          <h2 className="px-2 font-semibold text-xl tracking-tight md:px-2">Tracks</h2>
          <TrackList
            tracks={tracks}
            context={{ type: 'search', id: q, name: `Search: ${q}` }}
            showAlbum
          />
        </section>
      )}
      {artists.length > 0 && (
        <Shelf title="Artists">
          {artists.map((artist) => (
            <ArtistCard key={artist.id} artist={artist} />
          ))}
        </Shelf>
      )}
      {collections.length > 0 && (
        <Shelf title="Albums and playlists">
          {collections.map((collection) => (
            <CollectionCard key={collection.id} collection={collection} />
          ))}
        </Shelf>
      )}
      {stations.length > 0 && (
        <Shelf title="Radio stations">
          {stations.map((station, index) => (
            <TrackCard
              key={station.id}
              tracks={stations}
              index={index}
              context={{ type: 'radio', id: q, name: `Stations: ${q}` }}
            />
          ))}
        </Shelf>
      )}
    </div>
  );
}

function SearchContent() {
  const q = searchText(useSearchParams().get('q') ?? '');
  return (
    <div className="flex flex-col gap-6 pt-2 pb-10">
      <div className="px-4 md:hidden">
        <SearchField className="max-w-none" />
      </div>
      {q ? (
        <>
          <h1 className="sr-only">Search results for {q}</h1>
          <Results q={q} />
        </>
      ) : (
        <>
          <h1 className="px-4 font-semibold text-2xl tracking-tight md:px-8">Browse genres</h1>
          <GenreGrid />
        </>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchContent />
    </Suspense>
  );
}
