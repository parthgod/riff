import type { SourceId } from '@riff/core';
import { SOURCE_NAMES } from '@/components/player/now-playing';

type SourceStatus = 'ok' | 'error' | 'timeout' | 'disabled';

/** A quiet line naming sources that failed or timed out; results from the others still show. */
export function SourceNotice({ sources }: { sources: Partial<Record<SourceId, SourceStatus>> }) {
  const down = (Object.entries(sources) as [SourceId, SourceStatus][])
    .filter(([, status]) => status === 'error' || status === 'timeout')
    .map(([source]) => SOURCE_NAMES[source]);
  if (down.length === 0) return null;
  return (
    <p role="status" className="px-4 text-faint text-xs md:px-8">
      {down.join(' and ')} {down.length === 1 ? 'is' : 'are'} unavailable right now, so some results
      may be missing.
    </p>
  );
}
