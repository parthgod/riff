'use client';

import { type TrendingWindow, TrendingWindowSchema } from '@riff/core';
import { TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { SourceNotice } from '@/components/media/source-notice';
import { EmptyState, ErrorState } from '@/components/states/page-state';
import { TrackList, TrackListSkeleton } from '@/components/tracks/track-list';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTrending } from '@/lib/queries/catalog';
import { useRouteParam } from '@/lib/route-param';

const WINDOWS: { value: TrendingWindow; label: string }[] = [
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'allTime', label: 'All time' },
];

export default function GenrePage() {
  const genre = useRouteParam('genre');
  const [period, setPeriod] = useState<TrendingWindow>('week');
  const trending = useTrending(genre, period);
  return (
    <div className="flex flex-col gap-6 pt-4 pb-10">
      <div className="flex flex-col gap-4 px-4 md:px-8">
        <p className="font-medium text-muted text-sm">Trending</p>
        <h1 className="font-bold text-4xl tracking-tight md:text-6xl">{genre}</h1>
        <Tabs
          value={period}
          onValueChange={(value) => setPeriod(TrendingWindowSchema.parse(value))}
        >
          <TabsList aria-label="Period">
            {WINDOWS.map(({ value, label }) => (
              <TabsTrigger key={value} value={value}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <section className="px-2 md:px-6">
        {trending.isPending ? (
          <TrackListSkeleton />
        ) : trending.isError ? (
          <ErrorState error={trending.error} onRetry={() => trending.refetch()} />
        ) : trending.data.tracks.length === 0 ? (
          <EmptyState icon={TrendingUp} title={`Nothing trending in ${genre} right now`}>
            Try another period or genre.
          </EmptyState>
        ) : (
          <>
            <SourceNotice sources={trending.data.sources} />
            <TrackList
              tracks={trending.data.tracks}
              context={{ type: 'trending', id: genre, name: `Trending in ${genre}` }}
              showAlbum
            />
          </>
        )}
      </section>
    </div>
  );
}
