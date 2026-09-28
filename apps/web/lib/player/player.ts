import {
  type QueueContext,
  type QueueEnv,
  type QueueState,
  type QueueStep,
  queue as q,
  type Track,
} from '@riff/core';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AudioEngine, EngineEvents } from './engine';
import { PlayTracker, type RecordPlay } from './play-tracker';
import { toGain } from './volume';

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';

export interface PlayerState {
  queue: QueueState;
  status: PlayerStatus;
  /** Seconds into the current track. */
  position: number;
  /** Seconds; null for live streams and before anything is loaded. */
  duration: number | null;
  /** Slider position in [0, 1]; the element's volume is its square. */
  volume: number;
  muted: boolean;
}

/** What the player saves across reloads (see persistence.ts). */
export interface SavedPlayer {
  queue: QueueState;
  position: number;
  volume: number;
  muted: boolean;
}

export type EngineLike = Pick<
  AudioEngine,
  | 'loadedTrackId'
  | 'load'
  | 'play'
  | 'pause'
  | 'seek'
  | 'setVolume'
  | 'setMuted'
  | 'prefetch'
  | 'unload'
>;

export interface PlayerDeps {
  /** Called once, on the first action that needs audio (never during server rendering). */
  createEngine(events: EngineEvents): EngineLike;
  env: QueueEnv;
  recordPlay: RecordPlay;
  /** Shows a transient message (a toast in the app). */
  notify(message: string): void;
}

export interface PlayerActions {
  playContext(tracks: readonly Track[], startIndex: number, context: QueueContext): void;
  togglePlay(): void;
  next(): void;
  prev(): void;
  seek(positionSec: number): void;
  jumpTo(uid: string): void;
  addToQueue(tracks: readonly Track[]): void;
  playNext(tracks: readonly Track[]): void;
  removeFromQueue(uid: string): void;
  moveInQueue(uid: string, toIndex: number): void;
  clearUpNext(): void;
  toggleShuffle(): void;
  cycleRepeat(): void;
  setVolume(volume: number): void;
  toggleMute(): void;
  restore(saved: SavedPlayer): void;
  reset(): void;
}

export interface Player {
  store: StoreApi<PlayerState>;
  actions: PlayerActions;
}

/** After this many tracks fail in a row, stop instead of skipping through the whole queue. */
export const MAX_CONSECUTIVE_FAILURES = 3;

const initialState: PlayerState = {
  queue: q.emptyQueue,
  status: 'idle',
  position: 0,
  duration: null,
  volume: 1,
  muted: false,
};

/** The history `context` for a play: the queue context, unless the item was queued by hand. */
function historyContext(queue: QueueState): string | undefined {
  if (!queue.context || queue.currentFromUpNext) return undefined;
  const { type, id } = queue.context;
  return id ? `${type}:${id}` : type;
}

/**
 * The player: queue state from `@riff/core`, playback status, and the audio engine, wired
 * together. React reads `store`; everything else calls `actions`.
 */
export function createPlayer(deps: PlayerDeps): Player {
  const store = createStore<PlayerState>()(() => initialState);
  const { getState: get, setState: set } = store;
  const tracker = new PlayTracker(deps.recordPlay);
  let failures = 0;
  /** uid of the play whose next item has been prefetched. */
  let prefetchedAfter: string | null = null;

  const events: EngineEvents = {
    onStatus(status) {
      if (status === 'playing') {
        failures = 0;
        prefetchNext();
      }
      // A late `pause` from the element must not hide the ended or error state.
      const current = get().status;
      if (status === 'paused' && (current === 'ended' || current === 'error')) return;
      set({ status });
    },
    onTime(position) {
      const { status, muted, volume } = get();
      tracker.onTime(position, status === 'playing' && !muted && volume > 0);
      set({ position });
    },
    onDuration(duration) {
      set({ duration: duration ?? get().queue.current?.track.durationSec ?? null });
    },
    onEnded() {
      tracker.onEnded();
      apply(q.trackEnded(get().queue, deps.env));
    },
    onFailed(track) {
      failures++;
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        engine().unload();
        set({ status: 'error' });
        deps.notify('Playback stopped: several tracks in a row failed. Check your connection.');
        return;
      }
      deps.notify(`Couldn’t play “${track.title}”. Skipping.`);
      const step = q.next(get().queue, deps.env);
      if (step.effect !== 'play') set({ status: 'error' });
      else if (get().status === 'paused') {
        // The listener paused: move on, but load the next track only when they press play.
        const next = step.state.current?.track;
        set({ queue: step.state, position: 0, duration: next?.durationSec ?? null });
      } else apply(step);
    },
  };

  let engineInstance: EngineLike | null = null;
  const engine = (): EngineLike => {
    engineInstance ??= deps.createEngine(events);
    return engineInstance;
  };

  function startCurrent(startAt = 0): void {
    const { queue } = get();
    const item = queue.current;
    if (!item) return;
    tracker.start(item.track.id, historyContext(queue));
    prefetchedAfter = null;
    set({ status: 'loading', position: startAt, duration: item.track.durationSec });
    void engine().load(item.track, { autoplay: true, startAt });
  }

  function restart(): void {
    const item = get().queue.current;
    if (!item) return;
    tracker.start(item.track.id, historyContext(get().queue));
    engine().seek(0);
    set({ position: 0 });
    void engine().play();
  }

  function apply(step: QueueStep): void {
    set({ queue: step.state });
    if (step.effect === 'play') startCurrent();
    else if (step.effect === 'restart') restart();
    else if (step.effect === 'stop') {
      engine().pause();
      set({ status: 'ended' });
    }
  }

  function prefetchNext(): void {
    const { queue } = get();
    const current = queue.current;
    if (!current || prefetchedAfter === current.uid) return;
    prefetchedAfter = current.uid;
    const following = q.upcoming(queue)[0];
    if (following) void engine().prefetch(following.track);
  }

  const isLive = () => get().queue.current?.track.isLive ?? false;

  const actions: PlayerActions = {
    playContext(tracks, startIndex, context) {
      const before = get().queue;
      const queue = q.playContext(before, tracks, startIndex, context, deps.env);
      if (queue === before) return;
      failures = 0;
      set({ queue });
      startCurrent();
    },

    togglePlay() {
      const { queue, status, position } = get();
      const current = queue.current;
      if (!current) return;
      if (status === 'playing' || status === 'loading') {
        engine().pause();
        set({ status: 'paused' });
        return;
      }
      failures = 0;
      if (engine().loadedTrackId !== current.track.id) {
        // Restored from storage, or unloaded after errors: load it where it was.
        startCurrent(status === 'ended' || current.track.isLive ? 0 : position);
      } else if (status === 'ended') {
        restart();
      } else {
        void engine().play();
      }
    },

    next() {
      apply(q.next(get().queue, deps.env));
    },

    prev() {
      if (isLive()) return;
      apply(q.prev(get().queue, get().position));
    },

    seek(positionSec) {
      const { queue, duration } = get();
      if (!queue.current || isLive()) return;
      const max = duration ?? queue.current.track.durationSec ?? 0;
      const position = Math.min(Math.max(positionSec, 0), max);
      engine().seek(position);
      tracker.onSeek(position);
      set({ position });
    },

    jumpTo(uid) {
      apply(q.jumpTo(get().queue, uid));
    },

    addToQueue(tracks) {
      const queue = q.addToQueue(get().queue, tracks, deps.env);
      set({ queue });
      // With nothing loaded, adding to the queue starts it.
      if (!queue.current) apply(q.next(queue, deps.env));
    },

    playNext(tracks) {
      const queue = q.playNext(get().queue, tracks, deps.env);
      set({ queue });
      if (!queue.current) apply(q.next(queue, deps.env));
    },

    removeFromQueue(uid) {
      set({ queue: q.removeFromQueue(get().queue, uid) });
    },

    moveInQueue(uid, toIndex) {
      set({ queue: q.moveInQueue(get().queue, uid, toIndex) });
    },

    clearUpNext() {
      set({ queue: q.clearUpNext(get().queue) });
    },

    toggleShuffle() {
      set({ queue: q.toggleShuffle(get().queue, deps.env) });
    },

    cycleRepeat() {
      set({ queue: q.cycleRepeat(get().queue) });
    },

    setVolume(volume) {
      const clamped = Math.min(Math.max(volume, 0), 1);
      engine().setVolume(toGain(clamped));
      const muted = clamped > 0 ? false : get().muted;
      engine().setMuted(muted);
      set({ volume: clamped, muted });
    },

    toggleMute() {
      const muted = !get().muted;
      engine().setMuted(muted);
      set({ muted });
    },

    restore(saved) {
      const current = saved.queue.current;
      engine().setVolume(toGain(saved.volume));
      engine().setMuted(saved.muted);
      set({
        queue: saved.queue,
        status: current ? 'paused' : 'idle',
        position: current && !current.track.isLive ? saved.position : 0,
        duration: current?.track.durationSec ?? null,
        volume: saved.volume,
        muted: saved.muted,
      });
    },

    reset() {
      engine().unload();
      failures = 0;
      prefetchedAfter = null;
      set({ ...initialState, volume: get().volume, muted: get().muted });
    },
  };

  return { store, actions };
}
