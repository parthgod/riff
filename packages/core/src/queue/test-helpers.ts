import type { Track } from '../types';
import type { QueueContext, QueueEnv, QueueItem } from './types';

export const ctx: QueueContext = { type: 'playlist', id: 'p1', name: 'Test playlist' };

export function track(n: number): Track {
  return {
    id: `audius:t${n}`,
    source: 'audius',
    title: `Track ${n}`,
    artists: [{ id: 'audius:a1', name: 'Artist' }],
    durationSec: 180,
    isLive: false,
    artwork: {},
  };
}

export const tracks = (count: number): Track[] =>
  Array.from({ length: count }, (_, i) => track(i + 1));

/** Sequential uids and a seeded LCG, so shuffles are reproducible. */
export function testEnv(seed = 42): QueueEnv {
  let counter = 0;
  let state = seed >>> 0;
  return {
    uid: () => {
      counter += 1;
      return `u${counter}`;
    },
    rng: () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    },
  };
}

export const ids = (items: readonly QueueItem[]): string[] => items.map((item) => item.track.id);

export const currentId = (state: { current: QueueItem | null }): string | null =>
  state.current?.track.id ?? null;
