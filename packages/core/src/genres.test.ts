import { expect, test } from 'vitest';
import { DEFAULT_HOME_GENRES, GENRES } from './genres';

test('GENRES has no duplicates and uses Audius genre names', () => {
  expect(new Set(GENRES).size).toBe(GENRES.length);
  expect(GENRES).toContain('Lo-Fi');
  expect(GENRES).toContain('Hip-Hop/Rap');
});

test('home fallback genres are real genres', () => {
  for (const genre of DEFAULT_HOME_GENRES) expect(GENRES).toContain(genre);
});
