import type { QueueContext } from '@riff/core';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { station, tracks } from '@/test/fixtures';
import { createTestPlayer } from '@/test/test-player';
import { bindMediaSession, type MediaSessionLike } from './media-session';

const ctx: QueueContext = { type: 'playlist', id: 'p1', name: 'Mix' };

class FakeMediaSession implements MediaSessionLike {
  metadata: MediaMetadataInit | null = null;
  playbackState: MediaSessionPlaybackState = 'none';
  handlers = new Map<MediaSessionAction, MediaSessionActionHandler | null>();
  setPositionState = vi.fn();
  setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
    this.handlers.set(action, handler);
  }
  fire(action: MediaSessionAction, details: Partial<MediaSessionActionDetails> = {}) {
    this.handlers.get(action)?.({ action, ...details });
  }
}

let session: FakeMediaSession;
const toMetadata = (init: MediaMetadataInit) => init;

beforeEach(() => {
  vi.useFakeTimers();
  session = new FakeMediaSession();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('bindMediaSession', () => {
  test('publishes the current track with every artwork size', () => {
    const { player } = createTestPlayer();
    const stop = bindMediaSession(player, session, toMetadata);
    player.actions.playContext(tracks(2), 0, ctx);
    expect(session.metadata).toEqual({
      title: 'Track 1',
      artist: 'Artist 1',
      album: '',
      artwork: [
        { src: 'https://img.test/1-150.jpg', sizes: '150x150' },
        { src: 'https://img.test/1-480.jpg', sizes: '480x480' },
      ],
    });
    stop();
  });

  test('mirrors the playback state', () => {
    const { player } = createTestPlayer();
    const stop = bindMediaSession(player, session, toMetadata);
    expect(session.playbackState).toBe('none');
    player.actions.playContext(tracks(1), 0, ctx);
    player.store.setState({ status: 'playing' });
    expect(session.playbackState).toBe('playing');
    player.store.setState({ status: 'paused' });
    expect(session.playbackState).toBe('paused');
    stop();
  });

  test('routes OS controls to the player', () => {
    const { player } = createTestPlayer();
    const next = vi.spyOn(player.actions, 'next');
    const prev = vi.spyOn(player.actions, 'prev');
    const seek = vi.spyOn(player.actions, 'seek');
    const toggle = vi.spyOn(player.actions, 'togglePlay');
    const stop = bindMediaSession(player, session, toMetadata);
    player.actions.playContext(tracks(2), 0, ctx);
    player.store.setState({ status: 'playing', position: 50 });
    session.fire('nexttrack');
    session.fire('previoustrack');
    session.fire('seekto', { seekTime: 90 });
    session.fire('seekforward', {});
    session.fire('seekbackward', { seekOffset: 30 });
    session.fire('play');
    session.fire('pause');
    expect(next).toHaveBeenCalledOnce();
    expect(prev).toHaveBeenCalledOnce();
    // Each seek moves the position the next relative seek starts from.
    expect(seek.mock.calls).toEqual([[90], [100], [70]]);
    // "play" while already playing does nothing; "pause" toggles.
    expect(toggle).toHaveBeenCalledOnce();
    stop();
  });

  test('updates the position state every second, but not for live streams', () => {
    const { player } = createTestPlayer();
    const stop = bindMediaSession(player, session, toMetadata);
    player.actions.playContext(tracks(1), 0, ctx);
    player.store.setState({ status: 'playing', position: 12, duration: 180 });
    vi.advanceTimersByTime(1_000);
    expect(session.setPositionState).toHaveBeenLastCalledWith({
      duration: 180,
      playbackRate: 1,
      position: 12,
    });
    session.setPositionState.mockClear();
    player.actions.playContext([station(1)], 0, { type: 'radio', name: 'Radio' });
    player.store.setState({ status: 'playing', position: 30, duration: null });
    vi.advanceTimersByTime(3_000);
    expect(session.setPositionState).not.toHaveBeenCalled();
    stop();
  });

  test('live stations disable seeking and previous in the OS controls', () => {
    const { player } = createTestPlayer();
    const stop = bindMediaSession(player, session, toMetadata);
    player.actions.playContext([station(1)], 0, { type: 'radio', name: 'Radio' });
    expect(session.handlers.get('seekto')).toBeNull();
    expect(session.handlers.get('previoustrack')).toBeNull();
    player.actions.playContext(tracks(1), 0, ctx);
    expect(session.handlers.get('seekto')).toBeTypeOf('function');
    stop();
  });

  test('cleanup removes every handler', () => {
    const { player } = createTestPlayer();
    const stop = bindMediaSession(player, session, toMetadata);
    stop();
    expect([...session.handlers.values()].every((handler) => handler === null)).toBe(true);
  });
});
