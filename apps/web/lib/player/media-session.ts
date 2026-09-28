import type { Track } from '@riff/core';
import type { Player, PlayerState } from './player';

/** The parts of `navigator.mediaSession` the player uses. */
export interface MediaSessionLike {
  metadata: MediaMetadata | MediaMetadataInit | null;
  playbackState: MediaSessionPlaybackState;
  setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null): void;
  setPositionState(state?: MediaPositionState): void;
}

export const SEEK_OFFSET_SEC = 10;

const ARTWORK_SIZES = [
  ['sm', '150x150'],
  ['md', '480x480'],
  ['lg', '1000x1000'],
] as const;

export function metadataFor(track: Track): MediaMetadataInit {
  return {
    title: track.title,
    artist: track.artists.map((artist) => artist.name).join(', '),
    album: track.album?.title ?? '',
    artwork: ARTWORK_SIZES.flatMap(([size, sizes]) => {
      const src = track.artwork[size];
      return src ? [{ src, sizes }] : [];
    }),
  };
}

const ACTIONS: MediaSessionAction[] = [
  'play',
  'pause',
  'previoustrack',
  'nexttrack',
  'seekto',
  'seekbackward',
  'seekforward',
];

/**
 * Connects the OS media controls (lock screen, media keys, headsets) to the player.
 * `toMetadata` is `(init) => new MediaMetadata(init)` in the browser.
 */
export function bindMediaSession(
  player: Player,
  session: MediaSessionLike,
  toMetadata: (init: MediaMetadataInit) => MediaMetadata | MediaMetadataInit,
): () => void {
  const { store, actions } = player;
  const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
    try {
      session.setActionHandler(action, handler);
    } catch {
      // Browsers throw for actions they do not support.
    }
  };

  const isPlaying = () => ['playing', 'loading'].includes(store.getState().status);
  set('play', () => {
    if (!isPlaying()) actions.togglePlay();
  });
  set('pause', () => {
    if (isPlaying()) actions.togglePlay();
  });
  set('nexttrack', () => actions.next());

  const bindSeeking = (live: boolean) => {
    set('previoustrack', live ? null : () => actions.prev());
    set('seekto', live ? null : (details) => actions.seek(details.seekTime ?? 0));
    set(
      'seekbackward',
      live
        ? null
        : (details) =>
            actions.seek(store.getState().position - (details.seekOffset ?? SEEK_OFFSET_SEC)),
    );
    set(
      'seekforward',
      live
        ? null
        : (details) =>
            actions.seek(store.getState().position + (details.seekOffset ?? SEEK_OFFSET_SEC)),
    );
  };

  const sync = (state: PlayerState, previous: PlayerState | null) => {
    const track = state.queue.current?.track ?? null;
    if (track !== (previous?.queue.current?.track ?? null)) {
      session.metadata = track ? toMetadata(metadataFor(track)) : null;
      bindSeeking(track?.isLive ?? false);
    }
    session.playbackState =
      state.status === 'playing' || state.status === 'loading'
        ? 'playing'
        : state.queue.current
          ? 'paused'
          : 'none';
  };

  sync(store.getState(), null);
  const unsubscribe = store.subscribe(sync);

  const timer = setInterval(() => {
    const { status, position, duration, queue } = store.getState();
    if (status !== 'playing' || queue.current?.track.isLive || !duration) return;
    try {
      session.setPositionState({
        duration,
        playbackRate: 1,
        position: Math.min(position, duration),
      });
    } catch {
      // Invalid states (e.g. a duration change mid-update) are skipped until the next tick.
    }
  }, 1_000);

  return () => {
    unsubscribe();
    clearInterval(timer);
    for (const action of ACTIONS) set(action, null);
  };
}
