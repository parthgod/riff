import type { Artist, Track } from '@riff/core';

export function makeTrack(n: number | string, overrides: Partial<Track> = {}): Track {
  return {
    id: `audius:t${n}`,
    source: 'audius',
    title: `Track ${n}`,
    artists: [{ id: 'audius:a1', name: 'Artist 1' }],
    durationSec: 180,
    isLive: false,
    artwork: { sm: `https://img.example/t${n}/150.jpg`, md: `https://img.example/t${n}/480.jpg` },
    ...overrides,
  };
}

export function makeArtist(n: number | string, overrides: Partial<Artist> = {}): Artist {
  return {
    id: `audius:a${n}`,
    source: 'audius',
    name: `Artist ${n}`,
    avatar: {},
    verified: false,
    ...overrides,
  };
}
