'use client';

import type { QueueContext, Track } from '@riff/core';
import { Radio, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { TrackCard } from '@/components/media/cards';
import { ShelfSkeleton } from '@/components/media/shelf';
import { EmptyState, ErrorState } from '@/components/states/page-state';
import { searchText, useRadioSearch, useRadioTop } from '@/lib/queries/catalog';

function StationGrid({ stations, context }: { stations: readonly Track[]; context: QueueContext }) {
  return (
    <ul className="grid grid-cols-2 gap-1 px-2 sm:grid-cols-3 md:px-6 lg:grid-cols-4 xl:grid-cols-6">
      {stations.map((station, index) => (
        <TrackCard
          key={station.id}
          tracks={stations}
          index={index}
          context={context}
          layout="grid"
        />
      ))}
    </ul>
  );
}

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export default function RadioPage() {
  const [input, setInput] = useState('');
  const q = searchText(useDebounced(input, 300));
  const top = useRadioTop();
  const results = useRadioSearch(q);
  const list = q ? results : top;

  return (
    <div className="flex flex-col gap-6 pt-4 pb-10">
      <div className="flex flex-col gap-4 px-4 md:px-8">
        <h1 className="font-bold text-4xl tracking-tight md:text-5xl">Radio</h1>
        <div className="relative max-w-md">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-faint"
            aria-hidden
          />
          <input
            type="search"
            aria-label="Search stations"
            placeholder="Search stations by name"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            className="h-11 w-full rounded-full border border-line bg-surface pr-4 pl-10 text-sm outline-none placeholder:text-faint hover:border-faint focus-visible:border-accent"
          />
        </div>
        <h2 className="font-semibold text-xl tracking-tight">
          {q ? `Stations matching “${q}”` : 'Popular stations'}
        </h2>
      </div>
      {list.isPending ? (
        <ShelfSkeleton />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState icon={Radio} title={q ? `No stations match “${q}”` : 'No stations right now'} />
      ) : (
        <StationGrid
          stations={list.data}
          context={
            q
              ? { type: 'radio', id: q, name: `Stations: ${q}` }
              : { type: 'radio', name: 'Popular stations' }
          }
        />
      )}
    </div>
  );
}
