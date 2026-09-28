import type { Track } from '../types';

export const REPEAT_MODES = ['off', 'all', 'one'] as const;
export type RepeatMode = (typeof REPEAT_MODES)[number];

export const QUEUE_CONTEXT_TYPES = [
  'playlist',
  'collection',
  'artist',
  'liked',
  'search',
  'trending',
  'radio',
  'history',
] as const;
export type QueueContextType = (typeof QUEUE_CONTEXT_TYPES)[number];

export interface QueueContext {
  type: QueueContextType;
  id?: string;
  name: string;
}

/** `uid` distinguishes two entries of the same track. */
export interface QueueItem {
  uid: string;
  track: Track;
}

export interface QueueState {
  context: QueueContext | null;
  /** Context items in their original order. */
  original: QueueItem[];
  /** Play order: equal to `original` unless shuffled. */
  order: QueueItem[];
  /** Position in `order` of the last context item played; -1 before any. */
  index: number;
  /** User-queued items, played before the context continues. */
  upNext: QueueItem[];
  current: QueueItem | null;
  currentFromUpNext: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
}

/** What the audio engine must do after a transition. */
export type QueueEffect = 'play' | 'restart' | 'stop' | 'none';

export interface QueueStep {
  state: QueueState;
  effect: QueueEffect;
}

/** Injected so the state machine stays pure and deterministic under test. */
export interface QueueEnv {
  /** Returns a float in [0, 1). */
  rng: () => number;
  uid: () => string;
}
