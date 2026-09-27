import { type Lyrics, parseLrc } from '@riff/core';
import type { CallOptions } from '../adapter';
import type { HttpClient } from '../http';

export interface LyricsQuery {
  title: string;
  artist: string;
  album?: string;
  durationSec?: number | null;
}

export interface LyricsClient {
  getLyrics(query: LyricsQuery, options?: CallOptions): Promise<Lyrics | null>;
}

export interface LrclibRecord {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

const DURATION_TOLERANCE_SEC = 3;
const NOISE =
  /\s*[([][^)\]]*\b(?:feat|ft|prod|official|video|audio|lyrics?|visuali[sz]er|remaster(?:ed)?|original mix)\b[^)\]]*[)\]]/gi;
const TRAILING_FEATURE = /\s+(?:feat|ft)\.?\s.*$/i;

/** Makes source titles like "Artist - Song (Official Video)" searchable. */
export function cleanTitle(title: string, artist: string): string {
  let result = title;
  const prefix = `${artist} - `.toLowerCase();
  if (artist && result.toLowerCase().startsWith(prefix)) result = result.slice(prefix.length);
  result = result.replace(NOISE, '').replace(TRAILING_FEATURE, '').replace(/\s+/g, ' ').trim();
  return result || title;
}

export function toLyrics(record: LrclibRecord): Lyrics | null {
  const synced = record.syncedLyrics ? parseLrc(record.syncedLyrics) : [];
  const plain = record.plainLyrics?.trim() || null;
  if (synced.length === 0 && !plain && !record.instrumental) return null;
  return { synced: synced.length > 0 ? synced : null, plain, instrumental: record.instrumental };
}

export function pickBest(
  candidates: readonly LrclibRecord[],
  durationSec?: number | null,
): LrclibRecord | null {
  const pool = durationSec
    ? candidates.filter((c) => Math.abs(c.duration - durationSec) <= DURATION_TOLERANCE_SEC)
    : candidates;
  return (
    pool.find((c) => c.syncedLyrics) ?? pool.find((c) => c.plainLyrics || c.instrumental) ?? null
  );
}

export function createLrclibClient({
  http,
  baseUrl = 'https://lrclib.net',
}: {
  http: HttpClient;
  baseUrl?: string;
}): LyricsClient {
  const endpoint = (path: string, params: Record<string, string | undefined>): string => {
    const url = new URL(path, baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, value);
    }
    return url.toString();
  };

  return {
    async getLyrics(query, options) {
      const signal = options?.signal;
      const duration = query.durationSec ? String(Math.round(query.durationSec)) : undefined;

      const exact = await http.getJson<LrclibRecord>(
        endpoint('/api/get', {
          track_name: query.title,
          artist_name: query.artist,
          album_name: query.album,
          duration,
        }),
        { upstream: 'lrclib', signal },
      );
      const fromExact = exact ? toLyrics(exact) : null;
      if (fromExact) return fromExact;

      const candidates =
        (await http.getJson<LrclibRecord[]>(
          endpoint('/api/search', {
            track_name: cleanTitle(query.title, query.artist),
            artist_name: query.artist,
          }),
          { upstream: 'lrclib', signal },
        )) ?? [];
      const best = pickBest(candidates, query.durationSec);
      return best ? toLyrics(best) : null;
    },
  };
}
