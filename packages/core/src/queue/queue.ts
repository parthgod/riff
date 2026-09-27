import type { Track } from '../types';
import { shuffled } from './shuffle';
import type { QueueContext, QueueEnv, QueueItem, QueueState, QueueStep, RepeatMode } from './types';

/** Pressing "previous" later than this restarts the current track instead. */
export const RESTART_THRESHOLD_SEC = 3;

export const emptyQueue: QueueState = {
  context: null,
  original: [],
  order: [],
  index: -1,
  upNext: [],
  current: null,
  currentFromUpNext: false,
  shuffle: false,
  repeat: 'off',
};

const REPEAT_CYCLE: Record<RepeatMode, RepeatMode> = { off: 'all', all: 'one', one: 'off' };

const toItems = (tracks: readonly Track[], env: QueueEnv): QueueItem[] =>
  tracks.map((track) => ({ uid: env.uid(), track }));

const play = (state: QueueState): QueueStep => ({ state, effect: 'play' });

const stay = (state: QueueState, effect: 'restart' | 'stop' | 'none'): QueueStep => ({
  state,
  effect,
});

/** Replaces the context and starts playing `tracks[startIndex]`. Queued items are kept. */
export function playContext(
  state: QueueState,
  tracks: readonly Track[],
  startIndex: number,
  context: QueueContext,
  env: QueueEnv,
): QueueState {
  if (tracks.length === 0) return state;
  const items = toItems(tracks, env);
  const start = Math.min(Math.max(Math.trunc(startIndex), 0), items.length - 1);
  const first = items[start] as QueueItem;
  const order = state.shuffle
    ? [
        first,
        ...shuffled(
          items.filter((_, i) => i !== start),
          env.rng,
        ),
      ]
    : items;
  return {
    ...state,
    context,
    original: items,
    order,
    index: state.shuffle ? 0 : start,
    current: first,
    currentFromUpNext: false,
  };
}

export function next(state: QueueState, env: QueueEnv): QueueStep {
  const [head, ...rest] = state.upNext;
  if (head) return play({ ...state, upNext: rest, current: head, currentFromUpNext: true });

  const following = state.order[state.index + 1];
  if (following) {
    return play({ ...state, index: state.index + 1, current: following, currentFromUpNext: false });
  }

  if (state.repeat === 'all' && state.order.length > 0) {
    const order = state.shuffle ? reshuffle(state.order, state.current, env.rng) : state.order;
    return play({
      ...state,
      order,
      index: 0,
      current: order[0] as QueueItem,
      currentFromUpNext: false,
    });
  }
  return stay(state, 'stop');
}

export function trackEnded(state: QueueState, env: QueueEnv): QueueStep {
  if (state.repeat === 'one' && state.current) return stay(state, 'restart');
  return next(state, env);
}

export function prev(state: QueueState, positionSec: number): QueueStep {
  if (!state.current) return stay(state, 'none');
  if (positionSec > RESTART_THRESHOLD_SEC) return stay(state, 'restart');
  if (state.currentFromUpNext) {
    const anchor = state.order[state.index];
    return anchor
      ? play({ ...state, current: anchor, currentFromUpNext: false })
      : stay(state, 'restart');
  }
  const previous = state.order[state.index - 1];
  if (previous) return play({ ...state, index: state.index - 1, current: previous });
  return stay(state, 'restart');
}

export function cycleRepeat(state: QueueState): QueueState {
  return { ...state, repeat: REPEAT_CYCLE[state.repeat] };
}

/** Everything that will play after `current`, in order (what the queue panel shows). */
export function upcoming(state: QueueState): QueueItem[] {
  return [...state.upNext, ...state.order.slice(state.index + 1)];
}

export function hasNext(state: QueueState): boolean {
  return (
    state.upNext.length > 0 ||
    state.index + 1 < state.order.length ||
    (state.repeat === 'all' && state.order.length > 0)
  );
}

export function addToQueue(state: QueueState, tracks: readonly Track[], env: QueueEnv): QueueState {
  return { ...state, upNext: [...state.upNext, ...toItems(tracks, env)] };
}

export function playNext(state: QueueState, tracks: readonly Track[], env: QueueEnv): QueueState {
  return { ...state, upNext: [...toItems(tracks, env), ...state.upNext] };
}

function reshuffle(
  order: readonly QueueItem[],
  last: QueueItem | null,
  rng: () => number,
): QueueItem[] {
  const result = shuffled(order, rng);
  const end = result.length - 1;
  if (end > 0 && last && result[0]?.uid === last.uid) {
    const held = result[0];
    result[0] = result[end] as QueueItem;
    result[end] = held;
  }
  return result;
}

export function jumpTo(state: QueueState, uid: string): QueueStep {
  const queued = state.upNext.findIndex((item) => item.uid === uid);
  if (queued >= 0) {
    return play({
      ...state,
      upNext: state.upNext.slice(queued + 1),
      current: state.upNext[queued] as QueueItem,
      currentFromUpNext: true,
    });
  }
  const position = state.order.findIndex((item) => item.uid === uid);
  if (position > state.index) {
    return play({
      ...state,
      index: position,
      current: state.order[position] as QueueItem,
      currentFromUpNext: false,
    });
  }
  return stay(state, 'none');
}

export function removeFromQueue(state: QueueState, uid: string): QueueState {
  const keep = (item: QueueItem) => item.uid !== uid;
  if (state.upNext.some((item) => item.uid === uid)) {
    return { ...state, upNext: state.upNext.filter(keep) };
  }
  const position = state.order.findIndex((item) => item.uid === uid);
  if (position <= state.index) return state;
  return { ...state, order: state.order.filter(keep), original: state.original.filter(keep) };
}

export function moveInQueue(state: QueueState, uid: string, toIndex: number): QueueState {
  const from = state.upNext.findIndex((item) => item.uid === uid);
  if (from < 0) return state;
  const items = state.upNext.slice();
  const [moved] = items.splice(from, 1);
  const to = Math.min(Math.max(Math.trunc(toIndex), 0), items.length);
  items.splice(to, 0, moved as QueueItem);
  return { ...state, upNext: items };
}

export function clearUpNext(state: QueueState): QueueState {
  return { ...state, upNext: [] };
}

export function toggleShuffle(state: QueueState, env: QueueEnv): QueueState {
  const anchor = state.order[state.index];
  if (!state.shuffle) {
    const rest = shuffled(
      state.original.filter((item) => item.uid !== anchor?.uid),
      env.rng,
    );
    return anchor
      ? { ...state, shuffle: true, order: [anchor, ...rest], index: 0 }
      : { ...state, shuffle: true, order: rest, index: -1 };
  }
  const index = anchor ? state.original.findIndex((item) => item.uid === anchor.uid) : -1;
  return { ...state, shuffle: false, order: state.original, index };
}
