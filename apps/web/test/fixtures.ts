import type { Track } from '@riff/core';

/** A finite Audius-style track. `n` keeps ids and titles distinct. */
export function track(n: number, overrides: Partial<Track> = {}): Track {
  return {
    id: `audius:t${n}`,
    source: 'audius',
    title: `Track ${n}`,
    artists: [{ id: `audius:a${n}`, name: `Artist ${n}` }],
    durationSec: 180,
    isLive: false,
    artwork: { sm: `https://img.test/${n}-150.jpg`, md: `https://img.test/${n}-480.jpg` },
    genre: 'Electronic',
    ...overrides,
  };
}

export const tracks = (count: number): Track[] =>
  Array.from({ length: count }, (_, i) => track(i + 1));

/** A live radio station. */
export function station(n: number): Track {
  return {
    id: `radio:9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6${n}`,
    source: 'radio',
    title: `Station ${n}`,
    artists: [],
    durationSec: null,
    isLive: true,
    artwork: {},
  };
}
