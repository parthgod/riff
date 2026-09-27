import type { SourceId, Track } from '@riff/core';
import { describe, expect, test } from 'vitest';
import { dedupeAcrossSources, interleave, normalizeForMatch } from './merge';

const t = (source: SourceId, n: number, artist: string, title: string): Track => ({
  id: `${source}:${n}`,
  source,
  title,
  artists: [{ id: `${source}:a${n}`, name: artist }],
  durationSec: 100,
  isLive: false,
  artwork: {},
});

describe('interleave', () => {
  test('round-robins lists of different lengths', () => {
    expect(interleave([[1, 2, 3], [10], [20, 21]])).toEqual([1, 10, 20, 2, 21, 3]);
    expect(interleave([])).toEqual([]);
  });
});

describe('normalizeForMatch', () => {
  test('ignores case, accents, punctuation and feature credits', () => {
    expect(normalizeForMatch('Beyoncé – Halo (feat. X)')).toBe('beyonce halo');
    expect(normalizeForMatch('HALO ft. Someone Else')).toBe('halo');
  });

  test('keeps other bracketed words such as remix', () => {
    expect(normalizeForMatch('Song (Remix)')).toBe('song remix');
  });
});

describe('dedupeAcrossSources', () => {
  test('drops later cross-source duplicates and repeated ids but keeps same-source near-duplicates', () => {
    const tracks = [
      t('audius', 1, 'Ketsa', 'Sunny Side'),
      t('jamendo', 2, 'KETSA', 'Sunny Side (feat. Someone)'),
      t('audius', 3, 'Ketsa', 'Sunny Side'),
      t('audius', 1, 'Ketsa', 'Sunny Side'),
    ];
    expect(dedupeAcrossSources(tracks).map((x) => x.id)).toEqual(['audius:1', 'audius:3']);
  });
});
