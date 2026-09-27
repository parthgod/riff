import type { SourceId, Track } from '@riff/core';

/** Round-robin merge that preserves each list's own order. */
export function interleave<T>(lists: readonly (readonly T[])[]): T[] {
  const result: T[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      if (i < list.length) result.push(list[i] as T);
    }
  }
  return result;
}

const BRACKETED_FEATURE = /[([]\s*(?:feat|ft)\.?\s[^)\]]*[)\]]/g;
const TRAILING_FEATURE = /\s(?:feat|ft)\.?\s.*$/;

/** Lowercase, accent-free, punctuation-free text with feature credits removed. */
export function normalizeForMatch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(BRACKETED_FEATURE, ' ')
    .replace(TRAILING_FEATURE, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function dedupeKey(track: Track): string {
  return `${normalizeForMatch(track.artists[0]?.name ?? '')}|${normalizeForMatch(track.title)}`;
}

/**
 * Removes repeated ids and tracks that an earlier track from a *different* source
 * already covers. Same-source near-duplicates (e.g. remixes) are kept.
 */
export function dedupeAcrossSources(tracks: readonly Track[]): Track[] {
  const seenIds = new Set<string>();
  const sourceByKey = new Map<string, SourceId>();
  const result: Track[] = [];
  for (const track of tracks) {
    if (seenIds.has(track.id)) continue;
    const key = dedupeKey(track);
    const firstSource = sourceByKey.get(key);
    if (firstSource && firstSource !== track.source) continue;
    seenIds.add(track.id);
    sourceByKey.set(key, track.source);
    result.push(track);
  }
  return result;
}
